# Notificações internas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao usuário uma central de notificações in-app (sino com contador + página `/notificacoes`) que avisa sobre feedback recebido, reações, selos ganhos, Destaque do Mês publicado e abertura/fechamento de período.

**Architecture:** Tabela `Notification` própria; criação inline best-effort nos sites de evento (espelhando a avaliação de selos pós-voto); leitura por polling (React Query `refetchInterval`). Texto pt-BR renderizado no write (denormalizado). Sem real-time, sem e-mail.

**Tech Stack:** Backend Fastify 4 + Prisma 5 + PostgreSQL + Zod; contrato em `@legends/shared`; frontend Vite + React 18 + React Query + Tailwind; testes Vitest (API contra Postgres real, web jsdom + Testing Library).

## Global Constraints

- TypeScript **strict**, ESM puro (`"type": "module"`); Node ≥ 20; pnpm 9.7.
- Camadas finas e separadas: **route → service → Prisma**. Sem regra de negócio na route.
- Contrato api⇄web vive em `@legends/shared`; **mudar o tipo lá primeiro**, ajustar os dois lados.
- Mensagens voltadas ao usuário em **português** (pt-BR).
- **Best-effort:** criar notificação nunca pode derrubar a ação que a originou — sempre `try/catch` com `request.log.error(err)` no catch (padrão de `votes.ts:27-33`).
- **Nunca editar migration já aplicada** — gerar nova com `pnpm db:migrate`.
- Testes da API exigem Postgres de pé (`pnpm db:up`); `pnpm test` verde antes de concluir.
- **Anonimato do voto:** nenhum evento de voto gera notificação.
- **Destaque só na publicação** (`publishHighlight`), nunca em `electWinner`.
- **Selo `destaque-do-mes` suprimido** do fluxo de notificação de selo.
- **Retenção 90 dias** (`NOTIFICATION_RETENTION_DAYS = 90`), expurgo lazy no write.
- **Sem auto-notificação:** nunca notificar o próprio ator.

## File Structure

**Criar:**
- `packages/shared/src/notification.ts` — DTOs, enum `NOTIFICATION_TYPES`, responses.
- `apps/api/src/services/notification-service.ts` — write path (criadores tipados, prune) + read path (list/count/markAll).
- `apps/api/src/services/notification-service.test.ts` — testes de serviço.
- `apps/api/src/routes/notifications.ts` — 3 rotas.
- `apps/api/src/routes/notifications.test.ts` — testes de rota.
- `apps/web/src/lib/use-notifications.ts` — hooks React Query (count/list/markAll).
- `apps/web/src/components/NotificationBell.tsx` — sino + dropdown.
- `apps/web/src/components/NotificationBell.test.tsx` — testes do sino.
- `apps/web/src/pages/NotificationsPage.tsx` — página `/notificacoes`.
- `apps/web/src/pages/NotificationsPage.test.tsx` — testes da página.

**Modificar:**
- `apps/api/prisma/schema.prisma` — enum + model `Notification` + relations no `User`.
- `packages/shared/src/index.ts` — exportar `./notification`.
- `apps/api/src/lib/serialize.ts` — `toNotificationDTO`.
- `apps/api/src/app.ts` — registrar `notificationRoutes`.
- `apps/api/src/routes/feedback.ts` — disparar notificação (feedback recebido + reação) e capturar selos concedidos.
- `apps/api/src/routes/votes.ts` — notificar selos concedidos no voto.
- `apps/api/src/routes/admin.ts` — notificar selo manual, publicação do destaque, abertura/fechamento de período.
- `apps/web/src/components/AppLayout.tsx` — montar `NotificationBell` no header.
- `apps/web/src/App.tsx` — rota `/notificacoes`.
- `apps/web/src/components/nav-items.ts` — item de navegação "Notificações".

---

## Task 1: Contrato compartilhado (`@legends/shared`)

