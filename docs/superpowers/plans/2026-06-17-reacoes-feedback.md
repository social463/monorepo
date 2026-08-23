# Reações a feedbacks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir reagir a um feedback com emojis (estilo Slack: várias reações diferentes por usuário, toggle por clique).

**Architecture:** Novo modelo Prisma `FeedbackReaction` relacionado a `Feedback` e `User`. Backend expõe um endpoint de toggle e passa a embutir um resumo de reações na listagem de feedbacks. Frontend renderiza chips de reação com contagem + tooltip de nomes e um popover com a paleta de emojis, com atualização otimista no cache do react-query.

**Tech Stack:** Fastify + Prisma + Postgres (apps/api), React + Vite + Tailwind + @tanstack/react-query (apps/web), tipos compartilhados em packages/shared, testes com Vitest.

## Global Constraints

- Monorepo pnpm: `@legends/shared` é a fonte dos tipos compartilhados; a API e a web importam dele.
- Conjunto fixo de 12 reações, validado no servidor: `👏 ❤️ 🎯 💡 🚀 👍 🎉 🙌 🔥 💪 🧠 🙏`.
- Reações respeitam a visibilidade por categoria já existente (privados só para autor, alvo e ADMIN; ver `PUBLIC_FEEDBACK_CATEGORIES`).
- Um usuário pode ter no máximo uma reação de cada emoji por feedback (constraint único `@@unique([feedbackId, userId, emoji])`).
- `apiFetch` só envia `Content-Type: application/json` quando há corpo; sempre enviar `body: JSON.stringify(...)` em POSTs com payload.
- Mensagens de UI em português, seguindo o tom das já existentes.

---

## File Structure

- `packages/shared/src/feedback.ts` — **Modify**: constantes e tipos de reação; campo `reactions` no `FeedbackDTO`.
- `apps/api/prisma/schema.prisma` — **Modify**: modelo `FeedbackReaction` + relações em `Feedback` e `User`.
- `apps/api/prisma/migrations/<timestamp>_add_feedback_reaction/` — **Create**: migration gerada pelo Prisma.
- `apps/api/test/setup.ts` — **Modify**: limpeza de `feedbackReaction` entre testes.
- `apps/api/src/lib/serialize.ts` — **Modify**: `toFeedbackDTO(feedback, viewerId)` + resumo de reações.
- `apps/api/src/services/feedback-service.ts` — **Modify**: `feedbackInclude` com reações, helper `canViewFeedback`, função `toggleReaction`.
- `apps/api/src/routes/feedback.ts` — **Modify**: passar `viewerId` ao serializar; rota `POST /feedbacks/:id/reactions/toggle`.
- `apps/api/src/services/feedback-service.test.ts` — **Create**: testes do serviço de reação.
- `apps/api/src/routes/feedback.test.ts` — **Modify**: testes da rota de toggle.
- `apps/web/src/pages/profile/FeedbackReactions.tsx` — **Create**: componente de chips + popover.
- `apps/web/src/pages/profile/FeedbackSection.tsx` — **Modify**: mutation de toggle (otimista) + render do `FeedbackReactions`.

---

## Task 1: Tipos compartilhados de reação

**Files:**
- Modify: `packages/shared/src/feedback.ts`

**Interfaces:**
- Produces:
  - `FEEDBACK_REACTIONS: readonly ['👏','❤️','🎯','💡','🚀','👍','🎉','🙌','🔥','💪','🧠','🙏']`
  - `type FeedbackReactionEmoji = (typeof FEEDBACK_REACTIONS)[number]`
  - `interface ReactionSummary { emoji: FeedbackReactionEmoji; count: number; reactedByMe: boolean; users: { id: string; name: string }[] }`
  - `interface ToggleReactionRequest { emoji: FeedbackReactionEmoji }`
  - `FeedbackDTO.reactions: ReactionSummary[]`

