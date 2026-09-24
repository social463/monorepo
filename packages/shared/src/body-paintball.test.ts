import { describe, expect, it } from 'vitest'
import type { MapDocumentV1 } from './index'
import {
  BODY_HIT_RADIUS,
  BODY_SHOT_RANGE,
  bodyCollisionGrid,
  createEmptyMapDocumentV1,
  fireBodyShot,
  paintballColorFor,
} from './index'

const TILE = 32
function campo(): MapDocumentV1 {
  return createEmptyMapDocumentV1({ width: 40, height: 40, tileSize: TILE })
}
function parede(doc: MapDocumentV1, x: number, y: number, w: number, h: number): void {
  doc.objects.push({
    id: `p-${x}-${y}`,
    layerKey: 'collision',
    type: 'collision',
    geometry: { kind: 'rectangle', x, y, width: w, height: h },
    properties: {},
  })
}
const atirador = { userId: 'ana', x: 200, y: 200 }
const DIREITA = 0

describe('fireBodyShot', () => {
  it('sem nada no caminho, vai até o alcance e não marca ninguém', () => {
    const shot = fireBodyShot({
      grid: bodyCollisionGrid(campo()),
      shooter: atirador,
      angle: DIREITA,
      targets: [],
      now: 1,
    })

    expect(shot.to.x - shot.from.x).toBeCloseTo(BODY_SHOT_RANGE, -1)
    expect(shot.splat).toBeNull()
  })

  it('acerta quem está na linha e para nele', () => {
    const shot = fireBodyShot({
      grid: bodyCollisionGrid(campo()),
      shooter: atirador,
      angle: DIREITA,
      targets: [
        { userId: 'perto', x: 300, y: 200 },
        { userId: 'longe', x: 400, y: 200 },
      ],
      now: 42,
    })

    expect(shot.splat?.userId).toBe('perto')
    expect(shot.splat?.color).toBe(paintballColorFor('ana'))
    expect(shot.to.x).toBeLessThan(320)
  })

  // O ângulo é livre — é isso que a arena traz sobre o escritório, onde o tiro
  // sai preso a uma das quatro poses.
  it('atira em qualquer ângulo, não só nas quatro direções', () => {
    const shot = fireBodyShot({
      grid: bodyCollisionGrid(campo()),
      shooter: atirador,
      angle: Math.PI / 6,
      targets: [{ userId: 'diagonal', x: 200 + 150 * Math.cos(Math.PI / 6), y: 200 + 150 * Math.sin(Math.PI / 6) }],
      now: 1,
    })

    expect(shot.splat?.userId).toBe('diagonal')
  })

  // É o que faz a cobertura do mapa valer alguma coisa.
  it('parede no caminho protege quem está atrás', () => {
    const doc = campo()
    parede(doc, 250, 0, TILE, 40 * TILE)

    const shot = fireBodyShot({
      grid: bodyCollisionGrid(doc),
      shooter: atirador,
      angle: DIREITA,
      targets: [{ userId: 'protegido', x: 320, y: 200 }],
      now: 1,
    })

    expect(shot.splat).toBeNull()
    expect(shot.to.x).toBeLessThanOrEqual(250)
  })

  it('nunca acerta o próprio atirador', () => {
    const shot = fireBodyShot({
      grid: bodyCollisionGrid(campo()),
      shooter: atirador,
      angle: DIREITA,
      targets: [{ userId: 'ana', x: 200, y: 200 }],
      now: 1,
    })

    expect(shot.splat).toBeNull()
  })

  it('quem está fora do alcance não é atingido', () => {
    const shot = fireBodyShot({
      grid: bodyCollisionGrid(campo()),
      shooter: atirador,
      angle: DIREITA,
      targets: [{ userId: 'longe', x: 200 + BODY_SHOT_RANGE + 60, y: 200 }],
      now: 1,
    })

    expect(shot.splat).toBeNull()
  })

  it('acerta de raspão dentro do raio do corpo', () => {
    const shot = fireBodyShot({
      grid: bodyCollisionGrid(campo()),
      shooter: atirador,
      angle: DIREITA,
      targets: [{ userId: 'raspao', x: 300, y: 200 + BODY_HIT_RADIUS - 1 }],
      now: 1,
    })

    expect(shot.splat?.userId).toBe('raspao')
  })

  it('atirar encostado na parede não sai do lugar', () => {
    const doc = campo()
    parede(doc, 200 + 8, 0, TILE, 40 * TILE)

    const shot = fireBodyShot({
      grid: bodyCollisionGrid(doc),
      shooter: atirador,
      angle: DIREITA,
      targets: [],
      now: 1,
    })

    expect(Math.hypot(shot.to.x - shot.from.x, shot.to.y - shot.from.y)).toBeLessThan(20)
  })

  it('mesma dupla, mesmo instante, mesmo id de marca — nada é sorteado', () => {
    const opcoes = {
      grid: bodyCollisionGrid(campo()),
      shooter: atirador,
      angle: DIREITA,
      targets: [{ userId: 'alvo', x: 280, y: 200 }],
      now: 7,
    }

    expect(fireBodyShot(opcoes).splat?.id).toBe(fireBodyShot(opcoes).splat?.id)
  })
})