**Files:**
- Create: `packages/shared/src/notification.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `NOTIFICATION_TYPES`, `NotificationType`, `NotificationActor`, `NotificationDTO`, `NotificationListResponse`, `UnreadCountResponse`.

- [ ] **Step 1: Criar o arquivo de contrato**

Create `packages/shared/src/notification.ts`:

```ts
export const NOTIFICATION_TYPES = [
  'FEEDBACK_RECEIVED',
  'FEEDBACK_REACTION',
  'BADGE_EARNED',
  'HIGHLIGHT_PUBLISHED',
  'PERIOD_OPENED',
  'PERIOD_CLOSED',
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export interface NotificationActor {
  id: string
  name: string
  photoUrl: string | null
}

export interface NotificationDTO {
  id: string
  type: NotificationType
  title: string
  link: string | null
  read: boolean
  createdAt: string
  actor: NotificationActor | null
}

export interface NotificationListResponse {
  items: NotificationDTO[]
  unreadCount: number
  nextCursor: string | null
}

export interface UnreadCountResponse {
  unreadCount: number
}
```

- [ ] **Step 2: Exportar no barril**

Modify `packages/shared/src/index.ts` — adicionar a linha (ao final da lista de exports):

```ts
export * from './notification'
```

- [ ] **Step 3: Build do shared para validar tipos**

Run: `pnpm --filter @legends/shared build`
Expected: build sem erros de TypeScript.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/notification.ts packages/shared/src/index.ts
git commit -m "feat(shared): contrato de notificações internas"
```

---

## Task 2: Model Prisma + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**
- Produces: model `Notification` (campos `id`, `userId`, `type`, `actorId`, `title`, `link`, `metadata`, `readAt`, `createdAt`); enum `NotificationType`; relations `User.notifications` e `User.notificationsTriggered`.

- [ ] **Step 1: Adicionar o enum**

Modify `apps/api/prisma/schema.prisma` — adicionar após o enum `FeedbackCategory` (perto da linha 170):

```prisma
enum NotificationType {
  FEEDBACK_RECEIVED
  FEEDBACK_REACTION
  BADGE_EARNED
  HIGHLIGHT_PUBLISHED
  PERIOD_OPENED
  PERIOD_CLOSED
}
```

- [ ] **Step 2: Adicionar o model**

Modify `apps/api/prisma/schema.prisma` — adicionar ao final do arquivo:

```prisma
model Notification {
  id        String           @id @default(cuid())
  userId    String
  type      NotificationType
  actorId   String?
  title     String
  link      String?
  metadata  Json?
  readAt    DateTime?
  createdAt DateTime         @default(now())

  user  User  @relation("UserNotifications", fields: [userId], references: [id], onDelete: Cascade)
  actor User? @relation("NotificationActor", fields: [actorId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@index([userId, readAt])
}
```

- [ ] **Step 3: Adicionar as relations no model User**

Modify `apps/api/prisma/schema.prisma` — no model `User`, após a linha `feedbackReactions FeedbackReaction[]` (linha 65):

```prisma
  notifications          Notification[] @relation("UserNotifications")
  notificationsTriggered Notification[] @relation("NotificationActor")
```

- [ ] **Step 4: Subir o Postgres e gerar a migration**

Run:
```bash
pnpm db:up
pnpm db:migrate
```
Quando pedir o nome da migration, usar: `add_notification`
Expected: migration criada em `apps/api/prisma/migrations/<timestamp>_add_notification/` e Prisma Client regenerado.

- [ ] **Step 5: Verificar que o client compila com o novo model**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (o tipo `Prisma.Notification` passa a existir).

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): model Notification + migration"
```

---

## Task 3: Serviço — write path + serialização

**Files:**
- Create: `apps/api/src/services/notification-service.ts`
- Modify: `apps/api/src/lib/serialize.ts`
- Test: `apps/api/src/services/notification-service.test.ts`

**Interfaces:**
- Consumes: `prisma` de `../lib/prisma`; tipos de `@legends/shared`.
- Produces:
  - `createNotification(input: CreateNotificationInput): Promise<void>`
  - `notifyFeedbackReceived(feedback: { id: string; targetId: string; authorId: string; author: { name: string } }): Promise<void>`
  - `notifyReaction(feedback: { id: string; targetId: string; authorId: string }, reactorId: string, reactorName: string): Promise<void>`
  - `notifyBadgesEarned(userId: string, badgeIds: string[]): Promise<void>`
  - `notifyHighlightPublished(period: { id: string; monthRef: string; winnerId: string }): Promise<void>`
  - `notifyPeriodOpened(period: { monthRef: string }): Promise<void>`
  - `notifyPeriodClosed(period: { monthRef: string }): Promise<void>`
  - `toNotificationDTO(n)` em `serialize.ts`
  - `NOTIFICATION_RETENTION_DAYS = 90`
  - tipo `NotificationWithActor`

- [ ] **Step 1: Escrever os testes de serviço (falhando)**

Create `apps/api/src/services/notification-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import {
  notifyFeedbackReceived,
  notifyReaction,
  notifyBadgesEarned,
  notifyHighlightPublished,
  notifyPeriodOpened,
  createNotification,
  NOTIFICATION_RETENTION_DAYS,
} from './notification-service'

async function makeUser(email: string, over: Record<string, unknown> = {}) {
  return prisma.user.create({ data: { name: email.split('@')[0], email, passwordHash: 'x', ...over } })
}

