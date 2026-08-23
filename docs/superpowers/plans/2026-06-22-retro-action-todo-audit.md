# Ações de retro no perfil (To-Do) + auditoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando uma retro é concluída, as ações com responsável aparecem no perfil dele como to-do marcável; ações concluídas são auditadas (validar/reprovar) na retro seguinte da mesma squad.

**Architecture:** A ação é o card de origem (`RetroCard` com `actionPlan`/`actionResponsible`/`actionDueDate`). Persistimos conclusão (`actionDone`/`actionDoneAt`) e veredito (`auditStatus`/`auditedById`/`auditedAt`) no próprio card. O perfil filtra por `room.status=CONCLUDED`; o painel de auditoria de uma sala calcula a retro anterior da mesma squad — ambos em tempo de leitura, sem materialização. Rotas finas → service → Prisma.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL (api), Vite + React 18 + React Query + Tailwind (web), tipos em `@legends/shared`, Vitest.

## Global Constraints

- TypeScript **strict**, ESM puro (`"type": "module"`).
- Mensagens ao usuário em **português**.
- Camadas: **rota fina (Zod `safeParse` → 400 `{ message, issues }`) → service (erros `RetroError`/`ProfileError` com `status`, rota faz `instanceof`) → Prisma**. DTO só em `serialize.ts`. Contrato em `@legends/shared` primeiro.
- **Nunca editar migration já aplicada**; gerar nova com Prisma.
- Testes da API batem em **Postgres real** — subir com `pnpm db:up` antes de rodar.
- Front sempre fala com a API por `/api` (proxy). Access token só em memória.
- Código novo segue o padrão da camada vizinha.

---

### Task 1: Migração — campos de conclusão e auditoria no `RetroCard`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `RetroCard` ~327-354; model `User` ~70-74)
- Create: `apps/api/prisma/migrations/<timestamp>_retro_action_done_audit/migration.sql` (gerado pelo Prisma)

**Interfaces:**
- Produces: colunas `RetroCard.actionDone Boolean`, `actionDoneAt DateTime?`, `auditStatus String?`, `auditedById String?`, `auditedAt DateTime?`; índice `@@index([actionResponsible])`; relação `User.auditedActions`.

- [ ] **Step 1: Editar o model `RetroCard`** — adicionar campos e índice. Substituir o bloco de campos `action*` + relações por:

```prisma
  actionPlan String?
  actionResponsible String?
  actionDueDate String?
  actionCardId String?
  actionDone Boolean   @default(false)
  actionDoneAt DateTime?
  auditStatus String?
  auditedById String?
  auditedAt   DateTime?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  room      RetroRoom       @relation(fields: [roomId], references: [id], onDelete: Cascade)
  author    User            @relation("RetroCards", fields: [authorId], references: [id])
  auditedBy User?           @relation("RetroActionsAudited", fields: [auditedById], references: [id])
  votes     RetroVote[]
  reactions RetroReaction[]

  @@index([roomId])
  @@index([authorId])
  @@index([actionResponsible])
}
```

- [ ] **Step 2: Editar o model `User`** — adicionar a relação inversa após `retroReactions` (linha ~74):

```prisma
  retroReactions      RetroReaction[]    @relation("RetroReactions")
  auditedActions      RetroCard[]        @relation("RetroActionsAudited")
```

- [ ] **Step 3: Subir o Postgres (se necessário) e gerar a migração**

Run: `pnpm db:up && pnpm --filter @legends/api exec prisma migrate dev --name retro_action_done_audit`
Expected: cria a pasta de migração, aplica no banco, regenera o client. Saída termina com "Your database is now in sync with your schema." / "Generated Prisma Client".

- [ ] **Step 4: Verificar o client (typecheck)**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (os novos campos existem no client gerado).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(retro): campos actionDone/actionDoneAt e auditoria no RetroCard"
```

---

### Task 2: Contrato compartilhado (`@legends/shared`)

**Files:**
- Modify: `packages/shared/src/retro.ts`
- Modify: `packages/shared/src/profile.ts`

**Interfaces:**
- Produces: `RetroActionItemDTO`, `RetroAuditItemDTO`, `RetroEvent` com `audit.changed`, `ProfileDTO.actions`.
- Consumes: `RetroCardAuthor` (já existe em `retro.ts`).

- [ ] **Step 1: Adicionar os DTOs em `retro.ts`** — logo após a definição de `RetroCardDTO` (após sua chave de fechamento):

```ts
export interface RetroActionItemDTO {
  id: string
  plan: string
  dueDate: string            // AAAA-MM-DD
  done: boolean
  doneAt: string | null      // ISO
  sprint: number
  roomId: string
  auditStatus: 'VALIDATED' | 'REJECTED' | null
}

export interface RetroAuditItemDTO {
  id: string
  plan: string
  dueDate: string            // AAAA-MM-DD
  doneAt: string | null      // ISO
  responsible: RetroCardAuthor | null
  auditStatus: 'VALIDATED' | 'REJECTED' | null
  auditedAt: string | null   // ISO
}
```

- [ ] **Step 2: Adicionar o evento `audit.changed` ao `RetroEvent`** — localizar a união `export type RetroEvent =` e acrescentar a linha junto às demais variantes não-efêmeras (perto de `anonymous.changed`):

```ts
  | { type: 'audit.changed' }
```

- [ ] **Step 3: Estender `ProfileDTO` em `profile.ts`** — adicionar o import e o campo. No topo do arquivo garantir o import do tipo:

```ts
import type { RetroActionItemDTO } from './retro'
```

E dentro de `export interface ProfileDTO { ... }` adicionar:

```ts
  actions: RetroActionItemDTO[]
