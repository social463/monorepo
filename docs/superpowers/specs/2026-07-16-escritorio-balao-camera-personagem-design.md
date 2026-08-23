# Balão de câmera acompanhando o personagem no mapa

## Problema

Hoje a câmera de cada participante só aparece de dois jeitos: (a) seu próprio
preview flutuante e arrastável no canto da tela (`SelfCameraPreview.tsx`,
só fora de sala), ou (b) uma faixa lateral consolidada no canto superior
direito (`MediaTiles.tsx`, modo compacto — feature recém-implementada). Não
há nenhum feedback visual de câmera "no lugar" do mapa: olhando pro
personagem de alguém, você não vê a câmera dela.

A referência (Gather.town, imagens anexadas) mostra a câmera de cada pessoa
como um balão flutuando por cima do próprio personagem, seguindo ele pelo
mapa — dentro ou fora de sala, para qualquer pessoa com câmera ligada
(local e remotos).

## Comportamento desejado

- Sempre que alguém liga a câmera — você ou qualquer colega, em qualquer
  lugar do mapa (sala de reunião ou espaço aberto) — um balão de vídeo
  aparece **acima do personagem dela**, com um ponteirinho apontando pra
  baixo (estilo balão de fala), na mesma linguagem visual do balão de
  pensamento que já existe no Phaser (`OfficeScene.showNearbyBubble`).
- O balão **acompanha o personagem em tempo real** enquanto ele anda pelo
  mapa (mesmo mecanismo de posição do nome/balão de pensamento hoje, só
  que renderizado como elemento DOM real por cima do canvas, já que vídeo
  do LiveKit precisa de uma tag `<video>` de verdade).
- O balão **escala junto com o zoom do mapa** (60%–250%, mesmo range já
  existente) — o mesmo fator de zoom que a câmera do Phaser aplica ao
  mundo do jogo.
- Só aparece para participantes **visíveis na tela** (dentro do viewport
  atual do mapa) — quem está fora da área visível simplesmente não tem
  balão renderizado.
- Aplica-se a **local e remotos igualmente**: sua própria câmera também vira
  um balão sobre seu personagem, no lugar do preview flutuante de hoje.
- Câmeras de remotos continuam sujeitas à mesma regra de assinatura já
  existente (`useOfficeMedia.ts` — autoSubscribe em zona, proximidade em
  espaço aberto): só aparece balão pra quem já tem `cameraTrack`
  assinado, sem mudança nessa lógica.

## Remoções (substituídas pelo balão)

- `apps/web/src/office/media/SelfCameraPreview.tsx` (+ teste) — preview
  flutuante arrastável de hoje, só cobria a própria câmera fora de sala.
- `apps/web/src/office/media/useMediaStripWidth.ts` (+ teste) — hook de
  resize da faixa lateral, feature muito recente que este spec substitui.
- O bloco de **faixa compacta** dentro de `MediaTiles.tsx` (o que hoje
  aparece como `{hasVisible && !expanded && (...)}`) e o container/alça de
  resize correspondente em `OfficePage.tsx`.
- Prop `showAllPresent` de `MediaTiles` deixa de ter uso (só existia pra
  decidir a visibilidade da faixa compacta).