describe('notification-service write path', () => {
  it('notifyFeedbackReceived cria notificação para o alvo com link', async () => {
    const author = await makeUser('au@x.com')
    const target = await makeUser('tg@x.com')
    await notifyFeedbackReceived({ id: 'fb1', targetId: target.id, authorId: author.id, author: { name: 'Ana' } })

    const rows = await prisma.notification.findMany({ where: { userId: target.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      type: 'FEEDBACK_RECEIVED',
      actorId: author.id,
      link: `/perfil/${target.id}?feedback=fb1`,
    })
    expect(rows[0].title).toContain('Ana')
  })

  it('notifyReaction notifica o autor do feedback, não o reactor', async () => {
    const author = await makeUser('au2@x.com')
    const target = await makeUser('tg2@x.com')
    const reactor = await makeUser('rc2@x.com')
    await notifyReaction({ id: 'fb2', targetId: target.id, authorId: author.id }, reactor.id, 'Bia')

    const toAuthor = await prisma.notification.findMany({ where: { userId: author.id } })
    expect(toAuthor).toHaveLength(1)
    expect(toAuthor[0].type).toBe('FEEDBACK_REACTION')
    const toReactor = await prisma.notification.findMany({ where: { userId: reactor.id } })
    expect(toReactor).toHaveLength(0)
  })

  it('notifyReaction não notifica quando o reactor é o próprio autor', async () => {
    const author = await makeUser('au3@x.com')
    const target = await makeUser('tg3@x.com')
    await notifyReaction({ id: 'fb3', targetId: target.id, authorId: author.id }, author.id, 'Ana')
    expect(await prisma.notification.count({ where: { userId: author.id } })).toBe(0)
  })

  it('notifyBadgesEarned ignora o slug destaque-do-mes', async () => {
    const user = await makeUser('bd@x.com')
    const normal = await prisma.badge.create({ data: { slug: 'incansavel', name: 'Incansável', description: 'd', kind: 'IMPACT', iconKey: 'k', threshold: 1 } })
    const destaque = await prisma.badge.create({ data: { slug: 'destaque-do-mes', name: 'Destaque', description: 'd', kind: 'HIGHLIGHT', iconKey: 'k' } })
    await notifyBadgesEarned(user.id, [normal.id, destaque.id])

    const rows = await prisma.notification.findMany({ where: { userId: user.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('BADGE_EARNED')
    expect(rows[0].title).toContain('Incansável')
  })

  it('notifyHighlightPublished notifica o vencedor com link /destaques', async () => {
    const winner = await makeUser('wn@x.com', { role: 'DEV' })
    await notifyHighlightPublished({ id: 'p1', monthRef: '2026-06', winnerId: winner.id })
    const rows = await prisma.notification.findMany({ where: { userId: winner.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'HIGHLIGHT_PUBLISHED', link: '/destaques' })
  })

  it('notifyPeriodOpened faz broadcast só para usuários ativos', async () => {
    const a = await makeUser('act@x.com', { active: true })
    const b = await makeUser('inact@x.com', { active: false })
    await notifyPeriodOpened({ monthRef: '2026-06' })
    expect(await prisma.notification.count({ where: { userId: a.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: b.id } })).toBe(0)
  })

  it('createNotification expurga notificações além da retenção', async () => {
    const user = await makeUser('old@x.com')
    const old = new Date(Date.now() - (NOTIFICATION_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000)
    await prisma.notification.create({ data: { userId: user.id, type: 'PERIOD_OPENED', title: 'antiga', createdAt: old } })
    await createNotification({ userId: user.id, type: 'PERIOD_CLOSED', title: 'nova' })

    const rows = await prisma.notification.findMany({ where: { userId: user.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('nova')
  })
})
```

- [ ] **Step 2: Rodar os testes para vê-los falhar**

Run: `pnpm --filter @legends/api test notification-service`
Expected: FAIL — módulo `./notification-service` não existe.

- [ ] **Step 3: Implementar o serviço (write path)**

Create `apps/api/src/services/notification-service.ts`:

```ts
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { monthLabel } from '../lib/month-label'

export const NOTIFICATION_RETENTION_DAYS = 90

export type NotificationWithActor = Prisma.NotificationGetPayload<{ include: { actor: true } }>

interface CreateNotificationInput {
  userId: string
  type: Prisma.NotificationCreateInput['type']
  title: string
  actorId?: string | null
  link?: string | null
  metadata?: Prisma.InputJsonValue
}

/** Insere uma notificação e expurga, do mesmo usuário, as além da retenção. */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  await prisma.$transaction([
    prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        actorId: input.actorId ?? null,
        link: input.link ?? null,
        metadata: input.metadata,
      },
    }),
    prisma.notification.deleteMany({ where: { userId: input.userId, createdAt: { lt: cutoff } } }),
  ])
}

export async function notifyFeedbackReceived(feedback: {
  id: string
  targetId: string
  authorId: string
  author: { name: string }
}): Promise<void> {
  if (feedback.authorId === feedback.targetId) return
  await createNotification({
    userId: feedback.targetId,
    type: 'FEEDBACK_RECEIVED',
    actorId: feedback.authorId,
    title: `${feedback.author.name} deixou um feedback pra você`,
    link: `/perfil/${feedback.targetId}?feedback=${feedback.id}`,
    metadata: { feedbackId: feedback.id },
  })
}

export async function notifyReaction(
  feedback: { id: string; targetId: string; authorId: string },
  reactorId: string,
  reactorName: string,
): Promise<void> {
  if (reactorId === feedback.authorId) return
  await createNotification({
    userId: feedback.authorId,
    type: 'FEEDBACK_REACTION',
    actorId: reactorId,
    title: `${reactorName} reagiu a um feedback seu`,
    link: `/perfil/${feedback.targetId}?feedback=${feedback.id}`,
    metadata: { feedbackId: feedback.id },
  })
}

/** Cria uma notificação por selo concedido, ignorando o selo do Destaque do Mês. */
export async function notifyBadgesEarned(userId: string, badgeIds: string[]): Promise<void> {
  if (badgeIds.length === 0) return
  const badges = await prisma.badge.findMany({
    where: { id: { in: badgeIds }, slug: { not: 'destaque-do-mes' } },
    select: { name: true },
  })
  for (const badge of badges) {
    await createNotification({
      userId,
      type: 'BADGE_EARNED',
      title: `Você conquistou o selo "${badge.name}"!`,
      link: '/selos',
    })
  }
}

export async function notifyHighlightPublished(period: {
  id: string
  monthRef: string
  winnerId: string
}): Promise<void> {
  await createNotification({
    userId: period.winnerId,
    type: 'HIGHLIGHT_PUBLISHED',
    title: `Você é o Destaque de ${monthLabel(period.monthRef)}!`,
    link: '/destaques',
    metadata: { periodId: period.id },
  })
}

async function broadcastToActive(
  type: Prisma.NotificationCreateInput['type'],
  title: string,
): Promise<void> {
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true } })
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  await prisma.$transaction([
    prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, type, title })) }),
    prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ])
}

export async function notifyPeriodOpened(period: { monthRef: string }): Promise<void> {
  await broadcastToActive('PERIOD_OPENED', `A votação de ${monthLabel(period.monthRef)} está aberta!`)
}

export async function notifyPeriodClosed(period: { monthRef: string }): Promise<void> {
  await broadcastToActive('PERIOD_CLOSED', `A votação de ${monthLabel(period.monthRef)} foi encerrada.`)
}
```

- [ ] **Step 4: Adicionar `toNotificationDTO` ao serialize**

Modify `apps/api/src/lib/serialize.ts` — adicionar ao import de tipos de `@legends/shared` (dentro do bloco já existente):

```ts
  type NotificationDTO,
```

E adicionar o import do tipo do serviço (perto dos outros imports de service, ~linha 22):

```ts
import type { NotificationWithActor } from '../services/notification-service'
```

E adicionar a função ao final do arquivo:

```ts
export function toNotificationDTO(n: NotificationWithActor): NotificationDTO {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    link: n.link,
    read: n.readAt != null,
    createdAt: n.createdAt.toISOString(),
    actor: n.actor ? { id: n.actor.id, name: n.actor.name, photoUrl: n.actor.photoUrl } : null,
  }
}
```

- [ ] **Step 5: Rodar os testes para vê-los passar**

Run: `pnpm --filter @legends/api test notification-service`
Expected: PASS (7 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/notification-service.ts apps/api/src/services/notification-service.test.ts apps/api/src/lib/serialize.ts
git commit -m "feat(api): notification-service (write path) + serialize"
```

