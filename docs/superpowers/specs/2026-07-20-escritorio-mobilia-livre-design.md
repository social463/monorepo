# Mobília livre no editor in-place: posicionar em qualquer pixel, arrastar e apagar por objeto

**Data:** 2026-07-20
**Status:** aprovado (design)
**Task:** ADO #21926 — "Permitir mover um asset para qualquer posição no mapa"

## Objetivo

Três mudanças no modo de edição in-place do escritório (drawer "Decoração",
sobre a cena Phaser), inspiradas no Gather:

1. **Posicionar em qualquer pixel.** Ao colocar mobília, a peça deve cair onde o
   cursor está, não no canto/centro do tile. Hoje toda peça é arredondada para a
   grade.
2. **Arrastar mobília já colocada.** Clicar sobre uma peça e arrastá-la livremente
   para qualquer posição, soltando onde quiser. Hoje não há gesto de mover.
3. **Borracha por objeto.** Com a borracha ativa, passar o mouse sobre uma peça a
   realça em vermelho (hover-target); clicar exclui aquela peça. Hoje a borracha é
   um retângulo desenhado por arraste que apaga por célula da grade.

Estende `2026-07-18-escritorio-mobilia-empilhavel-design.md` (que fez o pincel
gravar `tile-object` em `document.objects`).

## Causa raiz

A mobília do pincel já é gravada como `tile-object` (pixel, em `document.objects`),
e a cena **já a renderiza por pixel** (`applyTileObjectStamp`,
`OfficeScene.ts:725` — desenha na posição `{x,y,width,height}` sem arredondar).
O que trava a posição livre está em dois pontos, ambos na grade:

- **Colocação arredonda.** `addTileObject` (`decorationDoc.ts:71`) grava
  `x: col * tileWidth, y: row * tileHeight`. E a cena entrega ao handler só a
  célula: `onTilePaint(col, row)` (`OfficeScene.ts:551`), via
  `pointerToCell → Math.floor(world / tile)` (`:478`). O sub-tile é perdido antes
  de chegar no documento.
- **Achar a peça casa por grade exata.** `topTileObjectAt` (`decorationDoc.ts:90`)
  só acha um `tile-object` se `geometry.x === col*tile && geometry.y === row*tile`.
  A borracha (`eraseAt`, `useOfficeMapEditing.ts:298`) depende disso. Com peças em
  posição livre, o `x` deixa de ser múltiplo do tile e a borracha nunca mais acha
  a peça.

O schema não é o problema: `TileObjectV1.geometry` é retângulo com `x/y` em pixel
inteiro (`office-map.ts:354`); a validação só exige `width/height == tile do
tileset` e ficar dentro dos limites do mapa (`office-map.ts:1039`, `:983`).
Posição é livre. Sem migration, sem mudança de contrato, sem novo WS (decoração é
local até Salvar → publish).

## Arquitetura da interação

Hit-test e mutação ficam na **camada do hook** (`useOfficeMapEditing`), sobre o
documento de trabalho (`documentRef.current`) — não na cena. Motivo: a cena
renderiza o mapa **publicado**; as edições da sessão vivem no hook. Hit-testar
contra `scene.document` erraria (ignora peças colocadas/movidas nesta sessão e
acertaria peças já apagadas). Portanto:

- **Cena** = geometria de input + desenho. Passa a emitir **pixels do mundo**
  (não célula) num novo `editMode: 'object'`, e ganha um realce de hover.
- **Hook** = decide, sobre o doc de trabalho, o que colocar/mover/apagar e manda a
  cena estampar. Lógica pura e testável em `decorationDoc`.

## Parte A — colocar em qualquer pixel + arrastar (pincel/Mobília)

### `decorationDoc.ts` (puro, TDD)

Novas funções, mantendo as de grade para o caminho legado:

```ts
// Retângulo delimitador de um tile-object (pixels).
function tileObjectBounds(o: TileObjectV1): Rect

// Clampeia a posição (top-left) para a peça caber inteira no mapa.
export function clampObjectTopLeft(doc, x, y, w, h): { x: number; y: number }

// Acrescenta um tile-object numa posição livre (x,y = top-left já clampeado).
export function addTileObjectAtPixel(
  doc, input: { id; x; y; tilesetId; tileIndex; tileWidth; tileHeight },
): MapDocumentV1

// Move um tile-object existente para (x,y) top-left (clampeado). No-op por
// identidade se a posição não mudou.
export function moveTileObject(doc, id, x, y): MapDocumentV1

// Topmost tile-object cujo bbox contém (x,y) — varre de trás pra frente (topo
// da pilha primeiro), substitui o `topTileObjectAt` de grade no caminho novo.
export function topTileObjectAtPixel(doc, x, y): TileObjectV1 | null
```

### Cena — `editMode: 'object'`

`editModeForTool('brush')` passa a devolver `'object'`. No novo modo, os handlers
de pointer emitem pixels do mundo:

- `onObjectPointerDown?(x, y)` — no down.
- `onObjectPointerMove?(x, y, isDown)` — no move (hover ou arraste).
- `onObjectPointerUp?()` — no up.

`pointerToCell`/`onTilePaint` continuam para os modos legados; o modo `'object'`
não usa grade.

### Hook — gesto colocar-ou-agarrar + arrastar (espelha o editor admin)

Estado local do gesto: `{ objectId, offsetX, offsetY } | null`.

- **onObjectPointerDown(x,y)** com pincel:
  - `topTileObjectAtPixel` acha peça sob o cursor → **agarra**: guarda
    `offset = (x - o.x, y - o.y)`, `beginOp()`.
  - senão, se há tile selecionado na paleta → **coloca uma** peça centrada no
    cursor (`x - tileW/2, y - tileH/2`, clampeado), `beginOp()`,
    `addTileObjectAtPixel`, `applyTileObjectStamp`, e já **agarra** a recém-criada
    (arrasta no mesmo gesto, igual `beginFreeTileSelection` do admin,
    `MapCanvas.tsx:1091`).
- **onObjectPointerMove(x,y, isDown)** com peça agarrada: `moveTileObject` para
  `(x - offsetX, y - offsetY)` clampeado; re-estampa via `applyTileObjectStamp`
  (que remove+recria pelo id). `dirty: true`.
- **onObjectPointerUp**: `commitOp()`, solta o gesto.

Um clique-solta = coloca uma peça (arraste de zero pixels). Um clique-e-arrasta =
coloca e reposiciona, ou reposiciona a peça existente. **Sai o "arrastar para
pintar vários"** da mobília (conflita com arrastar-para-mover); empilhar continua
possível colocando peça sobre peça, um clique cada.

## Parte B — borracha por objeto (hover + clique)

### `decorationDoc.ts` (puro, TDD)

```ts
// Topmost objeto APAGÁVEL (tile-object + ERASABLE_OBJECT_TYPES já existente)
// cujo bbox contém (x,y). tile-object tem prioridade de topo por ordem do array.
export function topErasableObjectAtPixel(doc, x, y): MapObjectV1 | null

// Remove um objeto por id (identidade). Devolve doc + removido (ou null).
export function removeObjectById(doc, id): { doc; removed: MapObjectV1 | null }
```

### Cena — realce de hover

Novo método transitório, distinto dos marcadores de remoção pendente:

```ts
setEraseHover(bounds: Rect | null): void  // retângulo vermelho, depth alto,
                                          // recriado a cada move, limpo no null
```

Reaproveita o estilo de `markTileObjectErased` (`OfficeScene.ts:770`, vermelho
`0xff5d5d`), em um slot próprio (`this.eraseHover`), sem colidir com
`editObjectEraseMarkers`.

### Hook — borracha no `editMode: 'object'`

- **onObjectPointerMove(x,y,_)** com borracha: `topErasableObjectAtPixel`;
  `scene.setEraseHover(bounds)` se achou, `setEraseHover(null)` senão.
- **onObjectPointerDown(x,y)** com borracha: acha o topo apagável e exclui:
  - `tile-object` desta sessão → `removeTileObjectStamp(id)`.
  - objeto já publicado (`baseDocRef` tem o id) → `markTileObjectErased`/
    `eraseAreaMarker` conforme o tipo (marca vermelha até o save).
  - `beginOp()`+`commitOp()` (um passo de desfazer), `dirty: true`.
