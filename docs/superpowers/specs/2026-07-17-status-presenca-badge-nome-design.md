# Design — Status de presença + badge de nome sobre o personagem

**Data:** 2026-07-17
**Branch:** a definir (segue em cima da main atual)

## Problema

O nome do personagem hoje é um texto simples desenhado no canvas do Phaser
(sem indicar presença), e a câmera/tela compartilhada aparecem como
elementos DOM separados sobrepostos ao canvas (`CharacterVideoBubble.tsx`,
`ScreenShareIndicator.tsx`), sem nenhuma coordenação com o nome — os três
podem, em teoria, competir pelo mesmo espaço acima do personagem.

O usuário quer: (1) um badge de nome com visual de "pill" (fundo colorido,
bolinha de status, tracinho apontando pro personagem — referência visual de
outra ferramenta), (2) que abrir a câmera substitua esse badge (mesmo
quadrado, só um de cada vez), (3) que compartilhar tela substitua a câmera
no mesmo quadrado (não um indicador separado do lado), e (4) que a bolinha
reflita um status de presença real, escolhido manualmente pela pessoa:
online (verde), ausente (vermelho), volto logo (amarelo).

## Decisões de escopo (validadas com o usuário)

- **Onde renderizar o badge:** sai do Phaser (canvas) e vira componente
  React, reaproveitando o mesmo sistema de posicionamento por tela
  (`useCharacterScreenPositions`) que já posiciona a bolha de câmera —
  mais simples de estilizar (pill arredondado, tracinho) do que desenhar
  no canvas, e permite trocar de conteúdo (nome/câmera/tela) no mesmo
  slot com uma condicional só.
- **Prioridade de conteúdo no quadrado:** tela compartilhada > câmera >
  badge de nome. Nunca mais de um ao mesmo tempo.
- **Status de presença:** 3 estados — `online` (verde), `away`/ausente
  (vermelho), `brb`/volto logo (amarelo). 100% manual (sem detecção de
  inatividade). Vive só na sessão do escritório (em memória no servidor,
  como posição/direção hoje) — reseta pra `online` a cada entrada, sem
  coluna nova no Prisma.
- **Onde trocar o status:** menu aberto a partir do chip de identidade da
  `MediaBar` (hoje só abre o editor de personagem no clique) — vira um
  menu com as 3 opções + "Editar personagem".
- **Cor do pill do badge:** verde do tema (`bg-primary`, texto escuro) —
  não o roxo da referência visual (fora da paleta do app).
- **Dot de conexão da MediaBar não muda:** o pontinho que já existe no
  chip de identidade (reflete `media.status` — saúde da conexão de
  áudio/vídeo) é um conceito técnico diferente da bolinha de presença
  social do badge — ambos continuam existindo, sem se fundir.

## Fatos verificados do código

- **`apps/web/src/office/scenes/OfficeScene.ts`** (`spawn()`): hoje cria
  `this.add.text(0, 18, occupant.name.split(' ')[0], {...backgroundColor:
  '#f5f5f0', color:'#1a1a1a', padding...})`, guardado em
  `CharacterView.label`. Sem nenhum código que esconda esse label por
  estado de mídia — é sempre visível, independente de câmera/tela.
- **`apps/web/src/office/media/CharacterVideoBubble.tsx`**: balão de
  câmera, `BUBBLE_BASE_SIZE = 64`, `BUBBLE_BASE_OFFSET_Y = 90` (px em
  zoom 1), `rounded-lg border-2 border-primary bg-black`, com um
  quadradinho rotacionado 45° como "tracinho" (`-mt-px h-2 w-2 rotate-45
  border-b-2 border-r-2 border-primary bg-black`). `null` se
  `position` (de `useCharacterScreenPositions`) for `null`.
