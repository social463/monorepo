# Notificações e convites no Escritório — design

## Contexto

O Legends já tem um sistema de notificações completo (model `Notification`,
`apps/api/prisma/schema.prisma:409-425`; serviço
`apps/api/src/services/notification-service.ts`; rotas REST em
`apps/api/src/routes/notifications.ts`) com um sino (`NotificationBell.tsx`)
e uma página de listagem (`NotificationsPage.tsx`), ambos alimentados por
polling REST a cada 45s (`useUnreadCount`, `apps/web/src/lib/use-notifications.ts:6-11`)
— não existe WebSocket/SSE genérico para notificações.

Esse sino só é renderizado dentro de `AppLayout` (`apps/web/src/components/AppLayout.tsx:244`),
que envolve as rotas "normais" do produto. A rota `/escritorio`
(`OfficeRoute`, `apps/web/src/App.tsx:111-134`) fica fora desse layout — hoje
quem está no Escritório não vê nenhuma notificação, nem o sino nem qualquer
outro indício.

Convites já existem no backend: `notifyRetroInvited`
(`notification-service.ts:280-297`) cria uma notificação `RETRO_INVITED` com
`link: /retrospectivas/${roomId}` quando alguém é adicionado a uma sala de
retro. `notifyPeriodOpened` (linhas 272-274) cria `PERIOD_OPENED` para todos
os usuários ativos quando um admin abre o período de votação (hoje sem
`link`, fica `null`). `runVoteReminderTick`
(`apps/api/src/scheduler/vote-reminders.ts:34-75`) cria
`VOTE_REMINDER_MIDWAY`/`VOTE_REMINDER_CLOSING` (hoje com `link: '/'`) por
cron, pra quem ainda não votou no período aberto. Nenhum desses chega como
toast — só aparecem se a pessoa abrir o sino ou a página de notificações.

O Escritório já tem seu próprio sistema de toast, mas é local e
não-clicável: `useOfficeInteractions.ts` (`toast: string | null`,
`showToast`) renderiza uma única mensagem, embaixo/centralizada,
`pointer-events-none`, auto-dismiss fixo em 4s — usado para erros de mesa,
resultado de chamada, etc. Não serve pro caso de convite (precisa ser
clicável, redirecionar, e conviver com várias mensagens ao mesmo tempo).

## Objetivo

1. Mostrar o sino de notificações (existente) dentro da tela do Escritório,
   no canto superior direito, pros usuários autenticados (não-convidados)
   verem notificações normalmente enquanto estão conectados lá.
2. Quando o usuário tem um convite não-lido pra uma retrospectiva ou pra
   votar no Destaque do Mês — e essa atividade ainda está aberta — mostrar
   um toast dedicado no canto superior direito, clicável, que leva direto
   pra área correta (board da retro ou `/votar`).

Fora de escopo: WebSocket/tempo real pra notificações genéricas (mantém o
polling de 45s já existente); toast de convite fora do Escritório (só
dentro da tela `/escritorio`); qualquer notificação que não seja convite de
retro/votação (as demais continuam só no sino).

## Mudanças

### 1. Sino de notificações no Escritório

Reaproveitar `NotificationBell` (`apps/web/src/components/NotificationBell.tsx`)
sem alterações — os tokens de design usados (`surface-container`,
`on-surface`, `primary` etc.) já funcionam no tema escuro do Escritório.
Montar dentro de `OfficePage.tsx`, no wrapper existente
`<div className="absolute top-3 right-3 z-10 flex items-center gap-2">`
(linha 405), junto dos botões "Editar mapa"/grade — condicionado a
`!isGuest`, mesmo padrão já usado pelo botão "Editar mapa" na mesma linha.

### 2. Polling de notificações não-lidas (reaproveitável)

Novo hook em `apps/web/src/lib/use-notifications.ts`:
```ts
export function useUnreadNotificationsPoll() {
  return useQuery({
    queryKey: ['notifications', 'unread-list'],
    queryFn: () => apiFetch<NotificationListResponse>('/notifications?limit=20&read=false'),
    refetchInterval: 45_000,
  })
}
```
Não mexe em `useNotifications`/`useUnreadCount` existentes (usados pelo
sino/dropdown/página) — é uma query nova, cacheada separadamente.