- [ ] **Step 1: Adicionar constantes, tipos e campo no DTO**

Em `packages/shared/src/feedback.ts`, após a definição de `PUBLIC_FEEDBACK_CATEGORIES` (linha 16) adicione:

```ts
export const FEEDBACK_REACTIONS = ['👏', '❤️', '🎯', '💡', '🚀', '👍', '🎉', '🙌', '🔥', '💪', '🧠', '🙏'] as const
export type FeedbackReactionEmoji = (typeof FEEDBACK_REACTIONS)[number]

export interface ReactionSummary {
  emoji: FeedbackReactionEmoji
  count: number
  /** Se o usuário que fez a requisição já reagiu com este emoji. */
  reactedByMe: boolean
  /** Quem reagiu com este emoji — usado para o tooltip de nomes. */
  users: { id: string; name: string }[]
}

export interface ToggleReactionRequest {
  emoji: FeedbackReactionEmoji
}
```

E no `interface FeedbackDTO`, adicione o campo `reactions` após `updatedAt`:

```ts
export interface FeedbackDTO {
  id: string
  author: PublicUser
  message: string
  category: FeedbackCategory
  createdAt: string
  updatedAt: string
  reactions: ReactionSummary[]
}
```

- [ ] **Step 2: Confirmar reexport**

`packages/shared/src/index.ts` reexporta de `./feedback` (já faz `export * from './feedback'` ou similar). Verifique:

Run: `grep -n "feedback" packages/shared/src/index.ts`
Expected: existe uma linha reexportando `./feedback`. Se for um `export {}` nominal em vez de `export *`, acrescente os novos nomes (`FEEDBACK_REACTIONS`, `FeedbackReactionEmoji`, `ReactionSummary`, `ToggleReactionRequest`) à lista.

- [ ] **Step 3: Type-check do pacote shared**

Run: `pnpm --filter @legends/shared build` (ou `pnpm -w typecheck` se existir)
Expected: compila sem erros.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/feedback.ts packages/shared/src/index.ts
git commit -m "feat(shared): tipos de reação a feedback"
```

---

## Task 2: Modelo Prisma + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/test/setup.ts`
- Create: `apps/api/prisma/migrations/<timestamp>_add_feedback_reaction/migration.sql` (gerada)

**Interfaces:**
- Produces: tabela `FeedbackReaction` com `@@unique([feedbackId, userId, emoji])`; relações `Feedback.reactions` e `User.feedbackReactions`; Prisma Client com `prisma.feedbackReaction`.

- [ ] **Step 1: Adicionar o modelo e as relações**

No `apps/api/prisma/schema.prisma`, no model `Feedback` (após a linha `target User @relation("FeedbacksReceived", ...)`, linha 180), adicione a relação:

```prisma
  reactions FeedbackReaction[]
```

No model `User`, junto às outras relações (após `feedbacksReceived Feedback[] @relation("FeedbacksReceived")`, linha 63), adicione:

```prisma
  feedbackReactions FeedbackReaction[]
```

Após o model `Feedback` (depois da linha 185), adicione o novo modelo:

```prisma
model FeedbackReaction {
  id         String   @id @default(cuid())
  feedbackId String
  userId     String
  emoji      String
  createdAt  DateTime @default(now())

  feedback Feedback @relation(fields: [feedbackId], references: [id], onDelete: Cascade)
  user     User     @relation(fields: [userId], references: [id])

  @@unique([feedbackId, userId, emoji])
  @@index([feedbackId])
}
```

- [ ] **Step 2: Gerar a migration**

Run: `pnpm --filter @legends/api exec prisma migrate dev --name add_feedback_reaction`
Expected: cria `apps/api/prisma/migrations/<timestamp>_add_feedback_reaction/migration.sql` com `CREATE TABLE "FeedbackReaction"`, regenera o Prisma Client, sem erros.

- [ ] **Step 3: Limpar reações entre testes**