---

## Task 4: Serviço — read path + rotas

**Files:**
- Modify: `apps/api/src/services/notification-service.ts`
- Create: `apps/api/src/routes/notifications.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/routes/notifications.test.ts`

**Interfaces:**
- Consumes: `toNotificationDTO` de `serialize`; `app.authenticate`; `request.user.sub`.
- Produces (no service):
  - `listNotifications(userId: string, opts: { cursor?: string; limit: number }): Promise<{ items: NotificationWithActor[]; nextCursor: string | null; unreadCount: number }>`
  - `countUnread(userId: string): Promise<number>`
  - `markAllRead(userId: string): Promise<void>`
- Produces (rotas): `GET /notifications/unread-count`, `GET /notifications`, `POST /notifications/read`; `notificationRoutes` registrada em `app.ts`.

- [ ] **Step 1: Escrever os testes de rota (falhando)**

Create `apps/api/src/routes/notifications.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Ana', email: 'ana@x.com', password: 'changeme123' } })
  const token = reg.json().accessToken as string
  const userId = reg.json().user.id as string
  return { app, token, userId }
}

describe('notification routes', () => {
  it('as rotas exigem autenticação (401)', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/notifications' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/notifications/unread-count' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/notifications/read' })).statusCode).toBe(401)
    await app.close()
  })

  it('unread-count conta apenas as não-lidas do usuário', async () => {
    const { app, token, userId } = await setup()
    await prisma.notification.create({ data: { userId, type: 'PERIOD_OPENED', title: 'a' } })
    await prisma.notification.create({ data: { userId, type: 'PERIOD_CLOSED', title: 'b', readAt: new Date() } })
    const res = await app.inject({ method: 'GET', url: '/notifications/unread-count', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().unreadCount).toBe(1)
    await app.close()
  })

  it('GET /notifications só traz as do próprio usuário e pagina por cursor', async () => {
    const { app, token, userId } = await setup()
    const other = await prisma.user.create({ data: { name: 'Bia', email: 'bia@x.com', passwordHash: 'x' } })
    await prisma.notification.create({ data: { userId: other.id, type: 'PERIOD_OPENED', title: 'de outro' } })
    for (let i = 0; i < 3; i++) {
      await prisma.notification.create({ data: { userId, type: 'PERIOD_OPENED', title: `n${i}` } })
    }

    const page1 = await app.inject({ method: 'GET', url: '/notifications?limit=2', headers: { authorization: `Bearer ${token}` } })
    expect(page1.statusCode).toBe(200)
    expect(page1.json().items).toHaveLength(2)
    expect(page1.json().unreadCount).toBe(3)
    expect(page1.json().nextCursor).not.toBeNull()
    expect(page1.json().items.every((n: { title: string }) => n.title !== 'de outro')).toBe(true)

    const page2 = await app.inject({ method: 'GET', url: `/notifications?limit=2&cursor=${page1.json().nextCursor}`, headers: { authorization: `Bearer ${token}` } })
    expect(page2.json().items).toHaveLength(1)
    expect(page2.json().nextCursor).toBeNull()
    await app.close()
  })

  it('POST /notifications/read zera o contador e não mexe em outro usuário', async () => {
    const { app, token, userId } = await setup()
    const other = await prisma.user.create({ data: { name: 'Bia', email: 'bia2@x.com', passwordHash: 'x' } })
    await prisma.notification.create({ data: { userId, type: 'PERIOD_OPENED', title: 'minha' } })
    await prisma.notification.create({ data: { userId: other.id, type: 'PERIOD_OPENED', title: 'dela' } })

    const res = await app.inject({ method: 'POST', url: '/notifications/read', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().unreadCount).toBe(0)
    expect(await prisma.notification.count({ where: { userId, readAt: null } })).toBe(0)
    expect(await prisma.notification.count({ where: { userId: other.id, readAt: null } })).toBe(1)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar os testes para vê-los falhar**

Run: `pnpm --filter @legends/api test notifications`
Expected: FAIL — rota `/notifications` retorna 404 (não registrada).

- [ ] **Step 3: Implementar o read path no serviço**

Modify `apps/api/src/services/notification-service.ts` — adicionar ao final:

```ts
const notificationListOrder = [{ createdAt: 'desc' as const }, { id: 'desc' as const }]

export async function listNotifications(
  userId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: NotificationWithActor[]; nextCursor: string | null; unreadCount: number }> {
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      include: { actor: true },
      orderBy: notificationListOrder,
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    }),
    countUnread(userId),
  ])
  const hasMore = rows.length > opts.limit
  const items = hasMore ? rows.slice(0, opts.limit) : rows
  const nextCursor = hasMore ? items[items.length - 1].id : null
  return { items, nextCursor, unreadCount }
}

export function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } })
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } })
}
```

- [ ] **Step 4: Implementar as rotas**

Create `apps/api/src/routes/notifications.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { countUnread, listNotifications, markAllRead } from '../services/notification-service'
import { toNotificationDTO } from '../lib/serialize'

const listQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/notifications/unread-count', { onRequest: [app.authenticate] }, async (request, reply) => {
    const unreadCount = await countUnread(request.user.sub)
    return reply.send({ unreadCount })
  })

  app.get('/notifications', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: parsed.error.flatten() })
    }
    const { items, nextCursor, unreadCount } = await listNotifications(request.user.sub, {
      cursor: parsed.data.cursor,
      limit: parsed.data.limit ?? 20,
    })
    return reply.send({ items: items.map(toNotificationDTO), nextCursor, unreadCount })
  })

  app.post('/notifications/read', { onRequest: [app.authenticate] }, async (request, reply) => {
    await markAllRead(request.user.sub)
    return reply.send({ unreadCount: 0 })
  })
}
```

- [ ] **Step 5: Registrar a rota no app**

Modify `apps/api/src/app.ts` — adicionar o import (junto aos outros, após `muralRoutes`):

```ts
import { notificationRoutes } from './routes/notifications'
```

E registrar (após `app.register(muralRoutes)`):

```ts
  app.register(notificationRoutes)
