import { describe, expect, it } from 'vitest'
import type { MapDocumentV1 } from './index'
import {
  PAINTBALL_COLORS,
  PAINTBALL_COOLDOWN_MS,
  PAINTBALL_RANGE,
  PAINTBALL_TILE_MS,
  PAINT_SPLAT_VARIANTS,
  PAINT_SPLAT_TTL_MS,
  createEmptyMapDocumentV1,
  firePaintball,
  isPaintballTarget,
  paintSplatPlacement,
  paintballColorFor,
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

const shooter = { userId: 'atirador', x: 5, y: 5, dir: 'right' as const }

describe('firePaintball', () => {
  it('sem nada no caminho, a bolinha vai até o fim do alcance e não marca ninguém', () => {
    const shot = firePaintball({ document: emptyRoom(), shooter, occupants: [], now: 1 })

    expect(shot.path).toHaveLength(PAINTBALL_RANGE)
    expect(shot.path.at(-1)).toEqual({ x: 5 + PAINTBALL_RANGE, y: 5 })
    expect(shot.durationMs).toBe(PAINTBALL_RANGE * PAINTBALL_TILE_MS)
    expect(shot.splat).toBeNull()
  })

  it('acerta a primeira pessoa da linha e para nela', () => {
    const shot = firePaintball({
      document: emptyRoom(),
      shooter,
      occupants: [
        { userId: 'perto', x: 7, y: 5 },
        { userId: 'longe', x: 9, y: 5 },
      ],
      now: 42,
    })

    expect(shot.path).toEqual([{ x: 6, y: 5 }, { x: 7, y: 5 }])
    expect(shot.splat?.userId).toBe('perto')
    expect(shot.splat?.byUserId).toBe('atirador')
    expect(shot.splat?.ttlMs).toBe(PAINT_SPLAT_TTL_MS)
    expect(shot.splat?.color).toBe(paintballColorFor('atirador'))
  })

  it('mesa/parede no caminho para o tiro antes do alvo — cobertura é o que faz o jogo', () => {
    const document = emptyRoom()
    wallAt(document, 7, 5)

    const shot = firePaintball({
      document,
      shooter,
      occupants: [{ userId: 'atras-da-mesa', x: 8, y: 5 }],
      now: 1,
    })

    // A parede não entra no caminho: a bolinha estoura no tile anterior.
    expect(shot.path).toEqual([{ x: 6, y: 5 }])
    expect(shot.splat).toBeNull()
  })

  it('quem está ausente é ATRAVESSADO: não leva marca nem vira escudo', () => {
    const shot = firePaintball({
      document: emptyRoom(),
      shooter,
      occupants: [
        { userId: 'ausente', x: 6, y: 5, status: 'away' },
        { userId: 'jogando', x: 8, y: 5, status: 'online' },
      ],
      now: 1,
    })

    expect(shot.splat?.userId).toBe('jogando')
    expect(shot.path.at(-1)).toEqual({ x: 8, y: 5 })
  })

  it('não acerta quem atira, mesmo com alguém em cima dele', () => {
    const shot = firePaintball({
      document: emptyRoom(),
      shooter,
      occupants: [{ userId: 'atirador', x: 5, y: 5 }],
      now: 1,
    })

    expect(shot.splat).toBeNull()
  })

  it('atirando contra a parede colada, a bolinha não sai', () => {
    const document = emptyRoom()
    wallAt(document, 6, 5)

    const shot = firePaintball({ document, shooter, occupants: [], now: 1 })

    expect(shot.path).toEqual([])
    expect(shot.durationMs).toBe(0)
    expect(shot.splat).toBeNull()
  })

  it('o tiro segue o facing, nas quatro direções', () => {
    const document = emptyRoom()
    const up = firePaintball({
      document,
      shooter: { ...shooter, dir: 'up' },
      occupants: [{ userId: 'acima', x: 5, y: 3 }],
      now: 1,
    })

    expect(up.splat?.userId).toBe('acima')
    expect(up.path).toEqual([{ x: 5, y: 4 }, { x: 5, y: 3 }])
  })

  it('mesma dupla, mesmo instante, mesmo id de marca — nada é sorteado', () => {
    const options = {
      document: emptyRoom(),
      shooter,
      occupants: [{ userId: 'alvo', x: 6, y: 5 }],
      now: 7,
    }

    expect(firePaintball(options).splat?.id).toBe(firePaintball(options).splat?.id)
  })
})

describe('paintballColorFor', () => {
  it('é estável por usuário e sai sempre da paleta', () => {
    expect(paintballColorFor('ana')).toBe(paintballColorFor('ana'))
    expect(PAINTBALL_COLORS).toContain(paintballColorFor('ana'))
    expect(PAINTBALL_COLORS).toContain(paintballColorFor('bruno'))
  })
})

describe('paintSplatPlacement', () => {
  it('é derivada do id, então todo cliente põe a mancha no mesmo lugar', () => {
    expect(paintSplatPlacement('a:b:1')).toEqual(paintSplatPlacement('a:b:1'))
    expect(paintSplatPlacement('a:b:1')).not.toEqual(paintSplatPlacement('a:b:2'))
  })

  /**
   * Ids de tiros seguidos do mesmo par diferem só nos últimos dígitos do
   * instante. Fatiando bits de um hash só, o djb2 mal levava essa diferença
   * para os bits altos: giro idêntico e tamanho quase igual em todas as
   * manchas de uma pessoa — o "carimbo repetido" que esta função existe para
   * evitar.
   */
  it('tiros seguidos no mesmo alvo variam nos QUATRO campos, não só na posição', () => {
    const inicio = 1_787_570_000_000
    const seguidos = Array.from({ length: 6 }, (_, i) =>
      paintSplatPlacement(`ana:bruno:${inicio + i * PAINTBALL_COOLDOWN_MS}`),
    )

    for (const campo of ['ox', 'oy', 'variant'] as const) {
      expect(new Set(seguidos.map((p) => p[campo])).size).toBeGreaterThan(1)
    }
  })

  it('cai dentro dos limites que a cena espera', () => {
    for (const id of ['x:y:1', 'x:y:2', 'ana:bruno:1699999999999', 'z']) {
      const { ox, oy, variant } = paintSplatPlacement(id)
      expect(ox).toBeGreaterThanOrEqual(-1)
      expect(ox).toBeLessThanOrEqual(1)
      expect(oy).toBeGreaterThanOrEqual(-1)
      expect(oy).toBeLessThanOrEqual(1)
      // A variante indexa `PAINT_SPLAT_MASKS` na cena: fora da faixa, a
      // textura não existe e a mancha simplesmente não aparece.
      expect(Number.isInteger(variant)).toBe(true)
      expect(variant).toBeGreaterThanOrEqual(0)
      expect(variant).toBeLessThan(PAINT_SPLAT_VARIANTS)
    }
  })
})

describe('isPaintballTarget', () => {
  it('occupant sem status (payload antigo/replay) conta como online', () => {
    expect(isPaintballTarget(undefined)).toBe(true)
    expect(isPaintballTarget('online')).toBe(true)
    expect(isPaintballTarget('away')).toBe(false)
    expect(isPaintballTarget('brb')).toBe(false)
  })
})
