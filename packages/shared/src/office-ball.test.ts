import { describe, expect, it } from 'vitest'
import type { MapDocumentV1, OfficeBall } from './index'
import {
  OFFICE_BALL_SHEET,
  createEmptyMapDocumentV1,
  isCollidableAssetCategory,
  isMapTileWalkable,
  isOfficeBallAssetId,
  isOfficeBallPower,
  isOfficeBallTile,
  officeKickBall,
  officeBallCell,
  mapBalls,
  officeAssetTilesetId,
  officeBallTileCount,
} from './index'

function emptyRoom(): MapDocumentV1 {
  return createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
}

function wallAt(document: MapDocumentV1, x: number, y: number): void {
  document.objects.push({
    id: `wall-${x}-${y}`,
    layerKey: 'collision',
    type: 'collision',
    geometry: { kind: 'rectangle', x: x * 32, y: y * 32, width: 32, height: 32 },
    properties: {},
  })
}

describe('officeKickBall', () => {
  const bola = (x: number, y: number, over: Partial<OfficeBall> = {}): OfficeBall => ({
    id: 'ball-1',
    x,
    y,
    vx: 0,
    vy: 0,
    memberIds: ['ball-1'],
    ...over,
  })

  it('manda a bola na direção ENCARADA, não na do mouse', () => {
    // O escritório nunca teve mira: só o gesto vem do cliente, e a direção sai
    // do facing autoritativo. Migrar para pixel não é motivo para dar uma mira.
    const chutada = officeKickBall({
      ball: bola(120, 100),
      kicker: { x: 100, y: 100, dir: 'right' },
      power: 'kick',
    })
    expect(chutada).not.toBeNull()
    expect(chutada!.vx).toBeGreaterThan(0)
    expect(chutada!.vy).toBeCloseTo(0, 5)
  })

  it('o toque sai mais fraco que o chute', () => {
    const kicker = { x: 100, y: 100, dir: 'right' as const }
    const toque = officeKickBall({ ball: bola(120, 100), kicker, power: 'touch' })!
    const chute = officeKickBall({ ball: bola(120, 100), kicker, power: 'kick' })!
    expect(Math.hypot(toque.vx, toque.vy)).toBeLessThan(Math.hypot(chute.vx, chute.vy))
  })

  it('a corrida reforça o chute — e a força é do SERVIDOR, não do fio', () => {
    const kicker = { x: 100, y: 100, dir: 'right' as const }
    const parado = officeKickBall({ ball: bola(120, 100), kicker, power: 'kick' })!
    const correndo = officeKickBall({ ball: bola(120, 100), kicker, power: 'kick', sprint: true })!
    expect(Math.hypot(correndo.vx, correndo.vy)).toBeGreaterThan(Math.hypot(parado.vx, parado.vy))
  })

  it('segurar X mais tempo (carga maior) chuta mais forte', () => {
    const kicker = { x: 100, y: 100, dir: 'right' as const }
    const fraco = officeKickBall({ ball: bola(120, 100), kicker, power: 'kick', charge: 0 })!
    const forte = officeKickBall({ ball: bola(120, 100), kicker, power: 'kick', charge: 1 })!
    expect(Math.hypot(forte.vx, forte.vy)).toBeGreaterThan(Math.hypot(fraco.vx, fraco.vy))
  })

  it('sem carga informada, o chute sai na força cheia — compatível com quem não carrega', () => {
    const kicker = { x: 100, y: 100, dir: 'right' as const }
    const semCarga = officeKickBall({ ball: bola(120, 100), kicker, power: 'kick' })!
    const cargaCheia = officeKickBall({ ball: bola(120, 100), kicker, power: 'kick', charge: 1 })!
    expect(semCarga.vx).toBeCloseTo(cargaCheia.vx, 5)
  })

  it('o toque não carrega — a mesma força de sempre, tecla segurada ou não', () => {
    const kicker = { x: 100, y: 100, dir: 'right' as const }
    const toque = officeKickBall({ ball: bola(120, 100), kicker, power: 'touch' })!
    const toqueCarregado = officeKickBall({ ball: bola(120, 100), kicker, power: 'touch', charge: 0 })!
    expect(toqueCarregado.vx).toBeCloseTo(toque.vx, 5)
  })

  it('segurar C mais tempo também levanta mais a bola, não só chuta mais forte', () => {
    const kicker = { x: 100, y: 100, dir: 'right' as const }
    const baixo = officeKickBall({ ball: bola(120, 100), kicker, power: 'lob', charge: 0 })!
    const alto = officeKickBall({ ball: bola(120, 100), kicker, power: 'lob', charge: 1 })!
    expect(baixo.airborneMs).toBeGreaterThan(0)
    expect(alto.airborneMs!).toBeGreaterThan(baixo.airborneMs!)
  })

  it('o chute alto sai pelo AR — é o que sobra dele no contínuo', () => {
    // Na grade, o chute alto resolvia a trajetória por cima da mobília. Sem eixo
    // Z, o que preserva a feature é o PRAZO em que a bola ignora colisão; sem
    // ele o chute alto viraria rasteiro e bateria na primeira mesa.
    const kicker = { x: 100, y: 100, dir: 'right' as const }
    const alto = officeKickBall({ ball: bola(120, 100), kicker, power: 'lob' })!
    const rasteiro = officeKickBall({ ball: bola(120, 100), kicker, power: 'kick' })!
    expect(alto.airborneMs).toBeGreaterThan(0)
    expect(rasteiro.airborneMs).toBeUndefined()
  })

  it('bola fora do alcance não é chutada', () => {
    const longe = officeKickBall({
      ball: bola(400, 100),
      kicker: { x: 100, y: 100, dir: 'right' },
      power: 'kick',
    })
    expect(longe).toBeNull()
  })

  it('a bola GRANDE é alcançável pela superfície, não pelo centro', () => {
    // Uma bola de pilates tem raio de um tile: medir do centro exigiria enfiar
    // o personagem dentro dela.
    const pilates = bola(150, 100, { r: 32, w: 2, h: 2 })
    expect(officeKickBall({ ball: pilates, kicker: { x: 100, y: 100, dir: 'right' }, power: 'kick' }))
      .not.toBeNull()
    const pequena = bola(150, 100)
    expect(officeKickBall({ ball: pequena, kicker: { x: 100, y: 100, dir: 'right' }, power: 'kick' }))
      .toBeNull()
  })
})

