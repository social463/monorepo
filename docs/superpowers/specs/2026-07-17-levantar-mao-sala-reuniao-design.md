# Levantar a mão (sala de reunião) — design

Data: 2026-07-17
Branch: `feat/levantar-mao-sala-reuniao`

## Objetivo

Dentro de uma sala de reunião do escritório virtual, adicionar um botão "levantar a mão"
na caixa de ferramentas (barra inferior). Quem levanta entra numa fila FIFO por sala;
um contador no topo da tela mostra quantas mãos estão levantadas e, ao clicar, expande a
lista na ordem de quem levantou. A mão abaixa automaticamente quando a pessoa começa a
falar, ou manualmente clicando o botão de novo. Som ao levantar, seguindo o padrão de
sinais sonoros já existente no escritório.

## Contexto

- **Sala de reunião** já é um conceito de primeira classe: `OfficeHub.roomForPosition(x, y)`
  (`apps/api/src/lib/office-hub.ts:149`) resolve a zona do tilemap (`mapZoneAt`) para uma
  `room` com `id`/`externalKey`; `broadcastToRoom(roomId, msg)` (linha 494) entrega uma
  mensagem só a quem está fisicamente naquela sala **agora**. `move()` (linha 161) já
  detecta transição de sala (`previousRoom`/`nextRoom`) a cada passo — é o ponto usado
  pelo chat de sala e pelos sinais sonoros de entrar/sair (`room-presence`).
- **Detecção de fala** já existe e é 100% local ao cliente: LiveKit `ActiveSpeakersChanged`
  chega via `useOfficeMedia` como `media.localSpeaking` (consumida hoje pelo anel visual
  de "falando" e pelo estilo `mic-speaking` do botão de mic em `MediaBar.tsx:316`). Não
  passa pelo servidor — cada cliente só sabe da própria fala e da dos remotos que já
  assina via LiveKit.
- **Sons sintetizados**: `apps/web/src/lib/beep.ts` é o módulo canônico de bipes via Web
  Audio (osciladores, sem asset binário) usado pelos sinais do escritório — `playCallBeep`,
  `playEnterBeep`, `playLeaveBeep`. Consumido em `useOfficeInteractions.ts` no switch de
  `bridge.onServerMessage` (linha 245), que já tem `case 'room-presence'` tocando
  enter/leave conforme `kind` — é o mesmo lugar onde plugar o som de mão levantada.
- **Mensagens room-scoped não passam pelo `OfficeBridge`**: diferente do confete
  (`confettiActiveIds`, espelhado no bridge para replay em quem assina tarde — ver
  `OfficeBridge.ts:58`), `room-chat-message` e `room-presence` fluem direto do
  `onServerMessage` genérico, sem estado espelhado no bridge. O chat de sala tem seu
  **próprio hook dedicado**, `useRoomChat` (`apps/web/src/office/media/useRoomChat.ts`):
  recebe `(bridge, roomId, sender, connected)`, mantém `messages` local, zera ao trocar
  de `roomId` (`useEffect(() => setMessages([]), [roomId])`) e filtra mensagens do
  `onServerMessage` por `message.roomId === roomIdRef.current`. Esse hook é instanciado
  uma vez em `OfficeSessionContext.tsx` (não em `useOfficeInteractions.ts`), usando
  `currentRoom?.id` derivado de `mapZoneAt` + `activeMap.rooms` — e exposto via
  `OfficeSessionValue.roomChat`. A fila de mãos levantadas segue **exatamente esse
  padrão** (hook dedicado `useRaisedHands`, mesmo ciclo de vida), não
  `useOfficeInteractions.ts` como um rascunho inicial deste design cogitou. Única
  diferença: o chat nunca implementou replay ao entrar (efêmero mesmo); a fila de mãos
  **precisa** desse snapshot, porque é estado persistente, não um evento de balão.
- **Toolbox / barra inferior**: `MediaBar.tsx`, montada em `OfficePage.tsx:381-403`. O
  bloco de botões condicionados à sala (`showRoomControls`, linhas 384-407) hoje só
  aparece com `camerasExpanded && inMeetingRoom` (grade de câmeras aberta) — não serve
  para o botão de mão, que precisa estar disponível sempre que `inMeetingRoom`, goste ou
  não da grade expandida.

## Abordagem

Mensagem autoritativa do servidor, fila mantida no `OfficeHub` por `roomId`, entregue via
`broadcastToRoom` — mesmo padrão do chat/sinais de sala. Alternativa descartada: o cliente
inferir a fila localmente a partir de eventos brutos — duplicaria lógica de sala já
centralizada no hub e quebraria com múltiplas abas/reconexão.

### Contrato — `packages/shared/src/office.ts`

Cliente → servidor, junto dos outros `OfficeClientMessage`:

```ts
/** Levantar (true) ou abaixar (false) a própria mão — fila FIFO por sala de reunião. */
| { type: "raise-hand"; active: boolean }
```