Em `apps/api/test/setup.ts`, dentro do `prisma.$transaction([...])`, adicione `prisma.feedbackReaction.deleteMany()` **antes** de `prisma.feedback.deleteMany()`:

```ts
  await prisma.$transaction([
    prisma.refreshToken.deleteMany(),
    prisma.userBadge.deleteMany(),
    prisma.vote.deleteMany(),
    prisma.feedbackReaction.deleteMany(),
    prisma.feedback.deleteMany(),
    prisma.badge.deleteMany(),
    prisma.votingPeriod.deleteMany(),
    prisma.category.deleteMany(),
    prisma.user.deleteMany(),
  ])
```

- [ ] **Step 4: Verificar que o client compila e os testes existentes passam**

Run: `pnpm --filter @legends/api test -- feedback`
Expected: a suíte `feedback routes` passa (ainda sem testes de reação).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/setup.ts
git commit -m "feat(api): modelo FeedbackReaction + migration"
```

---

## Task 3: Include de reações + serialização com viewerId

**Files:**
- Modify: `apps/api/src/services/feedback-service.ts:15-16`
- Modify: `apps/api/src/lib/serialize.ts:110-119`
- Modify: `apps/api/src/routes/feedback.ts` (chamadas a `toFeedbackDTO`)

**Interfaces:**
- Consumes: `ReactionSummary`, `FEEDBACK_REACTIONS` (Task 1); `feedbackReaction` no client (Task 2).
- Produces:
  - `feedbackInclude = { author: true, reactions: { include: { user: true } } }`
  - `toFeedbackDTO(feedback: FeedbackWithAuthor, viewerId: string): FeedbackDTO`

- [ ] **Step 1: Incluir reações no `feedbackInclude`**

Em `apps/api/src/services/feedback-service.ts`, substitua a linha 15:

```ts
export const feedbackInclude = { author: true } as const
```

por:

```ts
export const feedbackInclude = { author: true, reactions: { include: { user: true } } } as const
```

`FeedbackWithAuthor` (linha 16) já deriva de `feedbackInclude`, então passa a conter `reactions`.

- [ ] **Step 2: Atualizar `toFeedbackDTO` para resumir reações**

Em `apps/api/src/lib/serialize.ts`, adicione o import de `FEEDBACK_REACTIONS` e `ReactionSummary` (na lista de imports de `@legends/shared`, linhas 2-13):

```ts
  FEEDBACK_REACTIONS,
  type ReactionSummary,
```

(Note: `FEEDBACK_REACTIONS` é valor, não `type`; mantenha-o fora do bloco de `type`-only imports — separe se necessário.)

Substitua a função `toFeedbackDTO` (linhas 110-119) por:

```ts
function summarizeReactions(
  reactions: { emoji: string; userId: string; user: { id: string; name: string } }[],
  viewerId: string,
): ReactionSummary[] {
  return FEEDBACK_REACTIONS.flatMap((emoji) => {
    const matching = reactions.filter((r) => r.emoji === emoji)
    if (matching.length === 0) return []
    return [
      {
        emoji,
        count: matching.length,
        reactedByMe: matching.some((r) => r.userId === viewerId),
        users: matching.map((r) => ({ id: r.user.id, name: r.user.name })),
      },
    ]
  })
}

export function toFeedbackDTO(feedback: FeedbackWithAuthor, viewerId: string): FeedbackDTO {
  return {
    id: feedback.id,
    author: toPublicUser(feedback.author),
    message: feedback.message,
    category: feedback.category,
    createdAt: feedback.createdAt.toISOString(),
    updatedAt: feedback.updatedAt.toISOString(),
    reactions: summarizeReactions(feedback.reactions, viewerId),
  }
}
```

- [ ] **Step 3: Passar `viewerId` em todas as chamadas a `toFeedbackDTO`**

Em `apps/api/src/routes/feedback.ts`:

- Linha 44 (listagem): troque `page.map(toFeedbackDTO)` por:

```ts
    return reply.send({ feedbacks: page.map((f) => toFeedbackDTO(f, request.user.sub)), hasMore })
