# Resenha — Menções @ + Card de Notificação do Teams — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir marcar pessoas com `@` (autocomplete) em resenhas e comentários — vinculando, notificando e linkando o perfil — e redesenhar o card genérico de notificação do Teams para seguir o modelo rico do nudge de ofensiva.

**Architecture:** Mesmo padrão da Resenha (route→service→Prisma, contrato em `@legends/shared`). Menções selecionadas no cliente viram `mentionedUserIds` no payload; o service grava tabelas-irmãs `ReviewMention`/`ReviewCommentMention` (com snapshot do nome) numa transação com a entidade, usadas para notificar e renderizar. O front insere `@Nome` via autocomplete e linka as menções na exibição. O card do Teams genérico passa a espelhar o layout do `buildStreakAtRiskCard`.

**Tech Stack:** Fastify 4, Prisma 5 + PostgreSQL, Zod, Vitest (+ Postgres real), React 18 + React Query + React Router 6, Tailwind 3, TypeScript ESM.

## Global Constraints

- TypeScript **strict**, ESM puro.
- Cap de **10** menções por resenha/comentário (`MAX_REVIEW_MENTIONS = 10`).
- Dropdown/menções: apenas usuários **ativos e não-admin** (`active && role !== 'ADMIN'`).
- Servidor **leniente** com `mentionedUserIds`: deduplica, mantém só ativos não-admin, ignora ids desconhecidos/inativos/admin, limita a 10. Não retorna 400 por id inválido.
- Notificação de menção: tipo `REVIEW_MENTION`, título `"<ator> te marcou numa resenha"`, link `/resenha#<reviewId>`, **dedup**, **não notifica a si mesmo**, best-effort + espelho no Teams.
- Menções gravam **snapshot do `name`** (nome atual do usuário no momento).
- O enum Prisma `NotificationType` e o array `NOTIFICATION_TYPES` de `@legends/shared` devem permanecer **em sincronia**.
- Mensagens ao usuário em **português**.
- Nunca editar migration já aplicada — gerar nova com `pnpm db:migrate`.
- Testes da API exigem Postgres de pé (`pnpm db:up`). GOTCHA: se o login falhar/banco vazio, `brew services stop postgresql@17` e retry.
- Card do Teams: `buildNotificationCard` segue o modelo de `buildStreakAtRiskCard` (header `accent` com emoji + título em negrito, corpo opcional, botão de ação). Campos novos de `TeamsNotification` (`emoji?`, `body?`) são **opcionais** — nenhuma assinatura pública quebra.

---

## File Structure

**Backend (`apps/api`)**
- `prisma/schema.prisma` — +2 models (`ReviewMention`, `ReviewCommentMention`), +1 enum value, back-relations no `User`. (T1)
- `test/setup.ts` — trunca as 2 novas tabelas. (T1)
- `src/services/review-service.ts` — includes `mentions`, `resolveMentions`, `createReview`/`createComment` com menções. (T3)
- `src/lib/serialize.ts` — `mentions` nos DTOs. (T3)
- `src/services/notification-service.ts` — `notifyReviewMention` (T4) + emoji por tipo em `createNotification` (T8).
- `src/routes/review.ts` — `mentionedUserIds` no schema + disparo de `notifyReviewMention`. (T5)
- `src/lib/teams-client.ts` — redesign de `buildNotificationCard`. (T8)

**Shared (`packages/shared`)**
- `src/review.ts` — `MAX_REVIEW_MENTIONS`, `MentionDTO`, `mentions` nos DTOs, `mentionedUserIds?` nos requests. (T2)
- `src/notification.ts` — `REVIEW_MENTION` em `NOTIFICATION_TYPES`. (T2)

**Frontend (`apps/web`)**
- `src/lib/use-colleagues.ts` — hook de colegas ativos não-admin. (T6)
- `src/lib/mentions.tsx` — `renderWithMentions` + utilitários de menção. (T6)
- `src/components/MentionTextarea.tsx` — textarea com autocomplete de `@`. (T7)
- `src/pages/resenha/ReviewComposer.tsx`, `ReviewComments.tsx`, `ReviewCard.tsx` — integração. (T8web)

---

## Task 1: Modelo de dados das menções

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/test/setup.ts`
- Create: `apps/api/src/services/review-mention-schema.test.ts`

**Interfaces:**
- Produces: tabelas `ReviewMention`, `ReviewCommentMention`; enum value `REVIEW_MENTION`; `prisma.reviewMention`, `prisma.reviewCommentMention`.

- [ ] **Step 1: Escrever o teste de schema (falha)**

Create `apps/api/src/services/review-mention-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'

async function makeUser(email: string) {
  return prisma.user.create({ data: { name: email, email, passwordHash: 'x' } })
}