Servidor → cliente, junto dos outros `OfficeServerMessage`:

```ts
/**
 * Fila de mãos levantadas da sala — só chega a quem está na MESMA sala (mais o
 * próprio ao sair andando, para zerar a fila do lado dele). `queue` é sempre o
 * snapshot completo, na ordem de quem levantou primeiro. `event` ausente = sync
 * (ex.: snapshot para quem acabou de entrar na sala) — não deve tocar som;
 * presente = mudança real (alguém levantou ou abaixou agora).
 */
| { type: "raised-hands"; roomId: string; queue: string[]; event?: { kind: "raised" | "lowered"; userId: string } }
```

### Servidor — `apps/api/src/lib/office-hub.ts`

Novo estado, ao lado do `confettiActive`:

```ts
/** Fila de mãos levantadas por sala (FIFO). Só existe entrada enquanto a fila não está vazia. */
private raisedHandsByRoom = new Map<string, string[]>()
/** Índice reverso: em qual sala (se houver) o usuário está com a mão levantada. */
private raisedHandRoomOf = new Map<string, string>()
```

Helper privado, único ponto que mexe nos dois maps:

```ts
/** Remove userId da fila em que estiver; devolve sala+fila atualizada, ou null se não estava em nenhuma. */
private removeFromRaisedHandQueue(userId: string): { roomId: string; queue: string[] } | null
```

`raiseHand(socket, userId, active)` — API pública, espelha `confetti()`:
- Valida dono do socket (`socketOwner`) e que o usuário está no escritório (`entries`).
- `active === false`: `removeFromRaisedHandQueue`; no-op se não estava em fila alguma;
  senão `broadcastToRoom(roomId, {type:'raised-hands', roomId, queue, event:{kind:'lowered', userId}})`
  — alcança o próprio remetente automaticamente, pois ele ainda está fisicamente na sala.
- `active === true`: no-op se já está em alguma fila (`raisedHandRoomOf.has`); no-op se a
  posição atual não é sala de reunião (`roomForPosition` null); senão empilha no fim da
  fila da sala e `broadcastToRoom(..., event:{kind:'raised', userId})`.

Integração em `move()`:
- Ramo de **entrar** em `nextRoom` (já existe): se a fila da sala não estiver vazia, manda
  um snapshot só para quem chegou — `sendTo(socket, {type:'raised-hands', roomId, queue})`
  (sem `event`, não toca som).
- Ramo de **sair** de `previousRoom` (já existe, mesmo bloco do `room-presence leave`):
  `removeFromRaisedHandQueue(userId)`; se removeu algo, manda a atualização tanto pro
  próprio (`sendTo`, ele já não está mais na sala pro `broadcastToRoom` alcançar) quanto
  pro resto da sala (`broadcastToRoom`) — exatamente o mesmo par `sendTo`+`broadcastToRoom`
  já usado ali para `room-presence`.

Integração em `leave()` (desconexão, último socket do usuário fechando): mesmo
`removeFromRaisedHandQueue` + `broadcastToRoom` (sem `sendTo`, o socket já se foi) — no
mesmo ponto onde hoje limpa `previousRoom`/`room-presence leave`.

`configure()` (troca de mapa) e `reset()` (helper de teste): `raisedHandsByRoom.clear()` +
`raisedHandRoomOf.clear()`, junto da limpeza do confete.

### Rota WS — `apps/api/src/routes/office-ws.ts`

Novo `else if` no dispatch de mensagens, ao lado do de `confetti`:

```ts
else if (msg.type === 'raise-hand' && typeof msg.active === 'boolean') {
  officeHub.raiseHand(ws, user.id, msg.active)
}
```

### Cliente — hook dedicado `useRaisedHands` (`apps/web/src/office/media/useRaisedHands.ts`)

Mesmo formato de `useRoomChat`: `useRaisedHands(bridge, roomId, youId, connected,
localSpeaking)`, devolvendo `{ queue, raised, canRaise, toggle }`.

- `queue: string[]` — estado local, zerado a cada troca de `roomId` (`useEffect(() =>
  setQueue([]), [roomId])`), sempre substituído pelo snapshot completo que chega em
  `raised-hands` filtrado por `message.roomId === roomIdRef.current`.
- Toca `playRaiseHandBeep()` só quando a mensagem recebida tem `event?.kind === 'raised'`
  (nunca no snapshot puro).
- `raised = youId !== null && queue.includes(youId)`.
- `toggle()` manda `bridge.emitClientMessage({type:'raise-hand', active: !raised})`; no-op
  sem sala/identificação/conexão.
- **Abaixar automaticamente ao falar**: efeito interno que reage à *borda de subida* de
  `localSpeaking` (guardada num `ref` — só quando passa de `false`→`true`, não enquanto
  já se está falando) e, se `raised` nesse instante, dispara
  `bridge.emitClientMessage({type:'raise-hand', active:false})`. Levantar a mão no meio
  de uma fala que já estava rolando não derruba ela na hora — só o *início* de uma nova
  fala com a mão já levantada.

