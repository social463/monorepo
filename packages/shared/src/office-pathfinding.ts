import { isOfficeBallTile } from './office-ball-assets'
import type {
  Direction,
  MapDocumentV1,
  MapObjectV1,
  OfficeKart,
  TilePosition,
} from './index'

/**
 * Custo extra de ATRAVESSAR uma zona (sala de reunião / zona privada) que não é
 * nem a de onde se sai nem a do destino.
 *
 * É o que transforma a busca em Dijkstra de verdade: com custo uniforme, o
 * caminho mais curto entre dois pontos do corredor corta por dentro da primeira
 * sala que estiver no meio — e aí o servidor recusa o passo na porta
 * (`roomEntryDenial`: sala trancada, lotada, allowlist), o cliente recalcula a
 * MESMA rota, e o personagem fica batendo na porta pra sempre. Custo alto o
 * bastante para preferir dar a volta pelo corredor, e finito de propósito:
 * quando a sala é a ÚNICA passagem (sala em corredor, mapa recortado), o
 * caminho ainda existe.
 */
export const ZONE_DETOUR_COST = 8

/**
 * Separador do id de um grupo de mobília e sufixo da colisão pareada com ele
 * (ver `decorationDoc` no front, quem os gera). Repetidos aqui — e não
 * importados — porque a grade é do pacote compartilhado e o editor é do web;
 * o que atravessa é o FORMATO do id, que já está gravado em todo mapa
 * publicado.
 */
const GROUP_ID_SEPARATOR = '__'
const FURNITURE_COLLISION_SUFFIX = `${GROUP_ID_SEPARATOR}collision`

/**
 * Colisões pareadas com uma BOLA. A paleta dá colisão a toda peça de
 * `Esporte`, então as bolas colocadas antes de elas serem chutáveis carregam
 * um retângulo sólido — que, depois do primeiro chute, viraria uma parede
 * invisível parada onde a bola estava. Bola não bloqueia passagem: some com
 * ela da grade, o que também deixa alcançar a bola por qualquer lado.
 */
function ballCollisionIds(document: MapDocumentV1): ReadonlySet<string> {
  // `tilesets` ausente: documento parcial (fixture de teste, mapa legado).
  // Sem sheet não há como saber o que é bola — e não havendo bola, não há
  // colisão de bola para ignorar.
  const assetIdByTilesetId = new Map((document.tilesets ?? []).map((tileset) => [tileset.id, tileset.assetId]))
  const ids = new Set<string>()
  for (const object of document.objects) {
    if (object.type !== 'tile-object') continue
    const assetId = assetIdByTilesetId.get(object.properties.tilesetId)
    if (!assetId || !isOfficeBallTile(assetId, object.properties.tileIndex)) continue
    const separator = object.id.indexOf(GROUP_ID_SEPARATOR)
    const groupKey = separator === -1 ? object.id : object.id.slice(0, separator)
    ids.add(`${groupKey}${FURNITURE_COLLISION_SUFFIX}`)
  }
  return ids
}

/** Passo normal, em piso aberto. */
const STEP_COST = 1

const DIRECTION_ORDER: readonly Direction[] = ['up', 'down', 'left', 'right']

const DELTAS: Record<Direction, TilePosition> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/**
 * Ponto (em pixels) dentro da geometria de um objeto do mapa. Único teste
 * geométrico do runtime — `office-map-runtime` importa daqui em vez de manter
 * uma cópia, porque colisão que diverge entre dois pontos do código é o bug que
 * volta como "personagem atravessa a parede" ou "passo recusado sem motivo".
 */
