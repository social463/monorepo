import { describe, expect, it } from 'vitest'
import {
  OFFICE_TILESET_CATALOG, isBuiltinTilesetAssetId, builtinTilesetAsset,
  officeTilesetCategories, builtinAssetToDTO,
} from './office-tileset-catalog'

describe('office tileset catalog', () => {
  it('expõe entradas builtin com id/assetId iguais', () => {
    expect(OFFICE_TILESET_CATALOG.length).toBeGreaterThan(0)
    for (const e of OFFICE_TILESET_CATALOG) {
      expect(e.id).toBe(e.assetId)
      expect(isBuiltinTilesetAssetId(e.assetId)).toBe(true)
      expect(e.columns * Math.floor(e.height / e.tileHeight)).toBe(e.tileCount)
    }
  })
  it('resolve por assetId e agrupa por categoria', () => {
    const first = OFFICE_TILESET_CATALOG[0]
    expect(builtinTilesetAsset(first.assetId)?.id).toBe(first.id)
    expect(builtinTilesetAsset('builtin:office/inexistente')).toBeNull()
    expect(isBuiltinTilesetAssetId('outro-asset')).toBe(false)
    const groups = officeTilesetCategories()
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(OFFICE_TILESET_CATALOG.length)
  })
  it('gera DTO sintético de asset', () => {
    const dto = builtinAssetToDTO(OFFICE_TILESET_CATALOG[0])
    expect(dto.sizeBytes).toBe(0)
    expect(dto.url).toMatch(/^\/office\/tilesets\//)
  })
})
