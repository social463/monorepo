import { describe, it, expect } from 'vitest'
import { ANNOTATION_COLORS, annotationColor } from './annotation-color'

describe('annotationColor', () => {
  it('é determinística — a mesma pessoa desenha sempre na mesma cor, em qualquer aba', () => {
    expect(annotationColor('ana')).toBe(annotationColor('ana'))
  })

  it('sempre devolve uma cor da paleta', () => {
    for (const userId of ['ana', 'bruno', 'carla', 'daniel', 'elisa', 'fabio', 'gabi']) {
      expect(ANNOTATION_COLORS).toContain(annotationColor(userId))
    }
  })

  it('distribui pessoas diferentes por cores diferentes (não colapsa tudo numa só)', () => {
    const ids = ['ana', 'bruno', 'carla', 'daniel', 'elisa', 'fabio']
    expect(new Set(ids.map(annotationColor)).size).toBeGreaterThan(1)
  })

  it('id vazio não quebra', () => {
    expect(ANNOTATION_COLORS).toContain(annotationColor(''))
  })
})