```

- Linha 59 (criação): troque `toFeedbackDTO(feedback)` por `toFeedbackDTO(feedback, request.user.sub)`.
- Linha 78 (update): troque `toFeedbackDTO(feedback)` por `toFeedbackDTO(feedback, request.user.sub)`.

- [ ] **Step 4: Ajustar teste de listagem para o novo campo**

Em `apps/api/src/routes/feedback.test.ts`, no teste "lista feedbacks do alvo em ordem decrescente" (após a linha 100), adicione uma asserção de que o campo existe:

```ts
    expect(res.json().feedbacks[0].reactions).toEqual([])
```

- [ ] **Step 5: Rodar testes de feedback**

Run: `pnpm --filter @legends/api test -- feedback`
Expected: todos passam; o feedback retornado inclui `reactions: []`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/feedback-service.ts apps/api/src/lib/serialize.ts apps/api/src/routes/feedback.ts apps/api/src/routes/feedback.test.ts
git commit -m "feat(api): embutir resumo de reações no FeedbackDTO"
```

---

## Task 4: Serviço `toggleReaction` + visibilidade

**Files:**
- Modify: `apps/api/src/services/feedback-service.ts`
- Create: `apps/api/src/services/feedback-service.test.ts`

**Interfaces:**
- Consumes: `FEEDBACK_REACTIONS`, `FeedbackReactionEmoji` (Task 1); `feedbackInclude`, `FeedbackError`, `FeedbackWithAuthor` (existentes).
- Produces:
  - `canViewFeedback(feedback: { authorId: string; targetId: string; category: FeedbackCategory }, viewer: { id: string; role: string }): boolean`
  - `toggleReaction(input: { feedbackId: string; userId: string; emoji: string; viewerRole: string }): Promise<FeedbackWithAuthor>`

- [ ] **Step 1: Escrever os testes do serviço (que falham)**

Crie `apps/api/src/services/feedback-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { createFeedback, toggleReaction, FeedbackError } from './feedback-service'

const LONG = 'feedback suficientemente longo para passar na validação de tamanho mínimo'

async function makeUser(name: string, role: 'DEV' | 'LEAD' | 'ADMIN' = 'DEV') {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@empresa.com`, passwordHash: 'x', role },
  })
}