export function pointInMapObject(px: number, py: number, object: MapObjectV1): boolean {
  const geometry = object.geometry
  if (geometry.kind === 'point') return geometry.x === px && geometry.y === py
  if (geometry.kind === 'rectangle') {
    return (
      px >= geometry.x &&
      px < geometry.x + geometry.width &&
      py >= geometry.y &&
      py < geometry.y + geometry.height
    )
  }
  let inside = false
  for (
    let current = 0, previous = geometry.points.length - 1;
    current < geometry.points.length;
    previous = current, current += 1
  ) {
    const a = geometry.points[current]!
    const b = geometry.points[previous]!
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/**
 * O mapa rasterizado uma vez: um byte de colisão e um id de zona por tile.
 *
 * Existe por causa do custo. A checagem tile a tile varria `document.objects`
 * inteiro (o mapa ativo da EMR passa de 2.000 objetos, e o teto é 10.000), e o
 * pathfinder chamava isso uma vez por vizinho visitado: um único traçado num
 * mapa 60×40 levava mais de um segundo de CPU no navegador. Como a rota é
 * refeita a cada passo de quem está sendo seguido, o resultado era o passo
 * estourar o timeout antes de sair — o personagem "perdido no mapa". Aqui a
 * varredura acontece UMA vez por documento (O(objetos + tiles)) e cada consulta
 * vira um índice de array.
 */
export interface OfficeWalkGrid {
  width: number
  height: number
  /** 1 = cenário sólido (objeto `collision` cobrindo o centro do tile). */
  blocked: Uint8Array
  /** Índice 1-based da zona que cobre o tile; 0 = piso aberto. */
  zone: Int32Array
}

interface CachedGrid extends OfficeWalkGrid {
  /** Quantos objetos o documento tinha quando a grade foi construída. */
  objectCount: number
}

/**
 * Cache por ARRAY de objetos (e não pelo documento): publicação, decoração e
 * edição sempre produzem um `objects` novo (`cloneDocument`, `{...doc, objects}`),
 * então a identidade do array é o sinal natural de "o mapa mudou". O tamanho
 * cobre o caso do editor, que empurra objeto no array clonado.
 */
const gridCache = new WeakMap<readonly MapObjectV1[], CachedGrid>()

/** Faixa de tiles tocada pela bbox da geometria, já recortada ao mapa. */
function tileRange(
  object: MapObjectV1,
  tileWidth: number,
  tileHeight: number,
  width: number,
  height: number,
): { fromX: number; toX: number; fromY: number; toY: number } {
  const geometry = object.geometry
  let minX: number
  let minY: number
  let maxX: number
  let maxY: number
  if (geometry.kind === 'rectangle') {
    minX = geometry.x
    minY = geometry.y
    maxX = geometry.x + geometry.width
    maxY = geometry.y + geometry.height
  } else if (geometry.kind === 'point') {
    minX = geometry.x
    minY = geometry.y
    maxX = geometry.x
    maxY = geometry.y
  } else {
    minX = Infinity
    minY = Infinity
    maxX = -Infinity
    maxY = -Infinity
    for (const point of geometry.points) {
      if (point.x < minX) minX = point.x
      if (point.y < minY) minY = point.y
      if (point.x > maxX) maxX = point.x
      if (point.y > maxY) maxY = point.y
    }
  }
  return {
    fromX: Math.max(0, Math.floor(minX / tileWidth)),
    toX: Math.min(width - 1, Math.floor(maxX / tileWidth)),
    fromY: Math.max(0, Math.floor(minY / tileHeight)),
    toY: Math.min(height - 1, Math.floor(maxY / tileHeight)),
  }
}

/**
 * Grade do documento, memoizada. O teste de cada tile continua sendo o CENTRO
 * dentro da geometria — mesma regra de `isMapTileWalkable` e `mapZoneAtTile`, só
 * que avaliada de uma vez por objeto em vez de uma vez por consulta.
 */
export function officeWalkGrid(document: MapDocumentV1): OfficeWalkGrid {
  const cached = gridCache.get(document.objects)
  if (
    cached &&
    cached.objectCount === document.objects.length &&
    cached.width === document.map.width &&
    cached.height === document.map.height
  ) {
    return cached
  }

  const { width, height, tileWidth, tileHeight } = document.map
  const blocked = new Uint8Array(width * height)
  const zone = new Int32Array(width * height)
  let zoneCount = 0

  const ballCollisions = ballCollisionIds(document)

  for (const object of document.objects) {
    const isZone = object.type === 'meeting-room' || object.type === 'private-zone'
    if (object.type !== 'collision' && !isZone) continue
    if (object.type === 'collision' && ballCollisions.has(object.id)) continue
    const zoneId = isZone ? (zoneCount += 1) : 0
    const range = tileRange(object, tileWidth, tileHeight, width, height)
    for (let y = range.fromY; y <= range.toY; y += 1) {
      const centerY = y * tileHeight + tileHeight / 2
      for (let x = range.fromX; x <= range.toX; x += 1) {
        const centerX = x * tileWidth + tileWidth / 2
        if (!pointInMapObject(centerX, centerY, object)) continue
        const cell = y * width + x
        if (isZone) {
          // A PRIMEIRA zona vence, para casar com o `.find()` de `mapZoneAtTile`.
          if (zone[cell] === 0) zone[cell] = zoneId
        } else {
          blocked[cell] = 1
        }
      }
    }
  }

  const grid: CachedGrid = { width, height, blocked, zone, objectCount: document.objects.length }
  gridCache.set(document.objects, grid)
  return grid
}

export interface OfficePathOptions {
  /** `true` = chegar ao próprio tile-alvo; `false` (padrão) = parar adjacente. */
  exact?: boolean
  karts?: readonly OfficeKart[]
  /**
   * Tiles que o servidor RECUSOU nesta caminhada (porta de sala trancada,
   * lotada, fora da allowlist). O cliente não conhece essas regras — ele só
   * descobre batendo —, então quem caminha vai acumulando o que aprendeu e
   * manda de volta pra cá. Sem isso o recálculo devolve a mesma rota e o
   * personagem insiste na mesma porta até desistir.
   */
  blocked?: Iterable<TilePosition>
  /**
   * Alvo inalcançável: `'closest'` caminha até o tile alcançável mais perto
   * dele (clique direito em cima de uma mesa, de uma parede ou de uma sala
   * fechada — "chegue o mais perto que der" é o que a pessoa quis dizer).
   * `'none'` (padrão) devolve `null`, que é o contrato antigo.
   */
  fallback?: 'none' | 'closest'
}

/**
 * Dijkstra no grid do escritório: menor CUSTO de `from` até o alvo, com o custo
 * de cada passo dado pela grade (piso aberto x atravessar zona alheia).
 *
 * Custo uniforme cairia em BFS; o que paga o Dijkstra aqui é o `ZONE_DETOUR_COST`,
 * que faz a rota preferir o corredor a cortar por dentro de uma sala em que o
 * passo pode ser recusado na porta.
 *
 * Devolve a lista de direções (`[]` quando já se está no alvo), ou `null`
 * quando não há caminho e não foi pedido `fallback: 'closest'`.
 *
 * O tile de PARTIDA ignora karts e recusas: quem acabou de estacionar está em
 * cima do próprio veículo e ainda assim precisa sair andando.
 */
export function findOfficePath(
  document: MapDocumentV1,
  from: TilePosition,
  to: TilePosition,
  options: OfficePathOptions = {},
): Direction[] | null {
  const grid = officeWalkGrid(document)
  const { width, height } = grid
  const exact = options.exact ?? false
  const cellOf = (x: number, y: number) => y * width + x

  const closedTiles = new Set<number>()
  for (const kart of options.karts ?? []) {
    if (!kart.riderUserId) closedTiles.add(cellOf(kart.x, kart.y))
  }
  for (const tile of options.blocked ?? []) closedTiles.add(cellOf(tile.x, tile.y))

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height
  const passable = (x: number, y: number) =>
    inside(x, y) && grid.blocked[cellOf(x, y)] === 0 && !closedTiles.has(cellOf(x, y))

  const isGoal = (x: number, y: number) =>
    exact
      ? x === to.x && y === to.y && passable(x, y)
      : Math.abs(x - to.x) + Math.abs(y - to.y) === 1 && passable(x, y)

  if (isGoal(from.x, from.y)) return []
  // Partida fora do mapa ou dentro do cenário: não há o que traçar.
  if (!inside(from.x, from.y) || grid.blocked[cellOf(from.x, from.y)] === 1) return null

  const startZone = grid.zone[cellOf(from.x, from.y)]
  const goalZone = inside(to.x, to.y) ? grid.zone[cellOf(to.x, to.y)] : 0

  const cells = width * height
  const dist = new Int32Array(cells).fill(-1)
  const cameFrom = new Int32Array(cells).fill(-1)
  const cameBy = new Int8Array(cells).fill(-1)
  const start = cellOf(from.x, from.y)
  dist[start] = 0

  // Heap binário de mínimo com o par (custo, tile) empacotado num número só —
  // `cell` cabe em 17 bits (teto de 200×200 tiles) e o custo máximo de uma rota
  // não chega perto de estourar o inteiro exato do double.
  const CELL_BITS = 131_072
  const heap: number[] = [start]
  const push = (value: number) => {
    heap.push(value)
    let index = heap.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (heap[parent]! <= heap[index]!) break
      const swap = heap[parent]!
      heap[parent] = heap[index]!
      heap[index] = swap
      index = parent
    }
  }
  const pop = () => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let index = 0
      for (;;) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (left < heap.length && heap[left]! < heap[smallest]!) smallest = left
        if (right < heap.length && heap[right]! < heap[smallest]!) smallest = right
        if (smallest === index) break
        const swap = heap[smallest]!
        heap[smallest] = heap[index]!
        heap[index] = swap
        index = smallest
      }
    }
    return top
  }

  const rebuild = (goal: number): Direction[] => {
    const path: Direction[] = []
    for (let cell = goal; cell !== start; cell = cameFrom[cell]!) {
      path.push(DIRECTION_ORDER[cameBy[cell]!]!)
    }
    return path.reverse()
  }

  const wantsClosest = options.fallback === 'closest'
  let closestCell = -1
  // Começa medindo a PRÓPRIA partida: o fallback só vale a pena se existir um
  // tile estritamente mais perto do alvo. Sem essa âncora, o primeiro tile que
  // sai da fila viraria "o mais próximo" e a pessoa andaria para longe do que
  // clicou.
  let closestDistance = Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
  let closestCost = 0

  while (heap.length > 0) {
    const packed = pop()
    const cell = packed % CELL_BITS
    const cost = (packed - cell) / CELL_BITS
    // Entrada obsoleta: o tile já saiu da fila com custo menor.
    if (cost > dist[cell]!) continue
    const x = cell % width
    const y = (cell - x) / width
    // O alvo é conferido ao SAIR da fila, não ao relaxar o vizinho: com custo
    // não-uniforme, o primeiro caminho que toca o alvo não é necessariamente o
    // mais barato — só o que já foi extraído com o menor custo é definitivo.
    if (cell !== start && isGoal(x, y)) return rebuild(cell)

    if (wantsClosest && cell !== start) {
      const distance = Math.abs(x - to.x) + Math.abs(y - to.y)
      if (distance < closestDistance || (distance === closestDistance && cost < closestCost)) {
        closestDistance = distance
        closestCost = cost
        closestCell = cell
      }
    }

    for (let index = 0; index < DIRECTION_ORDER.length; index += 1) {
      const delta = DELTAS[DIRECTION_ORDER[index]!]
      const nx = x + delta.x
      const ny = y + delta.y
      if (!passable(nx, ny)) continue
      const next = cellOf(nx, ny)
      const tileZone = grid.zone[next]!
      const detour = tileZone !== 0 && tileZone !== goalZone && tileZone !== startZone
      const nextCost = cost + STEP_COST + (detour ? ZONE_DETOUR_COST : 0)
      if (dist[next] !== -1 && dist[next]! <= nextCost) continue
      dist[next] = nextCost
      cameFrom[next] = cell
      cameBy[next] = index
      push(nextCost * CELL_BITS + next)
    }
  }

  if (closestCell >= 0) return rebuild(closestCell)
  return null
}
