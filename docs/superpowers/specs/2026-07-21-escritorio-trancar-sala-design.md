# Trancar sala de reunião — design

**Data:** 2026-07-21
**Slug:** `escritorio-trancar-sala`
**Branch:** `feat/escritorio-trancar-sala`

## Problema

Qualquer pessoa entra em qualquer sala de reunião do escritório virtual. Já existe um
bloqueio de sala, mas é **administrativo e persistido** (`Room.status = 'LOCKED'`,
ligado no editor de mapas / admin, avaliado em `OfficeHub.canEnterRoom`): serve para
fechar uma sala institucionalmente, não para uma conversa em andamento não ser
interrompida.

Além disso, quem esbarrava numa sala bloqueada recebia só um `sync` silencioso — o
personagem voltava um tile e nada explicava o porquê.

## Solução

Um **cadeado efêmero, de sessão**, na barra de ferramentas (centro-inferior), visível
enquanto a pessoa está dentro de uma sala de reunião.

- Com a sala trancada, quem está fora não entra. Ao esbarrar, vê um popup com o nome da
  sala e duas opções: **Cancelar** e **Pedir para entrar**.
- O pedido chega a **todos que estão na sala** como um modal com foto e nome de quem
  pediu, com **Aceitar** / **Recusar**, acompanhado de um aviso sonoro próprio (três
  batidas graves, "toc-toc-toc" — deliberadamente diferente do bipe agudo de chamada).
- Quem pediu recebe a resposta: aceito, o servidor concede um passe e o personagem
  **caminha sozinho** até o tile onde tinha sido barrado; recusado (ou sem resposta em
  30s), um aviso.

### Decisões

| Decisão | Por quê |
| --- | --- |
| Estado **efêmero**, na memória do `OfficeHub` | Mesmo padrão de confete, mão levantada e presença de edição. Não toca o Postgres e não conflita com o `Room.status` do admin, que continua sendo bloqueio absoluto — e sem "pedir para entrar", porque não há a quem pedir. |
| A tranca é **da sala**, não de quem trancou | Numa reunião de várias pessoas, qualquer uma pode liberar alguém; o primeiro que responder resolve para todos (`knock-cleared`). Evita a sala ficar refém de uma pessoa distraída. |
| Sair **não** destranca; a sala esvaziar sim | A chave fica com quem ficou. Mas sem ninguém dentro não há quem responda aos pedidos: a sala viraria uma porta fechada para sempre. |
| O passe vale enquanto a tranca durar | Quem foi aceito pode sair e voltar sem bater na porta de novo. Destrancar (ou esvaziar) revoga tudo. |
| Timeout do pedido no **cliente** | Mesmo desenho do popup de chamada recebida (`CALL_TIMEOUT_MS`); mantém o hub sem timers por pedido. |

## Contrato (`packages/shared/src/office.ts`)

Cliente → servidor:

- `set-room-lock { locked }` — age sobre a sala da posição atual do remetente (o cliente
  não manda `roomId`, como em `room-chat-message`).
- `knock { roomId, active }` — pede/desiste. Aqui o `roomId` vem do cliente porque quem
  pede está fora da sala.
- `knock-response { userId, accepted }`.

Servidor → cliente:

- `room-lock-changed { roomId, locked, byUserId }` — broadcast; `byUserId: null` quando
  destrancou por sala vazia.
- `room-entry-denied { roomId, roomName, reason, x, y }` — só para quem foi barrado,
  junto do `sync`. `reason` ∈ `locked | admin-locked | capacity | allowlist`; só
  `locked` oferece "pedir para entrar", o resto vira toast. `x`/`y` é o tile recusado,
  usado como destino da caminhada automática no aceite.
- `knock-request { roomId, userId, name }` — só para quem está na sala.
- `knock-cleared { roomId, userId }` — pedido encerrado por qualquer motivo; vai para a
  sala (fecha os modais) e para quem pediu (destrava o "aguardando").
- `knock-result { roomId, accepted, byUserId, byName }` — só para quem pediu.
- `welcome.lockedRoomIds` — snapshot para quem entra/reconecta.

## Servidor (`apps/api/src/lib/office-hub.ts`)

Estado novo: `lockedRooms`, `roomEntryGrants`, `pendingKnocks` (+ índice reverso
`knockRoomOf`), `lastKnockAt`, `lastEntryDeniedAt`.

`canEnterRoom` virou `roomEntryDenial`, que devolve o **motivo** (ou `null`) — é o que
permite ao `move` explicar a recusa. `move` emite `room-entry-denied` junto do `sync`,
com throttle por usuário (`ENTRY_DENIED_THROTTLE_MS = 1500`): uma tecla presa contra a
porta gera uma recusa por passo, até 20/s.

`clearKnock` é o único ponto que mexe na fila de pedidos (mesmo desenho de
`removeFromRaisedHandQueue`); todo caller passa por ele — aceite, recusa, cancelamento,
entrada na sala, saída do escritório e destrancar.

## Cliente

- `office/media/useRoomLock.ts` — lado de **dentro**: estado do cadeado e fila de
  pedidos, filtrados pelo `roomId` atual (modelado em `useRaisedHands`). Toca
  `playKnockBeep()` a cada pedido novo.
- `office/useOfficeInteractions.ts` — lado de **fora**: `entryDenied`, `knockToEnter`,
  `cancelEntryRequest`, timeout de 30s e a caminhada automática via `walkToTile`.
- `office/media/RoomLockedPopup.tsx` e `office/media/KnockRequestModal.tsx` — mesmo
  vocabulário visual do `IncomingCallPopup`.
- `MediaBar` ganha o botão de cadeado (`lock`/`lock_open`), do lado do de levantar a mão.

## Fora de escopo

- Indicação visual de sala trancada no mapa (Phaser).
- Popups no PiP (`OfficePipWindow` não renderiza nem o de chamada hoje).
- Trancar zona privada ("espaço de conversa"): a tranca depende de um `Room` de verdade,
  que é o que o servidor usa para decidir quem entra.
