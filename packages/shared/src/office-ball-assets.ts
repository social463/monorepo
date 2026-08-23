import rawAssets from './office-asset-catalog.json'
import rawTilesets from './office-tileset-catalog.json'

/**
 * Quem é bola, do ponto de vista do runtime do escritório.
 *
 * Módulo FOLHA de propósito: só lê os dois catálogos (JSON) e não importa mais
 * nada do pacote. `office-map-runtime`, `office-pathfinding` e
 * `office-asset-catalog` precisam desta resposta, e qualquer um deles como
 * dono criaria ciclo de import com os outros dois.
 */

/** Sheet funcional dedicado (a bola de futebol que só existe para ser chutada). */
export const OFFICE_BALL_ASSET_PREFIX = 'builtin:office/ball-'

export function isOfficeBallAssetId(assetId: string): boolean {
  return assetId.startsWith(OFFICE_BALL_ASSET_PREFIX)
}

/**
 * Toda bola do catálogo é chutável, venha do sheet que vier — basquete, vôlei,
 * praia, as coloridas da escola e as de pilates, que ocupam 2×2.
 *
 * O casamento é por (sheet, tile), não pelo id da entrada do catálogo, porque
 * é só isso que um `tile-object` publicado guarda (`tilesetId` + `tileIndex`).
 * Assim mapas JÁ publicados ganham a bola chutável sem precisar recolocá-la.
 */
const BALL_ENTRY_PATTERN = /(^|\/)bola-/

/** A que bola do catálogo um tile publicado pertence, e de que tamanho ela é. */
export interface OfficeBallCell {
  /** Id da entrada do catálogo (ex.: `gym/bola-de-pilates-azul`). */
  entryId: string
  /** Tamanho da peça inteira, em tiles. */
  cols: number
  rows: number
}

interface CatalogAsset {
  id: string
  sheet: string
  col: number
  row: number
  cols: number
  rows: number
}

interface CatalogTileset {
  assetId: string
  columns: number
}

const BALL_CELLS: ReadonlyMap<string, OfficeBallCell> = (() => {
  const columnsByAssetId = new Map(
    (rawTilesets as CatalogTileset[]).map((tileset) => [tileset.assetId, tileset.columns]),
  )
  const cells = new Map<string, OfficeBallCell>()
  for (const entry of rawAssets as CatalogAsset[]) {
    if (!BALL_ENTRY_PATTERN.test(entry.id)) continue
    for (const size of [16, 32, 48]) {
      const assetId = `builtin:office/${entry.sheet}-${size}`
      const columns = columnsByAssetId.get(assetId)
      if (columns === undefined) continue
      // Uma peça de 2×2 ocupa quatro tiles do sheet; qualquer um deles
      // identifica a mesma bola.
      for (let dr = 0; dr < entry.rows; dr += 1) {
        for (let dc = 0; dc < entry.cols; dc += 1) {
          const tileIndex = (entry.row + dr) * columns + entry.col + dc
          cells.set(`${assetId}#${tileIndex}`, {
            entryId: entry.id,
            cols: entry.cols,
            rows: entry.rows,
          })
        }
      }
    }
  }
  return cells
})()

/** A bola a que este tile publicado pertence, ou `null` se não é bola. */
export function officeBallCell(assetId: string, tileIndex: number): OfficeBallCell | null {
  const cell = BALL_CELLS.get(`${assetId}#${tileIndex}`)
  if (cell) return cell
  // O sheet funcional tem um tile só, e ele é a bola inteira.
  if (isOfficeBallAssetId(assetId)) return { entryId: 'ball/bola-de-futebol', cols: 1, rows: 1 }
  return null
}

/** Se o tile publicado (sheet + índice) faz parte de uma bola. */
export function isOfficeBallTile(assetId: string, tileIndex: number): boolean {
  return officeBallCell(assetId, tileIndex) !== null
}

/** Quantos tiles do catálogo pertencem a alguma bola — grade de proteção dos testes. */
export function officeBallTileCount(): number {
  return BALL_CELLS.size
}