### 3. Hook de convites do Escritório

Novo arquivo `apps/web/src/office/notifications/useOfficeInviteToasts.ts`.
Consome `useUnreadNotificationsPoll()`. A cada resposta:

- Filtra por `type` em `['RETRO_INVITED', 'PERIOD_OPENED', 'VOTE_REMINDER_MIDWAY', 'VOTE_REMINDER_CLOSING']`.
- Ignora qualquer `id` já em um `Set` de "vistos nesta sessão" (estado do
  hook, não persiste — reseta a cada entrada no Escritório).
- Para cada candidato novo, checa se a atividade ainda está aberta:
  - `RETRO_INVITED`: extrai o id do `link` (`/retrospectivas/${id}`) e busca
    `GET /retro/rooms/:id` (via React Query, cacheado por id); aberta se
    `room.status === 'OPEN'`.
  - `PERIOD_OPENED` / `VOTE_REMINDER_MIDWAY` / `VOTE_REMINDER_CLOSING`:
    reaproveita `useCurrentPeriod()` (`apps/web/src/lib/use-current-period.ts`)
    — aberta se `votingOpen` for `true`.
- Candidatos abertos entram numa fila de exibição (array de
  `{ id, type, title, link, shownAt }`). Assim que um item é
  clicado/dispensado/expira, sai da fila e entra no Set de "vistos" — não
  reaparece de novo na mesma sessão do Escritório, mesmo que a próxima
  chamada de polling ainda o traga como não-lido.
- Se a checagem "ainda aberta" falhar (404/403/erro de rede), o candidato é
  descartado silenciosamente — sem toast, sem popup de erro. Continua
  visível no sino normalmente.

### 4. Componente de exibição

Novo arquivo `apps/web/src/office/notifications/InviteToastStack.tsx`.
Recebe a fila do hook acima. Renderiza empilhado, abaixo do sino (canto
superior direito, ex. `absolute top-16 right-3 z-30`, ajustado durante a
implementação pra não colidir com o `CharacterCard` que já usa
`right-3 top-3 z-30` quando um personagem está selecionado). Cada item:

- Mostra o `title` da notificação (já com redação coerente por tipo, ex.
  `"Você foi convidado para a retrospectiva \"Sprint 12\""`,
  `"A votação de Julho está aberta!"`) mais um rótulo fixo de
  call-to-action — "Clique para participar" pra `RETRO_INVITED`, "Clique
  para votar" pros 3 tipos de votação.
- O card inteiro é um `<Link to={item.link}>` que, ao clicar, também marca a
  notificação como lida via `useMarkRead` (hook já existente,
  `use-notifications.ts:47-54`).
- Um botão X dispensa sem marcar como lida (só sai da fila/entra no "visto"
  desta sessão).
- Auto-dismiss em ~10s (mesmo efeito do X — sai da fila sem marcar como
  lida).

### 5. Corrigir o link das notificações de votação

Hoje `PERIOD_OPENED` salva `link: null`
(`notification-service.ts:272-274`, via `broadcastToActive`'s default) e os
lembretes de voto salvam `link: '/'` (`vote-reminders.ts:70`) — nenhum leva
pra área de votação. Trocar os dois pra `link: '/votar'`. Efeito colateral
positivo: conserta também o clique nessas notificações no sino/página fora
do Escritório (hoje não levam a lugar nenhum útil).

## Testes

- `useOfficeInviteToasts.test.ts`: filtra corretamente os 4 tipos-alvo
  (ignora outros tipos); ignora candidato já "visto"; checagem "ainda
  aberta" via mock (retro fechada → não entra na fila; retro aberta →
  entra; votação aberta/fechada via mock de `useCurrentPeriod`); falha na
  checagem → descarta silenciosamente.
- `InviteToastStack.test.tsx`: renderiza a fila; clique navega + chama
  `useMarkRead`; X remove sem chamar `useMarkRead`; timer de ~10s remove
  sozinho (fake timers).
- Testes existentes de `notification-service.test.ts`/`vote-reminders.test.ts`
  ajustados pra asserir `link: '/votar'` ao invés de `null`/`'/'`.
- `OfficePage.test.tsx`: sino aparece pra usuário autenticado, some pra
  guest (`isGuest`).