describe('mapBalls', () => {
  it('deriva bolas dos tile-objects publicados, ignorando mobília', () => {
    const document = emptyRoom()
    document.tilesets.push(
      {
        id: 'ball-tileset', assetId: 'builtin:office/ball-32', name: 'Bola',
        tileWidth: 32, tileHeight: 32, columns: 1, tileCount: 1,
      },
      {
        id: 'sport-tileset', assetId: 'builtin:office/school-32', name: 'Escola',
        tileWidth: 32, tileHeight: 32, columns: 32, tileCount: 3712,
      },
    )
    document.objects.push(
      {
        id: 'ball-a', layerKey: 'objects', type: 'tile-object',
        geometry: { kind: 'rectangle', x: 64, y: 96, width: 32, height: 32 },
        properties: { tilesetId: 'ball-tileset', tileIndex: 0 },
      },
      // Mobília comum do mesmo sheet: continua fora.
      {
        id: 'decor', layerKey: 'objects', type: 'tile-object',
        geometry: { kind: 'rectangle', x: 320, y: 320, width: 32, height: 32 },
        properties: { tilesetId: 'sport-tileset', tileIndex: 3 },
      },
      // …e uma bola decorativa (basquete da escola) agora conta como bola.
      {
        id: 'grp-1__0-0', layerKey: 'objects', type: 'tile-object',
        geometry: { kind: 'rectangle', x: 0, y: 0, width: 32, height: 32 },
        properties: { tilesetId: 'sport-tileset', tileIndex: 43 * 32 + 1 },
      },
    )

    // Em PIXEL, no centro do grupo, com o raio derivado do tamanho publicado.
    expect(mapBalls(document)).toEqual([
      { id: 'ball-a', x: 80, y: 112, vx: 0, vy: 0, r: 16, memberIds: ['ball-a'] },
      { id: 'grp-1__0-0', x: 16, y: 16, vx: 0, vy: 0, r: 16, memberIds: ['grp-1__0-0'] },
    ])
  })

  it('junta os quatro slices da bola de pilates numa peça 2×2 só', () => {
    const document = emptyRoom()
    document.tilesets.push({
      id: 'gym', assetId: 'builtin:office/gym-32', name: 'Academia',
      tileWidth: 32, tileHeight: 32, columns: 16, tileCount: 528,
    })
    // Sheet gym: bola de pilates azul em col 7, row 0, ocupando 2×2.
    const slices: Array<[number, number, number]> = [
      [0, 0, 0 * 16 + 7], [1, 0, 0 * 16 + 8], [0, 1, 1 * 16 + 7], [1, 1, 1 * 16 + 8],
    ]
    for (const [dc, dr, tileIndex] of slices) {
      document.objects.push({
        id: `grp-pilates__${dc}-${dr}`, layerKey: 'objects', type: 'tile-object',
        geometry: { kind: 'rectangle', x: (4 + dc) * 32, y: (6 + dr) * 32, width: 32, height: 32 },
        properties: { tilesetId: 'gym', tileIndex },
      })
    }

    expect(mapBalls(document)).toEqual([
      {
        id: 'grp-pilates__0-0',
        // Centro dos quatro slices; o raio é um tile inteiro.
        x: 5 * 32,
        y: 7 * 32,
        vx: 0,
        vy: 0,
        r: 32,
        w: 2,
        h: 2,
        memberIds: [
          'grp-pilates__0-0', 'grp-pilates__1-0', 'grp-pilates__0-1', 'grp-pilates__1-1',
        ],
      },
    ])
  })

  it('duas bolas de um tile coladas continuam sendo duas bolas', () => {
    const document = emptyRoom()
    document.tilesets.push({
      id: 'school', assetId: 'builtin:office/school-32', name: 'Escola',
      tileWidth: 32, tileHeight: 32, columns: 32, tileCount: 3712,
    })
    for (const [i, x] of [4, 5].entries()) {
      document.objects.push({
        id: `bola-${i}`, layerKey: 'objects', type: 'tile-object',
        geometry: { kind: 'rectangle', x: x * 32, y: 96, width: 32, height: 32 },
        properties: { tilesetId: 'school', tileIndex: 43 * 32 + 1 },
      })
    }

    expect(mapBalls(document).map((ball) => ball.id)).toEqual(['bola-0', 'bola-1'])
  })

  it('a colisão pareada de uma bola some da grade — bola não é parede', () => {
    const document = emptyRoom()
    document.tilesets.push({
      id: 'school', assetId: 'builtin:office/school-32', name: 'Escola',
      tileWidth: 32, tileHeight: 32, columns: 32, tileCount: 3712,
    })
    document.objects.push(
      {
        id: 'grp-bola__0-0', layerKey: 'objects', type: 'tile-object',
        geometry: { kind: 'rectangle', x: 96, y: 96, width: 32, height: 32 },
        properties: { tilesetId: 'school', tileIndex: 43 * 32 + 1 },
      },
      {
        id: 'grp-bola__collision', layerKey: 'collision', type: 'collision',
        geometry: { kind: 'rectangle', x: 96, y: 96, width: 32, height: 32 },
        properties: {},
      },
    )

    expect(isMapTileWalkable(document, 3, 3)).toBe(true)
  })
})

