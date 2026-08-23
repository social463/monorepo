import { builtinTilesetAsset, isBuiltinTilesetAssetId, type MapDocumentV1, type MapObjectV1, type MapTileSize, type TileObjectRotationV1, type TileObjectV1 } from '@legends/shared'

export function tileIndex(doc: MapDocumentV1, col: number, row: number): number {
  return row * doc.map.width + col
}

/**
 * Remove tilesets que não são referenciados por nenhum tile (em qualquer
 * tile-layer) nem por nenhum `tile-object`. `ensureBuiltinTileset` adiciona um
 * tileset ao escolher um tile, mas nada o remove — sem esta poda, tilesets
 * ficam órfãos no documento (ex.: de um tamanho de tile antigo) e derrubam a
 * validação de publicação (`TILESET_TILE_SIZE_MISMATCH`), ou estouram o teto de
 * `maxTilesets` só de folhear a paleta.
 *
 * `keep` protege ids que ainda não pintaram nada (o tileset recém-escolhido);
 * `onlyBuiltin` limita a poda aos builtins, para não sumir com um asset que o
 * admin acabou de importar e ainda não usou.
 */
export function pruneUnusedTilesets(
  doc: MapDocumentV1,
  options: { keep?: readonly string[]; onlyBuiltin?: boolean } = {},
): MapDocumentV1 {
  const used = new Set<string>(options.keep ?? [])
  for (const layer of doc.layers) {
    if (layer.type !== 'tile') continue
    for (const cell of layer.data) {
      if (cell) used.add(cell.split(':')[0])
    }
  }
  for (const object of doc.objects) {
    if (object.type === 'tile-object') used.add(object.properties.tilesetId)
  }
  const tilesets = doc.tilesets.filter(
    (tileset) =>
      used.has(tileset.id) || (options.onlyBuiltin === true && !isBuiltinTilesetAssetId(tileset.assetId)),
  )
  return tilesets.length === doc.tilesets.length ? doc : { ...doc, tilesets }
}

export function stampTile(
  doc: MapDocumentV1,
  layerKey: 'floor' | 'objects',
  col: number,
  row: number,
  ref: string | null,
): MapDocumentV1 {
  const index = tileIndex(doc, col, row)
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      if (layer.key !== layerKey || layer.type !== 'tile') return layer
      const data = layer.data.slice()
      data[index] = ref
      return { ...layer, data }
    }),
  }
}

/**
 * Acrescenta uma peça de mobília como `tile-object` no fim de `doc.objects`.
 *
 * É o que permite EMPILHAR: a tile layer `objects` tem um slot por célula
 * (`stampTile` sobrescreve), enquanto `doc.objects` é uma lista. Como
 * `renderDecoration` desenha as tile layers primeiro e depois percorre
 * `objects` na ordem do array, quem entra por último é desenhado por último —
 * ou seja, fica por cima. Sem mexer em `zIndex`/`setDepth`.
 *
 * `width`/`height` vêm do TILESET (não do mapa): a validação exige que a
 * geometria de um `tile-object` tenha exatamente o tamanho de um tile do seu
 * tileset. A posição usa o tile do MAPA, que é a grade em que o clique caiu.
 */
export function addTileObject(
  doc: MapDocumentV1,
  input: { id: string; col: number; row: number; tilesetId: string; tileIndex: number; tileWidth: number; tileHeight: number },
): MapDocumentV1 {
  const object: TileObjectV1 = {
    id: input.id,
    layerKey: 'objects',
    type: 'tile-object',
    geometry: {
      kind: 'rectangle',
      x: input.col * doc.map.tileWidth,
      y: input.row * doc.map.tileHeight,
      width: input.tileWidth,
      height: input.tileHeight,
    },
    properties: { tilesetId: input.tilesetId, tileIndex: input.tileIndex },
  }
  return { ...doc, objects: [...doc.objects, object] }
}

/**
 * Orientação de uma peça, já normalizada (os campos do documento são
 * opcionais). Ver `TileObjectRotationV1Schema` em `@legends/shared`.
 */
export type TileOrientation = { rotation: TileObjectRotationV1; flipX: boolean }

const ROTATIONS: TileObjectRotationV1[] = [0, 90, 180, 270]

function normalizeRotation(degrees: number): TileObjectRotationV1 {
  return ROTATIONS[(((degrees / 90) % 4) + 4) % 4]
}

export function orientationOf(object: TileObjectV1): TileOrientation {
  return { rotation: object.properties.rotation ?? 0, flipX: object.properties.flipX ?? false }
}