describe('toggleReaction', () => {
  it('adiciona quando não existe e remove no segundo toggle (idempotente)', async () => {
    const author = await makeUser('Autor')
    const target = await makeUser('Alvo', 'LEAD')
    const fb = await createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'POSITIVO' })

    const after1 = await toggleReaction({ feedbackId: fb.id, userId: target.id, emoji: '👏', viewerRole: 'LEAD' })
    expect(after1.reactions).toHaveLength(1)
    expect(after1.reactions[0].emoji).toBe('👏')

    const after2 = await toggleReaction({ feedbackId: fb.id, userId: target.id, emoji: '👏', viewerRole: 'LEAD' })
    expect(after2.reactions).toHaveLength(0)
  })

  it('rejeita emoji fora da lista permitida (400)', async () => {
    const author = await makeUser('Autor')
    const target = await makeUser('Alvo', 'LEAD')
    const fb = await createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'POSITIVO' })
    await expect(
      toggleReaction({ feedbackId: fb.id, userId: target.id, emoji: '💩', viewerRole: 'LEAD' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('bloqueia reação em feedback privado não visível ao usuário (404)', async () => {
    const author = await makeUser('Autor')
    const target = await makeUser('Alvo', 'LEAD')
    const stranger = await makeUser('Estranho')
    const fb = await createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'ORIENTACAO' })
    await expect(
      toggleReaction({ feedbackId: fb.id, userId: stranger.id, emoji: '👏', viewerRole: 'DEV' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('remove as reações em cascata ao excluir o feedback', async () => {
    const author = await makeUser('Autor')
    const target = await makeUser('Alvo', 'LEAD')
    const fb = await createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'POSITIVO' })
    await toggleReaction({ feedbackId: fb.id, userId: target.id, emoji: '🔥', viewerRole: 'LEAD' })
    await prisma.feedback.delete({ where: { id: fb.id } })
    const remaining = await prisma.feedbackReaction.count({ where: { feedbackId: fb.id } })
    expect(remaining).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `pnpm --filter @legends/api test -- feedback-service`
Expected: FAIL — `toggleReaction` ainda não exportado.

- [ ] **Step 3: Implementar `canViewFeedback` e `toggleReaction`**

Em `apps/api/src/services/feedback-service.ts`, atualize o import da linha 2 para incluir as novas constantes:

```ts
import {
  FEEDBACK_REACTIONS,
  MIN_FEEDBACK_FIELD_LENGTH,
  PUBLIC_FEEDBACK_CATEGORIES,
  type FeedbackCategory,
  type FeedbackReactionEmoji,
} from '@legends/shared'
```

Ao final do arquivo, adicione:

```ts
/** Visibilidade de um único feedback (espelha a regra de listFeedbacksForUser). */
export function canViewFeedback(
  feedback: { authorId: string; targetId: string; category: FeedbackCategory },
  viewer: { id: string; role: string },
): boolean {
  if (viewer.role === 'ADMIN') return true
  if (feedback.authorId === viewer.id || feedback.targetId === viewer.id) return true
  return (PUBLIC_FEEDBACK_CATEGORIES as readonly string[]).includes(feedback.category)
}

export async function toggleReaction(input: {
  feedbackId: string
  userId: string
  emoji: string
  viewerRole: string
}): Promise<FeedbackWithAuthor> {
  if (!(FEEDBACK_REACTIONS as readonly string[]).includes(input.emoji)) {
    throw new FeedbackError('Reação inválida.', 400)
  }
  const emoji = input.emoji as FeedbackReactionEmoji
  const feedback = await prisma.feedback.findUnique({ where: { id: input.feedbackId } })
  if (!feedback || !canViewFeedback(feedback, { id: input.userId, role: input.viewerRole })) {
    // Não vazamos a existência de feedbacks privados.
    throw new FeedbackError('Feedback não encontrado.', 404)
  }
  const existing = await prisma.feedbackReaction.findUnique({
    where: { feedbackId_userId_emoji: { feedbackId: input.feedbackId, userId: input.userId, emoji } },
  })
  if (existing) {
    await prisma.feedbackReaction.delete({ where: { id: existing.id } })
  } else {
    await prisma.feedbackReaction.create({
      data: { feedbackId: input.feedbackId, userId: input.userId, emoji },
    })
  }
  return prisma.feedback.findUniqueOrThrow({ where: { id: input.feedbackId }, include: feedbackInclude })
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `pnpm --filter @legends/api test -- feedback-service`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/feedback-service.ts apps/api/src/services/feedback-service.test.ts
git commit -m "feat(api): serviço de toggle de reação a feedback"
```

---

## Task 5: Rota `POST /feedbacks/:id/reactions/toggle`

**Files:**
- Modify: `apps/api/src/routes/feedback.ts`
- Modify: `apps/api/src/routes/feedback.test.ts`

**Interfaces:**
- Consumes: `toggleReaction`, `FeedbackError`, `toFeedbackDTO` (Tasks 3–4); `FEEDBACK_REACTIONS` (Task 1).
- Produces: endpoint `POST /feedbacks/:id/reactions/toggle` → `{ reactions: ReactionSummary[] }`.

- [ ] **Step 1: Escrever os testes da rota (que falham)**

Em `apps/api/src/routes/feedback.test.ts`, adicione dentro do `describe('feedback routes', ...)` (antes do fechamento na linha 339):

```ts
  it('toggle de reação adiciona e remove (200), com reactedByMe', async () => {
    const { app, lead, token, authorId } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const feedbackId = created.json().feedback.id as string

    const add = await app.inject({
      method: 'POST',
      url: `/feedbacks/${feedbackId}/reactions/toggle`,
      headers: { authorization: `Bearer ${token}` },
      payload: { emoji: '👏' },
    })
    expect(add.statusCode).toBe(200)
    expect(add.json().reactions).toHaveLength(1)
    expect(add.json().reactions[0]).toMatchObject({ emoji: '👏', count: 1, reactedByMe: true })
    expect(add.json().reactions[0].users[0].id).toBe(authorId)

    const remove = await app.inject({
      method: 'POST',
      url: `/feedbacks/${feedbackId}/reactions/toggle`,
      headers: { authorization: `Bearer ${token}` },
      payload: { emoji: '👏' },
    })
    expect(remove.json().reactions).toHaveLength(0)
    await app.close()
  })

  it('rejeita emoji inválido no toggle (400)', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const feedbackId = created.json().feedback.id as string
    const res = await app.inject({
      method: 'POST',
      url: `/feedbacks/${feedbackId}/reactions/toggle`,
      headers: { authorization: `Bearer ${token}` },
      payload: { emoji: 'X' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('404 ao reagir a feedback privado não visível', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message, category: 'ORIENTACAO' },
    })
    const feedbackId = created.json().feedback.id as string
    const other = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Bia', email: 'bia@empresa.com', password: 'changeme123' },
    })
    const otherToken = other.json().accessToken as string
    const res = await app.inject({
      method: 'POST',
      url: `/feedbacks/${feedbackId}/reactions/toggle`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { emoji: '👏' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `pnpm --filter @legends/api test -- feedback.test`
Expected: FAIL — rota retorna 404 padrão (rota inexistente) onde se espera 200/400.

- [ ] **Step 3: Implementar a rota**

Em `apps/api/src/routes/feedback.ts`:

Atualize o import de `@legends/shared` (linha 3) para incluir `FEEDBACK_REACTIONS`:

```ts
import { FEEDBACK_CATEGORIES, FEEDBACK_REACTIONS, MIN_FEEDBACK_FIELD_LENGTH } from '@legends/shared'
```

Atualize o import do serviço (linhas 4-10) para incluir `toggleReaction`:

```ts
import {
  FeedbackError,
  createFeedback,
  deleteFeedback,
  listFeedbacksForUser,
  toggleReaction,
  updateFeedback,
} from '../services/feedback-service'
```

Após o `updateFeedbackSchema` (linha 27), adicione:

```ts
const toggleReactionSchema = z.object({
  emoji: z.enum(FEEDBACK_REACTIONS),
})
```

Antes do fechamento de `feedbackRoutes` (após a rota DELETE, linha 94), adicione:

```ts
  app.post('/feedbacks/:id/reactions/toggle', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = toggleReactionSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Reação inválida.', issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    try {
      const feedback = await toggleReaction({
        feedbackId: id,
        userId: request.user.sub,
        emoji: parsed.data.emoji,
        viewerRole: request.user.role,
      })
      return reply.send({ reactions: toFeedbackDTO(feedback, request.user.sub).reactions })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `pnpm --filter @legends/api test -- feedback.test`
Expected: PASS (incluindo os 3 novos testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/feedback.ts apps/api/src/routes/feedback.test.ts
git commit -m "feat(api): rota de toggle de reação a feedback"
```

---

## Task 6: Frontend — chips de reação + popover + toggle otimista

**Files:**
- Create: `apps/web/src/pages/profile/FeedbackReactions.tsx`
- Modify: `apps/web/src/pages/profile/FeedbackSection.tsx`

**Interfaces:**
- Consumes: `FEEDBACK_REACTIONS`, `FeedbackReactionEmoji`, `ReactionSummary`, `FeedbackDTO` (Task 1); endpoint de toggle (Task 5); `Icon`, `apiFetch`, `useAuth`.
- Produces: componente `FeedbackReactions`.

- [ ] **Step 1: Criar o componente `FeedbackReactions`**

Crie `apps/web/src/pages/profile/FeedbackReactions.tsx`:

```tsx
import { useState } from 'react'
import { FEEDBACK_REACTIONS, type FeedbackReactionEmoji, type ReactionSummary } from '@legends/shared'
import { Icon } from '../../components/Icon'

export function FeedbackReactions({
  reactions,
  onToggle,
}: {
  reactions: ReactionSummary[]
  onToggle: (emoji: FeedbackReactionEmoji) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-sm flex flex-wrap items-center gap-xs">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle(r.emoji)}
          title={r.users.map((u) => u.name).join(', ')}
          className={`flex items-center gap-xs rounded-full border px-sm py-0.5 font-label text-label-sm transition-colors ${
            r.reactedByMe
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-outline-variant/60 text-on-surface-variant hover:border-primary'
          }`}
        >
          <span className="text-[14px] leading-none">{r.emoji}</span>
          <span>{r.count}</span>
        </button>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Adicionar reação"
          aria-expanded={open}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-outline-variant/60 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          <Icon name="add_reaction" className="text-[16px]" />
        </button>
        {open && (
          <>
            {/* Backdrop invisível para fechar ao clicar fora. */}
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute bottom-full left-0 z-20 mb-xs grid w-[13rem] grid-cols-6 gap-xs rounded-lg border border-outline-variant/40 bg-surface-container p-sm shadow-lg">
              {FEEDBACK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onToggle(emoji)
                    setOpen(false)
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[18px] transition-colors hover:bg-surface-container-highest"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Adicionar a mutation otimista de toggle no `FeedbackSection`**

Em `apps/web/src/pages/profile/FeedbackSection.tsx`:

Atualize os imports do topo. Na linha 1, adicione `InfiniteData`:

```ts
import { useState, type FormEvent, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
```

Na linha 3 (tipos do shared), adicione `FeedbackReactionEmoji`, `ReactionSummary`, e na linha 4 (valores) adicione `FEEDBACK_REACTIONS`:

```ts
import type { CreateFeedbackRequest, FeedbackDTO, FeedbackCategory, FeedbackReactionEmoji, ReactionSummary, UpdateFeedbackRequest } from '@legends/shared'
import { MIN_FEEDBACK_FIELD_LENGTH, FEEDBACK_CATEGORIES, FEEDBACK_CATEGORY_LABELS, FEEDBACK_REACTIONS } from '@legends/shared'
```

Adicione o import do componente novo, após o import do `Avatar` (linha 7):

```ts
import { FeedbackReactions } from './FeedbackReactions'
```

Antes do componente `FeedbackSection` (após a linha 38, fora do componente), adicione o helper de toggle otimista:

```tsx
type FeedbackPage = { feedbacks: FeedbackDTO[]; hasMore: boolean }

/** Recalcula o array de reações de um feedback ao aplicar/remover a reação do usuário atual. */
function applyToggle(
  reactions: ReactionSummary[],
  emoji: FeedbackReactionEmoji,
  me: { id: string; name: string },
): ReactionSummary[] {
  const existing = reactions.find((r) => r.emoji === emoji)
  if (existing?.reactedByMe) {
    return reactions
      .map((r) =>
        r.emoji === emoji
          ? { ...r, count: r.count - 1, reactedByMe: false, users: r.users.filter((u) => u.id !== me.id) }
          : r,
      )
      .filter((r) => r.count > 0)
  }
  if (existing) {
    return reactions.map((r) =>
      r.emoji === emoji
        ? { ...r, count: r.count + 1, reactedByMe: true, users: [...r.users, { id: me.id, name: me.name }] }
        : r,
    )
  }
  const added: ReactionSummary = { emoji, count: 1, reactedByMe: true, users: [{ id: me.id, name: me.name }] }
  return [...reactions, added].sort(
    (a, b) => FEEDBACK_REACTIONS.indexOf(a.emoji) - FEEDBACK_REACTIONS.indexOf(b.emoji),
  )
}
```

Dentro do componente, após a mutation `remove` (linha 113), adicione a mutation de toggle:

```tsx
  const toggleReaction = useMutation({
    mutationFn: (vars: { feedbackId: string; emoji: FeedbackReactionEmoji }) =>
      apiFetch<{ reactions: ReactionSummary[] }>(`/feedbacks/${vars.feedbackId}/reactions/toggle`, {
        method: 'POST',
        body: JSON.stringify({ emoji: vars.emoji }),
      }),
    onMutate: async (vars) => {
      if (!user) return { previous: undefined }
      await queryClient.cancelQueries({ queryKey: ['feedbacks', targetId] })
      const previous = queryClient.getQueryData<InfiniteData<FeedbackPage>>(['feedbacks', targetId])
      const me = { id: user.id, name: user.name }
      queryClient.setQueryData<InfiniteData<FeedbackPage>>(['feedbacks', targetId], (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            feedbacks: page.feedbacks.map((f) =>
              f.id === vars.feedbackId ? { ...f, reactions: applyToggle(f.reactions, vars.emoji, me) } : f,
            ),
          })),
        }
      })
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['feedbacks', targetId], ctx.previous)
      setError('Não foi possível registrar a reação.')
    },
    onSettled: () => invalidate(),
  })
```

- [ ] **Step 3: Renderizar o `FeedbackReactions` em cada feedback**

Em `apps/web/src/pages/profile/FeedbackSection.tsx`, logo após o parágrafo da mensagem (linha 345 `<p ...>{feedback.message}</p>`), adicione:

```tsx
                <FeedbackReactions
                  reactions={feedback.reactions}
                  onToggle={(emoji) => {
                    if (user) toggleReaction.mutate({ feedbackId: feedback.id, emoji })
                  }}
                />
```

- [ ] **Step 4: Type-check e build da web**

Run: `pnpm --filter @legends/web build`
Expected: compila sem erros de tipo.

- [ ] **Step 5: Verificação manual rápida**

Suba o app (`pnpm --filter @legends/api dev` + `pnpm --filter @legends/web dev`), abra o perfil de um colega com feedbacks, clique no botão `+` de um feedback, escolha um emoji. Esperado: o chip aparece com contagem 1 e destaque; clicar de novo remove; o tooltip (hover) mostra seu nome.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/profile/FeedbackReactions.tsx apps/web/src/pages/profile/FeedbackSection.tsx
git commit -m "feat(web): reações a feedback com popover e toggle otimista"
```

---

## Self-Review Notes

- **Spec coverage:** conjunto de 12 emojis (Task 1), modelo + constraint único + cascade (Task 2), visibilidade reaproveitada (Task 4 `canViewFeedback`), endpoint de toggle (Task 5), DTO com `reactions` + `reactedByMe` + `users` (Task 3), UI com chips/contagem/tooltip/popover/otimista (Task 6), testes de serviço e rota (Tasks 4–5). Todos os itens do spec têm task correspondente.
- **Type consistency:** `toFeedbackDTO(feedback, viewerId)` definido na Task 3 e usado nas Tasks 3 e 5; `toggleReaction` assinatura idêntica nas Tasks 4–5; `applyToggle`/`ReactionSummary`/`FeedbackReactionEmoji` consistentes entre Tasks 1 e 6.
- **Sem placeholders:** todo passo de código mostra o código completo.
