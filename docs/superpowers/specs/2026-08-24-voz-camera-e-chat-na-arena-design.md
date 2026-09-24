# Voz espacial, câmera e chat na arena (e o saguão)

**Data:** 2026-08-24
**Status:** implementado

## Problema

A arena nasceu muda. O escritório tem voz por proximidade, balão de webcam
sobre o personagem e chat; a arena tem tiro, bandeira e placar — e nenhum jeito
de falar com quem está do outro lado do mapa, nem de combinar a próxima partida
com quem está no menu.

Duas consequências práticas:

1. **Em campo**, jogo de time sem voz é jogo de time por adivinhação. Quem cobre
   a base, quem vai buscar a bandeira e quem está caído são informações que
   passam por fala, não por HUD.
2. **No menu**, esperar é esperar sozinho. Quem abre a arena e não encontra
   ninguém não tem como saber se há gente a caminho — e volta para o escritório.

## Decisão

### 1. A voz da arena é espacial, com raio de arena — não o do escritório

Reaproveita o grafo que já existe (`spatialAudio.ts`: fonte → ganho → pan →
saída). O que muda é a escala: `PROXIMITY_RADIUS` é **3 tiles**, medida de
conversa de mesa num mapa de 30 tiles. A arena tem 121×85 tiles e a câmera
sozinha mostra ~20 — com 3 tiles, dois jogadores que se veem na tela ficariam
mudos um para o outro.

Daí `ARENA_VOICE_RADIUS_TILES = 12`, e um raio de **assinatura** 1,5× maior:
assinar é caro e demora (renegociação WebRTC), então quem chega no limite do
alcance precisa já estar assinado para a primeira sílaba não sumir.

### 2. As posições são PUXADAS da cena, nunca empurradas para o React

`ArenaScene.presence()` devolve as posições em tiles; quem precisa consulta:

- o ganho/pan, a cada 100ms (`ArenaRemoteAudio`);
- a assinatura por distância, a cada 400ms (`useArenaMedia`).

A alternativa — um listener empurrando posição para `useState` — colocaria o
estado do jogo dentro do React e renderizaria a árvore a 60Hz. Foi para não
fazer isso que o snapshot nunca virou estado React (ver `useArenaSocket`).
Ouvido humano não distingue 10 de 60 atualizações de ganho por segundo.

### 3. O balão de webcam é o mesmo do escritório, mas só com câmera ligada

`CharacterOverlay` já decide o conteúdo por prioridade e é ancorado por
`useCharacterScreenPositions` (rAF). O hook passou a aceitar qualquer fonte com
`getScreenPosition` (era `OfficeCanvasHandle`), e `computeScreenPosition` saiu
de `OfficeScene` para `lib/screenPosition` — importar a cena do escritório da
arena arrastaria o escritório inteiro para o bundle do jogo.

O que **não** se traz é o badge de nome que o escritório mostra quando não há
vídeo: nome flutuando sobre todo mundo entregaria a posição do adversário, que é
justamente o que a arena esconde (só quem atira se revela, `REVEAL_MS`).

### 4. O chat da arena NÃO tem recorte por distância

A voz recorta; o texto não. Texto é o canal de quem não está perto — combinar a
próxima partida, avisar que caiu a conexão. Chat que só chega a quem já está no
alcance da voz não acrescenta nada.

### 5. O menu é o saguão

Hub próprio (`ArenaLobbyHub`), rota própria (`/arena/lobby/ws`), sala LiveKit
própria. Não é um modo do `ArenaHub` porque entrar no `ArenaHub` é entrar em
campo: time, spawn, partida, tick. O saguão só tem presença e conversa.

A voz do saguão **não** é espacial: sem posição não há distância, e todo mundo
que está ali se ouve por igual.

### 6. A credencial do token de mídia é a presença no hub

Igual ao escritório: o cliente diz onde acha que está e o servidor só concorda
se o socket dele estiver mesmo lá (`ArenaHub.nameOf` / `ArenaLobbyHub.nameOf` —
devolvem o nome porque o access token não carrega nome, e é ele que vira a
identidade no LiveKit). `arenaId` é validado contra os modos conhecidos e o
saguão: `arenaId` livre viraria sala LiveKit livre, e daria a qualquer um um
canal de voz privado do lado de dentro.

O nome da sala leva o `companyId` (`arena-<companyId>-<arenaId>`) porque o modo
é igual em todo tenant e a instância do LiveKit é compartilhada — sem ele, duas
empresas cairiam na mesma sala.

### 7. Digitar não move o personagem

`ArenaScene.setInputEnabled(false)` enquanto o foco está dentro do painel de
chat. Não basta ignorar as teclas: o `addCapture(['W','A','S','D'])` chama
`preventDefault`, então sem soltar a captura as próprias letras não chegariam ao
campo de texto. Ao desligar, as teclas são resetadas (senão a tecla pressionada
no momento do foco ficaria "em pé"). Fechar o painel devolve o teclado por um
efeito, e não pelo `blur`: painel desmontado com o cursor dentro não dispara
blur.

## O que ficou de fora

- **Tela compartilhada** na arena. É ferramenta de reunião; num jogo não tem uso
  que justifique o peso.
- **Rádio de time** (ouvir o time inteiro à distância). Foi considerado e
  descartado neste passo: muda o equilíbrio do jogo — a voz longe é vantagem
  tática — e a proximidade é o que o escritório já ensinou a todo mundo.
- **Fundo virtual de câmera** (`useCameraBackground`): existe no escritório e
  cabe aqui depois; não é o que faltava para conversar.

## Um hook novo, não um `useOfficeMedia` generalizado

`useArenaMedia` é primo do `useOfficeMedia`, não uma extensão. No escritório a
sala é resolvida pela zona do mapa a cada passo, com janela de estabilidade para
não flapar na porta, e há alto-falante, tela compartilhada, trava de sala e
convidado. Na arena a sala é uma por instância e só muda quando a pessoa troca
de modo — evento explícito, não tile pisado. Enfiar os dois no mesmo hook
custaria mais em condicionais do que se economizaria de linha, no arquivo mais
delicado do escritório.

O que é reaproveitado de verdade são as peças: `livekit-loader`,
`devicePreferences`, `spatialAudio`, `RemoteAudio`, `DeviceMenu`,
`useMediaDevices`, `CharacterOverlay`, `RoomChatPanel`.

## Arquivos

**Contrato** — `packages/shared/src/arena-media.ts` (sala, raios),
`arena-lobby.ts` (protocolo do saguão), `arena.ts` (`chat` no socket da arena).

**API** — `lib/arena-lobby-hub.ts`, `routes/arena-lobby-ws.ts`,
`routes/arena-media.ts`, `ArenaHub.chat`/`nameOf`, `chat` em `routes/arena-ws.ts`.

**Web** — `arena/media/useArenaMedia.ts`, `arena/media/ArenaRemoteAudio.tsx`,
`arena/media/ArenaMediaBar.tsx`, `arena/useArenaChat.ts`,
`arena/useArenaLobbySocket.ts`, `arena/ArenaLobby.tsx`, `ArenaScene.presence`/
`getScreenPosition`/`setInputEnabled`, `lib/screenPosition.ts`.