- **Fallback legado:** se nada apagável sob o cursor, limpa o tile da tile-layer
  `objects` naquela célula (mapas publicados antes do empilhamento) — preserva o
  comportamento atual do `eraseAt` para pintura em tile-layer.

`editModeForTool('eraser')` passa de `'rect'` para `'object'`. **Sai a borracha em
retângulo** (arraste apagando bloco); apagar em massa vira clicar peça a peça.

## Parte D — grupo atômico (asset fatiado)

Nossos assets são **fatiados em vários tiles** (ex.: cadeira = encosto + assento).
Colocar/arrastar slice por slice livre os desalinha. Solução: uma seleção
`cols×rows` da paleta vira um **grupo** de `tile-objects` que nasce, arrasta e
apaga **junto**, preservando os offsets internos. Posição livre é da bbox do
grupo, nunca de slice solto.

### Modelo (sem mudar schema)

O grupo é marcado no **id**: `<groupId>:<dc>-<dr>`. A chave do grupo é a parte
antes do `:`; um id sem `:` (mobília antiga/single) é seu próprio grupo
(singleton) — retrocompatível. `TileObjectV1.properties` continua `{tilesetId,
tileIndex}`; nada no contrato muda.

### `decorationDoc.ts` (puro, TDD)

- `groupKeyOf(id)` — chave do grupo (id sem `:` → singleton).
- `groupBounds(doc, key)` — união dos slices (para clamp, hover e offset do drag).
- `addTileObjectGroupAtPixel(doc, {groupId, x, y, tilesetId, tileWidth,
  tileHeight, tiles: [{dc,dr,tileIndex}]})` — coloca todos os slices; clampeia a
  **bbox do grupo** (não cada slice), para os offsets nunca distorcerem na borda.
- `moveGroupTo(doc, key, x, y)` — move o grupo inteiro (bbox → (x,y) clampeado);
  no-op por identidade.
- `removeGroup(doc, key)` — remove todos os slices; devolve os removidos.

### Fluxo (hook + cena)

- **Colocar**: `resolveSelectedGroup` registra o frame de cada slice da seleção;
  `placeFurnitureGroupAtPixel` coloca o grupo centrado no cursor e já o agarra.
- **Arrastar**: o gesto guarda a **chave do grupo** + offset na bbox;
  `moveFurnitureGroup` usa `moveGroupTo` e re-estampa/esconde cada slice.
- **Apagar**: do slice sob o cursor deriva a chave e usa `removeGroup` — clicar
  em qualquer parte apaga o asset inteiro. Hover realça a **bbox do grupo**.
- **Fantasma**: `setPlacementPreview` recebe **todos os slices** (`{textureKey,
  frameKey, dx, dy}`) e desenha o asset inteiro esmaecido seguindo o cursor.

Trade-off aceito: **não** dá para mover um slice isolado (ex.: só o encosto) — a
atomicidade é o que impede o asset de quebrar, como no Gather.

## Fora de escopo

- Rotação/redimensionamento de mobília (Gather tem; não pedido).
- Snap opcional com tecla (pedido explícito: 100% livre).
- **Mover/apagar slice isolado** de um asset fatiado (a atomicidade é intencional).
- Colisão ao posicionar (mobília é visual; segue livre, pode sobrepor).
- Editor admin full-screen (`MapEditor`/`MapCanvas`) — já tem free-drag próprio.

## Testes

- **`decorationDoc.test.ts`**: `addTileObjectAtPixel` (posição livre + clamp nas
  bordas), `moveTileObject` (move + clamp + no-op por identidade),
  `topTileObjectAtPixel` (topo da pilha, ponto fora = null),
  `topErasableObjectAtPixel` (prioridade tile-object, inclui zonas apagáveis),
  `removeObjectById`.
- **`useOfficeMapEditing.test.ts`**: colocar-e-arrastar num gesto; reposicionar
  peça existente; borracha hover→delete de peça da sessão e de peça publicada;
  undo de cada gesto; `dirty` só quando muda algo.
- Cena: hit-test/mutação não vivem na cena, então a cobertura fica no hook (a cena
  já é difícil de testar sem Phaser). Verificação de runtime manual pela skill
  `verify` (link admin já não se aplica; testar no drawer do `/escritorio`).
```
