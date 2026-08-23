# Mural do time — compartilhar feedback e exibir selos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o alvo de um feedback público o compartilhe e exibir, num banner-carrossel no topo de `/time`, um mural global com feedbacks compartilhados e selos conquistados nos últimos 30 dias.

**Architecture:** Backend Fastify + Prisma ganha o campo `Feedback.sharedAt`, endpoints de toggle (`POST`/`DELETE /feedbacks/:id/share`) e um endpoint agregador `GET /mural`. Frontend React + react-query ganha um botão "Compartilhar" no card de feedback e um componente `MuralBanner` renderizado no topo da página Time. Tipos compartilhados ficam em `packages/shared`.

**Tech Stack:** TypeScript, Fastify, Prisma (PostgreSQL), Zod, Vitest, React, react-query, Tailwind, Vitest + Testing Library.

## Global Constraints

- Monorepo pnpm. API em `apps/api`, web em `apps/web`, tipos em `packages/shared`.
- Apenas categorias **públicas** podem ser compartilhadas: `POSITIVO`, `ELOGIO` (constante `PUBLIC_FEEDBACK_CATEGORIES` em `@legends/shared`).
- Apenas o **alvo** (`targetId`) do feedback compartilha/descompartilha.
- Selos entram no mural **automaticamente**; não há compartilhamento de selo.
- Janela do mural: **últimos 30 dias**, ordenado por timestamp desc.
- Mensagens de UI e erro em **português**.
- Comandos rodam da raiz do repo. Testes da API: `pnpm --filter @legends/api test`. Testes web: `pnpm --filter @legends/web test`. Type-check dos tipos: `pnpm --filter @legends/shared exec tsc --noEmit`.
- `@legends/shared` é consumido como **código-fonte** (`main`/`types` apontam para `./src/index.ts`); não há script `build` nem `dist`. API e web resolvem os tipos direto do `.ts`. Após editar `packages/shared`, valide com `pnpm --filter @legends/shared exec tsc --noEmit` — não há passo de build a rodar.

---

## File Structure

- `apps/api/prisma/schema.prisma` — adiciona `Feedback.sharedAt` + índice.
- `apps/api/prisma/migrations/<timestamp>_feedback_shared_at/migration.sql` — migration nova.
- `packages/shared/src/feedback.ts` — `sharedAt` em `FeedbackDTO`.
- `packages/shared/src/mural.ts` — **novo**: tipos do mural (`MuralItemDTO` etc.).
- `packages/shared/src/index.ts` — exporta `./mural`.
- `apps/api/src/services/feedback-service.ts` — `setFeedbackShared()`.
- `apps/api/src/services/mural-service.ts` — **novo**: `getMuralItems()`.
- `apps/api/src/lib/serialize.ts` — `sharedAt` no `toFeedbackDTO`; `toMuralFeedbackItem` / `toMuralBadgeItem`.
- `apps/api/src/routes/feedback.ts` — rotas de share.
- `apps/api/src/routes/mural.ts` — **novo**: `GET /mural`.
- `apps/api/src/app.ts` — registra `muralRoutes`.
- `apps/web/src/pages/profile/FeedbackSection.tsx` — botão Compartilhar.
- `apps/web/src/components/MuralBanner.tsx` — **novo**: carrossel.
- `apps/web/src/pages/TeamPage.tsx` — monta `MuralBanner` no topo.
- Testes: `mural-service.test.ts`, `mural.test.ts` (routes), `feedback.test.ts` (share), `MuralBanner.test.tsx`, `FeedbackSection.test.tsx`.

---

## Task 1: Schema + migration `Feedback.sharedAt`

**Files:**
- Modify: `apps/api/prisma/schema.prisma:172-188`
- Create: `apps/api/prisma/migrations/20260617120000_feedback_shared_at/migration.sql`

**Interfaces:**
- Produces: coluna `Feedback.sharedAt: DateTime?` + índice `Feedback_sharedAt_idx`.

- [ ] **Step 1: Adicionar o campo ao modelo `Feedback`**

Em `apps/api/prisma/schema.prisma`, no `model Feedback`, depois de `updatedAt`:

```prisma
model Feedback {
  id         String           @id @default(cuid())
  authorId   String
  targetId   String
  message    String
  category   FeedbackCategory
  sharedAt   DateTime?
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt

  author    User               @relation("FeedbacksGiven", fields: [authorId], references: [id])
  target    User               @relation("FeedbacksReceived", fields: [targetId], references: [id])
  reactions FeedbackReaction[]

  @@index([targetId])
  @@index([authorId])
  @@index([targetId, category])
  @@index([sharedAt])
}
```

- [ ] **Step 2: Criar a migration SQL manualmente**

Crie `apps/api/prisma/migrations/20260617120000_feedback_shared_at/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN "sharedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Feedback_sharedAt_idx" ON "Feedback"("sharedAt");
```

- [ ] **Step 3: Gerar o Prisma Client**

Run: `pnpm --filter @legends/api exec prisma generate`
Expected: "Generated Prisma Client" sem erros.

- [ ] **Step 4: Aplicar a migration no banco de testes/dev**

