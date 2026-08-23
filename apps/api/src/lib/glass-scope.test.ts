import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from './prisma'
import { scopedPrisma } from './tenant-scope'
import { toGlassReviewDTO } from './serialize'

async function criarEmpresa(id: string) {
  return prisma.company.create({ data: { id, name: `Empresa ${id}`, slug: id } })
}

describe('GlassReview — isolamento e DTO', () => {
  it('não devolve avaliação de outra empresa', async () => {
    const a = await criarEmpresa('empresa-a')
    const b = await criarEmpresa('empresa-b')

    await prisma.glassReview.create({
      data: { companyId: a.id, sector: 'Suporte', rating: 4.5, themesPositive: [], themesNegative: [], alerts: [] },
    })
    await prisma.glassReview.create({
      data: { companyId: b.id, sector: 'Vendas', rating: 1.0, themesPositive: [], themesNegative: [], alerts: [] },
    })

    const daA = await scopedPrisma(a.id).glassReview.findMany()
    expect(daA).toHaveLength(1)
    expect(daA[0].sector).toBe('Suporte')
  })

  it('serializa sem expor autoria', async () => {
    const empresa = await criarEmpresa('empresa-dto')
    const review = await prisma.glassReview.create({
      data: {
        companyId: empresa.id,
        reviewDate: new Date('2026-03-12T00:00:00.000Z'),
        rating: 2.0,
        role: 'Analista',
        sector: 'Suporte',
        tenure: 'DE_1_A_3_ANOS',
        status: 'ATIVO',
        recommends: false,
        sentiment: 'NEGATIVO',
        themesPositive: ['AMBIENTE_EQUIPE'],
        themesNegative: ['SOBRECARGA'],
        alerts: ['NOTA_BAIXA_ATIVO'],
        createdById: null,
      },
    })

    const dto = toGlassReviewDTO(review)

    expect(dto).toMatchObject({
      reviewDate: '2026-03-12',
      rating: 2,
      sector: 'Suporte',
      tenure: 'DE_1_A_3_ANOS',
      status: 'ATIVO',
      sentiment: 'NEGATIVO',
      alerts: ['NOTA_BAIXA_ATIVO'],
    })
    // Anonimato: nada no DTO aponta para uma pessoa.
    expect(Object.keys(dto)).not.toContain('createdById')
    expect(Object.keys(dto)).not.toContain('createdByName')
    expect(Object.keys(dto)).not.toContain('authorId')
  })
})
