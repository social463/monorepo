# Grade da sala estilo Meet: painel lateral (chat/pessoas) + MediaBar acessível

## Problema

A grade expandida de câmeras (`MediaTiles`, modo `expanded`) hoje é só a
área central de vídeos (destaque + miniaturas, ou grid uniforme) num
overlay `fixed inset-0 z-50` via portal. Nada mais convive com ela: a
`MediaBar` (mic/câmera/tela/reações/sair) fica num container `z-10`,
**coberta** pelo overlay `z-50` da grade — hoje, dentro da grade, só dá pra
fechá-la (Esc ou botão "Recolher câmeras"), sem acesso a nenhum controle
de mídia.

Queremos aproximar a experiência da grade da referência do Google Meet:
câmeras no centro, painel lateral direito alternando entre chat e lista de
pessoas da sala, e a barra de ferramentas (mic/câmera/etc., já existente)
acessível por cima, com dois botões novos pra abrir cada painel.

## Comportamento desejado

- **MediaBar fica visível por cima da grade expandida** (hoje escondida
  atrás) — os controles de mídia continuam funcionando normalmente com a
  grade aberta.
- **Dois botões novos na MediaBar**, visíveis **somente quando a grade
  está expandida** (`camerasExpanded`): um abre/fecha o **chat da sala**,
  outro abre/fecha a **lista de pessoas da sala**. Fora da grade, a
  MediaBar continua exatamente como hoje.
- **Painel lateral direito, mutuamente exclusivo**: só chat OU só lista de
  pessoas por vez (nunca os dois). Abrir um fecha o outro automaticamente
  se estiver aberto. Sem nenhum painel aberto, a área de câmeras ocupa a
  largura toda.
- **Área de câmeras (central)** continua com a mesma lógica de hoje
  (destaque + miniaturas, ou grid uniforme) — só passa a ocupar o espaço
  restante (`flex-1`) ao lado do painel lateral, em vez da tela toda.
- **A grade nunca ultrapassa os limites do dispositivo**: o overlay
  continua fixo à viewport (`fixed inset-0`), mas o scroll deixa de ser da
  página inteira — cada área (câmeras, chat, lista) rola só o próprio
  conteúdo internamente, sem nunca fazer o container geral crescer além da
  tela.
- **Chat da sala**:
  - Mensagens de texto simples (sem anexo, menção ou emoji dentro do chat
    nesta primeira versão).
  - **Não persiste em banco nem no servidor.** Cada navegador guarda em
    memória somente as mensagens recebidas durante a permanência atual.
  - Quem já está na sala vê as mensagens em tempo real. Quem entra depois
    não recebe conversa anterior.
  - Sair ou trocar de sala apaga o histórico local. Reentrar sempre começa
    do zero, mesmo que outras pessoas tenham permanecido na sala.
- **Lista de pessoas da sala**: lista simples (avatar + nome) de quem está
  na MESMA sala/zona agora — sem ações (chamar/seguir/ver perfil). Isso é
  diferente da sidebar geral do escritório (que lista todo mundo online,
  escritório inteiro, com ações).
- Fechar a grade (Esc ou botão) fecha também qualquer painel lateral
  aberto — reabrir a grade nasce sem painel, igual ao comportamento já
  existente do destaque (`featuredPin` reseta a cada abertura).

## Abordagem

### Frontend — layout da grade (`MediaTiles.tsx`)

O overlay perde `overflow-y-auto` da raiz (que hoje deixa a página
inteira rolar) e vira um container flex vertical sem overflow próprio:

```
fixed inset-0 z-50 bg-black/90 flex flex-col overflow-hidden
```

Dentro dele, uma linha `flex flex-1 min-h-0` com dois filhos:

- **Área central** (`flex-1 min-w-0 overflow-y-auto p-lg`): o mesmo
  conteúdo de hoje (destaque + miniaturas, ou grid uniforme via
  `buildTiles`/`resolveFeatured`), sem nenhuma mudança de lógica — só o
  container pai que muda (antes ocupava a tela toda, agora ocupa o espaço
  ao lado do painel).
- **Painel lateral** (renderizado só quando há um painel ativo): largura
  fixa (`w-[360px] shrink-0`), borda esquerda, fundo levemente diferente do
  preto do overlay, `overflow-y-auto` próprio. Dentro dele, ou
  `RoomChatPanel` ou `RoomPeoplePanel`, conforme o painel ativo.

`MediaTiles` ganha props novas pra receber o estado do painel de fora
(controlado por `OfficePage`, já que os botões de abrir/fechar moram na
`MediaBar`, fora da própria `MediaTiles`):

```ts
roomPanel: 'chat' | 'people' | null
roomChatMessages: RoomChatMessage[]
onSendRoomChatMessage: (text: string) => void
roomOccupants: OfficeOccupant[] // já filtrados pra sala atual
```

O botão "Recolher câmeras" (topo direito) e o comportamento de
Esc/auto-recolhimento/destaque continuam idênticos.

### Frontend — novos componentes de painel

- **`RoomChatPanel`** (`apps/web/src/office/media/RoomChatPanel.tsx`):
  header ("Chat da sala" + botão fechar), lista de mensagens (nome do
  remetente + texto, mais recente embaixo, scroll automático pra última
  mensagem), formulário de envio (input + botão enviar). Sem histórico ao
  abrir? Não — o histórico já vem via `roomChatMessages` (prop, populado
  pelo hook descrito abaixo).
- **`RoomPeoplePanel`** (`apps/web/src/office/media/RoomPeoplePanel.tsx`):
  header ("Pessoas na sala (N)" + botão fechar), lista simples (avatar +
  nome) de `roomOccupants`, sem ações nem busca.

### Frontend — `MediaBar.tsx`

Novos props opcionais:

```ts
showRoomControls?: boolean // = camerasExpanded, calculado em OfficePage
roomPanel?: 'chat' | 'people' | null
onToggleRoomChat?: () => void
onToggleRoomPeople?: () => void
```

Quando `showRoomControls` é `true`, dois botões novos aparecem no grupo de
botões existente (mesmo estilo `toolButtonCls`, estado ativo quando
`roomPanel` corresponde): um com ícone de chat (distinto do ícone já usado
pelo nearby chat, ex. `forum`), outro com ícone de grupo de pessoas (ex.
`group`). Clique chama `onToggleRoomChat`/`onToggleRoomPeople`.

### Frontend — `OfficePage.tsx`

- Novo state `roomPanel: 'chat' | 'people' | null` (default `null`).
  - `toggleRoomChat`: se já `'chat'`, fecha (`null`); senão abre (`'chat'`,
    substituindo `'people'` se estivesse aberto).
  - `toggleRoomPeople`: análogo.
  - `useEffect` que zera `roomPanel` pra `null` sempre que `camerasExpanded`
    vira `false` (fechar a grade fecha os painéis também).
- Novo cálculo de **sala atual** (reaproveitando `zone`/`activeMap.rooms`
  já disponíveis): quando `inMeetingRoom`, encontra o `OfficeRoomDTO`
  correspondente (`activeMap.rooms.find((r) => r.externalKey ===
  zone.properties.externalKey)`) — esse `room.id` é a chave usada pelo
  hook de chat pra saber quando resetar o histórico local (trocou de
  sala/saiu da sala).
- Novo cálculo de **`roomOccupants`**: `occupants` (já disponível via
  `useOfficeSocket`) filtrados por estarem na MESMA sala que você
  (`mapZoneAt(activeMap.document, o.x, o.y)?.properties.externalKey ===
  zone?.properties.externalKey`), quando `inMeetingRoom`.
- Novo hook `useRoomChat(bridge, roomId, sender, connected)`, montado no
  `OfficeSessionProvider` para continuar recebendo mensagens mesmo com o
  painel ou a página fechados:
  mantém `messages: RoomChatMessage[]` em estado, zera pra `[]` sempre que
  `roomId` muda (troca de sala ou sai da sala — nunca mistura histórico de
  salas diferentes na tela); inscreve em `bridge.onServerMessage` e trata:
  - `room-chat-message` (mesma `roomId`): acrescenta a mensagem à lista.
  - `sendMessage(text)` acrescenta imediatamente a mensagem própria e chama
    `bridge.emitClientMessage({ type: 'room-chat-message', text })` quando há
    sala e conexão ativas.
- `<MediaBar>` e `<MediaTiles>` passam a receber os novos props descritos
  acima.

### Backend — retransmissão efêmera por sala

`packages/shared/src/office.ts`:

```ts
// Cliente → servidor
| { type: "room-chat-message"; text: string }

// Servidor → cliente
| {
    type: "room-chat-message";
    roomId: string;
    userId: string;
    name: string;
    text: string;
    sentAt: string; // ISO
  }
```

Mais uma constante `ROOM_CHAT_MESSAGE_MAX_LENGTH` (texto mais longo que o
`nearby-message`, que é só um balão — algo como 500 caracteres).

`apps/api/src/lib/office-hub.ts`:

- Novo método `roomChatMessage(socket, userId, text)`: valida dono do
  socket, acha a entry, calcula `room = this.roomForPosition(x, y)` da
  posição atual; se não estiver numa sala, não faz nada (chat de sala só
  existe dentro de sala); corta/normaliza o texto
  (`ROOM_CHAT_MESSAGE_MAX_LENGTH`); monta a mensagem e faz um **broadcast
  filtrado** — só pra quem está na MESMA sala agora (mesmo
  predicado de `canEnterRoom`: `roomForPosition(occupant.x,
  occupant.y)?.id === room.id`), excluindo apenas o socket remetente para
  não duplicar a mensagem inserida localmente. Outras abas recebem.
- `join()`, `move()` e `leave()` não manipulam chat: não existe replay nem
  armazenamento do lado do servidor.

`apps/api/src/routes/office-ws.ts`: novo `else if` despachando
`room-chat-message` pro método do hub, no mesmo padrão do
`nearby-message` existente.

## Fora de escopo

- Anexos, menções, emojis ou formatação dentro do chat da sala.
- Ações (chamar/seguir/ver perfil) na lista de pessoas da sala.
- Qualquer persistência em banco do chat de sala.
- Mudar o comportamento do "nearby chat" (balão de fala/pensamento) já
  existente — continua igual, é uma feature separada.
- Mudar a lógica de destaque/grid uniforme da área central de câmeras.
- Mais botões na MediaBar dentro da grade além dos 2 descritos aqui
  (outros controles ficam pra depois, conforme combinado).

## Testes

- `office-hub.test.ts`: mensagem chega aos outros sockets da mesma sala,
  não ecoa no socket remetente, não chega ao escritório inteiro e não é
  reexecutada para quem entra depois; texto é cortado no tamanho máximo.
- `office-ws.test.ts` (se aplicável): despacho de `room-chat-message`
  chama `officeHub.roomChatMessage` com os parâmetros certos.
- Frontend: `MediaBar.test.tsx` — os 2 botões novos só aparecem quando
  `showRoomControls`; `MediaTiles.test.tsx` — painel lateral certo
  renderiza conforme `roomPanel`, área central usa `flex-1` ao lado do
  painel; `RoomChatPanel.test.tsx`/`RoomPeoplePanel.test.tsx` novos;
  `OfficePage.test.tsx` — abrir um painel fecha o outro, fechar a grade
  zera `roomPanel`, `roomOccupants` filtra corretamente pela sala atual.