- O mecanismo de **dialog separado de tela compartilhada** (`expandedId`/
  `expandedScreen`, o `<div role="dialog">` de "Tela compartilhada em
  destaque") também some — seu único gatilho era o clique numa tela dentro
  da faixa compacta, que deixa de existir. Sem a faixa nem esse dialog,
  compartilhamento de tela fica **sem nenhuma indicação visível** até o
  spec do "botão de grade" (próximo passo) restaurar isso via a grade
  expandida — lacuna temporária aceita deliberadamente, não é regressão a
  corrigir aqui.

**Fica intocado** (fora de escopo deste spec, reaproveitado por um spec
separado do "botão de grade"): a parte de **grade expandida em tela cheia**
de `MediaTiles.tsx` (`buildTiles`, `resolveFeatured`, o overlay via
`createPortal`) — isso continua existindo, só muda de gatilho depois, numa
feature separada.

## Abordagem

### Exposição de posição de tela pelo Phaser

`OfficeScene.ts` ganha um método:

```ts
getScreenPosition(userId: string): { x: number; y: number } | null
```

Calculado a partir da posição atual do `Container` do personagem (já
tweened/animada, mesma fonte usada pelo balão de pensamento e nome) e da
câmera do Phaser (`this.cameras.main.scrollX/scrollY/zoom`):

```
screenX = (container.x - camera.scrollX) * camera.zoom
screenY = (container.y - camera.scrollY) * camera.zoom
```

Retorna `null` se o `userId` não tiver personagem spawnado, ou se a posição
calculada cair fora dos limites do viewport atual (`this.scale.width/height`).

### Exposição pro React

Hoje `OfficeCanvas.tsx` guarda a instância da `OfficeScene` num `sceneRef`
**interno**, sem expor nada pro componente pai. `OfficeCanvas` passa a usar
`forwardRef` + `useImperativeHandle`, expondo um handle:

```ts
export interface OfficeCanvasHandle {
  getScreenPosition(userId: string): { x: number; y: number } | null
}
```

`OfficePage.tsx` passa a segurar um `canvasRef` e passar `ref={canvasRef}`
pro `<OfficeCanvas>`.

### Hook de sincronização de posição

Novo hook `useCharacterScreenPositions(canvasRef, userIds: string[])` em
`apps/web/src/office/media/`, que roda um loop via `requestAnimationFrame`
chamando `canvasRef.current?.getScreenPosition(userId)` pra cada
`userId` da lista, e retorna um `Map<string, { x: number; y: number } |
null>` atualizado a cada frame (usando `useState`/`useRef` + um único
`rAF` agendando o próximo tick; para quando a lista de `userIds` fica
vazia).

### Componente de balão

Novo componente `CharacterVideoBubble` (substitui `SelfCameraPreview`)
recebe `track`, `name`, `position: {x,y} | null`, `zoom: number`. Renderiza
um `<video>` real (mesmo padrão de `track.attach()` já usado em
`VideoTile`/`SelfCameraPreview`) dentro de um balão arredondado com
ponteirinho, posicionado via `style={{ left, top, transform:
'translate(-50%, -100%)' }}` (centralizado horizontalmente, base do balão
encostando no topo do personagem) e tamanho base multiplicado por `zoom`
(ex.: `BUBBLE_BASE_SIZE = 64`, `width/height = BUBBLE_BASE_SIZE * zoom`).
Quando `position` é `null` (fora da tela), o componente não renderiza nada.

`OfficePage.tsx` monta uma lista de `{ userId, track, name, ... }` pra quem
tem `cameraTrack`/`localCameraTrack` ativo (local + `media.remotes`
filtrados por `r.cameraTrack`), usa `useCharacterScreenPositions` pra
saber onde cada um está na tela, e renderiza um `<CharacterVideoBubble>`
por entrada, dentro de um container `absolute inset-0 pointer-events-none
z-10` (os balões em si não bloqueiam clique no personagem por baixo, já
que ficam deslocados acima da cabeça, sem sobrepor o sprite).

## Fora de escopo

- Botão de "grade" no canto superior direito da sala e redesenho estilo
  Meet da grade expandida — spec separado, próximo passo.
- Indicador visual pra quem só tem áudio (sem câmera) — nenhuma mudança.
- Qualquer mudança na lógica de assinatura de tracks (`useOfficeMedia.ts`,
  proximidade/autoSubscribe) — só consumida, não alterada.
- Suporte a mobile/toque — fora do radar atual do produto.

## Testes

- `OfficeScene.test.ts`: `getScreenPosition` retorna a posição esperada
  dado scroll/zoom da câmera conhecidos; retorna `null` pra `userId`
  inexistente e pra posição fora do viewport.
- `useCharacterScreenPositions.test.tsx`: harness que mocka um
  `canvasRef`-like com `getScreenPosition` controlado, avança frames (via
  mock de `requestAnimationFrame`) e confirma que o mapa retornado
  atualiza; para de agendar frames quando a lista de `userIds` fica vazia.
- `CharacterVideoBubble.test.tsx`: renderiza vídeo quando `position` não é
  `null`; não renderiza nada quando `position` é `null`; tamanho escala
  com `zoom` (ex.: `zoom=2` → `width/height` dobra).
- `OfficePage.test.tsx`: ajustar/remover testes que dependiam de
  `SelfCameraPreview`/faixa lateral/`showAllPresent`.
- Remover `SelfCameraPreview.test.tsx` e `useMediaStripWidth.test.tsx`
  (arquivos deletados junto com a implementação).