describe('quem é bola', () => {
  // Índice do tile no sheet = row * columns + col (a bola de basquete da
  // escola: col 1, row 43, num sheet de 32 colunas).
  const basqueteEscola = { assetId: 'builtin:office/school-32', tileIndex: 43 * 32 + 1 }

  it('toda bola de UM tile é chutável, venha do sheet que vier', () => {
    expect(isOfficeBallAssetId(officeAssetTilesetId(OFFICE_BALL_SHEET, 32))).toBe(true)
    expect(isOfficeBallTile(basqueteEscola.assetId, basqueteEscola.tileIndex)).toBe(true)
    // Bola de vôlei do sheet de música e esporte (col 8, row 9, 16 colunas).
    expect(isOfficeBallTile('builtin:office/music-and-sport-32', 9 * 16 + 8)).toBe(true)
    // …e nos três tamanhos de tile, porque col/row não mudam com o tamanho.
    expect(isOfficeBallTile('builtin:office/school-48', 43 * 32 + 1)).toBe(true)
  })

  it('a bola de pilates entra inteira: qualquer um dos quatro tiles a identifica', () => {
    // Bola de pilates azul: sheet gym (16 colunas), col 7, row 0, 2×2.
    for (const tileIndex of [0 * 16 + 7, 0 * 16 + 8, 1 * 16 + 7, 1 * 16 + 8]) {
      expect(officeBallCell('builtin:office/gym-32', tileIndex)).toMatchObject({ cols: 2, rows: 2 })
    }
  })

  it('mobília vizinha no mesmo sheet continua sendo mobília', () => {
    expect(isOfficeBallTile(basqueteEscola.assetId, basqueteEscola.tileIndex + 5)).toBe(false)
  })

  it('bola não ganha colisão ao ser colocada; o resto de Esporte ganha', () => {
    expect(isCollidableAssetCategory('Esporte', basqueteEscola.assetId, basqueteEscola.tileIndex)).toBe(false)
    expect(isCollidableAssetCategory('Esporte', officeAssetTilesetId(OFFICE_BALL_SHEET, 32))).toBe(false)
    expect(isCollidableAssetCategory('Esporte', basqueteEscola.assetId, basqueteEscola.tileIndex + 5)).toBe(true)
    expect(isCollidableAssetCategory('Esporte')).toBe(true)
  })

  it('o catálogo reconhece todas as bolas nos três tamanhos de sheet', () => {
    // 9 bolas de um tile + 4 de pilates × 4 tiles cada = 25 tiles, × 3 tamanhos.
    expect(officeBallTileCount()).toBe(75)
  })
})
