import { describe, expect, it } from 'vitest'
import {
  canStepTo,
  createEmptyMapDocumentV1,
  DIAGONAL_STEP_FACTOR,
  facingForMove,
  isDiagonalMove,
  isMoveDirection,
  MOVE_DIRECTION_DELTAS,
  type MapDocumentV1,
} from './index'

function room(): MapDocumentV1 {
  return createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
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

describe('direções de passo', () => {
  it('a diagonal encara para os lados — o sprite só tem quatro poses', () => {
    expect(facingForMove('up')).toBe('up')
    expect(facingForMove('down')).toBe('down')
    expect(facingForMove('up-left')).toBe('left')
    expect(facingForMove('down-right')).toBe('right')
  })

  it('reconhece as oito direções e separa as diagonais', () => {
    expect(isMoveDirection('down-left')).toBe(true)
    expect(isMoveDirection('up-down')).toBe(false)
    expect(isDiagonalMove('down-left')).toBe(true)
    expect(isDiagonalMove('down')).toBe(false)
    expect(MOVE_DIRECTION_DELTAS['up-right']).toEqual({ x: 1, y: -1 })
  })

  it('a diagonal cobre √2 tiles, e é isso que normaliza a velocidade', () => {
    expect(DIAGONAL_STEP_FACTOR).toBeCloseTo(1.414, 3)
  })
})

describe('canStepTo', () => {
  it('anda reto para tile livre e recusa parede', () => {
    const document = room()
    wallAt(document, 5, 4)

    expect(canStepTo(document, { x: 5, y: 5 }, 'left')).toBe(true)
    expect(canStepTo(document, { x: 5, y: 5 }, 'up')).toBe(false)
  })

  it('não corta quina: diagonal exige as DUAS ortogonais livres', () => {
    const document = room()
    // Vão diagonal entre duas peças encostadas: (4,5) e (5,4) bloqueados,
    // (4,4) livre. Andando reto ninguém passa; na diagonal passaria raspando.
    wallAt(document, 4, 5)
    wallAt(document, 5, 4)

    expect(canStepTo(document, { x: 5, y: 5 }, 'up-left')).toBe(false)
  })

  it('uma ortogonal livre ainda não basta', () => {
    const document = room()
    wallAt(document, 5, 4)

    expect(canStepTo(document, { x: 5, y: 5 }, 'up-left')).toBe(false)
  })

  it('com as duas ortogonais livres, a diagonal passa', () => {
    expect(canStepTo(room(), { x: 5, y: 5 }, 'up-left')).toBe(true)
  })

  it('kart estacionado bloqueia o passo, como no tile reto', () => {
    const karts = [{ id: 'k', x: 4, y: 4, dir: 'up' as const }]

    expect(canStepTo(room(), { x: 5, y: 5 }, 'up-left', karts)).toBe(false)
    expect(canStepTo(room(), { x: 5, y: 5 }, 'up-left', [{ ...karts[0], riderUserId: 'ana' }])).toBe(true)
  })

  it('a borda do mapa é parede', () => {
    expect(canStepTo(room(), { x: 0, y: 0 }, 'up-left')).toBe(false)
  })
})