Run: `pnpm --filter @legends/api exec prisma migrate deploy`
Expected: aplica `20260617120000_feedback_shared_at` sem erro. (Se o banco não estiver acessível, isso roda no setup de teste; prossiga.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260617120000_feedback_shared_at
git commit -m "feat(api): adiciona Feedback.sharedAt + migration"
```

---

## Task 2: Tipos compartilhados (`sharedAt` + mural)

**Files:**
- Modify: `packages/shared/src/feedback.ts:43-52`
- Create: `packages/shared/src/mural.ts`
- Modify: `packages/shared/src/index.ts:10`

**Interfaces:**
- Consumes: `PublicUser` de `./auth`; `FeedbackCategory`, `ReactionSummary` de `./feedback`.
- Produces: `FeedbackDTO.sharedAt: string | null`; `MuralFeedbackItem`, `MuralBadgeItem`, `MuralItemDTO`, `MuralResponse`.

- [ ] **Step 1: Adicionar `sharedAt` ao `FeedbackDTO`**

Em `packages/shared/src/feedback.ts`, no `interface FeedbackDTO`, depois de `updatedAt: string`:

```ts
export interface FeedbackDTO {
  id: string
  author: PublicUser
  message: string
  category: FeedbackCategory
  createdAt: string
  updatedAt: string
  /** ISO do momento em que o alvo compartilhou no mural; null = não compartilhado. */
  sharedAt: string | null
  reactions: ReactionSummary[]
}
```

- [ ] **Step 2: Criar os tipos do mural**

Crie `packages/shared/src/mural.ts`:

```ts
import type { PublicUser } from './auth'
import type { FeedbackCategory, ReactionSummary } from './feedback'

export interface MuralFeedbackItem {
  type: 'feedback'
  id: string
  /** ISO usado para ordenar o mural (sharedAt do feedback). */
  timestamp: string
  target: PublicUser
  author: PublicUser
  message: string
  category: FeedbackCategory
  reactions: ReactionSummary[]
}

export interface MuralBadgeItem {
  type: 'badge'
  /** id do UserBadge. */
  id: string
  /** ISO usado para ordenar o mural (awardedAt do selo). */
  timestamp: string
  user: PublicUser
  badge: { slug: string; name: string; description: string; iconKey: string; kind: string }
}

export type MuralItemDTO = MuralFeedbackItem | MuralBadgeItem

export interface MuralResponse {
  items: MuralItemDTO[]
}
```

- [ ] **Step 3: Exportar o novo módulo**

Em `packages/shared/src/index.ts`, adicione após a linha `export * from './feedback'`:

```ts
export * from './mural'
```

- [ ] **Step 4: Type-check do pacote shared**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: sem erros de tipo. (O pacote é consumido como código-fonte; não há `build`/`dist`.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/feedback.ts packages/shared/src/mural.ts packages/shared/src/index.ts
git commit -m "feat(shared): sharedAt em FeedbackDTO + tipos do mural"
```

---

## Task 3: `serialize.ts` — `sharedAt` + serializadores do mural

**Files:**
- Modify: `apps/api/src/lib/serialize.ts:136-146` (toFeedbackDTO) e imports
- Test: `apps/api/src/lib/serialize.test.ts` (criar se não existir)

**Interfaces:**
- Consumes: `FeedbackWithAuthor` de `../services/feedback-service`.
- Produces: `toFeedbackDTO` agora preenche `sharedAt`; `toMuralFeedbackItem(feedback, viewerId)` e `toMuralBadgeItem(userBadge)`.

- [ ] **Step 1: Escrever o teste falhando**

Crie/edite `apps/api/src/lib/serialize.test.ts` adicionando:

```ts
import { describe, it, expect } from 'vitest'
import { toMuralBadgeItem } from './serialize'

describe('toMuralBadgeItem', () => {
  it('mapeia um UserBadge para item de mural', () => {
    const item = toMuralBadgeItem({
      id: 'ub1',
      awardedAt: new Date('2026-06-10T12:00:00Z'),
      user: {
        id: 'u1', name: 'Ana', email: 'a@x.com', role: 'DEV', position: null, squad: null,
        photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null,
        active: true, joinedAt: new Date('2026-01-01T00:00:00Z'),
      },
      badge: { slug: 's', name: 'Selo', description: 'desc', iconKey: 'k', kind: 'IMPACT' },
    } as never)
    expect(item.type).toBe('badge')
    expect(item.id).toBe('ub1')
    expect(item.timestamp).toBe('2026-06-10T12:00:00.000Z')
    expect(item.user.name).toBe('Ana')
    expect(item.badge.name).toBe('Selo')
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test -- serialize`
Expected: FAIL — `toMuralBadgeItem` não existe.

- [ ] **Step 3: Implementar serializadores e preencher `sharedAt`**

Em `apps/api/src/lib/serialize.ts`:

1. No topo, adicione os imports de tipo:

```ts
import type { MuralFeedbackItem, MuralBadgeItem } from '@legends/shared'
```

2. No `toFeedbackDTO`, adicione `sharedAt` antes de `reactions`:

```ts
export function toFeedbackDTO(feedback: FeedbackWithAuthor, viewerId: string): FeedbackDTO {
  return {
    id: feedback.id,
    author: toPublicUser(feedback.author),
    message: feedback.message,
    category: feedback.category,
    createdAt: feedback.createdAt.toISOString(),
    updatedAt: feedback.updatedAt.toISOString(),
    sharedAt: feedback.sharedAt ? feedback.sharedAt.toISOString() : null,
    reactions: summarizeReactions(feedback.reactions, viewerId),
  }
}
```

3. No fim do arquivo, adicione os serializadores do mural. `MuralFeedbackWithRelations` e `MuralBadgeWithRelations` vêm do mural-service (Task 4) — aqui usamos tipos estruturais mínimos para não criar dependência circular:

```ts
type MuralFeedbackRow = FeedbackWithAuthor & {
  target: User
  sharedAt: Date | null
}

export function toMuralFeedbackItem(feedback: MuralFeedbackRow, viewerId: string): MuralFeedbackItem {
  return {
    type: 'feedback',
    id: feedback.id,
    timestamp: (feedback.sharedAt ?? feedback.createdAt).toISOString(),
    target: toPublicUser(feedback.target),
    author: toPublicUser(feedback.author),
    message: feedback.message,
    category: feedback.category,
    reactions: summarizeReactions(feedback.reactions, viewerId),
  }
}

type MuralBadgeRow = {
  id: string
  awardedAt: Date
  user: User
  badge: { slug: string; name: string; description: string; iconKey: string; kind: string }
}

export function toMuralBadgeItem(row: MuralBadgeRow): MuralBadgeItem {
  return {
    type: 'badge',
    id: row.id,
    timestamp: row.awardedAt.toISOString(),
    user: toPublicUser(row.user),
    badge: {
      slug: row.badge.slug,
      name: row.badge.name,
      description: row.badge.description,
      iconKey: row.badge.iconKey,
      kind: row.badge.kind,
    },
  }
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api test -- serialize`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/lib/serialize.test.ts
git commit -m "feat(api): serializadores do mural + sharedAt no FeedbackDTO"
```

---

## Task 4: `feedback-service` — `setFeedbackShared()`

**Files:**
- Modify: `apps/api/src/services/feedback-service.ts` (após `updateFeedback`)
- Test: `apps/api/src/services/feedback-service.test.ts`

**Interfaces:**
- Consumes: `prisma`, `FeedbackError`, `PUBLIC_FEEDBACK_CATEGORIES`, `feedbackInclude`.
- Produces: `setFeedbackShared({ feedbackId, userId, shared }): Promise<FeedbackWithAuthor>`.

- [ ] **Step 1: Escrever o teste falhando**

Em `apps/api/src/services/feedback-service.test.ts`, adicione um bloco. Use os helpers de criação de usuário/feedback que já existem no arquivo; se não houver, crie inline com `prisma`. Teste mínimo:

```ts
import { setFeedbackShared, FeedbackError } from './feedback-service'

describe('setFeedbackShared', () => {
  it('marca sharedAt quando o alvo compartilha um feedback público', async () => {
    const author = await prisma.user.create({ data: { name: 'A', email: 'a-share@x.com', passwordHash: 'x' } })
    const target = await prisma.user.create({ data: { name: 'T', email: 't-share@x.com', passwordHash: 'x' } })
    const fb = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'mensagem bem específica aqui', category: 'POSITIVO' },
    })
    const updated = await setFeedbackShared({ feedbackId: fb.id, userId: target.id, shared: true })
    expect(updated.sharedAt).not.toBeNull()
  })

  it('rejeita quem não é o alvo (403)', async () => {
    const author = await prisma.user.create({ data: { name: 'A', email: 'a-share2@x.com', passwordHash: 'x' } })
    const target = await prisma.user.create({ data: { name: 'T', email: 't-share2@x.com', passwordHash: 'x' } })
    const fb = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'mensagem bem específica aqui', category: 'POSITIVO' },
    })
    await expect(setFeedbackShared({ feedbackId: fb.id, userId: author.id, shared: true }))
      .rejects.toBeInstanceOf(FeedbackError)
  })

  it('rejeita categoria privada (403)', async () => {
    const author = await prisma.user.create({ data: { name: 'A', email: 'a-share3@x.com', passwordHash: 'x' } })
    const target = await prisma.user.create({ data: { name: 'T', email: 't-share3@x.com', passwordHash: 'x' } })
    const fb = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'mensagem bem específica aqui', category: 'MELHORIA' },
    })
    await expect(setFeedbackShared({ feedbackId: fb.id, userId: target.id, shared: true }))
      .rejects.toBeInstanceOf(FeedbackError)
  })

  it('descompartilha limpando sharedAt', async () => {
    const author = await prisma.user.create({ data: { name: 'A', email: 'a-share4@x.com', passwordHash: 'x' } })
    const target = await prisma.user.create({ data: { name: 'T', email: 't-share4@x.com', passwordHash: 'x' } })
    const fb = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'mensagem bem específica aqui', category: 'ELOGIO', sharedAt: new Date() },
    })
    const updated = await setFeedbackShared({ feedbackId: fb.id, userId: target.id, shared: false })
    expect(updated.sharedAt).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test -- feedback-service`
Expected: FAIL — `setFeedbackShared` não existe.

- [ ] **Step 3: Implementar `setFeedbackShared`**

Em `apps/api/src/services/feedback-service.ts`, adicione (note: `PUBLIC_FEEDBACK_CATEGORIES` já está importado):

```ts
export async function setFeedbackShared(
  input: { feedbackId: string; userId: string; shared: boolean },
): Promise<FeedbackWithAuthor> {
  const existing = await prisma.feedback.findUnique({ where: { id: input.feedbackId } })
  if (!existing) {
    throw new FeedbackError('Feedback não encontrado.', 404)
  }
  if (existing.targetId !== input.userId) {
    throw new FeedbackError('Apenas quem recebeu o feedback pode compartilhá-lo.', 403)
  }
  if (!(PUBLIC_FEEDBACK_CATEGORIES as readonly string[]).includes(existing.category)) {
    throw new FeedbackError('Só é possível compartilhar feedbacks públicos.', 403)
  }
  return prisma.feedback.update({
    where: { id: input.feedbackId },
    data: { sharedAt: input.shared ? new Date() : null },
    include: feedbackInclude,
  })
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api test -- feedback-service`
Expected: PASS (4 novos testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/feedback-service.ts apps/api/src/services/feedback-service.test.ts
git commit -m "feat(api): setFeedbackShared no feedback-service"
```

---

## Task 5: `mural-service` — `getMuralItems()`

**Files:**
- Create: `apps/api/src/services/mural-service.ts`
- Test: `apps/api/src/services/mural-service.test.ts`

**Interfaces:**
- Consumes: `prisma`, `PUBLIC_FEEDBACK_CATEGORIES`, `feedbackInclude` de `./feedback-service`, `toMuralFeedbackItem`/`toMuralBadgeItem` de `../lib/serialize`.
- Produces: `getMuralItems(viewerId: string, now?: Date): Promise<MuralItemDTO[]>`.

- [ ] **Step 1: Escrever o teste falhando**

Crie `apps/api/src/services/mural-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { getMuralItems } from './mural-service'

async function makeUser(email: string) {
  return prisma.user.create({ data: { name: email, email, passwordHash: 'x' } })
}

describe('getMuralItems', () => {
  it('inclui feedback público compartilhado dentro de 30d e exclui não compartilhado', async () => {
    const author = await makeUser('m-author@x.com')
    const target = await makeUser('m-target@x.com')
    const shared = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback compartilhado específico', category: 'POSITIVO', sharedAt: new Date() },
    })
    await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback não compartilhado aqui', category: 'POSITIVO' },
    })
    const items = await getMuralItems(target.id)
    const fbItems = items.filter((i) => i.type === 'feedback')
    expect(fbItems.map((i) => i.id)).toContain(shared.id)
    expect(fbItems).toHaveLength(1)
  })

  it('exclui feedback compartilhado há mais de 30 dias', async () => {
    const author = await makeUser('m-old-author@x.com')
    const target = await makeUser('m-old-target@x.com')
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback antigo demais aqui', category: 'POSITIVO', sharedAt: old },
    })
    const items = await getMuralItems(target.id)
    expect(items.filter((i) => i.type === 'feedback')).toHaveLength(0)
  })

  it('ordena por timestamp desc (mais recente primeiro)', async () => {
    const author = await makeUser('m-ord-author@x.com')
    const target = await makeUser('m-ord-target@x.com')
    const older = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    const newer = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
    const a = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback mais antigo do par', category: 'POSITIVO', sharedAt: older },
    })
    const b = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback mais recente do par', category: 'ELOGIO', sharedAt: newer },
    })
    const items = await getMuralItems(target.id)
    const ids = items.filter((i) => i.type === 'feedback').map((i) => i.id)
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id))
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test -- mural-service`
Expected: FAIL — módulo `mural-service` não existe.

- [ ] **Step 3: Implementar `getMuralItems`**

Crie `apps/api/src/services/mural-service.ts`:

```ts
import { PUBLIC_FEEDBACK_CATEGORIES, type MuralItemDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { feedbackInclude } from './feedback-service'
import { toMuralFeedbackItem, toMuralBadgeItem } from '../lib/serialize'

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export async function getMuralItems(viewerId: string, now: Date = new Date()): Promise<MuralItemDTO[]> {
  const since = new Date(now.getTime() - WINDOW_MS)

  const [feedbacks, badges] = await Promise.all([
    prisma.feedback.findMany({
      where: {
        sharedAt: { gte: since },
        category: { in: [...PUBLIC_FEEDBACK_CATEGORIES] },
      },
      include: { ...feedbackInclude, target: true },
      orderBy: { sharedAt: 'desc' },
    }),
    prisma.userBadge.findMany({
      where: { awardedAt: { gte: since } },
      include: { user: true, badge: true },
      orderBy: { awardedAt: 'desc' },
    }),
  ])

  const items: MuralItemDTO[] = [
    ...feedbacks.map((f) => toMuralFeedbackItem(f, viewerId)),
    ...badges.map((b) => toMuralBadgeItem(b)),
  ]
  return items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api test -- mural-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/mural-service.ts apps/api/src/services/mural-service.test.ts
git commit -m "feat(api): mural-service getMuralItems (janela 30d, feedback + selos)"
```

---

## Task 6: Rotas de share no `feedback.ts`

**Files:**
- Modify: `apps/api/src/routes/feedback.ts` (imports + novas rotas)
- Test: `apps/api/src/routes/feedback.test.ts`

**Interfaces:**
- Consumes: `setFeedbackShared` de `../services/feedback-service`.
- Produces: `POST /feedbacks/:id/share` e `DELETE /feedbacks/:id/share` → `{ feedback: FeedbackDTO }`.

- [ ] **Step 1: Escrever o teste falhando**

Em `apps/api/src/routes/feedback.test.ts`, adicione (o `setup()` cria `authorId` = quem registra/token, e `lead` é o alvo; aqui o **alvo** precisa do token, então registramos o alvo). Use o padrão do arquivo:

```ts
describe('compartilhar feedback', () => {
  it('alvo compartilha feedback público (200) e sharedAt fica preenchido', async () => {
    const app = buildApp()
    await app.ready()
    // autor registra e dá feedback ao alvo
    const authorReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Autor', email: 'autor-sh@x.com', password: 'changeme123' } })
    const authorToken = authorReg.json().accessToken as string
    const targetReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Alvo', email: 'alvo-sh@x.com', password: 'changeme123' } })
    const targetToken = targetReg.json().accessToken as string
    const targetId = targetReg.json().user.id as string
    const created = await app.inject({ method: 'POST', url: `/users/${targetId}/feedbacks`, headers: { authorization: `Bearer ${authorToken}` }, payload: MSG })
    const fbId = created.json().feedback.id as string

    const res = await app.inject({ method: 'POST', url: `/feedbacks/${fbId}/share`, headers: { authorization: `Bearer ${targetToken}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().feedback.sharedAt).not.toBeNull()
    await app.close()
  })

  it('autor (não-alvo) não pode compartilhar (403)', async () => {
    const app = buildApp()
    await app.ready()
    const authorReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Autor', email: 'autor-sh2@x.com', password: 'changeme123' } })
    const authorToken = authorReg.json().accessToken as string
    const targetReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Alvo', email: 'alvo-sh2@x.com', password: 'changeme123' } })
    const targetId = targetReg.json().user.id as string
    const created = await app.inject({ method: 'POST', url: `/users/${targetId}/feedbacks`, headers: { authorization: `Bearer ${authorToken}` }, payload: MSG })
    const fbId = created.json().feedback.id as string

    const res = await app.inject({ method: 'POST', url: `/feedbacks/${fbId}/share`, headers: { authorization: `Bearer ${authorToken}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('descompartilha via DELETE (200) e sharedAt vira null', async () => {
    const app = buildApp()
    await app.ready()
    const authorReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Autor', email: 'autor-sh3@x.com', password: 'changeme123' } })
    const authorToken = authorReg.json().accessToken as string
    const targetReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Alvo', email: 'alvo-sh3@x.com', password: 'changeme123' } })
    const targetToken = targetReg.json().accessToken as string
    const targetId = targetReg.json().user.id as string
    const created = await app.inject({ method: 'POST', url: `/users/${targetId}/feedbacks`, headers: { authorization: `Bearer ${authorToken}` }, payload: MSG })
    const fbId = created.json().feedback.id as string
    await app.inject({ method: 'POST', url: `/feedbacks/${fbId}/share`, headers: { authorization: `Bearer ${targetToken}` } })

    const res = await app.inject({ method: 'DELETE', url: `/feedbacks/${fbId}/share`, headers: { authorization: `Bearer ${targetToken}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().feedback.sharedAt).toBeNull()
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test -- feedback.test`
Expected: FAIL — rota `/feedbacks/:id/share` retorna 404.

- [ ] **Step 3: Implementar as rotas**

Em `apps/api/src/routes/feedback.ts`:

1. Adicione `setFeedbackShared` ao import de `../services/feedback-service`:

```ts
import {
  FeedbackError,
  createFeedback,
  deleteFeedback,
  listFeedbacksForUser,
  setFeedbackShared,
  toggleReaction,
  updateFeedback,
} from '../services/feedback-service'
```

2. Dentro de `feedbackRoutes`, antes do fechamento da função, adicione:

```ts
  app.post('/feedbacks/:id/share', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const feedback = await setFeedbackShared({ feedbackId: id, userId: request.user.sub, shared: true })
      return reply.send({ feedback: toFeedbackDTO(feedback, request.user.sub) })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/feedbacks/:id/share', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const feedback = await setFeedbackShared({ feedbackId: id, userId: request.user.sub, shared: false })
      return reply.send({ feedback: toFeedbackDTO(feedback, request.user.sub) })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api test -- feedback.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/feedback.ts apps/api/src/routes/feedback.test.ts
git commit -m "feat(api): rotas POST/DELETE /feedbacks/:id/share"
```

---

## Task 7: Rota `GET /mural`

**Files:**
- Create: `apps/api/src/routes/mural.ts`
- Modify: `apps/api/src/app.ts:18,60`
- Test: `apps/api/src/routes/mural.test.ts`

**Interfaces:**
- Consumes: `getMuralItems` de `../services/mural-service`.
- Produces: `GET /mural` → `{ items: MuralItemDTO[] }`.

- [ ] **Step 1: Escrever o teste falhando**

Crie `apps/api/src/routes/mural.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'

describe('GET /mural', () => {
  it('exige autenticação (401)', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/mural' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('devolve itens com feedback compartilhado', async () => {
    const app = buildApp()
    await app.ready()
    const authorReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Autor', email: 'mural-a@x.com', password: 'changeme123' } })
    const authorToken = authorReg.json().accessToken as string
    const targetReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Alvo', email: 'mural-t@x.com', password: 'changeme123' } })
    const targetToken = targetReg.json().accessToken as string
    const targetId = targetReg.json().user.id as string
    const created = await app.inject({
      method: 'POST', url: `/users/${targetId}/feedbacks`, headers: { authorization: `Bearer ${authorToken}` },
      payload: { message: 'Feedback bem específico para o mural do time.', category: 'POSITIVO' },
    })
    const fbId = created.json().feedback.id as string
    await app.inject({ method: 'POST', url: `/feedbacks/${fbId}/share`, headers: { authorization: `Bearer ${targetToken}` } })

    const res = await app.inject({ method: 'GET', url: '/mural', headers: { authorization: `Bearer ${targetToken}` } })
    expect(res.statusCode).toBe(200)
    const items = res.json().items as { type: string; id: string }[]
    expect(items.some((i) => i.type === 'feedback' && i.id === fbId)).toBe(true)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test -- mural.test`
Expected: FAIL — `/mural` retorna 404 (rota inexistente).

- [ ] **Step 3: Criar a rota**

Crie `apps/api/src/routes/mural.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { getMuralItems } from '../services/mural-service'

export async function muralRoutes(app: FastifyInstance) {
  app.get('/mural', { onRequest: [app.authenticate] }, async (request, reply) => {
    const items = await getMuralItems(request.user.sub)
    return reply.send({ items })
  })
}
```

- [ ] **Step 4: Registrar a rota no app**

Em `apps/api/src/app.ts`, adicione o import após `highlightRoutes`:

```ts
import { muralRoutes } from './routes/mural'
```

E registre após `app.register(highlightRoutes)`:

```ts
  app.register(muralRoutes)
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api test -- mural.test`
Expected: PASS.

- [ ] **Step 6: Rodar toda a suíte da API**

Run: `pnpm --filter @legends/api test`
Expected: tudo PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/mural.ts apps/api/src/routes/mural.test.ts apps/api/src/app.ts
git commit -m "feat(api): GET /mural"
```

---

## Task 8: Botão "Compartilhar" no card de feedback

**Files:**
- Modify: `apps/web/src/pages/profile/FeedbackSection.tsx`
- Test: `apps/web/src/pages/profile/FeedbackSection.test.tsx`

**Interfaces:**
- Consumes: `FeedbackDTO.sharedAt`, `PUBLIC_FEEDBACK_CATEGORIES`, endpoints `POST`/`DELETE /feedbacks/:id/share`.
- Produces: botão de toggle visível só para o alvo (`user.id === targetId`) em categoria pública; invalida `['feedbacks', targetId]` e `['mural']`.

- [ ] **Step 1: Escrever o teste falhando**

Em `apps/web/src/pages/profile/FeedbackSection.test.tsx`, adicione um teste que monta a seção como o **alvo** vendo um feedback público e espera o botão "Compartilhar". Siga o padrão de mock de `apiFetch` e do `AuthContext` já usado no arquivo. Estrutura do caso:

```tsx
it('mostra botão Compartilhar para o alvo em feedback público', async () => {
  // Arrange: usuário logado é o alvo (user.id === targetId);
  // apiFetch de /users/:id/feedbacks retorna 1 feedback POSITIVO com sharedAt: null.
  // (use os mesmos mocks/wrappers dos outros testes deste arquivo)
  // Act: render <FeedbackSection targetId={MEU_ID} />
  // Assert:
  expect(await screen.findByRole('button', { name: /compartilhar/i })).toBeInTheDocument()
})
```

Implemente o corpo seguindo o setup existente do arquivo (mesmo `renderWithProviders`/mocks dos testes vizinhos — repita o padrão local, não invente um novo).

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/web test -- FeedbackSection`
Expected: FAIL — botão não existe.

- [ ] **Step 3: Implementar o botão e a mutation**

Em `apps/web/src/pages/profile/FeedbackSection.tsx`:

1. Importe a constante de categorias públicas:

```ts
import { MIN_FEEDBACK_FIELD_LENGTH, FEEDBACK_CATEGORIES, FEEDBACK_CATEGORY_LABELS, FEEDBACK_REACTIONS, PUBLIC_FEEDBACK_CATEGORIES } from '@legends/shared'
```

2. Dentro do componente, após a mutation `toggleReaction`, adicione a mutation de share. Ela invalida tanto os feedbacks do perfil quanto o mural:

```ts
  const toggleShare = useMutation({
    mutationFn: (vars: { id: string; shared: boolean }) =>
      apiFetch<{ feedback: FeedbackDTO }>(`/feedbacks/${vars.id}/share`, {
        method: vars.shared ? 'POST' : 'DELETE',
      }),
    onSuccess: () => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['mural'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível atualizar o compartilhamento.'),
  })
```

3. No `map` dos feedbacks, calcule a permissão e renderize o botão. Adicione, junto aos cálculos `isAuthor`/`canDelete`:

```ts
            const isTarget = user?.id === targetId
            const isPublic = (PUBLIC_FEEDBACK_CATEGORIES as readonly string[]).includes(feedback.category)
            const canShare = isTarget && isPublic
            const isShared = feedback.sharedAt !== null
```

4. Dentro da `<div className="flex shrink-0 gap-sm">` (onde estão os botões de editar/excluir), adicione antes do botão de editar:

```tsx
                    {canShare && (
                      <button
                        type="button"
                        onClick={() => toggleShare.mutate({ id: feedback.id, shared: !isShared })}
                        disabled={toggleShare.isPending}
                        aria-pressed={isShared}
                        aria-label={isShared ? 'Remover do mural' : 'Compartilhar no mural'}
                        className={`flex items-center gap-xs rounded-md border px-sm py-1 font-label text-label-sm transition-colors disabled:opacity-50 ${
                          isShared
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-outline-variant/60 text-on-surface-variant hover:border-primary hover:text-primary'
                        }`}
                      >
                        <Icon name={isShared ? 'check_circle' : 'share'} className="text-[18px]" />
                        {isShared ? 'Compartilhado' : 'Compartilhar'}
                      </button>
                    )}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/web test -- FeedbackSection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/profile/FeedbackSection.tsx apps/web/src/pages/profile/FeedbackSection.test.tsx
git commit -m "feat(web): botão Compartilhar no card de feedback"
```

---

## Task 9: Componente `MuralBanner`

**Files:**
- Create: `apps/web/src/components/MuralBanner.tsx`
- Test: `apps/web/src/components/MuralBanner.test.tsx`

**Interfaces:**
- Consumes: `GET /mural` (`{ items: MuralItemDTO[] }`), `apiFetch`, `Avatar`, `BadgeEmblem`, `Icon`, `FEEDBACK_CATEGORY_LABELS`.
- Produces: componente `MuralBanner` (sem props) que renderiza o carrossel ou `null` quando vazio/erro.

- [ ] **Step 1: Escrever o teste falhando**

Crie `apps/web/src/components/MuralBanner.test.tsx`. Mocke `apiFetch` (como nos testes vizinhos) e envolva em `QueryClientProvider` + `MemoryRouter`. Casos:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { MuralBanner } from './MuralBanner'
import * as api from '../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

const user = { id: 'u1', name: 'Ana', email: 'a@x.com', role: 'DEV', position: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' }

describe('MuralBanner', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('não renderiza nada quando a lista vem vazia', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ items: [] })
    const { container } = wrap(<MuralBanner />)
    // espera o fetch resolver
    await screen.findByTestId?.('mural-empty').catch(() => {})
    expect(container.querySelector('[data-testid="mural-banner"]')).toBeNull()
  })

  it('renderiza card de feedback e card de selo', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      items: [
        { type: 'feedback', id: 'f1', timestamp: '2026-06-16T00:00:00.000Z', target: user, author: { ...user, id: 'u2', name: 'Bia' }, message: 'Mandou muito bem na entrega.', category: 'POSITIVO', reactions: [] },
        { type: 'badge', id: 'b1', timestamp: '2026-06-15T00:00:00.000Z', user, badge: { slug: 's', name: 'Incansável', description: 'd', iconKey: 'k', kind: 'IMPACT' } },
      ],
    })
    wrap(<MuralBanner />)
    expect(await screen.findByText(/Mandou muito bem/i)).toBeInTheDocument()
    expect(screen.getByText('Incansável')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/web test -- MuralBanner`
Expected: FAIL — módulo `MuralBanner` não existe.

- [ ] **Step 3: Implementar o componente**

Crie `apps/web/src/components/MuralBanner.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { MuralItemDTO, MuralResponse } from '@legends/shared'
import { FEEDBACK_CATEGORY_LABELS } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { Avatar } from './Avatar'
import { BadgeEmblem } from './BadgeEmblem'
import { Icon } from './Icon'

function FeedbackCard({ item }: { item: Extract<MuralItemDTO, { type: 'feedback' }> }) {
  return (
    <article className="flex h-full w-[280px] shrink-0 flex-col gap-sm rounded-lg border border-outline-variant/40 bg-surface-container p-md sm:w-[320px]">
      <div className="flex items-center gap-sm">
        <Link to={`/perfil/${item.target.id}`} className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
          <Avatar user={item.target} />
        </Link>
        <div className="min-w-0">
          <p className="truncate font-label text-label-md text-on-surface">{item.target.name}</p>
          <span className="font-label text-label-sm text-on-surface-variant">{FEEDBACK_CATEGORY_LABELS[item.category]}</span>
        </div>
      </div>
      <p className="line-clamp-3 text-body-sm text-on-surface">{item.message}</p>
      <p className="mt-auto font-label text-label-sm text-on-surface-variant">por {item.author.name}</p>
    </article>
  )
}

function BadgeCard({ item }: { item: Extract<MuralItemDTO, { type: 'badge' }> }) {
  return (
    <article className="flex h-full w-[280px] shrink-0 flex-col items-center gap-sm rounded-lg border border-outline-variant/40 bg-surface-container p-md text-center sm:w-[320px]">
      <BadgeEmblem badge={{ iconKey: item.badge.iconKey, kind: item.badge.kind as never, name: item.badge.name }} size={56} />
      <p className="font-label text-label-md text-on-surface">{item.badge.name}</p>
      <Link to={`/perfil/${item.user.id}`} className="mt-auto font-label text-label-sm text-on-surface-variant hover:text-primary">
        conquistado por {item.user.name}
      </Link>
    </article>
  )
}

export function MuralBanner() {
  const { data } = useQuery({
    queryKey: ['mural'],
    queryFn: () => apiFetch<MuralResponse>('/mural'),
  })
  const scrollerRef = useRef<HTMLDivElement>(null)
  const items = data?.items ?? []
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    setReduceMotion(matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])

  useEffect(() => {
    if (reduceMotion || items.length <= 1) return
    const el = scrollerRef.current
    if (!el) return
    const timer = setInterval(() => {
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8
      el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + el.clientWidth, behavior: 'smooth' })
    }, 5000)
    return () => clearInterval(timer)
  }, [reduceMotion, items.length])

  if (items.length === 0) return null

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current
    if (el) el.scrollTo({ left: el.scrollLeft + dir * el.clientWidth, behavior: 'smooth' })
  }

  return (
    <section data-testid="mural-banner" aria-label="Mural do time" className="mb-xl rounded-xl border border-outline-variant/40 bg-surface-container-low p-lg">
      <div className="mb-md flex items-center justify-between gap-md">
        <div className="flex items-center gap-sm">
          <Icon name="campaign" className="text-[22px] text-primary" />
          <h3 className="font-headline text-headline-md text-on-surface">Mural do time</h3>
        </div>
        <div className="flex gap-xs">
          <button type="button" aria-label="Anterior" onClick={() => scrollBy(-1)} className="rounded-full border border-outline-variant/60 p-1 text-on-surface-variant hover:border-primary hover:text-primary">
            <Icon name="chevron_left" className="text-[20px]" />
          </button>
          <button type="button" aria-label="Próximo" onClick={() => scrollBy(1)} className="rounded-full border border-outline-variant/60 p-1 text-on-surface-variant hover:border-primary hover:text-primary">
            <Icon name="chevron_right" className="text-[20px]" />
          </button>
        </div>
      </div>
      <div ref={scrollerRef} className="flex snap-x snap-mandatory gap-md overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <div key={`${item.type}-${item.id}`} className="snap-start">
            {item.type === 'feedback' ? <FeedbackCard item={item} /> : <BadgeCard item={item} />}
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/web test -- MuralBanner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/MuralBanner.tsx apps/web/src/components/MuralBanner.test.tsx
git commit -m "feat(web): componente MuralBanner (carrossel)"
```

---

## Task 10: Montar `MuralBanner` no topo da página Time

**Files:**
- Modify: `apps/web/src/pages/TeamPage.tsx`

**Interfaces:**
- Consumes: `MuralBanner` de `../components/MuralBanner`.
- Produces: banner renderizado no topo de `/time`.

- [ ] **Step 1: Importar e renderizar o banner**

Em `apps/web/src/pages/TeamPage.tsx`:

1. Adicione o import:

```ts
import { MuralBanner } from "../components/MuralBanner";
```

2. Dentro do `<section ...>`, como **primeiro filho** (antes do `<header ...>`):

```tsx
      <MuralBanner />
```

- [ ] **Step 2: Rodar os testes da página/afins**

Run: `pnpm --filter @legends/web test`
Expected: tudo PASS (o `MuralBanner` faz fetch via react-query; em testes da TeamPage que não mockam `/mural`, ele resolve vazio e renderiza `null` — não quebra. Se algum teste da TeamPage falhar por falta de QueryClient/fetch, ajuste o mock de `apiFetch` desse teste para devolver `{ items: [] }` em `/mural`).

- [ ] **Step 3: Verificação manual rápida (opcional, recomendado)**

Run: `pnpm --filter @legends/api dev` e `pnpm --filter @legends/web dev`, faça login, compartilhe um feedback público no perfil e confirme que ele aparece no banner em `/time`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/TeamPage.tsx
git commit -m "feat(web): mural no topo da página Time"
```

---

## Task 11: Verificação final

- [ ] **Step 1: Rodar todas as suítes**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api test && pnpm --filter @legends/web test`
Expected: tudo PASS.

- [ ] **Step 2: Type-check / lint do monorepo (se houver script)**

Run: `pnpm -r typecheck` (ou o script equivalente do repo; pule se não existir)
Expected: sem erros de tipo.

- [ ] **Step 3: Commit final (se restar algo)**

```bash
git add -A
git commit -m "chore: mural do time — verificação final"
```
