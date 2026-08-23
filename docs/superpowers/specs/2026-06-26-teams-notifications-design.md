# Design — Espelhamento de notificações no Teams + lembretes de votação

**Data:** 2026-06-26
**Status:** Aprovado (aguardando review do spec)

## Contexto

A plataforma já possui:

- Model `Notification` (Prisma) com 8 tipos (`FEEDBACK_RECEIVED`, `FEEDBACK_REACTION`,
  `BADGE_EARNED`, `HIGHLIGHT_PUBLISHED`, `PERIOD_OPENED`, `PERIOD_CLOSED`,
  `RETRO_INVITED`, `STREAK_AT_RISK`).
- Campo `User.teamsWebhookUrl` (URL de webhook do Power Automate → DM no Teams),
  configurável pelo admin.
- `lib/teams-client.ts` — hoje só monta/posta o Adaptive Card de "ofensiva em risco"
  (`buildStreakAtRiskCard`, `postTeamsNudge`), best-effort (timeout 5s, erros logados).
- `scheduler/nudges.ts` — `setInterval` de 1h; `runNudgeTick(now)` age às 16h SP e
  notifica streak em risco in-app + Teams. `now` é injetável (testável sem timers).
- `services/notification-service.ts` — `createNotification` (individuais) e
  `broadcastToActive` (PERIOD_OPENED/CLOSED via `createMany`, **fora** de
  `createNotification`).
- Períodos derivados por data (`period-state.ts`); `getCurrentOpenPeriod(now)` retorna
  o período `OPEN` com `startsAt ≤ now ≤ endsAt`. Unicidade `@@unique([voterId, periodId])`.

## Objetivo

1. **Espelhar toda notificação in-app no Teams** (para quem tem `teamsWebhookUrl`),
   reaproveitando o canal de webhook já existente.
2. **Lembretes de votação**: notificar (in-app + Teams) o usuário que ainda não votou,
   no **ponto médio** da janela de votação e na **última hora** antes do encerramento.

## Decisões

- Escopo do espelhamento: **todas** as notificações (Teams vira espelho fiel do sino).
- Lembretes: **1 por usuário que não votou**, nos dois marcos (médio e última hora),
  idempotentes. Seguem o padrão do nudge de streak: **excluem ADMIN**, apenas ativos.

## 1. Espelhamento de notificações no Teams

### `lib/teams-client.ts`
- Extrair `postTeamsCard(url, card)`: o POST genérico (timeout 5s, best-effort, log de
  erro). `postTeamsNudge` passa a usá-lo internamente (comportamento inalterado).
- Adicionar `buildNotificationCard({ title, ctaUrl, ctaLabel })`: Adaptive Card genérico
  com o texto do `title` e um botão `Action.OpenUrl` apontando para `ctaUrl`.
- Adicionar `postTeamsNotification(url, { title, ctaUrl, ctaLabel })` que monta e posta o
  card genérico.
- Helper `absoluteUrl(link)`: converte o `link` relativo da notificação (ex.
  `/perfil/x`) em URL absoluta usando `APP_BASE_URL` (mesmo default de `nudges.ts`,
  `https://legends.eumedicoresidente.com.br`). Se `link` for nulo, usa a base.

### `services/notification-service.ts`
- **Individuais** (`createNotification`): após gravar a notificação, buscar
  `teamsWebhookUrl` + `name` do `userId`; se houver URL, chamar `postTeamsNotification`
  com `ctaUrl = absoluteUrl(link)`, `ctaLabel = 'Abrir no Legends'`. Envolto em try/catch
  com log — **nunca** derruba a criação da notificação (best-effort).
- **Broadcast** (`broadcastToActive`): o `findMany` de usuários ativos passa a
  selecionar também `teamsWebhookUrl`. Após o `createMany`, iterar os usuários com URL e
  postar o card (best-effort por usuário). O `link` de broadcast é a base do app.

> Mirroring é sempre best-effort: uma falha de rede/Teams não pode abortar a request
> nem o tick do scheduler.

## 2. Lembretes de votação

### `scheduler/vote-reminders.ts` (novo)
`runVoteReminderTick(now)`, com `now` injetável (testável sem timers):

1. `period = getCurrentOpenPeriod(now)`; se `null`, retorna.
2. `midpoint = startsAt + (endsAt − startsAt) / 2`; `closingStart = endsAt − 1h`.
3. Marco do tick:
   - **MIDWAY**: `now ≥ midpoint` **e** `now < closingStart`.
   - **CLOSING**: `now ≥ closingStart` **e** `now < endsAt`.
   - Senão: retorna (nada a fazer neste tick).
4. Carregar usuários ativos não-ADMIN. Para cada um:
   - Se já votou no período (`vote` com `voterId`+`periodId`): pula.
   - Idempotência: se já existe notificação do tipo do marco para esse usuário com
     `createdAt ≥ period.startsAt`: pula. (Só há um período ativo por vez, então o
     corte por `startsAt` isola o período sem consultar JSON.)
   - `createNotification(...)` do tipo do marco → o mirroring do item 1 cuida do Teams.

### Wiring do scheduler
O `setInterval` horário (em `nudges.ts` / ponto de partida do scheduler) passa a chamar
**ambos** os ticks (`runNudgeTick` e `runVoteReminderTick`), cada um com seu try/catch.
Não inicia em `NODE_ENV === 'test'`.

## 3. Contrato e tipos

- **Prisma**: adicionar `VOTE_REMINDER_MIDWAY` e `VOTE_REMINDER_CLOSING` ao enum
  `NotificationType`. Gerar **nova** migration (`pnpm db:migrate`) — não editar migrations
  aplicadas.
- **`packages/shared/src/notification.ts`**: incluir os dois novos tipos na união/labels.
- **Front (`apps/web`)**: `NotificationsPage`/`NotificationBell` já caem no ícone padrão
  `how_to_vote` para tipos não mapeados, cobrindo os lembretes sem mudança obrigatória.

### Mensagens (pt-BR)
- **MIDWAY**: `"A votação de <mês> está na metade e você ainda não votou. Reconheça um colega!"`
- **CLOSING**: `"Última hora pra votar em <mês> — não deixe pra depois!"`
- `<mês>` via `monthLabel(period.monthRef)` (já usado no notification-service).
- **Link** dos lembretes: `/` (home/tela de votação).

## 4. Testes (Vitest, colocados ao lado do código)

- **`teams-client`**: `buildNotificationCard` monta título + botão corretamente;
  `postTeamsCard` é best-effort (não lança em erro de rede — mock do `fetch`).
- **`notification-service`**: com `teamsWebhookUrl` presente, o post ao Teams é chamado;
  ausente, não é (mock do `postTeamsNotification`). Falha no Teams não impede a gravação.
- **`vote-reminders`**: injetando `now`, dispara MIDWAY no ponto médio e CLOSING na
  última hora; pula quem já votou; idempotente (segundo tick no mesmo marco não duplica);
  exclui ADMIN; sem período ativo é no-op.

## Fora de escopo

- Não há job que abre/fecha período automaticamente — segue por data, como hoje.
- Sem mudança no formato visual do card de streak existente.
- Sem novo ícone dedicado no front para os lembretes (usa o padrão `how_to_vote`).
