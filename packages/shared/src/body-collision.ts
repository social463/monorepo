import type { MapDocumentV1, MapObjectV1 } from './index'
import { pointInMapObject } from './office-pathfinding'

/**
 * Colisão de corpo contínuo: o mapa do escritório, rasterizado FINO.
 *
 * Serve à arena e ao escritório — os dois publicam `MapDocumentV1`, e os dois
 * movem corpos em pixel.
 *
 * A grade do escritório (`officeWalkGrid`) marca um tile como bloqueado quando
 * o **centro dele** cai dentro de um objeto de colisão. Para quem anda em
 * grade isso é exato — a pessoa está sempre no centro de um tile, então o
 * centro é a única amostra que importa.
 *
 * Para um corpo CONTÍNUO, a mesma regra é falsa: uma parede que cubra só metade
 * do tile deixa o centro livre, o tile sai desbloqueado e o personagem
 * atravessa a parede. O sintoma seria "às vezes atravessa", intermitente e
 * dependente de como o admin desenhou o mapa — o pior tipo de bug para achar
 * depois.
 *
 * Aqui o mecanismo é o mesmo (varrer uma vez, consultar O(1)); o que muda é a
 * resolução: `BODY_COLLISION_SUB` amostras por lado dentro de cada tile.
 */

/**
 * Subdivisões por lado do tile. Com 4, a célula de colisão de um tile de 32px
 * tem 8px — menor que qualquer peça de mobília do catálogo, e ainda 16× mais
 * barata em memória que rasterizar por pixel.
 */
export const BODY_COLLISION_SUB = 4

export interface BodyCollisionGrid {
  /** Células por linha (tiles × sub). */
  width: number
  /** Células por coluna. */
  height: number
  /** Lado da célula em pixels. */
  cellWidth: number
  cellHeight: number
  /** Uma célula, um byte. */
  blocked: Uint8Array
}

interface CachedGrid extends BodyCollisionGrid {
  objectCount: number
}

// Memoizado pela IDENTIDADE de `document.objects`, como a grade do escritório:
// documento novo sempre traz array novo (`cloneDocument`, `{...doc, objects}`).
// Mutar um documento no lugar sem trocar o array serviria grade velha.
const gridCache = new WeakMap<object, CachedGrid>()

/** Caixa envolvente do objeto, em índices de célula (recortada ao mapa). */
function cellRange(
  object: MapObjectV1,
  cellWidth: number,
  cellHeight: number,
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
    fromX: Math.max(0, Math.floor(minX / cellWidth)),
    toX: Math.min(width - 1, Math.floor(maxX / cellWidth)),
    fromY: Math.max(0, Math.floor(minY / cellHeight)),
    toY: Math.min(height - 1, Math.floor(maxY / cellHeight)),
  }
}

/** Rasteriza a colisão do documento em células de `1/sub` de tile. */
export function bodyCollisionGrid(
  document: MapDocumentV1,
  sub: number = BODY_COLLISION_SUB,
): BodyCollisionGrid {
  const cached = gridCache.get(document.objects)
  if (
    cached &&
    cached.objectCount === document.objects.length &&
    cached.width === document.map.width * sub &&
    cached.height === document.map.height * sub
  ) {
    return cached
  }

  const { tileWidth, tileHeight } = document.map
  const cellWidth = tileWidth / sub
  const cellHeight = tileHeight / sub
  const width = document.map.width * sub
  const height = document.map.height * sub
  const blocked = new Uint8Array(width * height)

  for (const object of document.objects) {
    if (object.type !== 'collision') continue
    // Só as células da caixa envolvente do objeto. Varrer a grade inteira por
    // objeto é o custo que a grade do escritório já documenta ter derrubado o
    // pathfinder: o mapa ativo passa de 2.000 objetos, e aqui há 16 células
    // por tile.
    const range = cellRange(object, cellWidth, cellHeight, width, height)
    for (let cy = range.fromY; cy <= range.toY; cy += 1) {
      // Centro da CÉLULA, não do tile: é a amostra na resolução em que a
      // arena de fato consulta.
      const py = cy * cellHeight + cellHeight / 2
      for (let cx = range.fromX; cx <= range.toX; cx += 1) {
        const cell = cy * width + cx
        if (blocked[cell] === 1) continue
        const px = cx * cellWidth + cellWidth / 2
        if (pointInMapObject(px, py, object)) blocked[cell] = 1
      }
    }
  }

  const grid: CachedGrid = {
    width,
    height,
    cellWidth,
    cellHeight,
    blocked,
    objectCount: document.objects.length,
  }
  gridCache.set(document.objects, grid)
  return grid
}

/**
 * Um ponto em PIXEL está bloqueado? Em pixel, e não em tile, porque quem
 * chama é movimento contínuo — converter para tile antes de perguntar jogaria
 * fora justamente a resolução que este módulo existe para ter.
 *
 * Fora do mapa é bloqueado: quem chama não precisa checar limites, mesma
 * garantia de `isWalkable` e `isMapTileWalkable`.
 */
export function bodyBlockedAt(grid: BodyCollisionGrid, px: number, py: number): boolean {
  const cx = Math.floor(px / grid.cellWidth)
  const cy = Math.floor(py / grid.cellHeight)
  if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) return true
  return grid.blocked[cy * grid.width + cx] === 1
}

/**
 * Uma caixa (centro + meia-largura/altura) encosta em algo sólido?
 *
 * Amostra os quatro cantos e o meio de cada lado, e não só os cantos: uma
 * coluna mais estreita que o corpo passaria entre dois cantos sem tocar
 * nenhum, e o personagem a atravessaria pelo meio.
 */
export function bodyBoxBlocked(
  grid: BodyCollisionGrid,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
): boolean {
  const left = x - halfWidth
  const right = x + halfWidth
  const top = y - halfHeight
  const bottom = y + halfHeight
  const xs = [left, x, right]
  const ys = [top, y, bottom]
  for (const py of ys) {
    for (const px of xs) {
      if (bodyBlockedAt(grid, px, py)) return true
    }
  }
  return false
}