```

- [ ] **Step 4: Buildar o shared e verificar tipos**

Run: `pnpm --filter @legends/shared build`
Expected: build sem erros (gera `dist/`).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/retro.ts packages/shared/src/profile.ts
git commit -m "feat(shared): RetroActionItemDTO/RetroAuditItemDTO, audit.changed e ProfileDTO.actions"
```

---

### Task 3: Serializers `toRetroActionItemDTO` e `toRetroAuditItemDTO`

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Test: `apps/api/src/lib/serialize-retro.test.ts`

**Interfaces:**
- Produces: `toRetroActionItemDTO(card, sprint): RetroActionItemDTO`, `toRetroAuditItemDTO(card, responsible): RetroAuditItemDTO`.
- Consumes: `RetroCard`, `User` (de `@prisma/client`); `AvatarStyleKey`, `AvatarOptions` (já importados).

- [ ] **Step 1: Escrever o teste que falha** — adicionar ao final de `serialize-retro.test.ts` (antes do `})` que fecha o `describe`, ou em novo `describe`):

```ts
import { toRetroActionItemDTO, toRetroAuditItemDTO } from './serialize'

describe('serialize ações/auditoria', () => {
  const actionCard = {
    id: 'c1', roomId: 'r1', actionPlan: 'Documentar deploy', actionDueDate: '2026-07-01',
    actionDone: true, actionDoneAt: new Date('2026-06-25T12:00:00Z'),
    auditStatus: null, auditedAt: null,
  } as any

  it('toRetroActionItemDTO monta plano/prazo/done/sprint', () => {
    const dto = toRetroActionItemDTO(actionCard, 23)
    expect(dto).toEqual({
      id: 'c1', plan: 'Documentar deploy', dueDate: '2026-07-01', done: true,
      doneAt: '2026-06-25T12:00:00.000Z', sprint: 23, roomId: 'r1', auditStatus: null,
    })
  })

  it('toRetroAuditItemDTO inclui responsável com avatar e veredito', () => {
    const responsible = { id: 'u9', name: 'Bia', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null } as any
    const dto = toRetroAuditItemDTO({ ...actionCard, auditStatus: 'VALIDATED', auditedAt: new Date('2026-06-26T00:00:00Z') }, responsible)
    expect(dto.responsible).toEqual({ id: 'u9', name: 'Bia', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })
    expect(dto.auditStatus).toBe('VALIDATED')
    expect(dto.doneAt).toBe('2026-06-25T12:00:00.000Z')
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test -- --run serialize-retro`
Expected: FAIL — `toRetroActionItemDTO is not a function` / import inexistente.

- [ ] **Step 3: Implementar os serializers** — em `serialize.ts`. Primeiro, garantir `RetroCard` no import do Prisma (linha 1):

```ts
import type { Badge, Category, Prisma, RetroCard, Squad, User, VotingPeriod } from '@prisma/client'
```

Adicionar `RetroActionItemDTO` e `RetroAuditItemDTO` ao bloco de imports de `@legends/shared` (o que termina na linha ~34). Depois, adicionar as funções (logo após `toRetroCardDTO`):

```ts
export function toRetroActionItemDTO(
  card: Pick<RetroCard, 'id' | 'roomId' | 'actionPlan' | 'actionDueDate' | 'actionDone' | 'actionDoneAt' | 'auditStatus'>,
  sprint: number,
): RetroActionItemDTO {
  return {
    id: card.id,
    plan: card.actionPlan ?? '',
    dueDate: card.actionDueDate ?? '',
    done: card.actionDone,
    doneAt: card.actionDoneAt ? card.actionDoneAt.toISOString() : null,
    sprint,
    roomId: card.roomId,
    auditStatus: (card.auditStatus as 'VALIDATED' | 'REJECTED' | null) ?? null,
  }
}

export function toRetroAuditItemDTO(
  card: Pick<RetroCard, 'id' | 'actionPlan' | 'actionDueDate' | 'actionDoneAt' | 'auditStatus' | 'auditedAt'>,
  responsible: User | null,
): RetroAuditItemDTO {
  return {
    id: card.id,
    plan: card.actionPlan ?? '',
    dueDate: card.actionDueDate ?? '',
    doneAt: card.actionDoneAt ? card.actionDoneAt.toISOString() : null,
    responsible: responsible
      ? {
          id: responsible.id,
          name: responsible.name,
          photoUrl: responsible.photoUrl,
          avatarStyle: responsible.avatarStyle as AvatarStyleKey | null,
          avatarSeed: responsible.avatarSeed,
          avatarOptions: (responsible.avatarOptions as AvatarOptions | null) ?? null,
        }
      : null,
    auditStatus: (card.auditStatus as 'VALIDATED' | 'REJECTED' | null) ?? null,
    auditedAt: card.auditedAt ? card.auditedAt.toISOString() : null,
  }
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api test -- --run serialize-retro`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/lib/serialize-retro.test.ts
git commit -m "feat(retro): serializers de ação e item de auditoria"
```

---

### Task 4: To-Do no perfil — `listUserActions` + rota do perfil

**Files:**
- Modify: `apps/api/src/services/profile-service.ts`
- Modify: `apps/api/src/routes/profile.ts`
- Test: `apps/api/src/routes/profile-actions.test.ts` (criar)

**Interfaces:**
- Produces: `listUserActions(userId)` → cards (com `room {id,sprint}`) de salas CONCLUÍDAS, ordenados (pendentes → prazo asc → doneAt desc).
- Consumes: `toRetroActionItemDTO` (Task 3).

- [ ] **Step 1: Escrever o teste que falha** — criar `apps/api/src/routes/profile-actions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function user(name: string, role: 'DEV' | 'LEAD' = 'DEV') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}