```

- [ ] **Step 6: Rodar os testes para vê-los passar**

Run: `pnpm --filter @legends/api test notifications`
Expected: PASS (4 testes).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/notification-service.ts apps/api/src/routes/notifications.ts apps/api/src/routes/notifications.test.ts apps/api/src/app.ts
git commit -m "feat(api): rotas de notificação (read path)"
```

---

## Task 5: Fiação best-effort nos sites de evento

**Files:**
- Modify: `apps/api/src/routes/feedback.ts`
- Modify: `apps/api/src/routes/votes.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/src/routes/feedback.test.ts` (adicionar casos)
- Test: `apps/api/src/routes/notifications.test.ts` (adicionar caso best-effort)

**Interfaces:**
- Consumes: `notifyFeedbackReceived`, `notifyReaction`, `notifyBadgesEarned`, `notifyHighlightPublished`, `notifyPeriodOpened`, `notifyPeriodClosed` (Task 3); `evaluateBadgesForUser` retorna `UserBadge[]`; `syncFeedbackBadgesForUser` retorna `{ awarded: UserBadge[] }`; `grantBadgeManually` retorna `UserBadge & { badge }`; `toggleReaction` (precisa expor estado add/remove — ver Step 4).

- [ ] **Step 1: Escrever o teste de feedback recebido (falhando)**

Modify `apps/api/src/routes/feedback.test.ts` — adicionar dentro do `describe('feedback routes', ...)`:

```ts
  it('cria notificação para o alvo ao receber feedback', async () => {
    const { app, lead, token } = await setup()
    await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const rows = await prisma.notification.findMany({ where: { userId: lead.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('FEEDBACK_RECEIVED')
    await app.close()
  })

  it('notifica o autor do feedback quando alguém reage', async () => {
    const { app, lead, token, authorId } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const feedbackId = created.json().feedback.id as string
    // o líder reage ao feedback que a Ana (authorId) escreveu
    const leadToken = app.jwt.sign({ sub: lead.id, role: 'LEAD' })
    await app.inject({ method: 'POST', url: `/feedbacks/${feedbackId}/reactions/toggle`, headers: { authorization: `Bearer ${leadToken}` }, payload: { emoji: '👏' } })

    const toAuthor = await prisma.notification.findMany({ where: { userId: authorId, type: 'FEEDBACK_REACTION' } })
    expect(toAuthor).toHaveLength(1)
    // remover a reação (segundo toggle) NÃO gera nova notificação
    await app.inject({ method: 'POST', url: `/feedbacks/${feedbackId}/reactions/toggle`, headers: { authorization: `Bearer ${leadToken}` }, payload: { emoji: '👏' } })
    expect(await prisma.notification.count({ where: { userId: authorId, type: 'FEEDBACK_REACTION' } })).toBe(1)
    await app.close()
  })
```

- [ ] **Step 2: Rodar os testes para vê-los falhar**

Run: `pnpm --filter @legends/api test feedback`
Expected: FAIL — nenhuma notificação criada ainda.

- [ ] **Step 3: Fiar feedback recebido na rota**

Modify `apps/api/src/routes/feedback.ts` — adicionar ao import de services (após a linha `import { syncFeedbackBadgesForUser } ...`):

```ts
import { notifyFeedbackReceived, notifyReaction, notifyBadgesEarned } from '../services/notification-service'
```

Na rota `POST /users/:id/feedbacks`, dentro do `try`, capturar o retorno do sync e disparar as notificações best-effort. Substituir o bloco atual (linhas ~60-73):

```ts
    try {
      const feedback = await createFeedback({
        authorId: request.user.sub,
        targetId: id,
        ...parsed.data,
      })
      // Sincronização de selos é best-effort: o feedback já está persistido e os selos
      // são deriváveis/recomputáveis, então uma falha aqui não pode falhar o feedback.
      try {
        const { awarded } = await syncFeedbackBadgesForUser(request.user.sub)
        await notifyBadgesEarned(request.user.sub, awarded.map((b) => b.badgeId))
      } catch (badgeErr) {
        request.log.error(badgeErr)
      }
      // Notificação ao alvo é best-effort pelo mesmo motivo.
      try {
        await notifyFeedbackReceived({
          id: feedback.id,
          targetId: id,
          authorId: request.user.sub,
          author: { name: feedback.author.name },
        })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      return reply.code(201).send({ feedback: toFeedbackDTO(feedback, request.user.sub) })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
```

> Confirmado: `createFeedback` retorna `FeedbackWithAuthor`, cujo `include` é `{ author: true, reactions: { include: { user: true } } }` (`feedback-service.ts:21-25`) — `feedback.author.name` e `feedback.reactions[].user.name` estão disponíveis sem query extra.

- [ ] **Step 4: Fiar a reação na rota (apenas no add, sem query extra de nome)**