describe('review mention schema', () => {
  it('grava menções de resenha e comentário e cascateia ao excluir', async () => {
    const author = await makeUser('autor@empresa.com')
    const alvo = await makeUser('alvo@empresa.com')
    const review = await prisma.review.create({ data: { authorId: author.id, content: 'oi @alvo' } })
    await prisma.reviewMention.create({ data: { reviewId: review.id, userId: alvo.id, name: 'Alvo' } })
    const comment = await prisma.reviewComment.create({
      data: { reviewId: review.id, authorId: author.id, content: 'cc @alvo' },
    })
    await prisma.reviewCommentMention.create({ data: { commentId: comment.id, userId: alvo.id, name: 'Alvo' } })

    await prisma.review.delete({ where: { id: review.id } })
    expect(await prisma.reviewMention.count()).toBe(0)
    expect(await prisma.reviewCommentMention.count()).toBe(0)
  })

  it('impede menção duplicada do mesmo usuário na mesma resenha (unique)', async () => {
    const author = await makeUser('a2@empresa.com')
    const alvo = await makeUser('alvo2@empresa.com')
    const review = await prisma.review.create({ data: { authorId: author.id, content: 'x' } })
    await prisma.reviewMention.create({ data: { reviewId: review.id, userId: alvo.id, name: 'Alvo' } })
    await expect(
      prisma.reviewMention.create({ data: { reviewId: review.id, userId: alvo.id, name: 'Alvo' } }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Rodar para falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test -- review-mention-schema`
Expected: FAIL — `prisma.reviewMention` indefinido.

- [ ] **Step 3: Adicionar models, enum e relations**

Em `apps/api/prisma/schema.prisma`:

No enum `NotificationType`, adicione ao final (antes do `}`):

```prisma
  REVIEW_MENTION
```

No model `User`, junto às outras relations de review (após `reviewShares           ReviewShare[]`):

```prisma
  reviewMentions         ReviewMention[]
  reviewCommentMentions  ReviewCommentMention[]
```

Ao final do arquivo, adicione:

```prisma
model ReviewMention {
  id        String   @id @default(cuid())
  reviewId  String
  userId    String
  name      String
  createdAt DateTime @default(now())

  review Review @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([reviewId, userId])
  @@index([reviewId])
}

model ReviewCommentMention {
  id        String   @id @default(cuid())
  commentId String
  userId    String
  name      String
  createdAt DateTime @default(now())

  comment ReviewComment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  user    User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([commentId, userId])
  @@index([commentId])
}
```

- [ ] **Step 4: Gerar a migration**

Run: `pnpm --filter @legends/api exec prisma migrate dev --name add_review_mentions`
Expected: cria `apps/api/prisma/migrations/<ts>_add_review_mentions/migration.sql` e regenera o client.

- [ ] **Step 5: Truncar as novas tabelas no setup de teste**

Em `apps/api/test/setup.ts`, dentro do `prisma.$transaction([...])`, adicione **antes** de `prisma.reviewComment.deleteMany(),`:

```ts
    prisma.reviewCommentMention.deleteMany(),
    prisma.reviewMention.deleteMany(),
```

- [ ] **Step 6: Rodar para passar**

Run: `pnpm --filter @legends/api test -- review-mention-schema`
Expected: PASS (2 testes).

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/setup.ts apps/api/src/services/review-mention-schema.test.ts
git commit -m "feat(resenha): schema de menções (ReviewMention/ReviewCommentMention) + REVIEW_MENTION"
```

---

## Task 2: Contrato compartilhado das menções

**Files:**
- Modify: `packages/shared/src/review.ts`
- Modify: `packages/shared/src/notification.ts`

**Interfaces:**
- Produces: `MAX_REVIEW_MENTIONS`, `MentionDTO`, `ReviewDTO.mentions`, `ReviewCommentDTO.mentions`, `CreateReviewRequest.mentionedUserIds?`, `CreateReviewCommentRequest.mentionedUserIds?`, `'REVIEW_MENTION'` em `NOTIFICATION_TYPES`.

- [ ] **Step 1: Atualizar o contrato de review**

Em `packages/shared/src/review.ts`:

Adicione após `REVIEW_MAX_LENGTH`:

```ts
/** Máximo de menções (@) por resenha ou comentário. */
export const MAX_REVIEW_MENTIONS = 10

export interface MentionDTO {
  userId: string
  /** Nome exibido; aparece como "@<name>" no conteúdo. */
  name: string
}
```

Em `ReviewDTO`, adicione o campo (após `reactions`):

```ts
  mentions: MentionDTO[]
```

Em `ReviewCommentDTO`, adicione (após `reactions`):

```ts
  mentions: MentionDTO[]
```

Em `CreateReviewRequest` e `CreateReviewCommentRequest`, adicione o campo opcional:

```ts
  mentionedUserIds?: string[]
```

- [ ] **Step 2: Sincronizar o enum de notificação**

Em `packages/shared/src/notification.ts`, adicione ao final do array `NOTIFICATION_TYPES` (após `'REVIEW_SHARED',`):

```ts
  'REVIEW_MENTION',
```

- [ ] **Step 3: Typecheck do shared**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/review.ts packages/shared/src/notification.ts
git commit -m "feat(resenha): contrato de menções (MentionDTO, mentionedUserIds, REVIEW_MENTION)"
```

---

## Task 3: Service + serialize das menções

**Files:**
- Modify: `apps/api/src/services/review-service.ts`
- Modify: `apps/api/src/lib/serialize.ts`
- Modify: `apps/api/src/services/review-service.test.ts`

**Interfaces:**
- Consumes: `MAX_REVIEW_MENTIONS` (`@legends/shared`), `reviewInclude`/`reviewCommentInclude`, `createReview`/`createComment`.
- Produces:
  - `reviewInclude`/`reviewCommentInclude` agora incluem `mentions: true`.
  - `createReview(input: { authorId: string; content: string; mentionedUserIds?: string[] }): Promise<ReviewWithRelations>`
  - `createComment(input: { reviewId: string; authorId: string; content: string; mentionedUserIds?: string[] }): Promise<{ comment: ReviewCommentWithRelations; reviewAuthorId: string; replyRecipientIds: string[] }>`
  - serialize: `toReviewDTO`/`toReviewCommentDTO` retornam `mentions: { userId, name }[]`.

- [ ] **Step 1: Escrever os testes (falham)**

Adicione ao `apps/api/src/services/review-service.test.ts` (importe o que faltar das funções já existentes no topo do arquivo):

```ts
describe('review-service: menções', () => {
  it('grava menções (dedup, ativos não-admin, cap 10) e o DTO as inclui', async () => {
    const author = await makeUser('m-author@empresa.com')
    const a = await makeUser('m-a@empresa.com')
    const b = await makeUser('m-b@empresa.com')
    const inativo = await prisma.user.create({
      data: { name: 'Inativo', email: 'm-inativo@empresa.com', passwordHash: 'x', active: false },
    })
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: 'm-admin@empresa.com', passwordHash: 'x', role: 'ADMIN' },
    })

    const review = await createReview({
      authorId: author.id,
      content: `oi @${a.name} @${b.name}`,
      mentionedUserIds: [a.id, a.id, b.id, inativo.id, admin.id, 'inexistente'],
    })
    // dedup + filtro: só a e b
    expect(review.mentions.map((m) => m.userId).sort()).toEqual([a.id, b.id].sort())
    expect(review.mentions.find((m) => m.userId === a.id)?.name).toBe(a.name)
  })

  it('cap de 10 menções', async () => {
    const author = await makeUser('m-cap@empresa.com')
    const users = []
    for (let i = 0; i < 12; i++) users.push(await makeUser(`m-cap-${i}@empresa.com`))
    const review = await createReview({
      authorId: author.id,
      content: 'muitos',
      mentionedUserIds: users.map((u) => u.id),
    })
    expect(review.mentions).toHaveLength(10)
  })

  it('comentário também grava menções no DTO', async () => {
    const author = await makeUser('mc-author@empresa.com')
    const alvo = await makeUser('mc-alvo@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r' })
    const { comment } = await createComment({
      reviewId: review.id,
      authorId: author.id,
      content: `e aí @${alvo.name}`,
      mentionedUserIds: [alvo.id],
    })
    expect(comment.mentions.map((m) => m.userId)).toEqual([alvo.id])
  })
})
```

- [ ] **Step 2: Rodar para falhar**

Run: `pnpm --filter @legends/api test -- review-service`
Expected: FAIL — `review.mentions`/`comment.mentions` indefinidos / `mentionedUserIds` não aceito.

- [ ] **Step 3: Incluir `mentions` nos includes**

Em `apps/api/src/services/review-service.ts`, atualize os dois includes:

```ts
export const reviewInclude = {
  author: true,
  reactions: { include: { user: true }, orderBy: { createdAt: 'asc' } },
  mentions: true,
  _count: { select: { comments: true, shares: true } },
} as const
```

```ts
export const reviewCommentInclude = {
  author: true,
  reactions: { include: { user: true }, orderBy: { createdAt: 'asc' } },
  mentions: true,
} as const
```

- [ ] **Step 4: Adicionar o resolvedor de menções e usá-lo em create**

Em `apps/api/src/services/review-service.ts`, garanta o import (mescle na linha existente do `@legends/shared`):

```ts
import { REVIEW_MAX_LENGTH, REVIEW_REACTIONS, MAX_REVIEW_MENTIONS } from '@legends/shared'
```

Adicione o helper (perto de `assertContent`):

```ts
/** Resolve mentionedUserIds em {userId, name}: dedup, só ativos não-admin, cap MAX_REVIEW_MENTIONS. */
async function resolveMentions(userIds?: string[]): Promise<{ userId: string; name: string }[]> {
  if (!userIds?.length) return []
  const unique = [...new Set(userIds)].slice(0, MAX_REVIEW_MENTIONS)
  const users = await prisma.user.findMany({
    where: { id: { in: unique }, active: true, role: { not: 'ADMIN' } },
    select: { id: true, name: true },
  })
  return users.map((u) => ({ userId: u.id, name: u.name }))
}
```

Substitua `createReview` por:

```ts
export async function createReview(input: {
  authorId: string
  content: string
  mentionedUserIds?: string[]
}): Promise<ReviewWithRelations> {
  const content = assertContent(input.content)
  const author = await prisma.user.findUnique({ where: { id: input.authorId } })
  if (!author || !author.active) {
    throw new ReviewError('Autor inválido.', 400)
  }
  const mentions = await resolveMentions(input.mentionedUserIds)
  return prisma.review.create({
    data: {
      authorId: input.authorId,
      content,
      ...(mentions.length
        ? { mentions: { create: mentions.map((m) => ({ userId: m.userId, name: m.name })) } }
        : {}),
    },
    include: reviewInclude,
  })
}
```

Em `createComment`, adicione `mentionedUserIds?: string[]` à assinatura do `input`, resolva as menções e inclua no `create`. A função fica:

```ts
export async function createComment(input: {
  reviewId: string
  authorId: string
  content: string
  mentionedUserIds?: string[]
}): Promise<{ comment: ReviewCommentWithRelations; reviewAuthorId: string; replyRecipientIds: string[] }> {
  const content = assertContent(input.content)
  const review = await prisma.review.findUnique({ where: { id: input.reviewId }, select: { authorId: true } })
  if (!review) throw new ReviewError('Resenha não encontrada.', 404)
  const prior = await prisma.reviewComment.findMany({
    where: { reviewId: input.reviewId },
    select: { authorId: true },
    distinct: ['authorId'],
  })
  const mentions = await resolveMentions(input.mentionedUserIds)
  const comment = await prisma.reviewComment.create({
    data: {
      reviewId: input.reviewId,
      authorId: input.authorId,
      content,
      ...(mentions.length
        ? { mentions: { create: mentions.map((m) => ({ userId: m.userId, name: m.name })) } }
        : {}),
    },
    include: reviewCommentInclude,
  })
  const replyRecipientIds = [...new Set(prior.map((c) => c.authorId))].filter(
    (id) => id !== input.authorId && id !== review.authorId,
  )
  return { comment, reviewAuthorId: review.authorId, replyRecipientIds }
}
```

- [ ] **Step 5: Mapear `mentions` nos DTOs**

Em `apps/api/src/lib/serialize.ts`, adicione `type MentionDTO,` ao import de `@legends/shared` (se ajudar na clareza; não é obrigatório, mas mantém consistência). Em `toReviewDTO`, adicione antes do fechamento do objeto retornado:

```ts
    mentions: review.mentions.map((m) => ({ userId: m.userId, name: m.name })),
```

Em `toReviewCommentDTO`, adicione:

```ts
    mentions: comment.mentions.map((m) => ({ userId: m.userId, name: m.name })),
```

- [ ] **Step 6: Rodar para passar + typecheck**

Run: `pnpm --filter @legends/api test -- review-service && pnpm --filter @legends/api exec tsc --noEmit`
Expected: PASS; tsc limpo.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/review-service.ts apps/api/src/lib/serialize.ts apps/api/src/services/review-service.test.ts
git commit -m "feat(resenha): persistir e serializar menções em resenha/comentário"
```

---

## Task 4: Notificação de menção

**Files:**
- Modify: `apps/api/src/services/notification-service.ts`
- Modify: `apps/api/src/services/review-notifications.test.ts`

**Interfaces:**
- Consumes: `createNotification`, `actorName` (helper privado já existente).
- Produces: `notifyReviewMention(input: { recipientIds: string[]; actorId: string; reviewId: string }): Promise<void>`

- [ ] **Step 1: Escrever o teste (falha)**

Adicione ao `apps/api/src/services/review-notifications.test.ts`:

```ts
import { notifyReviewMention } from './notification-service'

describe('notificação de menção', () => {
  it('notifica os marcados (dedup, exceto o ator) com tipo e link corretos', async () => {
    const actor = await makeUser('men-actor@empresa.com')
    const p1 = await makeUser('men1@empresa.com')
    const p2 = await makeUser('men2@empresa.com')
    await notifyReviewMention({ recipientIds: [p1.id, p2.id, p1.id, actor.id], actorId: actor.id, reviewId: 'rev9' })
    expect(await prisma.notification.count({ where: { type: 'REVIEW_MENTION' } })).toBe(2)
    expect(await prisma.notification.count({ where: { userId: actor.id } })).toBe(0)
    const n = await prisma.notification.findFirst({ where: { userId: p1.id } })
    expect(n?.link).toBe('/resenha#rev9')
    expect(n?.title).toContain('marcou')
  })
})
```

- [ ] **Step 2: Rodar para falhar**

Run: `pnpm --filter @legends/api test -- review-notifications`
Expected: FAIL — `notifyReviewMention` não exportado.

- [ ] **Step 3: Implementar**

Em `apps/api/src/services/notification-service.ts`, adicione (após `notifyReviewShared`):

```ts
export async function notifyReviewMention(input: {
  recipientIds: string[]
  actorId: string
  reviewId: string
}): Promise<void> {
  const recipients = [...new Set(input.recipientIds)].filter((id) => id !== input.actorId)
  if (recipients.length === 0) return
  const name = await actorName(input.actorId)
  for (const userId of recipients) {
    await createNotification({
      userId,
      type: 'REVIEW_MENTION',
      actorId: input.actorId,
      title: `${name} te marcou numa resenha`,
      link: `/resenha#${input.reviewId}`,
      metadata: { reviewId: input.reviewId },
    })
  }
}
```

- [ ] **Step 4: Rodar para passar**

Run: `pnpm --filter @legends/api test -- review-notifications`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/notification-service.ts apps/api/src/services/review-notifications.test.ts
git commit -m "feat(resenha): notificação REVIEW_MENTION (dedup, sem self) + Teams"
```

