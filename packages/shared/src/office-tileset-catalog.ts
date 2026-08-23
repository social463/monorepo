import rawCatalog from './office-tileset-catalog.json'
import type { OfficeMapAssetDTO } from './office-map'

export interface OfficeTilesetCatalogEntry {
  id: string
  assetId: string
  name: string
  category: string
  url: string
  tileWidth: number
  tileHeight: number
  columns: number
  tileCount: number
  width: number
  height: number
}

export const OFFICE_TILESET_CATALOG = rawCatalog as OfficeTilesetCatalogEntry[]

export const OFFICE_TILESET_BY_ASSET_ID: Map<string, OfficeTilesetCatalogEntry> =
  new Map(OFFICE_TILESET_CATALOG.map((entry) => [entry.assetId, entry]))

export function isBuiltinTilesetAssetId(assetId: string): boolean {
  return assetId.startsWith('builtin:office/')
}

export function builtinTilesetAsset(assetId: string): OfficeTilesetCatalogEntry | null {
  return OFFICE_TILESET_BY_ASSET_ID.get(assetId) ?? null
}

export function officeTilesetCategories(): { category: string; entries: OfficeTilesetCatalogEntry[] }[] {
  const byCategory = new Map<string, OfficeTilesetCatalogEntry[]>()
  for (const entry of OFFICE_TILESET_CATALOG) {
    const list = byCategory.get(entry.category) ?? []
    list.push(entry)
    byCategory.set(entry.category, list)
  }
  return [...byCategory.entries()].map(([category, entries]) => ({ category, entries }))
}

export function builtinAssetToDTO(entry: OfficeTilesetCatalogEntry): OfficeMapAssetDTO {
  return {
    id: entry.id,
    fileName: `${entry.name}.png`,
    mimeType: 'image/png',
    sizeBytes: 0,
    width: entry.width,
    height: entry.height,
    checksum: entry.id,
    url: entry.url,
  }
}