O `toggleReaction` retorna o feedback recarregado com `reactions` (cada uma com `user`). Para notificar **apenas no add**, achar a reação do usuário com aquele emoji no resultado; se existe, foi adicionada (e o `user.name` dela é o nome do reactor). O JWT carrega só `{ sub, role }` (`auth.ts:94`), então o nome NÃO vem do token. Modify `apps/api/src/routes/feedback.ts` — substituir a rota `POST /feedbacks/:id/reactions/toggle`:

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
      // Só notifica quando a reação foi ADICIONADA (existe no resultado), não removida.
      const myReaction = feedback.reactions.find(
        (r) => r.userId === request.user.sub && r.emoji === parsed.data.emoji,
      )
      if (myReaction) {
        try {
          await notifyReaction(
            { id: feedback.id, targetId: feedback.targetId, authorId: feedback.authorId },
            request.user.sub,
            myReaction.user.name,
          )
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      }
      return reply.send({ reactions: toFeedbackDTO(feedback, request.user.sub).reactions })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 5: Checar tipos**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (`feedback.reactions[].user.name`, `feedback.targetId`, `feedback.authorId` existem no payload de `FeedbackWithAuthor`).

- [ ] **Step 6: Fiar selos concedidos no voto**

Modify `apps/api/src/routes/votes.ts` — adicionar import:

```ts
import { notifyBadgesEarned } from '../services/notification-service'
```

Substituir o bloco best-effort (linhas ~29-33):

```ts
      try {
        const awarded = await evaluateBadgesForUser(vote.votedId)
        await notifyBadgesEarned(vote.votedId, awarded.map((b) => b.badgeId))
      } catch (badgeErr) {
        request.log.error(badgeErr)
      }
```

- [ ] **Step 7: Fiar selo manual, publicação do destaque e período no admin**

Modify `apps/api/src/routes/admin.ts` — adicionar import:

```ts
import { notifyBadgesEarned, notifyHighlightPublished, notifyPeriodOpened, notifyPeriodClosed } from '../services/notification-service'
```

**(a) Selo manual** — na rota `POST /admin/users/:userId/badges`, após `const awarded = await grantBadgeManually(...)`:

```ts
      try {
        await notifyBadgesEarned(userId, [awarded.badgeId])
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
```

**(b) Publicação do destaque** — na rota `POST /admin/periods/:id/highlight/publish`, após `const period = await publishHighlight(id)`:

```ts
      if (period.winnerId) {
        try {
          await notifyHighlightPublished({ id: period.id, monthRef: period.monthRef, winnerId: period.winnerId })
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      }
```

**(c) Período agendado/aberto** — na rota `POST /admin/periods`, após `const period = await scheduleVotingPeriod(...)`:

```ts
      try {
        await notifyPeriodOpened({ monthRef: period.monthRef })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
```

**(d) Período fechado** — na rota `POST /admin/periods/:id/close`, após `const period = await closeVotingPeriod(id)`:

```ts
      try {
        await notifyPeriodClosed({ monthRef: period.monthRef })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
```

- [ ] **Step 8: Adicionar teste best-effort (falha no notify não derruba a ação)**

Modify `apps/api/src/routes/notifications.test.ts` — adicionar import no topo:

```ts
import { vi } from 'vitest'
import * as notificationService from '../services/notification-service'
```

E adicionar o caso dentro do `describe`:

```ts
  it('falha ao notificar não derruba a criação de feedback (best-effort)', async () => {
    const { app, token } = await setup()
    const target = await prisma.user.create({ data: { name: 'Alvo', email: 'alvo-be@x.com', passwordHash: 'x', role: 'LEAD' } })
    const spy = vi.spyOn(notificationService, 'notifyFeedbackReceived').mockRejectedValueOnce(new Error('boom'))
    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'Mensagem de feedback suficientemente longa para validar.', category: 'POSITIVO' },
    })
    expect(res.statusCode).toBe(201)
    spy.mockRestore()
    await app.close()
  })
```

- [ ] **Step 9: Rodar a suíte da API inteira**

Run: `pnpm --filter @legends/api test`
Expected: PASS — incluindo os novos casos de feedback e notifications.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/routes/feedback.ts apps/api/src/routes/votes.ts apps/api/src/routes/admin.ts apps/api/src/routes/feedback.test.ts apps/api/src/routes/notifications.test.ts
git commit -m "feat(api): dispara notificações nos eventos (best-effort)"
```

---

## Task 6: Frontend — hooks + sino no header

**Files:**
- Create: `apps/web/src/lib/use-notifications.ts`
- Create: `apps/web/src/components/NotificationBell.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Test: `apps/web/src/components/NotificationBell.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`; tipos `NotificationListResponse`, `UnreadCountResponse` de `@legends/shared`.
- Produces: `useUnreadCount()`, `useNotifications()`, `useMarkAllRead()`; componente `<NotificationBell />`.

- [ ] **Step 1: Implementar os hooks**

Create `apps/web/src/lib/use-notifications.ts`:

```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NotificationListResponse, UnreadCountResponse } from '@legends/shared'
import { apiFetch } from './api'

/** Contador de não-lidas, com polling a cada 45s. Alimenta o badge do sino. */
export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => apiFetch<UnreadCountResponse>('/notifications/unread-count'),
    refetchInterval: 45_000,
  })
}

/** Lista paginada por cursor; carregada quando o dropdown/página abre. */
export function useNotifications(enabled = true) {
  return useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiFetch<NotificationListResponse>(
        `/notifications?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

/** Marca todas como lidas e revalida a lista + contador. */
export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<UnreadCountResponse>('/notifications/read', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
```

- [ ] **Step 2: Escrever os testes do sino (falhando)**

Create `apps/web/src/components/NotificationBell.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { NotificationBell } from './NotificationBell'
import * as api from '../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

describe('NotificationBell', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('mostra o contador de não-lidas', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 3 } as never
      return { items: [], unreadCount: 3, nextCursor: null } as never
    })
    wrap(<NotificationBell />)
    expect(await screen.findByText('3')).toBeInTheDocument()
  })

  it('abrir o sino chama markAllRead e lista os itens', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 1 } as never
      if (path === '/notifications/read') return { unreadCount: 0 } as never
      return {
        items: [{ id: 'n1', type: 'FEEDBACK_RECEIVED', title: 'Ana deixou um feedback pra você', link: '/perfil/u1?feedback=f1', read: false, createdAt: '2026-06-17T00:00:00.000Z', actor: null }],
        unreadCount: 1,
        nextCursor: null,
      } as never
    })
    wrap(<NotificationBell />)
    fireEvent.click(await screen.findByRole('button', { name: /notificaç/i }))
    expect(await screen.findByText(/Ana deixou um feedback/i)).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/notifications/read', { method: 'POST' }))
  })

  it('mostra estado vazio quando não há notificações', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      return { items: [], unreadCount: 0, nextCursor: null } as never
    })
    wrap(<NotificationBell />)
    fireEvent.click(await screen.findByRole('button', { name: /notificaç/i }))
    expect(await screen.findByText(/Nenhuma notificação ainda/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Rodar os testes para vê-los falhar**

Run: `pnpm --filter @legends/web test NotificationBell`
Expected: FAIL — componente `./NotificationBell` não existe.

- [ ] **Step 4: Implementar o NotificationBell**

Create `apps/web/src/components/NotificationBell.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNotifications, useUnreadCount, useMarkAllRead } from '../lib/use-notifications'
import { Icon } from './Icon'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const unread = useUnreadCount()
  const list = useNotifications(open)
  const markAllRead = useMarkAllRead()

  const count = unread.data?.unreadCount ?? 0
  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  // Abrir o sino marca tudo como lido (zera o contador).
  useEffect(() => {
    if (open && count > 0) markAllRead.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notificações"
        className="relative flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-surface-container-highest focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <Icon name="notifications" className="text-[24px] text-on-surface-variant" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-error px-1 font-label text-[10px] font-bold text-on-error">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-sm w-80 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-lg"
        >
          <div className="border-b border-outline-variant/40 px-lg py-md font-label text-label-md font-bold text-on-surface">
            Notificações
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-lg py-xl text-center text-body-sm text-on-surface-variant">
                Nenhuma notificação ainda
              </p>
            ) : (
              items.map((n) => {
                const inner = (
                  <div className="flex items-start gap-sm px-lg py-md transition-colors hover:bg-surface-container-highest">
                    <Icon name={iconFor(n.type)} className="mt-0.5 text-[20px] text-primary" />
                    <div className="min-w-0">
                      <p className={`text-body-sm ${n.read ? 'text-on-surface-variant' : 'font-bold text-on-surface'}`}>
                        {n.title}
                      </p>
                    </div>
                  </div>
                )
                return n.link ? (
                  <Link key={n.id} to={n.link} onClick={() => setOpen(false)} className="block">
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                )
              })
            )}
          </div>
          <Link
            to="/notificacoes"
            onClick={() => setOpen(false)}
            className="block border-t border-outline-variant/40 px-lg py-md text-center font-label text-label-md text-primary hover:bg-surface-container-highest"
          >
            Ver todas
          </Link>
        </div>
      )}
    </div>
  )
}

function iconFor(type: string): string {
  switch (type) {
    case 'FEEDBACK_RECEIVED':
    case 'FEEDBACK_REACTION':
      return 'chat'
    case 'BADGE_EARNED':
      return 'workspace_premium'
    case 'HIGHLIGHT_PUBLISHED':
      return 'trophy'
    default:
      return 'how_to_vote'
  }
}
```

- [ ] **Step 5: Rodar os testes para vê-los passar**

Run: `pnpm --filter @legends/web test NotificationBell`
Expected: PASS (3 testes).

- [ ] **Step 6: Montar o sino no header**

Modify `apps/web/src/components/AppLayout.tsx`:

Adicionar o import (após `import { ColleagueSearch } ...`):

```tsx
import { NotificationBell } from "./NotificationBell";
```

No header, dentro de `<div className="flex items-center gap-lg">` (linha ~147), antes do `<div className="relative" ref={accountMenuRef}>`:

```tsx
            <NotificationBell />
```

> O header é renderizado em todos os breakpoints (não tem `hidden`), então o sino fica visível no desktop e no mobile, atendendo "nos dois".

- [ ] **Step 7: Rodar a suíte web e checar tipos**

Run: `pnpm --filter @legends/web test`
Expected: PASS (incluindo `AppLayout.test.tsx` ainda verde).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/use-notifications.ts apps/web/src/components/NotificationBell.tsx apps/web/src/components/NotificationBell.test.tsx apps/web/src/components/AppLayout.tsx
git commit -m "feat(web): sino de notificações no header"
```

---

## Task 7: Frontend — página `/notificacoes`

**Files:**
- Create: `apps/web/src/pages/NotificationsPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/nav-items.ts`
- Test: `apps/web/src/pages/NotificationsPage.test.tsx`

**Interfaces:**
- Consumes: `useNotifications`, `useMarkAllRead` (Task 6); `Link` do react-router.
- Produces: rota `/notificacoes`; item de nav "Notificações".

- [ ] **Step 1: Escrever os testes da página (falhando)**

Create `apps/web/src/pages/NotificationsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { NotificationsPage } from './NotificationsPage'
import * as api from '../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

describe('NotificationsPage', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('lista as notificações e linka cada item', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      return {
        items: [{ id: 'n1', type: 'BADGE_EARNED', title: 'Você conquistou o selo "Incansável"!', link: '/selos', read: false, createdAt: '2026-06-17T00:00:00.000Z', actor: null }],
        unreadCount: 0,
        nextCursor: null,
      } as never
    })
    wrap(<NotificationsPage />)
    const title = await screen.findByText(/Incansável/i)
    expect(title.closest('a')).toHaveAttribute('href', '/selos')
  })

  it('mostra estado vazio', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      return { items: [], unreadCount: 0, nextCursor: null } as never
    })
    wrap(<NotificationsPage />)
    expect(await screen.findByText(/Nenhuma notificação/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar os testes para vê-los falhar**

Run: `pnpm --filter @legends/web test NotificationsPage`
Expected: FAIL — página não existe.

- [ ] **Step 3: Implementar a página**

Create `apps/web/src/pages/NotificationsPage.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { useEffect } from 'react'
import { useNotifications, useMarkAllRead, useUnreadCount } from '../lib/use-notifications'
import { Icon } from '../components/Icon'

function iconFor(type: string): string {
  switch (type) {
    case 'FEEDBACK_RECEIVED':
    case 'FEEDBACK_REACTION':
      return 'chat'
    case 'BADGE_EARNED':
      return 'workspace_premium'
    case 'HIGHLIGHT_PUBLISHED':
      return 'trophy'
    default:
      return 'how_to_vote'
  }
}

export function NotificationsPage() {
  const list = useNotifications(true)
  const unread = useUnreadCount()
  const markAllRead = useMarkAllRead()
  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  // Abrir a página marca tudo como lido.
  useEffect(() => {
    if ((unread.data?.unreadCount ?? 0) > 0) markAllRead.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread.data?.unreadCount])

  return (
    <div className="mx-auto w-full max-w-2xl px-lg py-xl">
      <h1 className="mb-lg font-headline text-headline-md font-bold text-on-surface">Notificações</h1>

      {items.length === 0 ? (
        <p className="py-2xl text-center text-body-md text-on-surface-variant">Nenhuma notificação ainda.</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {items.map((n) => {
            const inner = (
              <div className={`flex items-start gap-md rounded-lg border border-outline-variant/30 px-lg py-md transition-colors hover:bg-surface-container ${n.read ? 'opacity-70' : ''}`}>
                <Icon name={iconFor(n.type)} className="mt-0.5 text-[22px] text-primary" />
                <p className={`text-body-md ${n.read ? 'text-on-surface-variant' : 'font-bold text-on-surface'}`}>{n.title}</p>
              </div>
            )
            return (
              <li key={n.id}>
                {n.link ? <Link to={n.link} className="block">{inner}</Link> : inner}
              </li>
            )
          })}
        </ul>
      )}

      {list.hasNextPage && (
        <button
          type="button"
          onClick={() => list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
          className="mt-lg w-full rounded-md border border-outline-variant/40 py-md font-label text-label-md text-on-surface-variant transition-colors hover:bg-surface-container"
        >
          {list.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Registrar a rota**

Modify `apps/web/src/App.tsx`:

Adicionar o import (após `import { HighlightsPage } ...`):

```tsx
import { NotificationsPage } from './pages/NotificationsPage'
```

Adicionar a rota dentro do bloco protegido do `AppLayout` (após a rota `/destaques`, linha ~79):

```tsx
              <Route path="/notificacoes" element={<NotificationsPage />} />
```

- [ ] **Step 5: Adicionar o item de navegação**

Modify `apps/web/src/components/nav-items.ts` — adicionar o item de notificações nas duas listas retornadas. Na lista do **não-admin** (após `/destaques`):

```ts
    { to: '/notificacoes', label: 'Notificações', icon: 'notifications' },
```

E na lista do **admin** (após `/destaques`):

```ts
      { to: '/notificacoes', label: 'Notificações', icon: 'notifications' },
```

- [ ] **Step 6: Rodar os testes para vê-los passar**

Run: `pnpm --filter @legends/web test NotificationsPage`
Expected: PASS (2 testes).

- [ ] **Step 7: Rodar a suíte web inteira + build**

Run:
```bash
pnpm --filter @legends/web test
pnpm --filter @legends/web build
```
Expected: testes verdes; build sem erros de TypeScript.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/NotificationsPage.tsx apps/web/src/pages/NotificationsPage.test.tsx apps/web/src/App.tsx apps/web/src/components/nav-items.ts
git commit -m "feat(web): página /notificacoes"
```

---

## Task 8: Verificação final ponta a ponta

**Files:** nenhum (gate de verificação).

- [ ] **Step 1: Rodar a suíte inteira do monorepo**

Run:
```bash
pnpm db:up
pnpm test
```
Expected: todos os workspaces verdes (api contra Postgres, web jsdom, shared).

- [ ] **Step 2: Build completo**

Run: `pnpm build`
Expected: build de api + web + shared sem erros.

- [ ] **Step 3: Smoke manual (opcional, recomendado)**

Run: `pnpm dev` e validar no browser:
- criar feedback para outro usuário → o sino do alvo mostra contador após ≤45s; abrir zera; clicar leva ao perfil com o feedback destacado.
- página `/notificacoes` lista e pagina.

- [ ] **Step 4: Commit final (se houver ajustes do smoke)**

```bash
git add -A
git commit -m "chore: ajustes finais de notificações internas"
```

---

## Self-Review (preenchido na escrita do plano)

**1. Spec coverage:**
- Eventos (feedback, reação, selo, destaque, período) → Task 3 (criadores) + Task 5 (fiação). ✓
- Voto fora de escopo → nenhum disparo em `votes.ts` exceto selos. ✓
- Destaque só na publicação → Task 5 (b) fia `publishHighlight`, não `electWinner`. ✓
- Selo `destaque-do-mes` suprimido → `notifyBadgesEarned` filtra o slug (Task 3 + teste). ✓
- Broadcast só ativos → `broadcastToActive` (Task 3 + teste). ✓
- Retenção 90d lazy → `createNotification`/`broadcastToActive` (Task 3 + teste). ✓
- Sem auto-notificação → guards em `notifyFeedbackReceived`/`notifyReaction` (Task 3 + teste). ✓
- Contrato shared → Task 1. ✓ Model + migration → Task 2. ✓ Serialize → Task 3. ✓
- Read path (unread-count/list cursor/markAll) → Task 4. ✓
- Polling 45s, sino desktop+mobile, abrir zera, deep-link, página → Tasks 6 e 7. ✓

**2. Placeholder scan:** sem TBD/TODO; todo passo tem código ou comando concreto. Os dois pontos antes incertos foram verificados contra o código e resolvidos no plano: `createFeedback` inclui `author` + `reactions.user` (`feedback-service.ts:21-25`); o JWT carrega só `{ sub, role }` (`auth.ts:94`), então o nome do reactor vem de `myReaction.user.name` (Task 5, Step 4) — sem query extra, sem dependência inexistente. ✓

**3. Type consistency:** `notifyBadgesEarned(userId, badgeIds)` usado igual em votes/feedback/admin; `NotificationListResponse`/`UnreadCountResponse` idênticos entre shared, rotas e hooks; cursor = `id` (string) consistente entre `listNotifications`, rota e `useNotifications`. ✓