Instanciado uma vez em `OfficeSessionContext.tsx`, ao lado de `useRoomChat`, usando o
mesmo `currentRoom?.id`; exposto como `OfficeSessionValue.raisedHands`. `OfficePage.tsx`
consome via `useOfficeSession().raisedHands` — sem tocar `useOfficeInteractions.ts`.

### Cliente — som (`apps/web/src/lib/beep.ts`)

Novo `playRaiseHandBeep()`, seguindo a mesma receita de `playTones` — um único tom curto,
médio-agudo (ex. 740 Hz), ganho `~0.15` (mesma faixa de `playEnterBeep`/`playLeaveBeep`,
mais discreto que o de chamada).

### Cliente — UI

**Botão na `MediaBar.tsx`**: novo botão fora do bloco `showRoomControls` (que depende de
`camerasExpanded`), condicionado só a um novo prop `canRaiseHand` (= `inMeetingRoom`,
passado de `OfficePage.tsx` independente da grade de câmeras estar aberta). Ícone
Material Symbols `back_hand` (mesmo padrão `Icon` já usado em todo o arquivo), estado
ativo via `toolButtonCls(raised)` quando o próprio usuário está na fila. Prop nova
`raised: boolean` + `onToggleRaiseHand?: () => void`.

**Contador/lista no topo (`OfficePage.tsx`)**: novo componente
`apps/web/src/office/media/RaiseHandQueue.tsx`, renderizado como mais um overlay
absolutamente posicionado (mesmo padrão do botão de grade em `OfficePage.tsx:342-355`, mas
centralizado no topo para não colidir com ele nem com o botão da sidebar de pessoas em
`top-3 left-3`), visível só quando `inMeetingRoom && raisedHands.queue.length > 0` (o
componente já retorna `null` com fila vazia; a página também condiciona a
`inMeetingRoom`). Pill com ícone + número; ao clicar, expande uma lista (mesmo estilo
visual de `RoomPeoplePanel.tsx` — avatar + nome por linha) na ordem da fila, com posição
numerada — nomes/avatares resolvidos de `occupants` (já disponível em `OfficePage.tsx`)
por `userId`.

## Testes

- `apps/api/src/lib/office-hub.test.ts`: levantar dentro de sala emite `raised-hands` com
  a fila correta para quem está na sala (e só para eles); levantar fora de sala de
  reunião é no-op; levantar duas vezes seguidas (mesmo usuário) é no-op; abaixar
  manualmente remove da fila e mantém ordem dos demais; sair andando da sala abaixa a mão
  automaticamente e notifica quem ficou + o próprio; desconectar com mão levantada limpa a
  fila; entrar numa sala com fila não-vazia entrega snapshot sem `event`; troca de mapa
  limpa o estado.
- `apps/api/src/routes/office-ws.test.ts`: despacha `raise-hand` pro hub com os
  parâmetros certos; mensagem malformada não derruba a conexão (mesmo par de testes do
  `confetti`).
- `apps/web/src/lib/beep.test.ts`: novo teste para `playRaiseHandBeep` (agenda tom único).
- `apps/web/src/office/media/useRaisedHands.test.ts` (novo, mesmo molde de
  `useRoomChat.test.ts`): acumula a fila da sala atual e ignora outras salas; zera ao
  trocar de sala; `toggle()` levanta/abaixa conforme estado atual; `event.kind==='raised'`
  toca o som, snapshot sem `event` não toca; abaixa sozinho na borda de subida de
  `localSpeaking` com a mão levantada; não abaixa se já estava falando antes de levantar;
  `canRaise` exige sala + identificação + conexão.
- `apps/web/src/office/media/MediaBar.test.tsx`: botão de mão só aparece com
  `canRaiseHand`; reflete estado ativo/inativo (label e `aria-pressed`); dispara
  `onToggleRaiseHand`.
- `apps/web/src/office/session/OfficeSessionContext.test.tsx`: mock de `useRaisedHands`
  registrado (mesmo padrão do mock de `useRoomChat`), garantindo que o provider não
  quebra com o novo hook.
- `apps/web/src/pages/OfficePage.test.tsx`: botão de levantar a mão só aparece dentro de
  sala de reunião e chama `raisedHands.toggle`; contador só aparece com fila não-vazia;
  clicar no contador expande a lista com nome de cada pessoa na ordem da fila.

## Fora de escopo

- Indicador visual no personagem dentro do Phaser (ex. balãozinho de mão sobre a cabeça)
  — só o botão/contador/lista em DOM, como pedido.
- Papel de moderador (abaixar a mão de outra pessoa, "chamar o próximo da fila",
  reordenar) — não existe conceito de moderador de sala hoje; fora de escopo.
- Persistência da fila entre reconexões do processo do servidor (mesma decisão de design
  já vale para presença/confete: tudo em memória, reinicia zerado).
