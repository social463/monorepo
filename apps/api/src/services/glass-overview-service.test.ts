import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma'
import { getGlassCrossTab, getGlassOverview } from './glass-overview-service'

async function empresa(id: string) {
  const company = await prisma.company.create({ data: { id, name: id, slug: id } })
  return { id: company.id }
}

type Semente = {
  rating?: number | null
  sector?: string | null
  role?: string | null
  tenure?: string | null
  status?: string | null
  reviewDate?: string | null
  recommends?: boolean | null
  sentiment?: 'POSITIVO' | 'NEUTRO' | 'NEGATIVO'
  themesNegative?: string[]
}

async function semear(companyId: string, linhas: Semente[]) {
  for (const linha of linhas) {
    await prisma.glassReview.create({
      data: {
        companyId,
        rating: linha.rating === undefined ? 4 : linha.rating,
        sector: linha.sector ?? 'Suporte',
        role: linha.role ?? 'Analista',
        tenure: linha.tenure ?? 'DE_1_A_3_ANOS',
        status: linha.status ?? 'ATIVO',
        reviewDate: linha.reviewDate === null ? null : new Date(`${linha.reviewDate ?? '2026-03-10'}T00:00:00.000Z`),
        recommends: linha.recommends ?? null,
        sentiment: linha.sentiment ?? 'NEUTRO',
        themesPositive: [],
        themesNegative: linha.themesNegative ?? [],
        alerts: [],
      },
    })
  }
}