describe('GET /users/:id/profile — ações', () => {
  it('lista ações de sala CONCLUÍDA do responsável e ignora OPEN', async () => {
    const app = buildApp(); await app.ready()
    const lead = await user('Lia', 'LEAD'); const dev = await user('Dan')
    const squad = await prisma.squad.create({ data: { name: 'S', slug: 's' } })
    const concluded = await prisma.retroRoom.create({ data: { sprint: 5, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date(), squads: { create: { squadId: squad.id } } } })
    const open = await prisma.retroRoom.create({ data: { sprint: 6, createdById: lead.id, anonymous: true, votesPerParticipant: 3, squads: { create: { squadId: squad.id } } } })
    await prisma.retroCard.create({ data: { roomId: concluded.id, authorId: lead.id, text: 'o', color: 'blue', x: 0, y: 0, actionPlan: 'Fazer X', actionResponsible: dev.id, actionDueDate: '2026-07-01' } })
    await prisma.retroCard.create({ data: { roomId: open.id, authorId: lead.id, text: 'o', color: 'blue', x: 0, y: 0, actionPlan: 'Fazer Y', actionResponsible: dev.id, actionDueDate: '2026-07-02' } })

    const token = app.jwt.sign({ sub: lead.id, role: 'LEAD' })
    const res = await app.inject({ method: 'GET', url: `/users/${dev.id}/profile`, headers: { authorization: `Bearer ${token}` } })
    const actions = res.json().actions
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ plan: 'Fazer X', dueDate: '2026-07-01', sprint: 5, done: false })
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test -- --run profile-actions`
Expected: FAIL — `actions` é `undefined` (`toHaveLength` quebra).

- [ ] **Step 3: Implementar `listUserActions`** — em `profile-service.ts`, ao final do arquivo:

```ts
/** Ações (cards com responsável) de salas concluídas atribuídas ao usuário. Pendentes primeiro. */
export function listUserActions(userId: string) {
  return prisma.retroCard.findMany({
    where: {
      actionResponsible: userId,
      actionPlan: { not: null },
      actionDueDate: { not: null },
      room: { status: 'CONCLUDED' },
    },
    include: { room: { select: { id: true, sprint: true } } },
    orderBy: [{ actionDone: 'asc' }, { actionDueDate: 'asc' }, { actionDoneAt: 'desc' }],
  })
}
```

- [ ] **Step 4: Ligar na rota** — em `profile.ts`. Ajustar imports:

```ts
import { getUserProfile, listUserActions, listVotesReceived, setFeaturedBadges, ProfileError } from '../services/profile-service'
import { toAwardedBadgeDTO, toPublicUser, toRetroActionItemDTO, toVoteDTO } from '../lib/serialize'
```

No handler `GET /users/:id/profile`, antes do `return reply.send(...)`, buscar as ações e incluí-las:

```ts
    const badges = await listBadgesForUser(id)
    const actions = await listUserActions(id)
    return reply.send({
      user: toPublicUser(profile.user),
      stats: {
        totalVotesReceived: profile.totalVotesReceived,
        monthsRecognized: profile.monthsRecognized,
      },
      categoryBreakdown: profile.categoryBreakdown,
      months: profile.months,
      badges: badges.map(toAwardedBadgeDTO),
      actions: actions.map((c) => toRetroActionItemDTO(c, c.room.sprint)),
    })
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- --run profile-actions`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/profile-service.ts apps/api/src/routes/profile.ts apps/api/src/routes/profile-actions.test.ts
git commit -m "feat(profile): seção de ações (to-do) no perfil a partir de retros concluídas"
```

---

### Task 5: Concluir ação — `setActionDone` + `PATCH /retro/actions/:cardId`

**Files:**
- Modify: `apps/api/src/services/retro-service.ts`
- Modify: `apps/api/src/routes/retro.ts`
- Test: `apps/api/src/routes/retro-actions.test.ts` (criar)

**Interfaces:**
- Produces: `setActionDone({ cardId, userId, done })` → card atualizado com `room {sprint}`; rota `PATCH /retro/actions/:cardId` body `{ done: boolean }` → `{ action: RetroActionItemDTO }`.

- [ ] **Step 1: Escrever o teste que falha** — criar `apps/api/src/routes/retro-actions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function user(name: string, role: 'DEV' | 'LEAD' = 'DEV') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
async function actionCard(roomId: string, authorId: string, responsibleId: string) {
  return prisma.retroCard.create({ data: { roomId, authorId, text: 'o', color: 'blue', x: 0, y: 0, actionPlan: 'P', actionResponsible: responsibleId, actionDueDate: '2026-07-01' } })
}

describe('PATCH /retro/actions/:cardId', () => {
  it('só o responsável conclui; grava actionDone/doneAt', async () => {
    const app = buildApp(); await app.ready()
    const lead = await user('Lia', 'LEAD'); const dev = await user('Dan'); const other = await user('Ed')
    const squad = await prisma.squad.create({ data: { name: 'S', slug: 's' } })
    const room = await prisma.retroRoom.create({ data: { sprint: 5, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date(), squads: { create: { squadId: squad.id } } } })
    const card = await actionCard(room.id, lead.id, dev.id)

    const otherTk = app.jwt.sign({ sub: other.id, role: 'DEV' })
    const forbidden = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${otherTk}` }, payload: { done: true } })
    expect(forbidden.statusCode).toBe(403)

    const devTk = app.jwt.sign({ sub: dev.id, role: 'DEV' })
    const ok = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${devTk}` }, payload: { done: true } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().action).toMatchObject({ done: true, sprint: 5 })
    const saved = await prisma.retroCard.findUnique({ where: { id: card.id } })
    expect(saved!.actionDone).toBe(true)
    expect(saved!.actionDoneAt).not.toBeNull()
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test -- --run retro-actions`
Expected: FAIL — rota 404 (inexistente) / `action` undefined.