/** Gira a peça 90° no espaço do mundo. O flip local não muda. */
export function rotateOrientation(o: TileOrientation, direction: 'cw' | 'ccw'): TileOrientation {
  return { rotation: normalizeRotation(o.rotation + (direction === 'cw' ? 90 : 270)), flipX: o.flipX }
}

/**
 * Espelha a peça no espaço do MUNDO. Como o sprite é desenhado com o flip
 * local aplicado antes do ângulo, espelhar o mundo em torno do eixo vertical
 * equivale a inverter o ângulo e alternar o flip local: `H ∘ R(θ) = R(-θ) ∘ H`.
 * Espelhar na horizontal (⇅) é isso seguido de 180°.
 */
export function flipOrientation(o: TileOrientation, axis: 'horizontal' | 'vertical'): TileOrientation {
  const mirrored: TileOrientation = { rotation: normalizeRotation(-o.rotation), flipX: !o.flipX }
  if (axis === 'horizontal') return mirrored
  return { rotation: normalizeRotation(mirrored.rotation + 180), flipX: mirrored.flipX }
}

/**
 * Acha o `tile-object` do TOPO da pilha numa célula (o acrescentado mais
 * recentemente), sem remover nada. Usado tanto pela borracha
 * (`removeTopTileObjectAt`) quanto pelo pincel, para decidir se repintar o
 * MESMO sprite sobre a célula é no-op (review C4 — Critical 1: sem essa
 * checagem, uma pincelada arrastada devagar empilha dezenas de `tile-object`
 * idênticos, porque `OfficeScene` redespacha um pointerdown por pointermove
 * sem lembrar a última célula pintada).
 */
export function topTileObjectAt(doc: MapDocumentV1, col: number, row: number): TileObjectV1 | null {
  const x = col * doc.map.tileWidth
  const y = row * doc.map.tileHeight
  for (let index = doc.objects.length - 1; index >= 0; index--) {
    const object = doc.objects[index]
    if (object.type !== 'tile-object' || object.layerKey !== 'objects') continue
    if (object.geometry.x !== x || object.geometry.y !== y) continue
    return object
  }
  return null
}

/**
 * Remove a peça de mobília do TOPO da célula (a acrescentada mais recentemente)
 * e devolve qual foi — a cena precisa do id para apagar a estampa certa e do
 * retângulo para marcar a remoção. Devolve `removed: null` (e o mesmo `doc`,
 * por identidade) quando não há `tile-object` naquela célula.
 */
export function removeTopTileObjectAt(
  doc: MapDocumentV1,
  col: number,
  row: number,
): { doc: MapDocumentV1; removed: TileObjectV1 | null } {
  const object = topTileObjectAt(doc, col, row)
  if (!object) return { doc, removed: null }
  return { doc: { ...doc, objects: doc.objects.filter((o) => o !== object) }, removed: object }
}

export function ensureBuiltinTileset(doc: MapDocumentV1, assetId: string): { doc: MapDocumentV1; tilesetId: string } {
  const existing = doc.tilesets.find((t) => t.assetId === assetId)
  if (existing) return { doc, tilesetId: existing.id }
  const builtin = builtinTilesetAsset(assetId)
  if (!builtin) throw new Error('Tileset builtin desconhecido')
  const tilesetId = `builtin-${assetId.split('/').pop()}`
  return {
    doc: {
      ...doc,
      tilesets: [
        ...doc.tilesets,
        {
          id: tilesetId,
          assetId,
          name: builtin.name,
          tileWidth: builtin.tileWidth as MapTileSize,
          tileHeight: builtin.tileHeight as MapTileSize,
          columns: builtin.columns,
          tileCount: builtin.tileCount,
        },
      ],
    },
    tilesetId,
  }
}

export function addRectObject(doc: MapDocumentV1, object: MapObjectV1): MapDocumentV1 {
  return { ...doc, objects: [...doc.objects, object] }
}

/** Dimensões do mapa em pixels (a grade é só a unidade de tile). */
function mapPixelSize(doc: MapDocumentV1): { width: number; height: number } {
  return { width: doc.map.width * doc.map.tileWidth, height: doc.map.height * doc.map.tileHeight }
}

/**
 * Clampeia o canto superior-esquerdo (x,y) para que uma peça `w`×`h` caiba
 * inteira no mapa, e arredonda para inteiro (o schema exige coordenadas int).
 * É a única trava de posição da mobília livre — fora isso, qualquer pixel vale.
 */
export function clampObjectTopLeft(
  doc: MapDocumentV1,
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const { width: mapWidth, height: mapHeight } = mapPixelSize(doc)
  const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, 0), Math.max(max, 0)))
  return { x: clamp(x, mapWidth - width), y: clamp(y, mapHeight - height) }
}