---

## Task 5: Rotas — aceitar e notificar menções

**Files:**
- Modify: `apps/api/src/routes/review.ts`
- Modify: `apps/api/src/routes/review.test.ts`

**Interfaces:**
- Consumes: `createReview`/`createComment` com `mentionedUserIds`, `notifyReviewMention`, `MAX_REVIEW_MENTIONS`.
- Produces: `POST /reviews` e `POST /reviews/:id/comments` aceitam `mentionedUserIds` e notificam os marcados.

- [ ] **Step 1: Escrever o teste de rota (falha)**

Adicione ao `apps/api/src/routes/review.test.ts`:

```ts
describe('review mentions via rota', () => {
  it('cria resenha com menção, persiste e notifica o marcado', async () => {
    const { app, token, userId } = await setup()
    const alvo = await prisma.user.create({
      data: { name: 'Karina', email: 'karina@empresa.com', passwordHash: 'x' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: { content: 'boa @Karina', mentionedUserIds: [alvo.id] },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().review.mentions).toEqual([{ userId: alvo.id, name: 'Karina' }])
    const notif = await prisma.notification.findFirst({
      where: { userId: alvo.id, type: 'REVIEW_MENTION' },
    })
    expect(notif?.actorId).toBe(userId)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar para falhar**

Run: `pnpm --filter @legends/api test -- routes/review`
Expected: FAIL — `mentions` ausente / sem notificação.

- [ ] **Step 3: Atualizar schema e imports**

Em `apps/api/src/routes/review.ts`:

Adicione `MAX_REVIEW_MENTIONS` ao import de `@legends/shared`:

```ts
import { REVIEW_MAX_LENGTH, REVIEW_REACTIONS, MAX_REVIEW_MENTIONS } from '@legends/shared'
```

Adicione `notifyReviewMention` ao import de `../services/notification-service`.

Troque o `contentSchema` por (passa a aceitar menções, usado por resenha e comentário):

```ts
const contentSchema = z.object({
  content: z.string().trim().min(1).max(REVIEW_MAX_LENGTH),
  mentionedUserIds: z.array(z.string()).max(MAX_REVIEW_MENTIONS).optional(),
})
```

- [ ] **Step 4: Passar menções e notificar no POST /reviews**

No handler `app.post('/reviews', ...)`, troque a criação por (passando `mentionedUserIds` e notificando os marcados best-effort):

```ts
    try {
      const review = await createReview({
        authorId: request.user.sub,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
      })
      try {
        await notifyReviewMention({
          recipientIds: review.mentions.map((m) => m.userId),
          actorId: request.user.sub,
          reviewId: review.id,
        })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      return reply.code(201).send({ review: toReviewDTO(review, request.user.sub, false) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
```

- [ ] **Step 5: Passar menções e notificar no POST /reviews/:id/comments**

No handler `app.post('/reviews/:id/comments', ...)`, passe `mentionedUserIds` ao `createComment` e adicione a notificação de menção junto às existentes. O bloco de criação + notificações fica:

```ts
      const { comment, reviewAuthorId, replyRecipientIds } = await createComment({
        reviewId: id,
        authorId: request.user.sub,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
      })
      try {
        await notifyReviewComment({ reviewAuthorId, actorId: request.user.sub, reviewId: id })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      try {
        await notifyReviewCommentReply({ recipientIds: replyRecipientIds, actorId: request.user.sub, reviewId: id })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      try {
        await notifyReviewMention({
          recipientIds: comment.mentions.map((m) => m.userId),
          actorId: request.user.sub,
          reviewId: id,
        })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      return reply.code(201).send({ comment: toReviewCommentDTO(comment, request.user.sub) })
```

(Mantém o `try { ... } catch (err) { if (err instanceof ReviewError) ... }` externo existente ao redor.)

- [ ] **Step 6: Rodar para passar + typecheck**

Run: `pnpm --filter @legends/api test -- routes/review && pnpm --filter @legends/api exec tsc --noEmit`
Expected: PASS; tsc limpo.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/review.ts apps/api/src/routes/review.test.ts
git commit -m "feat(resenha): rotas aceitam mentionedUserIds e notificam os marcados"
```

---

## Task 6: Web — hook de colegas + helper de renderização

**Files:**
- Create: `apps/web/src/lib/use-colleagues.ts`
- Create: `apps/web/src/lib/mentions.tsx`
- Create: `apps/web/src/lib/mentions.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`./api`), `PublicUser`/`MentionDTO` (`@legends/shared`).
- Produces:
  - `useColleagues(): { data?: PublicUser[]; ... }` — colegas ativos não-admin.
  - `escapeRegExp(s: string): string`
  - `renderWithMentions(content: string, mentions: MentionDTO[]): ReactNode[]`

- [ ] **Step 1: Escrever os testes do helper (falham)**

Create `apps/web/src/lib/mentions.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderWithMentions } from './mentions'

function renderNodes(nodes: React.ReactNode) {
  return render(<MemoryRouter>{nodes}</MemoryRouter>)
}

describe('renderWithMentions', () => {
  it('linka o nome mencionado para o perfil e mantém o resto do texto', () => {
    const { getByText, container } = renderNodes(
      renderWithMentions('boa @Karina Akina, mandou bem', [{ userId: 'u1', name: 'Karina Akina' }]),
    )
    const link = getByText('@Karina Akina').closest('a')
    expect(link).toHaveAttribute('href', '/perfil/u1')
    expect(container.textContent).toBe('boa @Karina Akina, mandou bem')
  })

  it('não linka @nome que não está na lista de menções', () => {
    const { queryByRole, container } = renderNodes(
      renderWithMentions('oi @Fulano', []),
    )
    expect(queryByRole('link')).toBeNull()
    expect(container.textContent).toBe('oi @Fulano')
  })
})
```

- [ ] **Step 2: Rodar para falhar**

Run: `pnpm --filter @legends/web test -- mentions`
Expected: FAIL — módulo `./mentions` não existe.

- [ ] **Step 3: Implementar o helper de renderização**

Create `apps/web/src/lib/mentions.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { MentionDTO } from '@legends/shared'

/** Escapa metacaracteres de regex. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Quebra o conteúdo e transforma as ocorrências de "@<name>" (apenas dos usuários
 * em `mentions`) em links para o perfil. O restante do texto fica intacto.
 */
export function renderWithMentions(content: string, mentions: MentionDTO[]): ReactNode[] {
  if (mentions.length === 0) return [content]
  const byToken = new Map<string, string>()
  for (const m of mentions) byToken.set(`@${m.name}`, m.userId)
  // Tokens ordenados por comprimento desc para casar o nome mais longo primeiro.
  const tokens = [...byToken.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp)
  const re = new RegExp(`(${tokens.join('|')})`, 'g')
  return content.split(re).map((part, i) => {
    const userId = byToken.get(part)
    if (userId) {
      return (
        <Link key={i} to={`/perfil/${userId}`} className="font-label text-primary hover:underline">
          {part}
        </Link>
      )
    }
    return <span key={i}>{part}</span>
  })
}
```

- [ ] **Step 4: Implementar o hook de colegas**

Create `apps/web/src/lib/use-colleagues.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import type { PublicUser } from '@legends/shared'
import { apiFetch } from './api'

/** Colegas mencionáveis: ativos e não-admin (admins não têm perfil navegável). */
export function useColleagues() {
  return useQuery({
    queryKey: ['colleagues'],
    queryFn: async () => {
      const { users } = await apiFetch<{ users: PublicUser[] }>('/users')
      return users.filter((u) => u.active && u.role !== 'ADMIN')
    },
    staleTime: 5 * 60_000,
  })
}
```

- [ ] **Step 5: Rodar para passar + typecheck**

Run: `pnpm --filter @legends/web test -- mentions && pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS; tsc limpo.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/use-colleagues.ts apps/web/src/lib/mentions.tsx apps/web/src/lib/mentions.test.tsx
git commit -m "feat(resenha): hook de colegas + renderWithMentions (links de menção)"
```

---

## Task 7: Web — MentionTextarea (autocomplete de @)

**Files:**
- Create: `apps/web/src/components/MentionTextarea.tsx`
- Create: `apps/web/src/components/MentionTextarea.test.tsx`

**Interfaces:**
- Consumes: `PublicUser` (`@legends/shared`), `Avatar`.
- Produces: componente `MentionTextarea` com props
  `{ value: string; onChange: (v: string) => void; onMentionsChange: (ids: string[]) => void; colleagues: PublicUser[]; placeholder?: string; ariaLabel: string; className?: string; rows?: number }`.
  Insere `@Nome ` ao selecionar e reporta via `onMentionsChange` os ids cujo `@Nome` ainda está no texto.

- [ ] **Step 1: Escrever o teste (falha)**

Create `apps/web/src/components/MentionTextarea.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import type { PublicUser } from '@legends/shared'
import { MentionTextarea } from './MentionTextarea'

const colleagues: PublicUser[] = [
  { id: 'u1', name: 'Karina Akina', email: '', role: 'LEGEND', area: null, position: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'u2', name: 'Bruno Lima', email: '', role: 'LEGEND', area: null, position: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
]

function Harness() {
  const [value, setValue] = useState('')
  const [ids, setIds] = useState<string[]>([])
  return (
    <div>
      <MentionTextarea
        value={value}
        onChange={setValue}
        onMentionsChange={setIds}
        colleagues={colleagues}
        ariaLabel="Sua resenha"
      />
      <output data-testid="ids">{ids.join(',')}</output>
    </div>
  )
}

describe('MentionTextarea', () => {
  it('mostra o dropdown ao digitar @, insere @Nome e registra o id', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'boa @kar' } })
    const option = screen.getByText('Karina Akina')
    fireEvent.mouseDown(option)
    expect(textarea.value).toBe('boa @Karina Akina ')
    expect(screen.getByTestId('ids').textContent).toBe('u1')
  })

  it('remove o id quando o @Nome sai do texto', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'boa @kar' } })
    fireEvent.mouseDown(screen.getByText('Karina Akina'))
    expect(screen.getByTestId('ids').textContent).toBe('u1')
    fireEvent.change(textarea, { target: { value: 'boa ' } })
    expect(screen.getByTestId('ids').textContent).toBe('')
  })
})
```

- [ ] **Step 2: Rodar para falhar**

Run: `pnpm --filter @legends/web test -- MentionTextarea`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar o componente**

Create `apps/web/src/components/MentionTextarea.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { PublicUser } from '@legends/shared'
import { Avatar } from './Avatar'

