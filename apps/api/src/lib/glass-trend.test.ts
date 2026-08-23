import { describe, expect, it } from 'vitest'
import { averageOf, monthlyTrend, roundRating } from './glass-trend'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('monthlyTrend', () => {
  it('agrupa por mês e ordena do mais antigo ao mais recente', () => {
    expect(
      monthlyTrend([
        { reviewDate: d('2026-03-20'), rating: 3 },
        { reviewDate: d('2026-01-05'), rating: 5 },
        { reviewDate: d('2026-01-25'), rating: 4 },
      ]),
    ).toEqual([
      { month: '2026-01', averageRating: 4.5, count: 2 },
      { month: '2026-03', averageRating: 3, count: 1 },
    ])
  })

  it('exclui avaliação sem data — não há mês onde colocá-la', () => {
    expect(
      monthlyTrend([
        { reviewDate: null, rating: 1 },
        { reviewDate: d('2026-02-10'), rating: 4 },
      ]),
    ).toEqual([{ month: '2026-02', averageRating: 4, count: 1 }])
  })

  it('exclui avaliação sem nota', () => {
    expect(
      monthlyTrend([
        { reviewDate: d('2026-02-10'), rating: null },
        { reviewDate: d('2026-02-11'), rating: 4 },
      ]),
    ).toEqual([{ month: '2026-02', averageRating: 4, count: 1 }])
  })

  it('devolve vazio sem dados', () => {
    expect(monthlyTrend([])).toEqual([])
  })

  it('usa UTC — 31/12 às 23h não escorrega para janeiro', () => {
    expect(monthlyTrend([{ reviewDate: new Date('2025-12-31T23:00:00.000Z'), rating: 4 }])[0].month).toBe('2025-12')
  })

  it('arredonda a média para 2 casas', () => {
    const [ponto] = monthlyTrend([
      { reviewDate: d('2026-02-01'), rating: 4 },
      { reviewDate: d('2026-02-02'), rating: 5 },
      { reviewDate: d('2026-02-03'), rating: 5 },
    ])
    expect(ponto.averageRating).toBe(4.67)
  })
})

describe('averageOf', () => {
  it('devolve null para lista vazia — média de nada não é zero', () => {
    expect(averageOf([])).toBeNull()
  })

  it('arredonda para 2 casas', () => {
    expect(averageOf([4, 5, 5])).toBe(4.67)
  })
})

describe('roundRating', () => {
  it('mata o ruído de ponto flutuante', () => {
    expect(roundRating(4.199999999999999)).toBe(4.2)
  })
})