- [ ] **Step 3: Implementar `setActionDone`** — em `retro-service.ts`, ao final do arquivo:

```ts
export async function setActionDone(input: { cardId: string; userId: string; done: boolean }) {
  const card = await prisma.retroCard.findUnique({
    where: { id: input.cardId },
    include: { room: { select: { sprint: true } } },
  })
  if (!card || !card.actionPlan || !card.actionResponsible || !card.actionDueDate) {
    throw new RetroError('Ação não encontrada.', 404)
  }
  if (card.actionResponsible !== input.userId) throw new RetroError('Apenas o responsável conclui a ação.', 403)
  return prisma.retroCard.update({
    where: { id: card.id },
    data: {
      actionDone: input.done,
      actionDoneAt: input.done ? new Date() : null,
      auditStatus: null,
      auditedById: null,
      auditedAt: null,
    },
    include: { room: { select: { sprint: true } } },
  })
}
```

- [ ] **Step 4: Implementar a rota** — em `retro.ts`. Adicionar `setActionDone` ao import de `../services/retro-service` e `toRetroActionItemDTO` ao import de `../lib/serialize`. Adicionar o schema perto dos demais (após `anonymousSchema`):

```ts
const actionDoneSchema = z.object({ done: z.boolean() })
```

Dentro de `retroRoutes`, adicionar o endpoint (perto dos outros `/retro/...`):

```ts
  app.patch('/retro/actions/:cardId', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = actionDoneSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { cardId } = request.params as { cardId: string }
    try {
      const card = await setActionDone({ cardId, userId: request.user.sub, done: parsed.data.done })
      return reply.send({ action: toRetroActionItemDTO(card, card.room.sprint) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- --run retro-actions`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/routes/retro.ts apps/api/src/routes/retro-actions.test.ts
git commit -m "feat(retro): concluir ação (PATCH /retro/actions/:cardId), só o responsável"
```

---

### Task 6: Listar auditoria — `findAuditSourceRoom` + `listAudit` + `GET /retro/rooms/:id/audit`

**Files:**
- Modify: `apps/api/src/services/retro-service.ts`
- Modify: `apps/api/src/routes/retro.ts`
- Test: `apps/api/src/routes/retro-audit.test.ts` (criar)

**Interfaces:**
- Produces: `findAuditSourceRoom(room)` → `{ id, sprint } | null`; `listAudit(roomId, viewer)` → `{ sourceRoom, items: { card, responsible }[] }`; rota `GET /retro/rooms/:id/audit` → `{ sourceRoom, items: RetroAuditItemDTO[] }`.
- Consumes: `loadRoom`, `resolveRole` (existentes); `toRetroAuditItemDTO` (Task 3).

- [ ] **Step 1: Escrever o teste que falha** — criar `apps/api/src/routes/retro-audit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function user(name: string, role: 'DEV' | 'LEAD' = 'DEV') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}