/**
 * Acrescenta uma peça de mobília (`tile-object`) numa posição LIVRE (pixel),
 * não na grade — é o que difere de `addTileObject`. `x,y` são o canto
 * superior-esquerdo desejado; são clampeados para a peça caber no mapa.
 * `width/height` vêm do tileset (a validação exige o tamanho original do tile).
 */
export function addTileObjectAtPixel(
  doc: MapDocumentV1,
  input: { id: string; x: number; y: number; tilesetId: string; tileIndex: number; tileWidth: number; tileHeight: number },
): MapDocumentV1 {
  const { x, y } = clampObjectTopLeft(doc, input.x, input.y, input.tileWidth, input.tileHeight)
  const object: TileObjectV1 = {
    id: input.id,
    layerKey: 'objects',
    type: 'tile-object',
    geometry: { kind: 'rectangle', x, y, width: input.tileWidth, height: input.tileHeight },
    properties: { tilesetId: input.tilesetId, tileIndex: input.tileIndex },
  }
  return { ...doc, objects: [...doc.objects, object] }
}

/**
 * Move um `tile-object` existente para (x,y) (canto superior-esquerdo,
 * clampeado). No-op por identidade quando o id não existe ou a posição não muda
 * — o hook usa isso para não sujar o histórico/`dirty` num arraste parado.
 */
export function moveTileObject(doc: MapDocumentV1, id: string, x: number, y: number): MapDocumentV1 {
  const current = doc.objects.find(
    (object): object is TileObjectV1 => object.id === id && object.type === 'tile-object',
  )
  if (!current) return doc
  const target = clampObjectTopLeft(doc, x, y, current.geometry.width, current.geometry.height)
  if (target.x === current.geometry.x && target.y === current.geometry.y) return doc
  return {
    ...doc,
    objects: doc.objects.map((object) =>
      object === current
        ? { ...object, geometry: { ...current.geometry, x: target.x, y: target.y } }
        : object,
    ),
  }
}

function rectContainsPoint(
  geometry: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
): boolean {
  return x >= geometry.x && x < geometry.x + geometry.width && y >= geometry.y && y < geometry.y + geometry.height
}

/**
 * `tile-object` do TOPO (o mais recente no array) cujo retângulo contém o ponto
 * em pixels. Substitui `topTileObjectAt` (que casava por grade exata) no fluxo
 * de posição livre — arrastar/apagar precisam achar a peça onde ela realmente
 * está, não onde a grade cairia.
 */
export function topTileObjectAtPixel(doc: MapDocumentV1, x: number, y: number): TileObjectV1 | null {
  for (let index = doc.objects.length - 1; index >= 0; index--) {
    const object = doc.objects[index]
    if (object.type !== 'tile-object' || object.layerKey !== 'objects') continue
    if (rectContainsPoint(object.geometry, x, y)) return object
  }
  return null
}

/**
 * Objeto APAGÁVEL do topo sob o ponto (pixels), para a borracha por objeto.
 * Mobília tem prioridade: primeiro tenta o `tile-object` do topo; só se não
 * houver mobília sob o cursor cai nos objetos de decoração apagáveis
 * (áreas/colisão/link…), senão uma zona grande tornaria a mobília dentro dela
 * impossível de apagar.
 */
export function topErasableObjectAtPixel(doc: MapDocumentV1, x: number, y: number): MapObjectV1 | null {
  const furniture = topTileObjectAtPixel(doc, x, y)
  if (furniture) return furniture
  for (let index = doc.objects.length - 1; index >= 0; index--) {
    const object = doc.objects[index]
    if (!ERASABLE_OBJECT_TYPES.has(object.type)) continue
    if (rectContainsPoint(geometryBounds(object.geometry), x, y)) return object
  }
  return null
}

/**
 * Colisão sob o ponto (pixels), do topo para o fundo.
 *
 * Diferente de `topErasableObjectAtPixel`, NÃO passa pela mobília primeiro: a
 * borracha comum sempre acha o móvel por cima, e a colisão desenhada sobre ele
 * ficava inalcançável — justamente o retângulo que trava a passagem. Inclui a
 * colisão pareada de um móvel (`furnitureCollisionId`), que também é bloqueio.
 */
export function topCollisionAtPixel(doc: MapDocumentV1, x: number, y: number): MapObjectV1 | null {
  for (let index = doc.objects.length - 1; index >= 0; index--) {
    const object = doc.objects[index]
    if (object.type !== 'collision') continue
    if (rectContainsPoint(geometryBounds(object.geometry), x, y)) return object
  }
  return null
}

