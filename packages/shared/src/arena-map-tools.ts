import { builtinTilesetAsset, type OfficeTilesetCatalogEntry } from './office-tileset-catalog'

/**
 * Ferramentas comuns aos cenários GERADOS da arena (campo de batalha e campo de
 * futebol).
 *
 * Fora do barril de propósito: não é contrato entre api e web, é detalhe de
 * quem monta documento em código. O que os dois lados consomem é
 * `arenaDocumentFor(mode)`.
 */

/** Lados de tile que o schema do documento aceita. */
const TILE_SIZES = [16, 32, 48, 64] as const
export type TileSize = (typeof TILE_SIZES)[number]

/**
 * Checagem de verdade, não cast: o catálogo é gerado, e um sheet com lado fora
 * da lista entraria calado no documento e só quebraria ao desenhar.
 */
export function tileSize(value: number, assetId: string): TileSize {
  const size = TILE_SIZES.find((candidate) => candidate === value)
  if (!size) throw new Error(`tileset ${assetId} tem lado ${value}, fora do schema`)
  return size
}

export function tilesetEntry(assetId: string): OfficeTilesetCatalogEntry {
  const entry = builtinTilesetAsset(assetId)
  if (!entry) throw new Error(`tileset da arena ausente do catálogo: ${assetId}`)
  return entry
}