describe('GET /retro/rooms/:id/audit', () => {
  it('lista ações concluídas da retro anterior da mesma squad', async () => {
    const app = buildApp(); await app.ready()
    const lead = await user('Lia', 'LEAD'); const dev = await user('Dan')
    const squad = await prisma.squad.create({ data: { name: 'S', slug: 's' } })
    const prev = await prisma.retroRoom.create({ data: { sprint: 5, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date('2026-06-01'), createdAt: new Date('2026-05-20'), squads: { create: { squadId: squad.id } } } })
    const current = await prisma.retroRoom.create({ data: { sprint: 6, createdById: lead.id, anonymous: true, votesPerParticipant: 3, createdAt: new Date('2026-06-10'), squads: { create: { squadId: squad.id } }, participants: { create: { userId: dev.id } } } })
    await prisma.retroCard.create({ data: { roomId: prev.id, authorId: lead.id, text: 'o', color: 'blue', x: 0, y: 0, actionPlan: 'Concluída', actionResponsible: dev.id, actionDueDate: '2026-06-05', actionDone: true, actionDoneAt: new Date('2026-06-04') } })
    await prisma.retroCard.create({ data: { roomId: prev.id, authorId: lead.id, text: 'o', color: 'blue', x: 0, y: 0, actionPlan: 'Pendente', actionResponsible: dev.id, actionDueDate: '2026-06-06', actionDone: false } })

    const token = app.jwt.sign({ sub: lead.id, role: 'LEAD' })
    const res = await app.inject({ method: 'GET', url: `/retro/rooms/${current.id}/audit`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.sourceRoom).toMatchObject({ id: prev.id, sprint: 5 })
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ plan: 'Concluída', responsible: { id: dev.id } })
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test -- --run retro-audit`
Expected: FAIL — rota 404 (inexistente).

- [ ] **Step 3: Implementar service** — em `retro-service.ts`. Garantir `type User` no import do Prisma (linha 1):

```ts
import { Prisma, type User } from '@prisma/client'
```

Adicionar ao final do arquivo:

```ts
/** Retro anterior da mesma squad: sala CONCLUÍDA que compartilha ≥1 squad e concluiu antes desta. */
export function findAuditSourceRoom(room: { id: string; createdAt: Date; squads: { squadId: string }[] }) {
  const squadIds = room.squads.map((s) => s.squadId)
  if (squadIds.length === 0) return Promise.resolve(null)
  return prisma.retroRoom.findFirst({
    where: {
      id: { not: room.id },
      status: 'CONCLUDED',
      concludedAt: { lt: room.createdAt },
      squads: { some: { squadId: { in: squadIds } } },
    },
    orderBy: { concludedAt: 'desc' },
    select: { id: true, sprint: true },
  })
}

export async function listAudit(
  roomId: string,
  viewer: { id: string; role: string },
): Promise<{ sourceRoom: { id: string; sprint: number } | null; items: { card: RetroCardWithRelations; responsible: User | null }[] }> {
  const room = await loadRoom(roomId)
  if (!resolveRole(room, viewer)) throw new RetroError('Sala não encontrada.', 404)
  const source = await findAuditSourceRoom(room)
  if (!source) return { sourceRoom: null, items: [] }
  const cards = await prisma.retroCard.findMany({
    where: {
      roomId: source.id,
      actionDone: true,
      actionPlan: { not: null },
      actionResponsible: { not: null },
      actionDueDate: { not: null },
    },
    include: { author: true, votes: true, reactions: true },
    orderBy: [{ actionDoneAt: 'desc' }],
  })
  const responsibleIds = [...new Set(cards.map((c) => c.actionResponsible).filter((x): x is string => Boolean(x)))]
  const users = await prisma.user.findMany({ where: { id: { in: responsibleIds } } })
  const byId = new Map(users.map((u) => [u.id, u]))
  return {
    sourceRoom: source,
    items: cards.map((card) => ({ card, responsible: card.actionResponsible ? byId.get(card.actionResponsible) ?? null : null })),
  }
}
```

- [ ] **Step 4: Implementar a rota** — em `retro.ts`. Adicionar `listAudit` ao import de `../services/retro-service` e `toRetroAuditItemDTO` ao import de `../lib/serialize`. Dentro de `retroRoutes`:

```ts
  app.get('/retro/rooms/:id/audit', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { sourceRoom, items } = await listAudit(id, { id: request.user.sub, role: request.user.role })
      return reply.send({ sourceRoom, items: items.map(({ card, responsible }) => toRetroAuditItemDTO(card, responsible)) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- --run retro-audit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/routes/retro.ts apps/api/src/routes/retro-audit.test.ts
git commit -m "feat(retro): listar auditoria (ações concluídas da retro anterior da squad)"
```

---

### Task 7: Validar/Reprovar — `setAudit` + `POST /retro/rooms/:id/audit/:cardId` + broadcast

**Files:**
- Modify: `apps/api/src/services/retro-service.ts`
- Modify: `apps/api/src/routes/retro.ts`
- Test: `apps/api/src/routes/retro-audit.test.ts` (acrescentar casos)

**Interfaces:**
- Produces: `setAudit({ roomId, cardId, userId, verdict })` → `{ card, responsible }`; rota `POST /retro/rooms/:id/audit/:cardId` body `{ verdict: 'VALIDATED'|'REJECTED' }` → `{ item: RetroAuditItemDTO }`; broadcast `{ type: 'audit.changed' }`.

- [ ] **Step 1: Escrever os testes que falham** — acrescentar dentro do `describe` de `retro-audit.test.ts`:

```ts
  it('valida (facilitador) e reprova reabre a ação; participante não audita', async () => {
    const app = buildApp(); await app.ready()
    const lead = await user('Lia', 'LEAD'); const dev = await user('Dan')
    const squad = await prisma.squad.create({ data: { name: 'S2', slug: 's2' } })
    const prev = await prisma.retroRoom.create({ data: { sprint: 5, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date('2026-06-01'), createdAt: new Date('2026-05-20'), squads: { create: { squadId: squad.id } } } })
    const current = await prisma.retroRoom.create({ data: { sprint: 6, createdById: lead.id, anonymous: true, votesPerParticipant: 3, createdAt: new Date('2026-06-10'), squads: { create: { squadId: squad.id } }, participants: { create: { userId: dev.id } } } })
    const card = await prisma.retroCard.create({ data: { roomId: prev.id, authorId: lead.id, text: 'o', color: 'blue', x: 0, y: 0, actionPlan: 'C', actionResponsible: dev.id, actionDueDate: '2026-06-05', actionDone: true, actionDoneAt: new Date('2026-06-04') } })

    const devTk = app.jwt.sign({ sub: dev.id, role: 'DEV' })
    const forbidden = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/audit/${card.id}`, headers: { authorization: `Bearer ${devTk}` }, payload: { verdict: 'VALIDATED' } })
    expect(forbidden.statusCode).toBe(403)

    const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD' })
    const validated = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/audit/${card.id}`, headers: { authorization: `Bearer ${leadTk}` }, payload: { verdict: 'VALIDATED' } })
    expect(validated.statusCode).toBe(200)
    expect(validated.json().item).toMatchObject({ auditStatus: 'VALIDATED' })

    const rejected = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/audit/${card.id}`, headers: { authorization: `Bearer ${leadTk}` }, payload: { verdict: 'REJECTED' } })
    expect(rejected.statusCode).toBe(200)
    const saved = await prisma.retroCard.findUnique({ where: { id: card.id } })
    expect(saved!.auditStatus).toBe('REJECTED')
    expect(saved!.actionDone).toBe(false)
    expect(saved!.actionDoneAt).toBeNull()
    await app.close()
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- --run retro-audit`
Expected: FAIL — rota POST 404 (inexistente).

- [ ] **Step 3: Implementar `setAudit`** — em `retro-service.ts`, ao final:

```ts
export async function setAudit(input: {
  roomId: string
  cardId: string
  userId: string
  verdict: 'VALIDATED' | 'REJECTED'
}): Promise<{ card: RetroCard; responsible: User | null }> {
  const room = await loadRoom(input.roomId)
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador audita ações.', 403)
  const source = await findAuditSourceRoom(room)
  if (!source) throw new RetroError('Nenhuma retro anterior para auditar.', 409)
  const card = await prisma.retroCard.findFirst({ where: { id: input.cardId, roomId: source.id, actionDone: true } })
  if (!card) throw new RetroError('Ação não encontrada para auditoria.', 404)
  const data =
    input.verdict === 'REJECTED'
      ? { auditStatus: 'REJECTED', auditedById: input.userId, auditedAt: new Date(), actionDone: false, actionDoneAt: null }
      : { auditStatus: 'VALIDATED', auditedById: input.userId, auditedAt: new Date() }
  const updated = await prisma.retroCard.update({ where: { id: card.id }, data })
  const responsible = updated.actionResponsible
    ? await prisma.user.findUnique({ where: { id: updated.actionResponsible } })
    : null
  return { card: updated, responsible }
}
```

Adicionar `RetroCard` ao import do Prisma da linha 1 (junto de `type User`):

```ts
import { Prisma, type RetroCard, type User } from '@prisma/client'
```

- [ ] **Step 4: Implementar a rota** — em `retro.ts`. Adicionar `setAudit` ao import de `../services/retro-service`. Schema (após `actionDoneSchema`):

```ts
const auditSchema = z.object({ verdict: z.enum(['VALIDATED', 'REJECTED']) })
```

Endpoint dentro de `retroRoutes`:

```ts
  app.post('/retro/rooms/:id/audit/:cardId', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = auditSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const { card, responsible } = await setAudit({ roomId: id, cardId, userId: request.user.sub, verdict: parsed.data.verdict })
      retroHub.broadcast(id, () => ({ type: 'audit.changed' }))
      return reply.send({ item: toRetroAuditItemDTO(card, responsible) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 5: Rodar e ver passar (toda a suíte de retro)**

Run: `pnpm --filter @legends/api test -- --run retro`
Expected: PASS (retro-audit, retro-actions e os demais retro continuam verdes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/routes/retro.ts apps/api/src/routes/retro-audit.test.ts
git commit -m "feat(retro): validar/reprovar ação na auditoria (facilitador); reprovar reabre"
```

---

### Task 8: Cliente web — `retro-api` + invalidação `audit.changed`

**Files:**
- Modify: `apps/web/src/lib/retro-api.ts`
- Modify: `apps/web/src/lib/useRetroSocket.ts`

**Interfaces:**
- Produces: `toggleRetroAction(cardId, done)`, `getRetroAudit(roomId)`, `setRetroAudit(roomId, cardId, verdict)`; invalidação de `['retro-audit', roomId]` em `audit.changed`.

- [ ] **Step 1: Adicionar as funções de API** — em `retro-api.ts`. Acrescentar os tipos ao import de `@legends/shared`:

```ts
  RetroActionItemDTO,
  RetroAuditItemDTO,
```

E as funções ao final do arquivo:

```ts
export function toggleRetroAction(cardId: string, done: boolean) {
  return apiFetch<{ action: RetroActionItemDTO }>(`/retro/actions/${cardId}`, { method: 'PATCH', body: JSON.stringify({ done }) })
}
export function getRetroAudit(roomId: string) {
  return apiFetch<{ sourceRoom: { id: string; sprint: number } | null; items: RetroAuditItemDTO[] }>(`/retro/rooms/${roomId}/audit`)
}
export function setRetroAudit(roomId: string, cardId: string, verdict: 'VALIDATED' | 'REJECTED') {
  return apiFetch<{ item: RetroAuditItemDTO }>(`/retro/rooms/${roomId}/audit/${cardId}`, { method: 'POST', body: JSON.stringify({ verdict }) })
}
```

- [ ] **Step 2: Invalidar a auditoria no socket** — em `useRetroSocket.ts`, dentro do `ws.onmessage`, junto das invalidações por evento (após a linha de `participants.changed`):

```ts
        if (e.type === 'audit.changed') qc.invalidateQueries({ queryKey: ['retro-audit', roomId] })
```

- [ ] **Step 3: Verificar tipos do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/retro-api.ts apps/web/src/lib/useRetroSocket.ts
git commit -m "feat(web): API de ações/auditoria de retro + invalidação por audit.changed"
```

---

### Task 9: Perfil — seção "Ações" (to-do)

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx`
- Test: `apps/web/src/pages/ProfilePage.test.tsx`

**Interfaces:**
- Consumes: `profile.actions` (Task 2/4), `toggleRetroAction` (Task 8), `isOwnProfile` (já existe na página).

- [ ] **Step 1: Escrever/!atualizar o teste que falha** — adicionar um caso a `ProfilePage.test.tsx` (seguir o setup de mock existente do arquivo: ele mocka `apiFetch` retornando um `ProfileDTO`). Acrescentar `actions` ao mock do perfil e um teste:

```tsx
it('mostra a seção Ações e marca como concluída no próprio perfil', async () => {
  // No mock do ProfileDTO retornado por apiFetch, incluir:
  //   actions: [{ id: 'a1', plan: 'Documentar deploy', dueDate: '2026-07-01', done: false, doneAt: null, sprint: 5, roomId: 'r1', auditStatus: null }]
  // e garantir authUser.id === id (próprio perfil).
  renderProfile()
  expect(await screen.findByText('Ações')).toBeInTheDocument()
  expect(screen.getByText('Documentar deploy')).toBeInTheDocument()
  const checkbox = screen.getByRole('checkbox', { name: /concluída/i })
  expect(checkbox).not.toBeDisabled()
})
```

> Nota: adaptar `renderProfile`/mock aos helpers já presentes no arquivo de teste; o objetivo é (a) renderizar a seção quando há `actions` e (b) checkbox habilitado no próprio perfil.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- --run ProfilePage`
Expected: FAIL — "Ações" não encontrado.

- [ ] **Step 3: Implementar** — em `ProfilePage.tsx`. Ajustar o import de API e adicionar helper + mutação.

No topo, importar a função e o tipo:

```ts
import { toggleRetroAction } from "../lib/retro-api";
```

Helper de data (perto de `joinedLabel`):

```ts
function formatDue(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
}
```

Dentro do componente (perto das outras mutações/`queryClient`):

```ts
  const toggleActionM = useMutation({
    mutationFn: (v: { cardId: string; done: boolean }) => toggleRetroAction(v.cardId, v.done),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile", id] }),
  });
```

Garantir `useMutation` no import do `@tanstack/react-query` (já há `useQuery`, `useInfiniteQuery`, `useQueryClient`):

```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
```

Inserir a seção logo antes de `{pickerOpen && <AvatarPicker ... />}` (perto do fim do `return`):

```tsx
      {(profile.actions ?? []).length > 0 && (
        <div className="mt-lg rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
          <h3 className="mb-lg font-headline text-headline-md text-on-surface">Ações</h3>
          <ul className="flex flex-col gap-sm">
            {(profile.actions ?? []).map((a) => {
              const overdue = !a.done && a.dueDate < new Date().toISOString().slice(0, 10);
              return (
                <li key={a.id} className="flex items-start gap-md rounded-lg border border-outline-variant/30 bg-surface-container-high p-md">
                  <input
                    type="checkbox"
                    checked={a.done}
                    disabled={!isOwnProfile || toggleActionM.isPending}
                    onChange={() => toggleActionM.mutate({ cardId: a.id, done: !a.done })}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary disabled:opacity-50"
                    aria-label={a.done ? "Marcar como pendente" : "Marcar como concluída"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-body-md ${a.done ? "text-on-surface-variant line-through" : "text-on-surface"}`}>{a.plan}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-sm font-label text-label-sm">
                      <span className={overdue ? "text-error" : "text-on-surface-variant"}>
                        Prazo: {formatDue(a.dueDate)}{overdue ? " · Atrasada" : ""}
                      </span>
                      <Link to={`/retrospectivas/${a.roomId}`} className="text-primary hover:underline">Sprint {a.sprint}</Link>
                      {a.auditStatus === "VALIDATED" && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-primary">Validada</span>}
                      {a.auditStatus === "REJECTED" && <span className="rounded-full bg-error/15 px-2 py-0.5 text-error">Reprovada</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web test -- --run ProfilePage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ProfilePage.tsx apps/web/src/pages/ProfilePage.test.tsx
git commit -m "feat(profile): seção Ações (to-do) com prazo, atrasada e veredito"
```

---

### Task 10: Sala — painel "Auditoria"

**Files:**
- Create: `apps/web/src/pages/retro/AuditPanel.tsx`
- Modify: `apps/web/src/pages/RetroRoomPage.tsx`
- Test: `apps/web/src/pages/retro/AuditPanel.test.tsx` (criar)

**Interfaces:**
- Consumes: `getRetroAudit`, `setRetroAudit` (Task 8); `RetroAuditItemDTO`; `Avatar`.

- [ ] **Step 1: Escrever o teste que falha** — criar `apps/web/src/pages/retro/AuditPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AuditPanel } from './AuditPanel'

const items = [{
  id: 'a1', plan: 'Documentar deploy', dueDate: '2026-07-01', doneAt: '2026-06-25T00:00:00.000Z',
  responsible: { id: 'u1', name: 'Bia', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null },
  auditStatus: null, auditedAt: null,
}]

describe('AuditPanel', () => {
  it('mostra Validar/Reprovar só para facilitador', () => {
    const onValidate = vi.fn()
    const { rerender } = render(<AuditPanel items={items as any} sourceSprint={5} canValidate={false} onValidate={onValidate} onReject={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Documentar deploy')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validar' })).toBeNull()

    rerender(<AuditPanel items={items as any} sourceSprint={5} canValidate onValidate={onValidate} onReject={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }))
    expect(onValidate).toHaveBeenCalledWith('a1')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- --run AuditPanel`
Expected: FAIL — módulo `./AuditPanel` inexistente.

- [ ] **Step 3: Criar o componente** — `apps/web/src/pages/retro/AuditPanel.tsx`:

```tsx
import type { JSX } from 'react'
import type { RetroAuditItemDTO } from '@legends/shared'
import { Avatar } from '../../components/Avatar'

function formatDue(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd
}

export function AuditPanel({
  items,
  sourceSprint,
  canValidate,
  busy,
  onValidate,
  onReject,
  onClose,
}: {
  items: RetroAuditItemDTO[]
  sourceSprint: number | null
  canValidate: boolean
  busy?: boolean
  onValidate: (cardId: string) => void
  onReject: (cardId: string) => void
  onClose: () => void
}): JSX.Element {
  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col border-l border-outline-variant/40 bg-surface-container shadow-xl">
      <div className="flex items-center justify-between border-b border-outline-variant/40 px-4 py-3">
        <h3 className="font-label text-title-sm font-bold text-on-surface">
          Auditoria{sourceSprint != null ? ` · Sprint ${sourceSprint}` : ''}
        </h3>
        <button type="button" aria-label="Fechar" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <p className="px-2 py-1 text-body-sm text-on-surface-variant">Nenhuma ação concluída para auditar.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id} className="rounded-lg border border-outline-variant/30 bg-surface-container-high p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-zinc-700 ring-1 ring-white/60">
                    <Avatar user={it.responsible ?? { name: '?' }} initialsClassName="text-[10px] font-bold text-white" />
                  </span>
                  <span className="text-body-sm text-on-surface">{it.responsible?.name ?? 'Sem responsável'}</span>
                </div>
                <p className="mt-2 text-body-sm text-on-surface">{it.plan}</p>
                <p className="mt-1 font-label text-label-sm text-on-surface-variant">Prazo: {formatDue(it.dueDate)}</p>
                {it.auditStatus === 'VALIDATED' && <p className="mt-1 font-label text-label-sm text-primary">Validada</p>}
                {it.auditStatus === 'REJECTED' && <p className="mt-1 font-label text-label-sm text-error">Reprovada</p>}
                {canValidate && (
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={busy} onClick={() => onValidate(it.id)} className="rounded-md bg-primary px-2 py-1 font-label text-label-sm font-bold text-on-primary disabled:opacity-50">Validar</button>
                    <button type="button" disabled={busy} onClick={() => onReject(it.id)} className="rounded-md border border-outline-variant/40 px-2 py-1 font-label text-label-sm text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-50">Reprovar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar (componente)**

Run: `pnpm --filter @legends/web test -- --run AuditPanel`
Expected: PASS.

- [ ] **Step 5: Ligar no `RetroRoomPage`** — em `RetroRoomPage.tsx`.

Imports — adicionar `getRetroAudit, setRetroAudit` ao import de `../lib/retro-api` e o componente:

```ts
import { AuditPanel } from './retro/AuditPanel'
```

Estado (perto de `const [participantsOpen, setParticipantsOpen] = useState(false)`):

```ts
  const [auditOpen, setAuditOpen] = useState(false)
```

Query + mutação (perto de `roomQuery`/mutações):

```ts
  const auditQuery = useQuery({ queryKey: ['retro-audit', id], queryFn: () => getRetroAudit(id), enabled: !!id })
  const auditM = useMutation({
    mutationFn: (v: { cardId: string; verdict: 'VALIDATED' | 'REJECTED' }) => setRetroAudit(id, v.cardId, v.verdict),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['retro-audit', id] }),
  })
```

Botão no header — antes do botão "Sair" (linha ~447), visível quando houver itens:

```tsx
          {(auditQuery.data?.items.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setAuditOpen(true)}
              className="rounded-md border border-outline-variant/40 px-lg py-sm font-label text-on-surface-variant hover:bg-surface-container-highest"
            >
              Auditoria ({auditQuery.data?.items.length})
            </button>
          )}
```

Painel — junto do render do `ParticipantsPanel` (antes de `</section>`):

```tsx
      {auditOpen && (
        <AuditPanel
          items={auditQuery.data?.items ?? []}
          sourceSprint={auditQuery.data?.sourceRoom?.sprint ?? null}
          canValidate={isFacilitator}
          busy={auditM.isPending}
          onValidate={(cardId) => auditM.mutate({ cardId, verdict: 'VALIDATED' })}
          onReject={(cardId) => auditM.mutate({ cardId, verdict: 'REJECTED' })}
          onClose={() => setAuditOpen(false)}
        />
      )}
```

- [ ] **Step 6: Verificar tipos e suíte web de retro**

Run: `pnpm --filter @legends/web exec tsc --noEmit && pnpm --filter @legends/web test -- --run AuditPanel RetroRoomPage`
Expected: sem erros de tipo; testes PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/retro/AuditPanel.tsx apps/web/src/pages/retro/AuditPanel.test.tsx apps/web/src/pages/RetroRoomPage.tsx
git commit -m "feat(web): painel Auditoria na sala (validar/reprovar para facilitador)"
```

---

### Task 11: Verificação final ponta a ponta

- [ ] **Step 1: Subir Postgres e rodar toda a suíte**

Run: `pnpm db:up && pnpm test`
Expected: todos os pacotes verdes (api + web + shared).

- [ ] **Step 2: Typecheck/build geral**

Run: `pnpm build`
Expected: build de todos os workspaces sem erros.

- [ ] **Step 3: Smoke manual (opcional, recomendado)** — `pnpm dev`, concluir uma sala com ação atribuída a um usuário, abrir o perfil dele (seção "Ações", marcar concluída), criar a próxima sala da mesma squad e validar/reprovar no painel "Auditoria".

---

## Self-Review

- **Cobertura do spec:** modelo de dados → Task 1; contrato → Task 2; serializers → Task 3; To-Do no perfil (service+rota) → Task 4; concluir ação → Task 5; listar auditoria (`findAuditSourceRoom`/`listAudit`) → Task 6; validar/reprovar + reabrir + broadcast → Task 7; cliente web + `audit.changed` → Task 8; seção Ações no perfil → Task 9; painel Auditoria → Task 10; verificação → Task 11. Sem lacunas.
- **Placeholders:** nenhum "TBD/TODO"; todo passo de código mostra o código.
- **Consistência de tipos:** `RetroActionItemDTO`/`RetroAuditItemDTO` definidos na Task 2 e usados nas Tasks 3/4/7/8/9/10; `toRetroActionItemDTO(card, sprint)` e `toRetroAuditItemDTO(card, responsible)` com as mesmas assinaturas em todo o plano; `setActionDone`/`listAudit`/`findAuditSourceRoom`/`setAudit` consistentes entre service e rotas; chaves de query `['profile', id]` e `['retro-audit', id]` idênticas onde lidas/invalidadas.
