import { describe, expect, it } from 'vitest'
import {
  BODY_HALF_HEIGHT,
  BODY_HALF_WIDTH,
  ARENA_MAP_HEIGHT,
  ARENA_MAP_WIDTH,
  bodyBoxBlocked,
  bodyCollisionGrid,
  arenaMapAssets,
  arenaMapDocument,
  bodySpawnPoint,
  mapSpawnTiles,
} from './index'

const doc = arenaMapDocument()
const grid = bodyCollisionGrid(doc)
const TILE = doc.map.tileWidth

const livre = (x: number, y: number) =>
  !bodyBoxBlocked(grid, x, y, BODY_HALF_WIDTH, BODY_HALF_HEIGHT)

describe('arenaMapDocument', () => {
  it('tem o tamanho declarado e sai igual toda vez', () => {
    expect(doc.map.width).toBe(ARENA_MAP_WIDTH)
    expect(doc.map.height).toBe(ARENA_MAP_HEIGHT)
    // Determinístico: servidor e cliente geram o SEU documento chamando esta
    // função. Se ela variasse, cada lado colidiria em lugares diferentes.
    expect(JSON.stringify(arenaMapDocument())).toBe(JSON.stringify(doc))
  })

  it('declara todos os tilesets que referencia', () => {
    const declarados = new Set(doc.tilesets.map((t) => t.id))
    for (const layer of doc.layers) {
      if (layer.type !== 'tile') continue
      for (const ref of layer.data) {
        if (ref) expect(declarados).toContain(ref.slice(0, ref.lastIndexOf(':')))
      }
    }
    for (const object of doc.objects) {
      if (object.type === 'tile-object') expect(declarados).toContain(object.properties.tilesetId)
    }
  })

  it('os assets cobrem os tilesets do documento', () => {
    const urls = new Set(arenaMapAssets().map((a) => a.id))
    for (const tileset of doc.tilesets) expect(urls).toContain(tileset.assetId)
  })

  // Mapa assimétrico dá vantagem de lado, e isso só aparece depois do modo por
  // times pronto — quando refazer o mapa já custa caro.
  it('é espelhado no eixo vertical', () => {
    const solidos = new Set<string>()
    for (let y = 0; y < ARENA_MAP_HEIGHT; y += 1) {
      for (let x = 0; x < ARENA_MAP_WIDTH; x += 1) {
        if (!livre(x * TILE + TILE / 2, y * TILE + TILE / 2)) solidos.add(`${x},${y}`)
      }
    }
    for (const chave of solidos) {
      const [x, y] = chave.split(',').map(Number)
      expect(solidos).toContain(`${ARENA_MAP_WIDTH - 1 - x},${y}`)
    }
  })

  it('a borda é fechada — ninguém sai do campo', () => {
    for (let x = 0; x < ARENA_MAP_WIDTH; x += 1) {
      expect(livre(x * TILE + TILE / 2, TILE / 2)).toBe(false)
      expect(livre(x * TILE + TILE / 2, (ARENA_MAP_HEIGHT - 1) * TILE + TILE / 2)).toBe(false)
    }
    for (let y = 0; y < ARENA_MAP_HEIGHT; y += 1) {
      expect(livre(TILE / 2, y * TILE + TILE / 2)).toBe(false)
      expect(livre((ARENA_MAP_WIDTH - 1) * TILE + TILE / 2, y * TILE + TILE / 2)).toBe(false)
    }
  })

  it('tem duas bases, em lados opostos e em chão livre', () => {
    const spawns = mapSpawnTiles(doc)
    expect(spawns).toHaveLength(2)
    const [oeste, leste] = [...spawns].sort((a, b) => a.x - b.x)
    expect(oeste.x).toBeLessThan(ARENA_MAP_WIDTH / 3)
    expect(leste.x).toBeGreaterThan((ARENA_MAP_WIDTH * 2) / 3)
    for (const tile of spawns) {
      expect(livre(tile.x * TILE + TILE / 2, tile.y * TILE + TILE / 2)).toBe(true)
    }
  })

  it('quem nasce tem folga em volta — ninguém acorda entalado', () => {
    for (const tile of mapSpawnTiles(doc)) {
      const ponto = bodySpawnPoint(doc, grid, tile)
      // A busca por folga não precisa se afastar: a base já é aberta.
      expect(Math.abs(ponto.x - (tile.x * TILE + TILE / 2))).toBeLessThanOrEqual(TILE)
      expect(Math.abs(ponto.y - (tile.y * TILE + TILE / 2))).toBeLessThanOrEqual(TILE)
    }
  })

  // Paintball sem cobertura é troca de tiros a céu aberto, em que ganha quem
  // atira primeiro.
  it('tem cobertura no meio do campo, não só nas bordas', () => {
    let cobertura = 0
    const margem = 4
    for (let y = margem; y < ARENA_MAP_HEIGHT - margem; y += 1) {
      for (let x = margem; x < ARENA_MAP_WIDTH - margem; x += 1) {
        if (!livre(x * TILE + TILE / 2, y * TILE + TILE / 2)) cobertura += 1
      }
    }
    expect(cobertura).toBeGreaterThan(40)
  })
})
