import { describe, expect, it } from 'vitest'
import type { MapDocumentV1 } from './index'
import {
  BALL_KICK_TILE_MS,
  BALL_TOUCH_TILE_MS,
  OFFICE_BALL_SHEET,
  createEmptyMapDocumentV1,
  isCollidableAssetCategory,
  isMapTileWalkable,
  isOfficeBallAssetId,
  isOfficeBallPower,
  isOfficeBallTile,
  kickBall,
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

const ball = { id: 'ball-1', x: 5, y: 5 }

describe('kickBall', () => {
  it('chute limpo (bola à frente, na direção encarada) leva a bola longe e reto', () => {
    const kick = kickBall({
      document: emptyRoom(),
      ball,
      kicker: { x: 4, y: 5, dir: 'right' },
      power: 'kick',
    })

    expect(kick?.grazed).toBe(false)
    expect(kick?.path).toEqual([
      { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }, { x: 10, y: 5 },
    ])
    expect(kick?.durationMs).toBe(5 * BALL_KICK_TILE_MS)
  })

  it('bola na diagonal pega de raspão: sai torta e mais fraca', () => {
    const kick = kickBall({
      document: emptyRoom(),
      ball: { id: 'ball-1', x: 6, y: 4 },
      kicker: { x: 5, y: 5, dir: 'right' },
      power: 'kick',
    })

    expect(kick?.grazed).toBe(true)
    // 5 tiles × 0.55 = 2.75 → 3, na diagonal.
    expect(kick?.path).toEqual([{ x: 7, y: 3 }, { x: 8, y: 2 }, { x: 9, y: 1 }])
  })

  it('chutar de costas para a bola também é raspão', () => {
    const kick = kickBall({
      document: emptyRoom(),
      ball,
      kicker: { x: 4, y: 5, dir: 'left' },
      power: 'kick',
    })

    expect(kick?.grazed).toBe(true)
    expect(kick?.path).toHaveLength(3)
    // A bola continua indo para longe de quem chutou, não para trás dele.
    expect(kick?.path.at(-1)).toEqual({ x: 8, y: 5 })
  })

  it('chute com corrida vai mais longe que o parado', () => {
    const running = kickBall({
      document: emptyRoom(),
      ball,
      kicker: { x: 4, y: 5, dir: 'right' },
      power: 'kick',
      sprint: true,
    })

    expect(running?.path).toHaveLength(8)
  })

  it('toque anda um tile só, na cadência lenta, mesmo correndo', () => {
    const touch = kickBall({
      document: emptyRoom(),
      ball,
      kicker: { x: 4, y: 5, dir: 'right' },
      power: 'touch',
      sprint: true,
    })

    expect(touch?.path).toEqual([{ x: 6, y: 5 }])
    expect(touch?.durationMs).toBe(BALL_TOUCH_TILE_MS)
  })

  it('em cima da bola, o chute sai na direção encarada', () => {
    const kick = kickBall({
      document: emptyRoom(),
      ball,
      kicker: { x: 5, y: 5, dir: 'up' },
      power: 'kick',
    })

    expect(kick?.grazed).toBe(false)
    expect(kick?.path.at(-1)).toEqual({ x: 5, y: 0 })
  })

  it('bate na parede, volta com metade da força e para', () => {
    const document = emptyRoom()
    wallAt(document, 8, 5)
    const kick = kickBall({
      document,
      ball,
      kicker: { x: 4, y: 5, dir: 'right' },
      power: 'kick',
    })

    expect(kick?.bounces).toBe(1)
    // Dois tiles até a parede, rebate e volta com 3 → 1 tile de sobra.
    expect(kick?.path).toEqual([{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 6, y: 5 }])
  })

  it('pessoa no caminho para a bola como uma parede', () => {
    const kick = kickBall({
      document: emptyRoom(),
      ball,
      kicker: { x: 4, y: 5, dir: 'right' },
      power: 'kick',
      obstacles: [{ x: 7, y: 5 }],
    })

    expect(kick?.path).toEqual([{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 }])
  })

  it('bola entalada não sai do lugar, e o gesto ainda é válido', () => {
    const document = emptyRoom()
    wallAt(document, 6, 5)
    wallAt(document, 4, 5)
    wallAt(document, 5, 4)
    const kick = kickBall({
      document,
      ball,
      kicker: { x: 5, y: 5, dir: 'down' },
      power: 'kick',
      obstacles: [{ x: 5, y: 6 }],
    })

    expect(kick).not.toBeNull()
    expect(kick?.path).toEqual([])
    expect(kick?.durationMs).toBe(0)
  })

  it('bola de pilates (2×2) sai reta quando o pé pega de lado', () => {
    const pilates = { id: 'pilates', x: 5, y: 5, w: 2, h: 2 }
    const kick = kickBall({
      document: emptyRoom(),
      ball: pilates,
      // Ao lado da célula de BAIXO da peça: alinhado no eixo x, e por isso
      // ainda é chute limpo.
      kicker: { x: 4, y: 6, dir: 'right' },
      power: 'kick',
    })

    expect(kick?.grazed).toBe(false)
    expect(kick?.path).toEqual([
      { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }, { x: 10, y: 5 },
    ])
  })

  it('bola de pilates não passa por vão de um tile', () => {
    const document = emptyRoom()
    // Corredor de um tile à direita da peça: a metade de baixo fica bloqueada.
    wallAt(document, 7, 6)
    const kick = kickBall({
      document,
      ball: { id: 'pilates', x: 5, y: 5, w: 2, h: 2 },
      kicker: { x: 4, y: 5, dir: 'right' },
      power: 'kick',
    })

    // A metade de baixo não cabe no vão: bate de cara e volta com metade da
    // força. Uma bola de um tile, no mesmo lugar, passaria.
    expect(kick?.path).toEqual([{ x: 4, y: 5 }, { x: 3, y: 5 }])
    expect(kick?.bounces).toBe(1)
  })

  it('chute alto passa por cima do que está no caminho', () => {
    const document = emptyRoom()
    wallAt(document, 6, 5)
    wallAt(document, 7, 5)
    const kick = kickBall({
      document,
      ball,
      kicker: { x: 4, y: 5, dir: 'right' },
      power: 'lob',
      // Gente no meio também não para: a bola passa por cima.
      obstacles: [{ x: 8, y: 5 }],
    })

    expect(kick?.bounces).toBe(0)
    expect(kick?.path).toEqual([
      { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 },
    ])
    // O pouso é o que precisa estar livre — e está.
    expect(kick?.path.at(-1)).toEqual({ x: 9, y: 5 })
  })

  it('chute alto cai antes quando o pouso está ocupado', () => {
    const document = emptyRoom()
    wallAt(document, 9, 5)
    const kick = kickBall({
      document,
      ball,
      kicker: { x: 4, y: 5, dir: 'right' },
      power: 'lob',
    })

    expect(kick?.path.at(-1)).toEqual({ x: 8, y: 5 })
  })

  it('chute alto com corrida sobrevoa mais longe', () => {
    const running = kickBall({
      document: emptyRoom(),
      ball,
      kicker: { x: 4, y: 5, dir: 'right' },
      power: 'lob',
      sprint: true,
    })

    expect(running?.path).toHaveLength(6)
  })

  it('bola encurralada não sobe: sem pouso livre, fica onde está', () => {
    const document = emptyRoom()
    for (let x = 6; x <= 10; x += 1) wallAt(document, x, 5)
    const kick = kickBall({
      document,
      ball,
      kicker: { x: 4, y: 5, dir: 'right' },
      power: 'lob',
    })

    expect(kick?.path).toEqual([])
  })

  it('condução empurra um tile na direção do passo, sem raspão nem rebatida', () => {
    const kick = kickBall({
      document: emptyRoom(),
      ball,
      // Quem conduz está EM CIMA da bola: a direção vem do passo.
      kicker: { x: 5, y: 5, dir: 'right' },
      power: 'dribble',
    })

    expect(kick).toMatchObject({ path: [{ x: 6, y: 5 }], grazed: false, bounces: 0 })
  })

  it('condução contra a parede não empurra a bola', () => {
    const document = emptyRoom()
    wallAt(document, 6, 5)
    const kick = kickBall({
      document,
      ball,
      kicker: { x: 5, y: 5, dir: 'right' },
      power: 'dribble',
    })

    expect(kick?.path).toEqual([])
    expect(kick?.bounces).toBe(0)
  })

  it('correndo, a bola conduzida acompanha o passo mais curto', () => {
    const parado = kickBall({
      document: emptyRoom(), ball, kicker: { x: 5, y: 5, dir: 'right' }, power: 'dribble',
    })
    const correndo = kickBall({
      document: emptyRoom(), ball, kicker: { x: 5, y: 5, dir: 'right' }, power: 'dribble', sprint: true,
    })

    expect(correndo?.durationMs).toBeLessThan(parado?.durationMs as number)
  })

  it('o cliente não pode pedir condução — ela nasce do passo', () => {
    expect(isOfficeBallPower('kick')).toBe(true)
    expect(isOfficeBallPower('lob')).toBe(true)
    expect(isOfficeBallPower('dribble')).toBe(false)
  })

  it('fora de alcance não chuta', () => {
    expect(
      kickBall({
        document: emptyRoom(),
        ball,
        kicker: { x: 3, y: 5, dir: 'right' },
        power: 'kick',
      }),
    ).toBeNull()
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

    expect(mapBalls(document)).toEqual([
      { id: 'ball-a', x: 2, y: 3, memberIds: ['ball-a'] },
      { id: 'grp-1__0-0', x: 0, y: 0, memberIds: ['grp-1__0-0'] },
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
        x: 4,
        y: 6,
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
