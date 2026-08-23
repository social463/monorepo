import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma'
import { getGlassOverview } from './glass-overview-service'
import { resolveGlassCommand } from './glass-command-service'
import type { GlassActor } from './glass-review-service'

/**
 * O overview agora vem de fora (quem monta o turno já o calculou). O teste
 * calcula o mesmo overview real, do mesmo banco: continua provando que os
 * números do comando saem do Postgres, não do modelo.
 */
async function comando(actor: GlassActor, message: string) {
  return resolveGlassCommand(actor, message, await getGlassOverview(actor, {}))
}

async function cenario(id: string) {
  const company = await prisma.company.create({ data: { id, name: id, slug: id } })
  await prisma.glassReview.createMany({
    data: [
      {
        companyId: company.id,
        rating: 2,
        sector: 'Suporte',
        role: 'Analista',
        tenure: 'MENOS_DE_1_ANO',
        status: 'ATIVO',
        reviewDate: new Date('2026-01-10T00:00:00.000Z'),
        sentiment: 'NEGATIVO',
        themesPositive: [],
        themesNegative: ['SOBRECARGA'],
        alerts: ['NOTA_BAIXA_ATIVO'],
      },
      {
        companyId: company.id,
        rating: 4,
        sector: 'Vendas',
        role: 'Executivo',
        tenure: 'MAIS_DE_5_ANOS',
        status: 'ATIVO',
        reviewDate: new Date('2026-02-10T00:00:00.000Z'),
        sentiment: 'POSITIVO',
        themesPositive: ['CULTURA_VALORES'],
        themesNegative: [],
        alerts: [],
      },
    ],
  })
  return { id: 'quem-pergunta', companyId: company.id }
}

describe('resolveGlassCommand', () => {
  it('devolve null para pergunta livre — o modelo responde normalmente', async () => {
    const actor = await cenario('cmd-1')
    expect(await comando(actor, 'o que o pessoal anda reclamando?')).toBeNull()
  })

  it('/relatorio traz os números do banco', async () => {
    const actor = await cenario('cmd-2')
    const bloco = await comando(actor, '/relatorio')
    expect(bloco).toContain('Total de avaliações: 2')
    expect(bloco).toContain('Suporte')
  })

  it('/tendencia traz a série mensal', async () => {
    const actor = await cenario('cmd-3')
    const bloco = await comando(actor, '/tendencia')
    expect(bloco).toContain('2026-01')
    expect(bloco).toContain('2026-02')
  })

  it('/criticos lista só as avaliações com alerta', async () => {
    const actor = await cenario('cmd-4')
    const bloco = await comando(actor, '/criticos')
    expect(bloco).toContain('Suporte')
    expect(bloco).not.toContain('Vendas')
  })

  it('/cruzamento usa setor × tempo por padrão', async () => {
    const actor = await cenario('cmd-5')
    const bloco = await comando(actor, '/cruzamento')
    expect(bloco).toContain('MENOS_DE_1_ANO')
  })

  it('/cruzamento aceita dimensões explícitas', async () => {
    const actor = await cenario('cmd-6')
    const bloco = await comando(actor, '/cruzamento setor cargo')
    expect(bloco).toContain('Analista')
  })

  it('/cruzamento com dimensão repetida explica em vez de quebrar', async () => {
    const actor = await cenario('cmd-7')
    const bloco = await comando(actor, '/cruzamento setor setor')
    expect(bloco).toMatch(/diferentes/i)
  })

  it('/cruzamento com dimensão desconhecida lista as válidas', async () => {
    const actor = await cenario('cmd-8')
    const bloco = await comando(actor, '/cruzamento astral cargo')
    expect(bloco).toContain('setor')
    expect(bloco).toContain('status')
  })

  it('não enxerga avaliação de outra empresa', async () => {
    const a = await cenario('cmd-a')
    await cenario('cmd-b')
    const bloco = await comando(a, '/relatorio')
    expect(bloco).toContain('Total de avaliações: 2')
  })
})
