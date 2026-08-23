# Notificações internas — Design

Data: 2026-06-17

## Objetivo

Dar ao usuário do Legends uma central de notificações internas (in-app) para
saber, sem precisar caçar pelas telas, quando algo relevante aconteceu com ele:
recebeu feedback, alguém reagiu a um feedback que escreveu, ganhou um selo, foi
publicado como Destaque do Mês, ou um período de votação abriu/encerrou.

Entrega via **polling** (sem real-time): um sino no cabeçalho com contador de
não-lidas e dropdown das últimas, mais uma página `/notificacoes` com o histórico
completo paginado.

## Escopo

Eventos que **geram** notificação (MVP):

| Tipo | Quem é notificado | Quando |
|---|---|---|
| `FEEDBACK_RECEIVED` | alvo do feedback | feedback criado |
| `FEEDBACK_REACTION` | autor do feedback | reação **adicionada** (não no remove) |
| `BADGE_EARNED` | dono do selo | selo concedido (auto ou manual) |
| `HIGHLIGHT_PUBLISHED` | vencedor | Destaque do Mês **publicado** (nunca na eleição) |
| `PERIOD_OPENED` / `PERIOD_CLOSED` | **todos os usuários ativos** (broadcast) | período aberto / encerrado |

**Fora de escopo (deliberado, YAGNI):**

- **Voto recebido** — não pode vazar autoria; e há uma cerimônia de análise do
  Destaque do Mês. Por isso o Destaque só notifica na **publicação** (ação do
  admin), nunca em `electWinner`.
- **E-mail / push** — apenas in-app ("notificações internas").
- **Agrupamento/dedup** ("3 pessoas reagiram") — uma notificação por evento.
- **Preferências por usuário** (ligar/desligar tipos).
- Marcar notificação individual como lida (ver "Regras de leitura").

## Regras de negócio

- **Anonimato do voto preservado:** nenhum evento de voto gera notificação.
- **Destaque só na publicação:** `notifyHighlightPublished` dispara em
  `publishHighlight`; `electWinner` não notifica ninguém (cerimônia primeiro).
- **Selo `destaque-do-mes` suprimido do fluxo de selo:** `publishHighlight`
  concede esse selo. Para não mandar duas notificações (selo + destaque), o
  criador de notificação de selo **ignora o slug `destaque-do-mes`** — quem
  comunica o destaque é `notifyHighlightPublished`.
- **Sem auto-notificação:** nunca notificar o próprio ator (ex.: reagir ao
  próprio feedback). Guard no service compara destinatário × ator.
- **Reação só no add:** o toggle de reação notifica apenas quando adiciona;
  remover não notifica.
- **Broadcast de período** atinge todos os usuários com `active = true`.
- **Retenção 90 dias:** notificações com `createdAt < now - 90d` são expurgadas
  de forma **lazy/oportunista no write** (não há cron no projeto; períodos rodam
  por data). Constante `NOTIFICATION_RETENTION_DAYS = 90`.
- **Best-effort:** criar notificação nunca derruba a ação que a originou. Toda
  chamada de notificação é envolvida em `try/catch` com log no erro, espelhando
  o padrão de avaliação de selos pós-voto (`votes.ts`).

## Banco de dados (Prisma)

Novo enum + modelo em `apps/api/prisma/schema.prisma`:

```prisma
enum NotificationType {
  FEEDBACK_RECEIVED
  FEEDBACK_REACTION
  BADGE_EARNED
  HIGHLIGHT_PUBLISHED
  PERIOD_OPENED
  PERIOD_CLOSED
}

model Notification {
  id        String           @id @default(cuid())
  userId    String                              // destinatário
  type      NotificationType
  actorId   String?                             // quem disparou (null em eventos de sistema/broadcast)
  title     String                              // texto pt-BR renderizado no write (denormalizado)
  link      String?                             // deep-link relativo (ex.: "/perfil/<id>?feedback=<id>")
  metadata  Json?                               // ids crus p/ futuro/dedup (feedbackId, badgeSlug, periodId)
  readAt    DateTime?                           // null = não-lida
  createdAt DateTime         @default(now())

  user  User  @relation("UserNotifications", fields: [userId], references: [id], onDelete: Cascade)
  actor User? @relation("NotificationActor", fields: [actorId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])   // feed paginado
  @@index([userId, readAt])      // contador de não-lidas
}
```

