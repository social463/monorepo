import { describe, expect, it } from 'vitest'
import {
  OFFICE_ASSET_CATALOG,
  OFFICE_ASSET_CATEGORIES,
  isCollidableAssetCategory,
  officeAssetCategories,
  officeAssetTilesetId,
  officeAssetsForTileSize,
} from './office-asset-catalog'
import { builtinTilesetAsset } from './office-tileset-catalog'

describe('office-asset-catalog', () => {
  it('todo asset referencia um sheet builtin existente em 48px (tamanho sempre presente)', () => {
    for (const asset of OFFICE_ASSET_CATALOG) {
      const tileset = builtinTilesetAsset(officeAssetTilesetId(asset.sheet, 48))
      expect(tileset, `${asset.id} @ 48px`).not.toBeNull()
    }
  })

  it('officeAssetsForTileSize filtra assets sem variante naquele tamanho', () => {
    // Todos os sheets existem em 32px; alguns (condominium, japanese) não têm 16px.
    expect(officeAssetsForTileSize(32).length).toBe(OFFICE_ASSET_CATALOG.length)
    expect(officeAssetsForTileSize(16).every((a) => builtinTilesetAsset(officeAssetTilesetId(a.sheet, 16)) !== null)).toBe(true)
  })

  it('toda região cabe na grade do sheet (col/row/cols/rows dentro do tileset)', () => {
    for (const asset of OFFICE_ASSET_CATALOG) {
      const tileset = builtinTilesetAsset(officeAssetTilesetId(asset.sheet, 48))!
      const gridRows = tileset.tileCount / tileset.columns
      expect(asset.cols, `${asset.id} cols`).toBeGreaterThan(0)
      expect(asset.rows, `${asset.id} rows`).toBeGreaterThan(0)
      expect(asset.col + asset.cols, `${asset.id} colunas`).toBeLessThanOrEqual(tileset.columns)
      expect(asset.row + asset.rows, `${asset.id} linhas`).toBeLessThanOrEqual(gridRows)
    }
  })

  it('ids são únicos', () => {
    const ids = OFFICE_ASSET_CATALOG.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('toda categoria usada é canônica (trava esparramamento)', () => {
    const canon = new Set<string>(OFFICE_ASSET_CATEGORIES)
    const fora = [...new Set(OFFICE_ASSET_CATALOG.map((a) => a.category))].filter((c) => !canon.has(c))
    expect(fora, `categorias fora da canônica: ${fora.join(', ')}`).toEqual([])
  })

  it('a ordem das abas segue OFFICE_ASSET_CATEGORIES', () => {
    const order = officeAssetCategories().map((c) => c.category)
    const rank = (c: string) => OFFICE_ASSET_CATEGORIES.indexOf(c as (typeof OFFICE_ASSET_CATEGORIES)[number])
    for (let i = 1; i < order.length; i++) {
      expect(rank(order[i])).toBeGreaterThan(rank(order[i - 1]))
    }
  })

  it('officeAssetCategories agrupa por categoria preservando a ordem', () => {
    const categories = officeAssetCategories()
    expect(categories.length).toBeGreaterThan(0)
    const flat = categories.flatMap((c) => c.entries)
    expect(flat.length).toBe(OFFICE_ASSET_CATALOG.length)
  })

  it('isCollidableAssetCategory: peças ocupáveis não geram colisão estática; as demais bloqueiam por padrão', () => {
    const nonCollidable = new Set(['Tapete', 'Cadeira', 'Sofá', 'Cama', 'Veículo'])
    for (const category of OFFICE_ASSET_CATEGORIES) {
      expect(isCollidableAssetCategory(category), category).toBe(!nonCollidable.has(category))
    }
  })
})
