import { describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { updateAiSettings } from './ai-settings-service'
import { askAgent } from './agent-service'

async function cenario(id: string) {
  const company = await prisma.company.create({ data: { id, name: 'Acme', slug: id } })
  const user = await prisma.user.create({
    data: { name: 'Gestora', email: `g-${id}@acme.com`, passwordHash: 'x', role: 'ADMIN', companyId: company.id },
  })
  await prisma.glassReview.create({
    data: {
      companyId: company.id,
      rating: 2,
      sector: 'Suporte',
      status: 'ATIVO',
      reviewDate: new Date('2026-01-10T00:00:00.000Z'),
      sentiment: 'NEGATIVO',
      themesPositive: [],
      themesNegative: ['SOBRECARGA'],
      alerts: ['NOTA_BAIXA_ATIVO'],
    },
  })
  // Chave cifrada de verdade pelo service real — `askAgent` resolve credenciais
  // antes de qualquer coisa, e um valor falso estouraria em `decryptSecret`.
  await updateAiSettings({ companyId: company.id, actorId: user.id, body: { apiKey: 'chave-de-teste' } })
  return { id: user.id, companyId: company.id }
}

describe('askAgent — agente glass', () => {
  it('injeta o acumulado do banco no system prompt', async () => {
    const actor = await cenario('agente-1')
    const complete = vi.fn().mockResolvedValue('resposta')

    await askAgent({ actor, agent: 'glass', message: 'como estamos?', complete })

    expect(complete.mock.calls[0][0].systemPrompt).toContain('Acme')
    expect(complete.mock.calls[0][0].systemPrompt).toContain('Total de avaliações: 1')
  })

  it('comando vira números no turno, e o histórico guarda a mensagem original', async () => {
    const actor = await cenario('agente-2')
    const complete = vi.fn().mockResolvedValue('resposta redigida')

    const conversa = await askAgent({ actor, agent: 'glass', message: '/relatorio', complete })

    const ultimoTurno = complete.mock.calls[0][0].turns.at(-1).content
    expect(ultimoTurno).toContain('PAINEL COMPLETO')
    expect(ultimoTurno).toContain('Total de avaliações: 1')

    // O histórico guarda o que a pessoa escreveu, não o bloco de dados: senão a
    // conversa incha e reabri-la amanhã mostraria números de ontem como se
    // fossem de hoje.
    const pergunta = conversa.messages.find((m) => m.role === 'USER')
    expect(pergunta?.content).toBe('/relatorio')
    expect(pergunta?.content).not.toContain('PAINEL COMPLETO')
  })

  it('pergunta livre não recebe bloco de comando', async () => {
    const actor = await cenario('agente-3')
    const complete = vi.fn().mockResolvedValue('resposta')

    await askAgent({ actor, agent: 'glass', message: 'e a liderança?', complete })

    expect(complete.mock.calls[0][0].turns.at(-1).content).toBe('e a liderança?')
  })

  it('não vaza avaliação de outra empresa para o prompt', async () => {
    const a = await cenario('agente-a')
    await cenario('agente-b')
    const complete = vi.fn().mockResolvedValue('resposta')

    await askAgent({ actor: a, agent: 'glass', message: 'como estamos?', complete })

    expect(complete.mock.calls[0][0].systemPrompt).toContain('Total de avaliações: 1')
  })

  it('o benchmark continua funcionando igual', async () => {
    const actor = await cenario('agente-bench')
    const complete = vi.fn().mockResolvedValue('resposta')

    await askAgent({ actor, agent: 'benchmark', message: '/relatorio', complete })

    // `/relatorio` não é comando do benchmark: chega cru, como sempre chegou.
    expect(complete.mock.calls[0][0].turns.at(-1).content).toBe('/relatorio')
  })
})