Relações adicionadas ao `User`:
- `notifications        Notification[] @relation("UserNotifications")`
- `notificationsTriggered Notification[] @relation("NotificationActor")`

Decisões:
- **`title` denormalizado** (renderizado no write): notificação é uma foto do
  momento; se o ator renomear depois, o texto antigo fica defasado — aceitável,
  e evita joins/render no read.
- **`onDelete: SetNull` em `actorId`:** apagar um usuário não derruba a
  notificação alheia (só perde o avatar do ator).
- **`onDelete: Cascade` em `userId`:** removido o dono, removidas as suas
  notificações.

Migration nova via `pnpm db:migrate` (nunca editar migration aplicada).

## Tipos compartilhados (`packages/shared/src/notification.ts`)

Arquivo novo, reexportado no barril `index.ts`. Fonte única do contrato api⇄web.

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
  read: boolean          // derivado de readAt != null (web não precisa do timestamp)
  createdAt: string      // ISO
  actor: NotificationActor | null
}

export interface NotificationListResponse {
  items: NotificationDTO[]
  unreadCount: number        // total de não-lidas (não só da página)
  nextCursor: string | null  // paginação por cursor
}

export interface UnreadCountResponse {
  unreadCount: number        // resposta enxuta do polling
}
```

Mesmo padrão de `FEEDBACK_CATEGORIES`/`FEEDBACK_REACTIONS` (array `as const` +
type derivado).

## Serviço — write path (`apps/api/src/services/notification-service.ts`)

Toda a renderização de texto pt-BR e montagem de `link` fica **aqui** (não
espalhada nas routes). Criadores tipados, um por evento:

```ts
notifyFeedbackReceived(feedback)     // -> targetId
notifyReaction(feedback, reactorId)  // -> feedback.authorId, só no add
notifyBadgeEarned(userId, badge)     // -> userId (ignora slug 'destaque-do-mes')
notifyHighlightPublished(period)     // -> winnerId
notifyPeriodOpened(period)           // -> broadcast (todos ativos)
notifyPeriodClosed(period)           // -> broadcast (todos ativos)
```

Internos:
- `createNotification(input)` — insere uma linha e dispara o expurgo lazy.
- `createManyNotifications(userIds, input)` — `createMany` para broadcast.
- `pruneOldNotifications(userId)` — `deleteMany` com `createdAt < now - 90d`.

Deep-links montados no write (caminhos confirmados no router — ver Frontend):
- feedback / reação → `/perfil/<recipientUserId>?feedback=<feedbackId>`
  (reusa o destaque já existente do mural/perfil)
- selo → `/selos`
- destaque → `/destaques`
- período → `/votar`

`recipientUserId` é o próprio dono da notificação (não existe `/perfil/me`; o
perfil é por id).

### Fiação nos sites de evento (best-effort)

Cada chamada envolvida em `try/catch` com `request.log.error` no catch,
espelhando `votes.ts` (avaliação de selos pós-voto):

| Evento | Site | Notifica |
|---|---|---|
| Feedback recebido | `routes/feedback.ts` (POST `/users/:id/feedbacks`) | `targetId` |
| Reação adicionada | `routes/feedback.ts` (POST `/feedbacks/:id/reactions/toggle`) | autor do feedback — só no add; nunca o próprio reactor |
| Selo ganho | `services/badge-service.ts` (`evaluateBadgesForUser`, `syncFeedbackBadgesForUser`, `grantBadgeManually`) | dono do selo, no insert; ignora `destaque-do-mes` |
| Destaque publicado | `services/highlight-service.ts` (`publishHighlight`) | vencedor |
| Período aberto/fechado | `services/admin-service.ts` (`scheduleVotingPeriod`, `closeVotingPeriod`) | broadcast todos ativos |

## API — read path (`apps/api/src/routes/notifications.ts`)

Registrada em `app.ts`. Todas protegidas (`onRequest: [app.authenticate]`),
escopadas a `request.user.sub` (usuário só lê/marca as próprias; sem rota admin).

| Método | Rota | Faz | Retorna |
|---|---|---|---|
| `GET` | `/notifications/unread-count` | contador só — alvo do polling | `UnreadCountResponse` |
| `GET` | `/notifications?cursor=&limit=` | lista paginada por cursor (default 20) | `NotificationListResponse` |
| `POST` | `/notifications/read` | marca todas as não-lidas como lidas (`readAt = now`) | `{ unreadCount: 0 }` |

Detalhes:
- **Cursor** = `createdAt` + `id` (encodado), batendo no índice
  `[userId, createdAt]`. `nextCursor: null` quando acabou.
- **Marcar lida = bulk only** (`updateMany where userId, readAt: null`). Combina
  com "ao abrir o sino zera tudo". Sem marcar-item-individual (clique navega).
- Zod `safeParse` no query (`cursor`, `limit`); `400 { message, issues }` em
  falha — padrão das outras routes.

## Serialização (`apps/api/src/lib/serialize.ts`)

`toNotificationDTO(notification)` converte Prisma → `NotificationDTO`: monta
`actor` a partir do join (`id`/`name`/`photoUrl`, ou `null`) e deriva
`read = notification.readAt != null`. Segue o padrão de `toFeedbackDTO`/`toVoteDTO`.
A query de leitura inclui `actor: true`.

## Frontend (`apps/web`)

**Polling & estado — `src/lib/use-notifications.ts`:**
- `useUnreadCount()` → `useQuery(['notifications','unread'], …, { refetchInterval: 45_000 })`.
  Só o contador; alimenta o badge do sino.
- `useNotifications()` → `useInfiniteQuery(['notifications','list'], …)` com
  cursor; carrega quando dropdown/página abrem.
- `useMarkAllRead()` → `useMutation` (POST `/notifications/read`); no sucesso
  `invalidateQueries(['notifications'])` → contador zera na hora.

**Sino — `src/components/NotificationBell.tsx`**, plugado no `AppLayout.tsx`
(perto do indicador "Aberta"/avatar), presente **no header desktop e na navbar
mobile**:
- Ícone sino + badge vermelho com `unreadCount` (`9+` quando > 9).
- Abrir o dropdown dispara `markAllRead` → contador zera ("ao abrir o sino").
- Item: avatar do `actor` (DiceBear; fallback para ícone do `type` quando
  `actor` é null), `title`, tempo relativo, marcador de não-lida. Clicar navega
  pro `link` (react-router) e fecha.
- Rodapé "ver todas" → `/notificacoes`. Estado vazio: "Nenhuma notificação ainda".

**Página — `src/pages/NotificationsPage.tsx`**, rota `/notificacoes`
(protegida, dentro do `AppLayout`, com item de navegação):
- Inbox completa, scroll infinito por cursor ("carregar mais").
- Mesma linha visual do dropdown, mais espaçada; lidas com leve dim, não-lidas
  destacadas.

## Testes

**Serviço (`notification-service.test.ts`):**
- cada criador insere linha com `type`/`actorId`/`title`/`link` corretos.
- não auto-notifica (reação no próprio feedback → 0 linhas).
- reação só notifica no add, não no remove.
- selo `destaque-do-mes` não gera notificação de selo (suprimido).
- broadcast de período → uma linha por usuário ativo (inativo não recebe).
- expurgo: notificação > 90d some após novo write; recente permanece.
- read path: `unreadCount` conta certo; `markAllRead` zera; cursor pagina sem
  repetir/pular.

**Rota (`notifications.test.ts`, via `app.inject`):**
- as 3 rotas exigem auth (401 sem token).
- usuário só vê/marca as próprias (notif de outro user não aparece nem é marcada).
- `GET /notifications` pagina por cursor; `POST /notifications/read` → `unreadCount: 0`.

**Fiação best-effort (nos testes de route existentes):**
- `feedback.test.ts`: POST feedback gera notificação pro target; erro no notify
  (mock força throw) não derruba a ação (segue 201).

**Web (`NotificationBell.test.tsx`):**
- badge mostra `unreadCount`; abrir dropdown chama `markAllRead` e zera; item
  navega pro `link`; estado vazio.

`pnpm test` verde antes de concluir (subir Postgres com `pnpm db:up` primeiro).

## Fora de escopo

- Voto recebido como notificação (anonimato).
- E-mail / push / qualquer canal externo.
- Agrupamento/dedup de notificações repetidas.
- Preferências por usuário (mute por tipo).
- Marcar notificação individual como lida.
- Notificação em tempo real (SSE/WebSocket).