/** Remove um objeto por identidade (id). Devolve o novo documento e o removido (ou null). */
export function removeObjectById(
  doc: MapDocumentV1,
  id: string,
): { doc: MapDocumentV1; removed: MapObjectV1 | null } {
  const removed = doc.objects.find((object) => object.id === id) ?? null
  if (!removed) return { doc, removed: null }
  return { doc: { ...doc, objects: doc.objects.filter((object) => object !== removed) }, removed }
}

// ── Grupo atômico ─────────────────────────────────────────────────────────
// Um asset fatiado (ex.: cadeira = encosto + assento) é um GRUPO de
// tile-objects que nasce, arrasta e apaga junto, preservando os offsets
// internos. O grupo é marcado no id: `<groupId>__<dc>-<dr>`. A chave do grupo é
// a parte antes do `__`; um id sem `__` (mobília antiga/single) é seu próprio
// grupo (singleton) — retrocompatível, move/apaga individualmente como antes.
//
// O separador é `__` (não `:`) porque o id de um objeto precisa casar com
// `MapIdentifierSchema` (`office-map.ts`), que só admite `[A-Za-z0-9._-]` — dois
// pontos reprovariam o documento na validação estrutural do save. Nenhum id
// gerado (`grp-<base36>-<counter>`) contém `__`, então a divisão é sem ambiguidade.

/** Separador entre a chave do grupo e o sufixo do slice num id de tile-object. */
export const GROUP_ID_SEPARATOR = '__'

/** Chave do grupo de um id de tile-object. Id sem `__` é seu próprio grupo (singleton). */
export function groupKeyOf(id: string): string {
  const separator = id.indexOf(GROUP_ID_SEPARATOR)
  return separator === -1 ? id : id.slice(0, separator)
}

/**
 * Id do objeto `collision` pareado com um grupo de mobília (review PR 10555 —
 * item "colisão"). Como o sufixo é fixo (`collision`, nunca `<dc>-<dr>`),
 * `groupKeyOf` já o resolve pra mesma chave dos slices visuais — é o que
 * permite `moveGroupTo`/`removeGroup` moverem/removerem o par (visual +
 * colisão) SEM precisar saber da existência da colisão: qualquer objeto do
 * documento cuja `groupKeyOf(id)` bata com a chave do grupo anda/some junto.
 */
export function furnitureCollisionId(groupKey: string): string {
  return `${groupKey}${GROUP_ID_SEPARATOR}collision`
}

/** Se um id é o de uma colisão pareada com um grupo de mobília (vs. uma zona de colisão desenhada manualmente). */
export function isFurnitureCollisionId(id: string): boolean {
  return id.endsWith(`${GROUP_ID_SEPARATOR}collision`)
}

/** Slices (tile-objects) de um grupo, na ordem do documento — NÃO inclui a colisão pareada. */
export function tileObjectsInGroup(doc: MapDocumentV1, groupKey: string): TileObjectV1[] {
  return doc.objects.filter(
    (object): object is TileObjectV1 => object.type === 'tile-object' && groupKeyOf(object.id) === groupKey,
  )
}

export type FurnitureOrderDirection = 'forward' | 'front' | 'backward' | 'back'

/**
 * Reordena um grupo inteiro na pilha visual da sua layer.
 *
 * Só os slots ocupados por `tile-object` da mesma layer são substituídos:
 * áreas, links e a colisão pareada continuam exatamente onde estavam no
 * array. Os slices de cada grupo são reunidos e mantêm a ordem interna, para
 * um asset fatiado nunca se separar ao subir ou descer uma camada.
 */
export function reorderFurnitureGroup(
  doc: MapDocumentV1,
  groupKey: string,
  direction: FurnitureOrderDirection,
): { doc: MapDocumentV1; changed: boolean } {
  const selected = tileObjectsInGroup(doc, groupKey)
  if (selected.length === 0) return { doc, changed: false }

  const layerKey = selected[0].layerKey
  const layerObjects = doc.objects.filter(
    (object): object is TileObjectV1 => object.type === 'tile-object' && object.layerKey === layerKey,
  )
  const groupOrder: string[] = []
  const objectsByGroup = new Map<string, TileObjectV1[]>()
  for (const object of layerObjects) {
    const key = groupKeyOf(object.id)
    const members = objectsByGroup.get(key)
    if (members) members.push(object)
    else {
      groupOrder.push(key)
      objectsByGroup.set(key, [object])
    }
  }

  const currentIndex = groupOrder.indexOf(groupKey)
  if (currentIndex === -1) return { doc, changed: false }
  const targetIndex =
    direction === 'front'
      ? groupOrder.length - 1
      : direction === 'back'
        ? 0
        : direction === 'forward'
          ? Math.min(groupOrder.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1)
  if (targetIndex === currentIndex) return { doc, changed: false }

  const [movedKey] = groupOrder.splice(currentIndex, 1)
  groupOrder.splice(targetIndex, 0, movedKey)
  const reordered = groupOrder.flatMap((key) => objectsByGroup.get(key) ?? [])
  let visualIndex = 0
  const objects = doc.objects.map((object) => {
    if (object.type !== 'tile-object' || object.layerKey !== layerKey) return object
    return reordered[visualIndex++]
  })
  return { doc: { ...doc, objects }, changed: true }
}