const MAX_OPTIONS = 6

/** Detecta um "@query" ativo imediatamente antes do cursor (sem espaço no meio). */
function activeMention(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret)
  const match = /(?:^|\s)@([^\s@]*)$/.exec(upto)
  if (!match) return null
  const query = match[1]
  return { query, start: caret - query.length - 1 }
}

export function MentionTextarea({
  value,
  onChange,
  onMentionsChange,
  colleagues,
  placeholder,
  ariaLabel,
  className,
  rows = 2,
}: {
  value: string
  onChange: (v: string) => void
  onMentionsChange: (ids: string[]) => void
  colleagues: PublicUser[]
  placeholder?: string
  ariaLabel: string
  className?: string
  rows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // nome escolhido -> userId; usado para recomputar quais menções seguem no texto.
  const pickedRef = useRef<Map<string, string>>(new Map())
  const [query, setQuery] = useState<{ q: string; start: number } | null>(null)
  const [caretToSet, setCaretToSet] = useState<number | null>(null)

  // Reposiciona o cursor após inserir uma menção.
  useEffect(() => {
    if (caretToSet != null && ref.current) {
      ref.current.focus()
      ref.current.setSelectionRange(caretToSet, caretToSet)
      setCaretToSet(null)
    }
  }, [caretToSet])

  /** Reporta os ids cujo "@nome" ainda aparece no texto. */
  function reportMentions(text: string) {
    const ids: string[] = []
    for (const [name, id] of pickedRef.current) {
      if (text.includes(`@${name}`)) ids.push(id)
    }
    onMentionsChange([...new Set(ids)])
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value
    onChange(text)
    const caret = e.target.selectionStart ?? text.length
    const active = activeMention(text, caret)
    setQuery(active ? { q: active.query, start: active.start } : null)
    reportMentions(text)
  }

  function select(user: PublicUser) {
    const el = ref.current
    if (!el || !query) return
    const caret = el.selectionStart ?? value.length
    const before = value.slice(0, query.start)
    const after = value.slice(caret)
    const insert = `@${user.name} `
    const next = before + insert + after
    pickedRef.current.set(user.name, user.id)
    onChange(next)
    setQuery(null)
    setCaretToSet((before + insert).length)
    reportMentions(next)
  }

  const options =
    query == null
      ? []
      : colleagues
          .filter((c) => c.name.toLowerCase().includes(query.q.toLowerCase()))
          .slice(0, MAX_OPTIONS)

  return (
    <div className="relative">
      <textarea
        ref={ref}
        className={className}
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={rows}
      />
      {options.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-72 overflow-auto rounded-lg border border-outline-variant/40 bg-surface-container shadow-lg">
          {options.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                // mouseDown (não click) para disparar antes do blur do textarea.
                onMouseDown={(e) => {
                  e.preventDefault()
                  select(c)
                }}
                className="flex w-full items-center gap-sm px-sm py-2 text-left hover:bg-surface-container-high"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60">
                  <Avatar user={c} />
                </span>
                <span className="truncate font-label text-label-sm text-on-surface">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar para passar + typecheck**

Run: `pnpm --filter @legends/web test -- MentionTextarea && pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS (2 testes); tsc limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/MentionTextarea.tsx apps/web/src/components/MentionTextarea.test.tsx
git commit -m "feat(resenha): MentionTextarea com autocomplete de @"
```

---

## Task 8: Web — integrar menções no composer, comentário e exibição

**Files:**
- Modify: `apps/web/src/pages/resenha/ReviewComposer.tsx`
- Modify: `apps/web/src/pages/resenha/ReviewComments.tsx`
- Modify: `apps/web/src/pages/resenha/ReviewCard.tsx`
- Modify: `apps/web/src/pages/resenha/ResenhaPage.tsx`
- Modify: `apps/web/src/pages/resenha/ResenhaPage.test.tsx`

**Interfaces:**
- Consumes: `MentionTextarea`, `useColleagues`, `renderWithMentions`; `useCreateReview`/`useCreateComment` (já aceitam `CreateReviewRequest`/`CreateReviewCommentRequest`, agora com `mentionedUserIds?`).
- Produces: composers que enviam `mentionedUserIds`; card e comentários que renderizam menções como links.

- [ ] **Step 1: Atualizar o teste da página (falha)**

Em `apps/web/src/pages/resenha/ResenhaPage.test.tsx`, adicione `mentions: []` ao `sampleReview` (o DTO agora tem o campo) e um teste de renderização de menção. Atualize o objeto `sampleReview` para incluir `mentions: []` e adicione:

```tsx
  it('renderiza menção como link para o perfil', async () => {
    // sobrescreve o mock para devolver uma resenha com menção
    const { apiFetch } = await import('../../lib/api')
    ;(apiFetch as unknown as { mockImplementation: (fn: (p: string) => unknown) => void }).mockImplementation(
      (path: string) => {
        if (path === '/users') return Promise.resolve({ users: [] })
        if (path.startsWith('/reviews?'))
          return Promise.resolve({
            items: [{ ...sampleReview, content: 'boa @Bea', mentions: [{ userId: 'u2', name: 'Bea' }] }],
            nextCursor: null,
          })
        return Promise.resolve({})
      },
    )
    renderPage()
    const link = (await screen.findByText('@Bea')).closest('a')
    expect(link).toHaveAttribute('href', '/perfil/u2')
  })
```

(Garanta que o mock de `apiFetch` em `vi.mock('../../lib/api', ...)` use `vi.fn()` para permitir `mockImplementation`, e que `/users` seja tratado — devolva `{ users: [] }`.)

- [ ] **Step 2: Rodar para falhar**

Run: `pnpm --filter @legends/web test -- ResenhaPage`
Expected: FAIL — menção não vira link (ainda renderiza texto puro).

- [ ] **Step 3: Composer da resenha com menções**

Substitua `apps/web/src/pages/resenha/ReviewComposer.tsx` por:

```tsx
import { useState, type FormEvent } from 'react'
import { REVIEW_MAX_LENGTH } from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { MentionTextarea } from '../../components/MentionTextarea'
import { useAuth } from '../../auth/AuthContext'
import { useColleagues } from '../../lib/use-colleagues'

export function ReviewComposer({
  onSubmit,
  pending,
}: {
  onSubmit: (content: string, mentionedUserIds: string[]) => void
  pending: boolean
}) {
  const { user } = useAuth()
  const colleagues = useColleagues().data ?? []
  const [content, setContent] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const trimmed = content.trim()
  const tooLong = content.length > REVIEW_MAX_LENGTH
  const canSubmit = trimmed.length >= 1 && !tooLong && !pending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit(trimmed, mentionIds)
    setContent('')
    setMentionIds([])
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-md">
      {user && (
        <div className="hidden h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest sm:flex">
          <Avatar user={user} />
        </div>
      )}
      <div className="flex flex-1 flex-col">
        <MentionTextarea
          value={content}
          onChange={setContent}
          onMentionsChange={setMentionIds}
          colleagues={colleagues}
          placeholder="Manda a resenha pro time…"
          ariaLabel="Sua resenha"
          className="min-h-[56px] w-full resize-none bg-transparent py-1 text-body-lg text-on-surface outline-none placeholder:text-on-surface-variant"
        />
        <div className="flex items-center justify-between gap-sm border-t border-outline-variant/30 pt-sm">
          <span className={`font-label text-label-sm ${tooLong ? 'text-error' : 'text-on-surface-variant'}`}>
            {content.length}/{REVIEW_MAX_LENGTH}
          </span>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-full bg-primary px-xl py-2 font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container disabled:opacity-40"
          >
            Publicar
          </button>
        </div>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Ligar o composer ao envio com menções na página**

Em `apps/web/src/pages/resenha/ResenhaPage.tsx`, troque a linha do `ReviewComposer`:

```tsx
        <ReviewComposer
          onSubmit={(content, mentionedUserIds) => create.mutate({ content, mentionedUserIds })}
          pending={create.isPending}
        />
```

(`create` é o `useCreateReview()`; `CreateReviewRequest` já tem `mentionedUserIds?`.)

- [ ] **Step 5: Renderizar menções no card**

Em `apps/web/src/pages/resenha/ReviewCard.tsx`:

Adicione o import:

```tsx
import { renderWithMentions } from '../../lib/mentions'
```

Troque o parágrafo do conteúdo:

```tsx
        <p className="mt-0.5 whitespace-pre-wrap break-words text-body-md text-on-surface">
          {renderWithMentions(review.content, review.mentions)}
        </p>
```

- [ ] **Step 6: Menções no composer e exibição dos comentários**

Em `apps/web/src/pages/resenha/ReviewComments.tsx`:

Adicione imports:

```tsx
import { MentionTextarea } from '../../components/MentionTextarea'
import { renderWithMentions } from '../../lib/mentions'
import { useColleagues } from '../../lib/use-colleagues'
```

Adicione estado de menções e colegas no componente (junto ao `const [text, setText] = useState('')`):

```tsx
  const colleagues = useColleagues().data ?? []
  const [mentionIds, setMentionIds] = useState<string[]>([])
```

Troque o `submit` para enviar e limpar menções:

```tsx
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    create.mutate(
      { content: trimmed, mentionedUserIds: mentionIds },
      { onSuccess: () => { setText(''); setMentionIds([]) } },
    )
  }
```

Troque a exibição do conteúdo do comentário:

```tsx
                <p className="mt-0.5 whitespace-pre-wrap break-words text-body-sm text-on-surface">
                  {renderWithMentions(c.content, c.mentions)}
                </p>
```

Troque o `<input>` do composer por um `MentionTextarea` (mantendo o `aria-label`):

```tsx
        <MentionTextarea
          value={text}
          onChange={setText}
          onMentionsChange={setMentionIds}
          colleagues={colleagues}
          placeholder="Comentar…"
          ariaLabel="Seu comentário"
          rows={1}
          className="min-w-0 flex-1 resize-none rounded-2xl border border-outline-variant/60 bg-surface-container-highest px-md py-2 text-body-sm text-on-surface outline-none focus:border-primary"
        />
```

(O `MentionTextarea` é envolto por uma `div.relative`; mantenha o `<form>` com `items-start` e o botão "Enviar" ao lado — ajuste o container do form para `flex items-start gap-sm` se necessário para alinhar.)

- [ ] **Step 7: Rodar testes da página + suíte web + typecheck**

Run: `pnpm --filter @legends/web test -- ResenhaPage mentions MentionTextarea && pnpm --filter @legends/web test && pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS em tudo; tsc limpo. (Se algum teste existente quebrar por causa do novo campo `mentions` no DTO mockado, adicione `mentions: []` aos mocks.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/resenha/
git commit -m "feat(resenha): @menções no composer/comentário + render como link"
```

---

## Task 9: Card de notificação do Teams (seguir o modelo do nudge)

**Files:**
- Modify: `apps/api/src/lib/teams-client.ts`
- Modify: `apps/api/src/services/notification-service.ts`
- Create: `apps/api/src/lib/teams-client.test.ts` (se não existir; senão, adicionar)
- Modify: `apps/api/src/services/notification-service.test.ts`

**Interfaces:**
- Consumes: `TeamsNotification`, `buildNotificationCard`, `createNotification`.
- Produces:
  - `TeamsNotification` ganha `emoji?: string` e `body?: string`.
  - `buildNotificationCard` segue o modelo: header `accent` com `${emoji} ${title}` em negrito + corpo opcional + botão.
  - `createNotification` deriva um emoji do `type` e o passa ao espelho do Teams.

- [ ] **Step 1: Escrever os testes do card (falham)**

Create (ou adicione a) `apps/api/src/lib/teams-client.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildNotificationCard } from './teams-client'

function findTextBlocks(card: unknown): { text: string; weight?: string }[] {
  // navega no Adaptive Card e coleta os TextBlocks (incl. dentro de Containers)
  const content = (card as any).attachments[0].content
  const blocks: { text: string; weight?: string }[] = []
  const walk = (items: any[]) => {
    for (const it of items) {
      if (it.type === 'TextBlock') blocks.push({ text: it.text, weight: it.weight })
      if (it.type === 'Container') walk(it.items)
    }
  }
  walk(content.body)
  return blocks
}

describe('buildNotificationCard', () => {
  it('põe emoji + título como manchete em negrito e mantém o botão', () => {
    const card = buildNotificationCard({
      title: 'Bea te marcou numa resenha',
      ctaUrl: 'https://x/y',
      ctaLabel: 'Abrir no Legends',
      emoji: '@',
    })
    const blocks = findTextBlocks(card)
    const header = blocks.find((b) => b.weight === 'Bolder')
    expect(header?.text).toBe('@ Bea te marcou numa resenha')
    const actions = (card as any).attachments[0].content.actions
    expect(actions[0]).toMatchObject({ title: 'Abrir no Legends', url: 'https://x/y' })
  })

  it('renderiza o corpo quando presente e o omite quando ausente', () => {
    const withBody = buildNotificationCard({ title: 'T', ctaUrl: 'u', ctaLabel: 'c', body: 'detalhe' })
    expect(findTextBlocks(withBody).some((b) => b.text === 'detalhe')).toBe(true)
    const noBody = buildNotificationCard({ title: 'T', ctaUrl: 'u', ctaLabel: 'c' })
    // só a manchete (1 TextBlock), sem corpo
    expect(findTextBlocks(noBody)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Rodar para falhar**

Run: `pnpm --filter @legends/api test -- teams-client`
Expected: FAIL — `emoji`/`body` não suportados; header não inclui o título.

- [ ] **Step 3: Redesenhar `buildNotificationCard`**

Em `apps/api/src/lib/teams-client.ts`, troque a interface e a função:

```ts
export interface TeamsNotification {
  title: string
  /** URL absoluta que o botão de CTA abre. */
  ctaUrl: string
  ctaLabel: string
  /** Emoji da manchete (default 🔔). */
  emoji?: string
  /** Corpo opcional (parágrafo abaixo da manchete). */
  body?: string
}

/**
 * Adaptive Card de notificação no modelo do nudge: header destacado com
 * emoji + manchete em negrito, corpo opcional, e botão de CTA.
 */
export function buildNotificationCard(n: TeamsNotification): unknown {
  const headline = escapeAdaptiveText(`${n.emoji ?? '🔔'} ${n.title}`)
  const body: unknown[] = [
    {
      type: 'Container',
      style: 'accent',
      bleed: true,
      items: [{ type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: headline, wrap: true }],
    },
  ]
  if (n.body) {
    body.push({ type: 'TextBlock', text: escapeAdaptiveText(n.body), wrap: true })
  }
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          actions: [{ type: 'Action.OpenUrl', title: n.ctaLabel, url: n.ctaUrl }],
        },
      },
    ],
  }
}
```

- [ ] **Step 4: Escrever o teste do mapeamento tipo→emoji (falha)**

Adicione ao `apps/api/src/services/notification-service.test.ts`:

```ts
import { emojiForNotificationType } from './notification-service'

describe('emojiForNotificationType', () => {
  it('mapeia tipos conhecidos e cai no sino por padrão', () => {
    expect(emojiForNotificationType('REVIEW_MENTION')).toBe('@')
    expect(emojiForNotificationType('REVIEW_COMMENT')).toBe('💬')
    expect(emojiForNotificationType('REVIEW_REACTION')).toBe('❤️')
    expect(emojiForNotificationType('BADGE_EARNED')).toBe('🏅')
    expect(emojiForNotificationType('PERIOD_OPENED')).toBe('📣')
    expect(emojiForNotificationType('FEEDBACK_RECEIVED')).toBe('📝')
    // tipo fora do mapa cai no sino:
    expect(emojiForNotificationType('UNKNOWN_TYPE' as never)).toBe('🔔')
  })
})
```

- [ ] **Step 5: Implementar o mapa e passar o emoji ao Teams**

Em `apps/api/src/services/notification-service.ts`:

Adicione o helper exportado (perto do topo, após os imports):

```ts
/** Emoji da manchete do card do Teams por tipo de notificação. */
export function emojiForNotificationType(type: Prisma.NotificationCreateInput['type']): string {
  const map: Partial<Record<string, string>> = {
    REVIEW_COMMENT: '💬',
    REVIEW_COMMENT_REPLY: '💬',
    REVIEW_REACTION: '❤️',
    REVIEW_SHARED: '📣',
    REVIEW_MENTION: '@',
    FEEDBACK_RECEIVED: '📝',
    FEEDBACK_REACTION: '❤️',
    BADGE_EARNED: '🏅',
    HIGHLIGHT_PUBLISHED: '🏆',
    PERIOD_OPENED: '📣',
    PERIOD_CLOSED: '📣',
    RETRO_INVITED: '🗓️',
    STREAK_AT_RISK: '🔥',
    VOTE_REMINDER_MIDWAY: '🗳️',
    VOTE_REMINDER_CLOSING: '🗳️',
  }
  return map[type as string] ?? '🔔'
}
```

(O teste do Step 4 já espera `📝` para `FEEDBACK_RECEIVED` e `🔔` para um tipo fora do mapa — coerente com este mapa.)

Em `mirrorToTeams`, passe o emoji do tipo. A função `mirrorToTeams` hoje recebe `(userId, title, link)`; adicione um parâmetro `type` e use o emoji. Atualize a assinatura e a chamada dentro de `createNotification`:

```ts
async function mirrorToTeams(
  userId: string,
  title: string,
  link: string | null,
  type: Prisma.NotificationCreateInput['type'],
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { teamsWebhookUrl: true } })
    if (!user?.teamsWebhookUrl) return
    await postTeamsNotification(user.teamsWebhookUrl, {
      title,
      ctaUrl: absoluteUrl(link),
      ctaLabel: 'Abrir no Legends',
      emoji: emojiForNotificationType(type),
    })
  } catch (err) {
    console.error(`[notification-service] falha ao espelhar no Teams (user ${userId})`, err)
  }
}
```

E em `createNotification`, troque a chamada `await mirrorToTeams(input.userId, input.title, input.link ?? null)` por:

```ts
    await mirrorToTeams(input.userId, input.title, input.link ?? null, input.type)
```

- [ ] **Step 6: Rodar para passar + typecheck**

Run: `pnpm --filter @legends/api test -- teams-client notification-service && pnpm --filter @legends/api exec tsc --noEmit`
Expected: PASS; tsc limpo.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/teams-client.ts apps/api/src/lib/teams-client.test.ts apps/api/src/services/notification-service.ts apps/api/src/services/notification-service.test.ts
git commit -m "feat(notifications): card do Teams no modelo do nudge (emoji + manchete + corpo)"
```

---

## Task 10: Verificação final

**Files:** nenhum (verificação).

- [ ] **Step 1: Suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: PASS em todos os workspaces.

- [ ] **Step 2: Typecheck dos 3 workspaces**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build de todos os workspaces sem erro.

- [ ] **Step 4: Verificação manual (recomendada)**

`pnpm dev` → em `/resenha`: digitar `@`, selecionar um colega (insere `@Nome`), publicar; ver a menção como link; conferir notificação do marcado e o card no Teams (se webhook configurado) no novo layout.

---

## Self-Review (autor do plano)

**Spec coverage:**
- Menção em resenha e comentário → T3 (service) + T5 (rotas) + T8 (UI composer).
- Autocomplete de colegas ativos não-admin → T6 (useColleagues) + T7 (MentionTextarea).
- Persistência + snapshot do nome + cap 10 + dedup + leniência → T1 (schema) + T3 (resolveMentions).
- Notificação REVIEW_MENTION (dedup, sem self, Teams) → T2 (enum) + T4 (notify) + T5 (wire).
- Render como link → T6 (renderWithMentions) + T8 (card/comentário).
- Card do Teams no modelo do nudge → T9.

**Placeholder scan:** sem TBD; todo passo tem código/comando. (T9 Step 5 contém uma escolha explícita de fonte de verdade entre teste e mapa — resolvida na própria nota: usar `📝` para FEEDBACK_RECEIVED e ajustar o teste.)

**Type consistency:** `MentionDTO { userId, name }` usado em shared, serialize, renderWithMentions; `mentionedUserIds?: string[]` em requests, service e rotas; `createReview`/`createComment` com a mesma assinatura nos consumidores; `TeamsNotification.emoji?/body?` consistentes entre `buildNotificationCard` e `mirrorToTeams`.