describe('getGlassOverview', () => {
  it('bate exatamente com os dados semeados', async () => {
    const { id } = await empresa('ov-1')
    await semear(id, [
      { rating: 5, sector: 'Suporte', reviewDate: '2026-01-10', recommends: true, sentiment: 'POSITIVO' },
      { rating: 4, sector: 'Suporte', reviewDate: '2026-01-20', recommends: false, sentiment: 'NEUTRO' },
      { rating: 3, sector: 'Vendas', reviewDate: '2026-02-15', recommends: true, sentiment: 'NEGATIVO' },
    ])

    const overview = await getGlassOverview({ id: 'x', companyId: id }, {})

    expect(overview.totalReviews).toBe(3)
    expect(overview.averageRating).toBe(4)
    expect(overview.recommendRate).toBeCloseTo(2 / 3, 5)
    expect(overview.sentimentCounts).toEqual({ POSITIVO: 1, NEUTRO: 1, NEGATIVO: 1 })
    expect(overview.trend).toEqual([
      { month: '2026-01', averageRating: 4.5, count: 2 },
      { month: '2026-02', averageRating: 3, count: 1 },
    ])
    expect(overview.bySector).toContainEqual({ key: 'Suporte', count: 2, averageRating: 4.5 })
    expect(overview.bySector).toContainEqual({ key: 'Vendas', count: 1, averageRating: 3 })
  })

  it('conta avaliação sem data na média e fora da tendência', async () => {
    const { id } = await empresa('ov-2')
    await semear(id, [
      { rating: 2, reviewDate: null },
      { rating: 4, reviewDate: '2026-02-10' },
    ])

    const overview = await getGlassOverview({ id: 'x', companyId: id }, {})

    expect(overview.totalReviews).toBe(2)
    expect(overview.averageRating).toBe(3)
    expect(overview.trend).toEqual([{ month: '2026-02', averageRating: 4, count: 1 }])
  })

  it('ignora quem não respondeu ao calcular a taxa de recomendação', async () => {
    const { id } = await empresa('ov-3')
    await semear(id, [{ recommends: true }, { recommends: null }, { recommends: null }])
    const overview = await getGlassOverview({ id: 'x', companyId: id }, {})
    expect(overview.recommendRate).toBe(1)
  })

  it('conta tema por ocorrência, do mais citado ao menos', async () => {
    const { id } = await empresa('ov-4')
    await semear(id, [
      { themesNegative: ['SOBRECARGA', 'REMUNERACAO'] },
      { themesNegative: ['SOBRECARGA'] },
      { themesNegative: ['CLIMA_TOXICO'] },
    ])
    const overview = await getGlassOverview({ id: 'x', companyId: id }, {})
    expect(overview.topThemesNegative[0]).toEqual({ theme: 'SOBRECARGA', count: 2 })
  })

  it('inclui os alertas agregados', async () => {
    const { id } = await empresa('ov-5')
    await semear(id, [
      { rating: 1, sector: 'Suporte', reviewDate: '2026-01-10' },
      { rating: 2, sector: 'Suporte', reviewDate: '2026-02-10' },
      { rating: 2, sector: 'Suporte', reviewDate: '2026-03-10' },
    ])
    const overview = await getGlassOverview({ id: 'x', companyId: id }, {})
    expect(overview.alerts).toContainEqual({ key: 'SETOR_CRITICO', scope: 'Suporte', count: 3 })
  })

  it('respeita o filtro de período e de setor', async () => {
    const { id } = await empresa('ov-6')
    await semear(id, [
      { rating: 5, sector: 'Suporte', reviewDate: '2026-01-10' },
      { rating: 1, sector: 'Vendas', reviewDate: '2026-06-10' },
    ])

    const porPeriodo = await getGlassOverview({ id: 'x', companyId: id }, { from: new Date('2026-05-01T00:00:00Z') })
    expect(porPeriodo.totalReviews).toBe(1)
    expect(porPeriodo.averageRating).toBe(1)

    const porSetor = await getGlassOverview({ id: 'x', companyId: id }, { sector: 'Suporte' })
    expect(porSetor.totalReviews).toBe(1)
    expect(porSetor.averageRating).toBe(5)
  })

  it('não enxerga avaliação de outra empresa', async () => {
    const a = await empresa('ov-a')
    const b = await empresa('ov-b')
    await semear(a.id, [{ rating: 5 }])
    await semear(b.id, [{ rating: 1 }, { rating: 1 }, { rating: 1 }])

    const overview = await getGlassOverview({ id: 'x', companyId: a.id }, {})
    expect(overview.totalReviews).toBe(1)
    expect(overview.averageRating).toBe(5)
    expect(overview.alerts).toEqual([])
  })

  it('devolve zeros sem quebrar quando não há avaliação', async () => {
    const { id } = await empresa('ov-vazio')
    const overview = await getGlassOverview({ id: 'x', companyId: id }, {})
    expect(overview).toMatchObject({ totalReviews: 0, averageRating: null, trend: [], alerts: [] })
  })
})

describe('getGlassCrossTab', () => {
  it('cruza duas dimensões', async () => {
    const { id } = await empresa('cross-1')
    await semear(id, [
      { sector: 'Suporte', tenure: 'MENOS_DE_1_ANO', rating: 2 },
      { sector: 'Suporte', tenure: 'MENOS_DE_1_ANO', rating: 4 },
      { sector: 'Vendas', tenure: 'MAIS_DE_5_ANOS', rating: 5 },
    ])

    const celulas = await getGlassCrossTab({ id: 'x', companyId: id }, 'setor', 'tempo')

    expect(celulas).toContainEqual({ rowKey: 'Suporte', columnKey: 'MENOS_DE_1_ANO', count: 2, averageRating: 3 })
    expect(celulas).toContainEqual({ rowKey: 'Vendas', columnKey: 'MAIS_DE_5_ANOS', count: 1, averageRating: 5 })
  })

  it('não cruza avaliação de outra empresa', async () => {
    const a = await empresa('cross-a')
    const b = await empresa('cross-b')
    await semear(a.id, [{ sector: 'Suporte' }])
    await semear(b.id, [{ sector: 'Vendas' }])

    const celulas = await getGlassCrossTab({ id: 'x', companyId: a.id }, 'setor', 'cargo')
    expect(celulas.map((c) => c.rowKey)).toEqual(['Suporte'])
  })
})