/** Todo objeto (visual OU colisão pareada) de um grupo, na ordem do documento. */
function objectsInGroup(doc: MapDocumentV1, groupKey: string): MapObjectV1[] {
  return doc.objects.filter((object) => groupKeyOf(object.id) === groupKey)
}

/** Retângulo delimitador (união dos slices) de um grupo — `null` se o grupo não existe. */
export function groupBounds(
  doc: MapDocumentV1,
  groupKey: string,
): { x: number; y: number; width: number; height: number } | null {
  const members = tileObjectsInGroup(doc, groupKey)
  if (members.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const object of members) {
    minX = Math.min(minX, object.geometry.x)
    minY = Math.min(minY, object.geometry.y)
    maxX = Math.max(maxX, object.geometry.x + object.geometry.width)
    maxY = Math.max(maxY, object.geometry.y + object.geometry.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Acrescenta um asset fatiado como um GRUPO de tile-objects. `x,y` são o canto
 * superior-esquerdo desejado do grupo inteiro (clampeado pela BBOX do grupo, não
 * por slice, para os offsets internos nunca distorcerem perto da borda). Cada
 * slice vira `<groupId>:<dc>-<dr>` na posição origem + (dc·tw, dr·th).
 *
 * `collidable` (review PR 10555 — item "colisão"): quando `true`, acrescenta
 * TAMBÉM um objeto `collision` pareado (`furnitureCollisionId`) cobrindo a
 * bbox inteira do grupo — é o que faz o personagem parar de atravessar a
 * peça (`isMapTileWalkable`, `@legends/shared`, só olha pra objetos
 * `type === 'collision'`). Sem isso, mobília colocada pela paleta era
 * puramente visual. Categorias "pra sentar/deitar/pisar" (cadeira, sofá,
 * cama, tapete) nem chegam aqui com `collidable: true` — ver
 * `isCollidableAssetCategory` em `@legends/shared`.
 */
export function addTileObjectGroupAtPixel(
  doc: MapDocumentV1,
  input: {
    groupId: string
    x: number
    y: number
    tilesetId: string
    tileWidth: number
    tileHeight: number
    tiles: { dc: number; dr: number; tileIndex: number }[]
    collidable?: boolean
  },
): MapDocumentV1 {
  if (input.tiles.length === 0) return doc
  const cols = Math.max(...input.tiles.map((t) => t.dc)) + 1
  const rows = Math.max(...input.tiles.map((t) => t.dr)) + 1
  const origin = clampObjectTopLeft(doc, input.x, input.y, cols * input.tileWidth, rows * input.tileHeight)
  const members: TileObjectV1[] = input.tiles.map((tile) => ({
    id: `${input.groupId}${GROUP_ID_SEPARATOR}${tile.dc}-${tile.dr}`,
    layerKey: 'objects',
    type: 'tile-object',
    geometry: {
      kind: 'rectangle',
      x: origin.x + tile.dc * input.tileWidth,
      y: origin.y + tile.dr * input.tileHeight,
      width: input.tileWidth,
      height: input.tileHeight,
    },
    properties: { tilesetId: input.tilesetId, tileIndex: tile.tileIndex },
  }))
  const collision: MapObjectV1[] = input.collidable
    ? [
        {
          id: furnitureCollisionId(input.groupId),
          layerKey: 'collision',
          type: 'collision',
          geometry: { kind: 'rectangle', x: origin.x, y: origin.y, width: cols * input.tileWidth, height: rows * input.tileHeight },
          properties: {},
        },
      ]
    : []
  return { ...doc, objects: [...doc.objects, ...members, ...collision] }
}

/**
 * Move um grupo inteiro para que sua BBOX comece em (x,y) (clampeado). Todos os
 * slices deslocam pelo mesmo delta, preservando os offsets internos — e a
 * colisão pareada (se houver) junto, via `objectsInGroup` (que não filtra por
 * tipo). No-op por identidade quando o grupo não existe ou a origem não muda.
 */
export function moveGroupTo(doc: MapDocumentV1, groupKey: string, x: number, y: number): MapDocumentV1 {
  const bounds = groupBounds(doc, groupKey)
  if (!bounds) return doc
  const target = clampObjectTopLeft(doc, x, y, bounds.width, bounds.height)
  const dx = target.x - bounds.x
  const dy = target.y - bounds.y
  if (dx === 0 && dy === 0) return doc
  return {
    ...doc,
    objects: doc.objects.map((object) => {
      // Um grupo só contém `tile-object` (slices visuais) e, no máximo, UM
      // `collision` pareado (`furnitureCollisionId`) — os dois únicos tipos
      // que `addTileObjectGroupAtPixel` gera com este `groupKey`. Restrito a
      // eles (em vez de qualquer objeto cujo `groupKeyOf` bata) porque as
      // duas geometrias são sempre retângulos (`x/y` garantidos); um
      // `polygon` (zona) não tem esses campos.
      if (groupKeyOf(object.id) !== groupKey) return object
      if (object.type !== 'tile-object' && object.type !== 'collision') return object
      if (object.geometry.kind !== 'rectangle') return object
      return { ...object, geometry: { ...object.geometry, x: object.geometry.x + dx, y: object.geometry.y + dy } }
    }),
  }
}

/**
 * Gira um GRUPO de mobília em posição LIVRE (pixel) 90° em torno do centro da
 * sua bbox — usado tanto pelo arraste livre quanto pela ferramenta "Girar"
 * (clique único seleciona um grupo; R gira). Os tiles do documento são sempre
 * quadrados (`tileWidth === tileHeight`, validado na publicação — ver
 * `office-map.ts`), o que permite reaproveitar a troca dc↔dr por slice sem
 * exigir uma seleção alinhada à grade: o grupo pode estar em qualquer posição
 * de pixel, só os OFFSETS internos entre slices (sempre múltiplos do tile,
 * por construção de `addTileObjectGroupAtPixel`) importam.
 */
export function rotateGroupInPlace(
  doc: MapDocumentV1,
  groupKey: string,
  direction: 'cw' | 'ccw',
): { ok: true; doc: MapDocumentV1 } | { ok: false; reason: 'out-of-bounds' | 'empty' } {
  const members = tileObjectsInGroup(doc, groupKey)
  if (members.length === 0) return { ok: false, reason: 'empty' }
  const bounds = groupBounds(doc, groupKey)
  if (!bounds) return { ok: false, reason: 'empty' }

  const tileSize = members[0].geometry.width
  const cols = Math.round(bounds.width / tileSize)
  const rows = Math.round(bounds.height / tileSize)
  // Mesma construção de `rotateBlock` (arredondamento simétrico para os
  // deslocamentos de meio tile se cancelarem em rotações compostas), só que
  // direto em pixels — o grupo não precisa estar alinhado à grade do mapa.
  const halfDiff = (bounds.width - bounds.height) / 2
  const newX = bounds.x + roundSymmetric(halfDiff)
  const newY = bounds.y + roundSymmetric(-halfDiff)
  const newWidth = bounds.height
  const newHeight = bounds.width

  const { width: mapWidth, height: mapHeight } = mapPixelSize(doc)
  if (newX < 0 || newY < 0 || newX + newWidth > mapWidth || newY + newHeight > mapHeight) {
    return { ok: false, reason: 'out-of-bounds' }
  }

  const mapCell =
    direction === 'cw'
      ? (dc: number, dr: number) => ({ dc: rows - 1 - dr, dr: dc })
      : (dc: number, dr: number) => ({ dc: dr, dr: cols - 1 - dc })

  const membersSet = new Set<TileObjectV1>(members)
  const collisionId = furnitureCollisionId(groupKey)
  const objects = doc.objects.map((object) => {
    if (object.type === 'collision' && object.id === collisionId) {
      // A colisão pareada cobre a bbox INTEIRA (não é um slice de tileSize) —
      // só reposiciona/redimensiona pra nova bbox, sem a dança de dc/dr.
      return { ...object, geometry: { ...object.geometry, x: newX, y: newY, width: newWidth, height: newHeight } }
    }
    if (object.type !== 'tile-object' || !membersSet.has(object)) return object
    const dc = Math.round((object.geometry.x - bounds.x) / tileSize)
    const dr = Math.round((object.geometry.y - bounds.y) / tileSize)
    const mapped = mapCell(dc, dr)
    const orientation = rotateOrientation(orientationOf(object), direction)
    return {
      ...object,
      geometry: { ...object.geometry, x: newX + mapped.dc * tileSize, y: newY + mapped.dr * tileSize },
      properties: { ...object.properties, rotation: orientation.rotation, flipX: orientation.flipX },
    }
  })
  return { ok: true, doc: { ...doc, objects } }
}

/**
 * Espelha um GRUPO de mobília em posição LIVRE (pixel) — o equivalente de
 * `rotateGroupInPlace` para espelhamento: mesma ideia de trabalhar direto em
 * pixels (sem exigir um `TileRect` alinhado à grade), mas sem trocar
 * largura×altura nem mexer na colisão pareada (o espelhamento preserva as
 * dimensões da bbox, então a colisão — que só depende da bbox — não muda).
 */
export function flipGroupInPlace(
  doc: MapDocumentV1,
  groupKey: string,
  axis: 'horizontal' | 'vertical',
): { ok: true; doc: MapDocumentV1 } | { ok: false; reason: 'empty' } {
  const members = tileObjectsInGroup(doc, groupKey)
  if (members.length === 0) return { ok: false, reason: 'empty' }
  const bounds = groupBounds(doc, groupKey)
  if (!bounds) return { ok: false, reason: 'empty' }

  const tileSize = members[0].geometry.width
  const cols = Math.round(bounds.width / tileSize)
  const rows = Math.round(bounds.height / tileSize)
  const mapCell =
    axis === 'horizontal'
      ? (dc: number, dr: number) => ({ dc: cols - 1 - dc, dr })
      : (dc: number, dr: number) => ({ dc, dr: rows - 1 - dr })

  const membersSet = new Set<TileObjectV1>(members)
  const objects = doc.objects.map((object) => {
    if (object.type !== 'tile-object' || !membersSet.has(object)) return object
    const dc = Math.round((object.geometry.x - bounds.x) / tileSize)
    const dr = Math.round((object.geometry.y - bounds.y) / tileSize)
    const mapped = mapCell(dc, dr)
    const orientation = flipOrientation(orientationOf(object), axis)
    return {
      ...object,
      geometry: { ...object.geometry, x: bounds.x + mapped.dc * tileSize, y: bounds.y + mapped.dr * tileSize },
      properties: { ...object.properties, rotation: orientation.rotation, flipX: orientation.flipX },
    }
  })
  return { ok: true, doc: { ...doc, objects } }
}

/**
 * Remove todos os slices de um grupo E a colisão pareada, se houver (review
 * PR 10555 — sem isso, apagar mobília deixava um retângulo de colisão
 * fantasma bloqueando o lugar onde ela estava). Devolve o novo documento e os
 * removidos.
 */
export function removeGroup(
  doc: MapDocumentV1,
  groupKey: string,
): { doc: MapDocumentV1; removed: MapObjectV1[] } {
  const removed = objectsInGroup(doc, groupKey)
  if (removed.length === 0) return { doc, removed: [] }
  const removedSet = new Set<MapObjectV1>(removed)
  return { doc: { ...doc, objects: doc.objects.filter((object) => !removedSet.has(object)) }, removed }
}

/**
 * Remove SÓ a colisão pareada de um grupo de mobília, preservando os
 * `tile-object` visuais — a peça continua no mapa, só deixa de bloquear
 * passagem. `removed: null` quando o grupo não tem colisão pareada (ex.:
 * categoria não-colidível, ou já removida antes).
 */
export function removeFurnitureCollision(
  doc: MapDocumentV1,
  groupKey: string,
): { doc: MapDocumentV1; removed: MapObjectV1 | null } {
  const id = furnitureCollisionId(groupKey)
  const removed = doc.objects.find((object) => object.id === id) ?? null
  if (!removed) return { doc, removed: null }
  return { doc: { ...doc, objects: doc.objects.filter((object) => object.id !== id) }, removed }
}

function bboxContains(object: MapObjectV1, x: number, y: number): boolean {
  const g = object.geometry
  if (g.kind === 'rectangle') return x >= g.x && x <= g.x + g.width && y >= g.y && y <= g.y + g.height
  if (g.kind === 'point') return Math.abs(g.x - x) < 24 && Math.abs(g.y - y) < 24
  return false
}

/** Tipos de objeto de decoração que a borracha pode remover (spawn é estrutural). */
const ERASABLE_OBJECT_TYPES = new Set<MapObjectV1['type']>([
  'private-zone',
  'meeting-room',
  'collision',
  'link',
  'action-point',
  'door',
])

function geometryIntersectsRect(
  geometry: MapObjectV1['geometry'],
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const overlaps = (ax: number, aw: number, bx: number, bw: number) => ax < bx + bw && ax + aw > bx
  if (geometry.kind === 'rectangle') {
    return overlaps(geometry.x, geometry.width, rect.x, rect.width) && overlaps(geometry.y, geometry.height, rect.y, rect.height)
  }
  if (geometry.kind === 'point') {
    return geometry.x >= rect.x && geometry.x <= rect.x + rect.width && geometry.y >= rect.y && geometry.y <= rect.y + rect.height
  }
  // polígono: usa a bounding box (aproximação suficiente para apagar por arraste).
  const xs = geometry.points.map((p) => p.x)
  const ys = geometry.points.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return overlaps(minX, Math.max(...xs) - minX, rect.x, rect.width) && overlaps(minY, Math.max(...ys) - minY, rect.y, rect.height)
}

/** Retângulo delimitador (pixels) de uma geometria — usado para marcar a remoção. */
export function geometryBounds(
  geometry: MapObjectV1['geometry'],
): { x: number; y: number; width: number; height: number } {
  if (geometry.kind === 'rectangle') {
    return { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height }
  }
  if (geometry.kind === 'point') {
    return { x: geometry.x - 16, y: geometry.y - 16, width: 32, height: 32 }
  }
  const xs = geometry.points.map((p) => p.x)
  const ys = geometry.points.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

/**
 * Tipos de objeto que a paleta ÁREAS desenha — e que, portanto, precisam de um
 * retângulo visível enquanto o modo Decoração está aberto. Ficam de fora os
 * pontos (link, porta, spawn) e a mobília: aqueles não delimitam região, e o
 * sprite da mobília já é o próprio sinal visual.
 */
const AREA_OVERLAY_TYPES: ReadonlySet<MapObjectV1['type']> = new Set(['private-zone', 'meeting-room', 'collision'])

export interface AreaOverlay {
  id: string
  type: MapObjectV1['type']
  rect: { x: number; y: number; width: number; height: number }
}

/**
 * Áreas do documento que merecem overlay no modo Decoração — inclusive as JÁ
 * PUBLICADAS. Sem isto, quem abre a Decoração só enxerga o que desenhou nesta
 * sessão (`addEditZoneOverlay` é chamado no `handleRectEnd`), e acaba criando
 * uma sala de chamada em cima de outra por não ver a que já existia.
 *
 * A colisão pareada de um grupo de mobília (`furnitureCollisionId`) fica de
 * fora pelo mesmo motivo que em `repaintOverlays`: um retângulo vermelho por
 * cima de cada móvel seria ruído, não sinal.
 */
export function areaOverlays(doc: MapDocumentV1): AreaOverlay[] {
  return doc.objects
    .filter((object) => AREA_OVERLAY_TYPES.has(object.type) && !isFurnitureCollisionId(object.id))
    .map((object) => ({ id: object.id, type: object.type, rect: geometryBounds(object.geometry) }))
}

/**
 * Remove objetos de decoração (áreas, colisão, link, action-point, porta) cuja
 * geometria intersecta o retângulo apagado. Retorna o novo documento e os
 * objetos removidos (para a cena marcar/limpar visualmente cada um).
 *
 * `isProtected` (Task 5 — proteção de estruturas do admin) deixa de fora
 * objetos que o ator atual não pode remover — o padrão `() => false` preserva
 * o comportamento anterior para quem não passa o predicado.
 */
export function removeDecorationObjectsInRect(
  doc: MapDocumentV1,
  rect: { x: number; y: number; width: number; height: number },
  isProtected: (object: MapObjectV1) => boolean = () => false,
): { doc: MapDocumentV1; removed: MapObjectV1[] } {
  const removed: MapObjectV1[] = []
  const objects = doc.objects.filter((object) => {
    if (
      ERASABLE_OBJECT_TYPES.has(object.type) &&
      geometryIntersectsRect(object.geometry, rect) &&
      !isProtected(object)
    ) {
      removed.push(object)
      return false
    }
    return true
  })
  return { doc: removed.length ? { ...doc, objects } : doc, removed }
}

export function removeObjectAt(doc: MapDocumentV1, layerKey: string, x: number, y: number): MapDocumentV1 {
  const idx = [...doc.objects].reverse().findIndex((o) => o.layerKey === layerKey && bboxContains(o, x, y))
  if (idx === -1) return doc
  const realIndex = doc.objects.length - 1 - idx
  return { ...doc, objects: doc.objects.filter((_, i) => i !== realIndex) }
}

/**
 * Arredondamento simétrico em torno de zero (`f(-x) === -f(x)`). `Math.round`
 * NÃO tem essa propriedade — `Math.round(-0.5)` é `-0`, não `-1` —, e como os
 * deslocamentos de linha e coluna de uma rotação têm sinais opostos, usar
 * `Math.round` faz o erro de meio tile ACUMULAR em vez de cancelar: girar um
 * bloco 2×1 e desfazer o giro o movia uma célula na diagonal.
 */
function roundSymmetric(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}
