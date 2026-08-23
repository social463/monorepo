import { describe, expect, it } from 'vitest'
import { MapTilesetV1Schema, OFFICE_TILESET_CATALOG } from './index'

const baseTileset = (assetId: string) => ({
  id: 'ts1', assetId, name: 'X', tileWidth: 48, tileHeight: 48, columns: 4, tileCount: 8,
})

describe('MapTilesetV1Schema.assetId', () => {
  it('aceita identificador normal (asset enviado)', () => {
    expect(MapTilesetV1Schema.safeParse(baseTileset('abc-123')).success).toBe(true)
  })
  it('aceita assetId builtin com dois-pontos e barra', () => {
    expect(MapTilesetV1Schema.safeParse(baseTileset(OFFICE_TILESET_CATALOG[0].assetId)).success).toBe(true)
    expect(MapTilesetV1Schema.safeParse(baseTileset('builtin:office/modern-office')).success).toBe(true)
  })
  it('rejeita assetId com caractere fora do padrão', () => {
    expect(MapTilesetV1Schema.safeParse(baseTileset('espaço inválido')).success).toBe(false)
    expect(MapTilesetV1Schema.safeParse(baseTileset('builtin:other/x')).success).toBe(false)
  })
})