- **`apps/web/src/office/media/ScreenShareIndicator.tsx`**: pill separado
  (`rounded-full border-2 border-primary bg-black/80`, ícone + "Tela de
  {name}"), desloca pro lado (`INDICATOR_GAP_X = 60`) quando já existe
  bolha de câmera no mesmo ponto. Só renderiza fora de sala de reunião
  formal (dentro, a grade do `MediaTiles` já cobre).
- **`apps/web/src/pages/OfficePage.tsx`**: monta `cameraBubbles` (local +
  remotos com `cameraTrack`) e `screenSharers` (local + remotos com
  `screenTrack`, só `!inMeetingRoom`), renderizando os dois
  independentemente lado a lado via `useCharacterScreenPositions`.
- **`packages/shared/src/office.ts`**: `OfficeOccupant` (dir, thoughtText,
  avatarSeed/avatarOptions, sem campo de status genérico ainda).
  `OfficeClientMessage` = `move | call | call-response | nearby-message |
  room-chat-message | confetti` (+ os que a feature de fala/sinais
  sonoros já adicionaram). `OfficeServerMessage` inclui `avatar-updated`
  como o padrão mais próximo pra copiar (campo não-posicional,
  broadcastado pro hub inteiro).
- **`apps/api/src/lib/office-hub.ts`**: `entries: Map<userId, {occupant,
  sockets}>`. `updateAvatar(userId, avatarSeed, avatarOptions)` (linha
  ~276): muta `entry.occupant` direto e `this.broadcast({type:
  'avatar-updated', ...})` — chamado hoje só de uma rota REST, não de
  mensagem de cliente. `move()`/`confetti()` são o padrão de mutação
  **disparada por mensagem de cliente** (validam `socketOwner` contra o
  `userId` alegado, mutam `entry.occupant`, broadcastam).
- **`apps/api/src/routes/office-ws.ts`**: dispatch em cadeia de
  `if/else if (msg.type === ...)` sobre a mensagem JSON recebida.
- **`OfficeBridge.ts`** (`applyToSnapshot`): `case 'avatar-updated'` é o
  template a copiar — busca o occupant no Map interno, aplica o campo
  novo, resalva no Map.
- **`useOfficeSocket.ts`**: `bridge.onClientMessage((message) =>
  ws.send(JSON.stringify(message)))` já forwarda QUALQUER
  `OfficeClientMessage` pro servidor — nenhum código novo necessário
  nesse hook pra um tipo de mensagem novo.

## Arquitetura

### 1. Protocolo (`packages/shared/src/office.ts`)

```ts
export type OfficeUserStatus = 'online' | 'away' | 'brb'

export interface OfficeOccupant {
  // ...campos existentes
  status?: OfficeUserStatus // ausente = tratado como 'online' (default)
}

export type OfficeClientMessage =
  | ...
  | { type: 'set-status'; status: OfficeUserStatus }

export type OfficeServerMessage =
  | ...
  | { type: 'status-changed'; userId: string; status: OfficeUserStatus }
```

### 2. Servidor (`office-hub.ts`, `office-ws.ts`)

`setStatus(socket: OfficeSocket, userId: string, status: OfficeUserStatus): void`
— mesmo padrão de `move()`: valida que `socketOwner.get(socket) === userId`
(anti-spoof), busca `entries.get(userId)`, se existir muta
`entry.occupant.status = status` e `this.broadcast({type:'status-changed',
userId, status})`. Occupant nasce com `status: 'online'` (join/`entries.set`
inicial). `office-ws.ts`: `else if (msg.type === 'set-status' &&
isValidStatus(msg.status)) officeHub.setStatus(ws, user.id, msg.status)`
— `isValidStatus` é um type guard simples (`['online','away','brb'].includes(x)`).

### 3. Bridge (`OfficeBridge.ts`)

`applyToSnapshot`, novo `case 'status-changed': { const occupant =
this.occupants.get(message.userId); if (occupant)
this.occupants.set(message.userId, { ...occupant, status: message.status })
}` — idêntico ao `avatar-updated`.

### 4. Trocar o próprio status (`MediaBar.tsx`)

O botão do chip de identidade (hoje `onClick={onEditCharacter}` direto)
ganha um menu (mesmo padrão visual/estado do menu de modo do nearby chat
já existente no arquivo — `showModeMenu`, fecha em click-outside/Escape):
3 itens de status (bolinha colorida + label: Online/Ausente/Volto logo,
marca o atual com check) + separador + "Editar personagem" (chama
`onEditCharacter`, comportamento preservado). Escolher um status chama
`media.setStatus(status)` (novo método exposto — ver seção 6) que faz
`bridge.emitClientMessage({type:'set-status', status})`.

### 5. Badge de nome / câmera / tela — componente React único

Novo componente `CharacterOverlay.tsx` (substitui `CharacterVideoBubble.tsx`
+ `ScreenShareIndicator.tsx`), reaproveitando os mesmos
`BUBBLE_BASE_SIZE`/`BUBBLE_BASE_OFFSET_Y`/tracinho de hoje. Recebe
`{ position, name, status, cameraTrack, screenTrack, mirrored, onClick }`
e decide o conteúdo do quadrado por prioridade:

1. `screenTrack` presente → `<video>` da tela (mesmo tratamento que a
   câmera tem hoje: `object-cover`, sem mirror).
2. senão `cameraTrack` presente → `<video>` da câmera (comportamento
   atual do `CharacterVideoBubble`).
3. senão → badge de nome: `bg-primary` pill, bolinha (`bg-green-500` /
   `bg-red-500` / `bg-yellow-400` conforme `status`), nome, mesmo
   tracinho.

Clique no quadrado (quando há vídeo) preserva o comportamento de abrir a
grade de mídia (mesmo `onClick` que o `ScreenShareIndicator` tinha).

### 6. `useOfficeMedia.ts` / `OfficeMediaState`

Não precisa de estado novo de dados (status vem de `OfficeOccupant`, já
espelhado via bridge/socket) — só precisa expor uma função pra DISPARAR a
troca: `setStatus(status: OfficeUserStatus): void` que chama
`bridge.emitClientMessage({type:'set-status', status})`. Como o hook não
recebe o `bridge` sempre (parâmetro opcional, ver feature anterior), essa
função pode viver direto no componente/contexto que já tem o `bridge` em
mãos (`OfficeSessionContext.tsx`), exposta em `OfficeSessionValue`, em vez
de inflar `useOfficeMedia`.

### 7. `OfficePage.tsx`

Troca a montagem separada de `cameraBubbles`/`screenSharers` por uma lista
única de "overlays por personagem" (local + remotos), cada um carregando
`{userId, name, status, cameraTrack, screenTrack, mirrored}`, renderizando
`<CharacterOverlay>` uma vez por personagem (em vez de até duas entradas
independentes hoje).

## Tratamento de erros / casos de borda

- `status` ausente em `OfficeOccupant` (occupant antigo/replay sem o
  campo): tratado como `'online'` em toda leitura (badge e lógica de
  menu), nunca `undefined` na UI.
- `set-status` com socket que não é dono do userId: ignorado, mesmo
  comportamento de `move()`/`confetti()` hoje (anti-spoof).
- Câmera E tela ativas ao mesmo tempo: tela sempre vence (prioridade 1),
  câmera continua publicada mas não aparece nesse quadrado (comportamento
  já implícito na prioridade da seção 5).
- Personagem fora do viewport (`position === null`): `CharacterOverlay`
  não renderiza nada, igual ao `CharacterVideoBubble` hoje.

## Testes

- `office-hub.test.ts`: `setStatus` muta e broadcasta; ignora socket sem
  ownership do userId; novo occupant nasce `status:'online'`.
- `OfficeBridge.test.ts`: `status-changed` atualiza o snapshot.
- `CharacterOverlay.test.tsx` (novo): prioridade tela > câmera > badge;
  as 3 cores de bolinha de status; `null` sem `position`.
- `MediaBar.test.tsx`: menu do chip abre/fecha, cada opção de status
  dispara a chamada certa, "Editar personagem" continua funcionando.

## Fora de escopo

- Detecção automática de inatividade pra "ausente".
- Persistir o status entre sessões/reload (banco).
- Mudar o significado ou visual do dot de conexão de mídia já existente
  no chip da MediaBar.
