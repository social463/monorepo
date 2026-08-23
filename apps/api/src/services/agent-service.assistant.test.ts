import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { updateAiSettings } from './ai-settings-service'
import { setAssistantPersonaName } from './assistant-persona-service'
import { askAgent } from './agent-service'

/**
 * `emr` é o slug da empresa semeada pela migration (`DEFAULT_COMPANY_ID`,
 * preservada entre testes por `test/setup.ts`) — não dá para criar uma
 * segunda empresa com esse slug, então o cenário "empresa emr" reaproveita a
 * existente em vez de criar uma nova.
 */
async function cenario(id: string, slug: string = id) {
  const companyId = slug === 'emr' ? DEFAULT_COMPANY_ID : id
  if (slug !== 'emr') await prisma.company.create({ data: { id, name: 'Acme', slug } })
  const user = await prisma.user.create({
    data: { name: 'Colega', email: `c-${id}@acme.com`, passwordHash: 'x', role: 'LEGEND', companyId },
  })
  const admin = await prisma.user.create({
    data: { name: 'Admin', email: `a-${id}@acme.com`, passwordHash: 'x', role: 'ADMIN', companyId },
  })
  await prisma.knowledgeEntry.create({
    data: {
      companyId,
      question: 'Quantos dias de férias?',
      answer: 'São 30 dias corridos.',
      keywords: ['ferias'],
      createdById: admin.id,
    },
  })
  await updateAiSettings({ companyId, actorId: admin.id, body: { apiKey: 'chave-de-teste' } })
  return { id: user.id, companyId }
}

describe('askAgent — agente assistant', () => {
  it('usa o nome padrão da persona quando a empresa não configurou um', async () => {
    const actor = await cenario('assistant-1')
    const complete = vi.fn().mockResolvedValue('resposta')

    await askAgent({ actor, agent: 'assistant', message: 'quantos dias de férias?', complete })

    expect(complete.mock.calls[0][0].systemPrompt).toContain('Assistente de RH')
  })

  it('usa o nome de persona configurado pela empresa', async () => {
    const actor = await cenario('assistant-2')
    await setAssistantPersonaName(actor.companyId, 'Aria')
    const complete = vi.fn().mockResolvedValue('resposta')

    await askAgent({ actor, agent: 'assistant', message: 'quantos dias de férias?', complete })

    expect(complete.mock.calls[0][0].systemPrompt).toContain('Você é Aria')
  })

  it('injeta as entradas da base que casaram com a pergunta', async () => {
    const actor = await cenario('assistant-3')
    const complete = vi.fn().mockResolvedValue('resposta')

    await askAgent({ actor, agent: 'assistant', message: 'quantos dias de férias eu tenho?', complete })

    expect(complete.mock.calls[0][0].systemPrompt).toContain('São 30 dias corridos.')
  })

  it('injeta a base inteira, inclusive entrada que não casou com a pergunta', async () => {
    const actor = await cenario('assistant-7')
    const admin = await prisma.user.findFirstOrThrow({ where: { companyId: actor.companyId, role: 'ADMIN' } })
    await prisma.knowledgeEntry.create({
      data: {
        companyId: actor.companyId,
        question: 'Como funciona o vale refeição?',
        answer: 'O crédito cai todo dia 5.',
        keywords: ['vale'],
        createdById: admin.id,
      },
    })
    const complete = vi.fn().mockResolvedValue('resposta')

    await askAgent({ actor, agent: 'assistant', message: 'quantos dias de férias?', complete })

    // O vale não casa com a pergunta. Ele precisa estar lá mesmo assim: é o que
    // permite o follow-up ("e quais os benefícios?") ser respondido inteiro.
    expect(complete.mock.calls[0][0].systemPrompt).toContain('O crédito cai todo dia 5.')
  })

  it('não recusa quando a mensagem não casa com nada na base', async () => {
    const actor = await cenario('assistant-8')
    const complete = vi.fn().mockResolvedValue('resposta')

    // "oi" não gera token nenhum: antes o prompt chegava ao modelo dizendo que a
    // base estava vazia, e ele recusava um cumprimento.
    await askAgent({ actor, agent: 'assistant', message: 'oi', complete })

    expect(complete.mock.calls[0][0].systemPrompt).toContain('São 30 dias corridos.')
  })

  it('manda o modelo estruturar a resposta com o negrito que o chat renderiza', async () => {
    const actor = await cenario('assistant-formato')
    const complete = vi.fn().mockResolvedValue('resposta')

    await askAgent({ actor, agent: 'assistant', message: 'como funcionam as férias?', complete })

    // O widget converte **negrito** e quebra de linha (`renderRich`); a regra
    // antiga proibia asterisco e devolvia parágrafo corrido para renderizar.
    const prompt = complete.mock.calls[0][0].systemPrompt as string
    expect(prompt).toContain('**')
    expect(prompt).toMatch(/negrito/i)
    expect(prompt).not.toContain('Nunca use asterisco para ênfase')
  })

  it('só inclui o bloco de acolhimento emocional para a empresa de slug "emr"', async () => {
    const semEmr = await cenario('assistant-4', 'assistant-4')
    const completeSemEmr = vi.fn().mockResolvedValue('resposta')
    await askAgent({ actor: semEmr, agent: 'assistant', message: 'férias?', complete: completeSemEmr })
    expect(completeSemEmr.mock.calls[0][0].systemPrompt).not.toContain('ACOLHIMENTO EMOCIONAL')

    const comEmr = await cenario('assistant-5', 'emr')
    const completeComEmr = vi.fn().mockResolvedValue('resposta')
    await askAgent({ actor: comEmr, agent: 'assistant', message: 'férias?', complete: completeComEmr })
    expect(completeComEmr.mock.calls[0][0].systemPrompt).toContain('ACOLHIMENTO EMOCIONAL')
  })

  it('recorta a base pelo setor da pessoa quando informado', async () => {
    const actor = await cenario('assistant-6')
    const setor = await prisma.sector.create({ data: { name: 'RH', companyId: actor.companyId, slug: 'rh-assistant-6' } })
    const admin = await prisma.user.findFirstOrThrow({ where: { companyId: actor.companyId, role: 'ADMIN' } })
    await prisma.knowledgeEntry.create({
      data: {
        companyId: actor.companyId,
        sectorId: setor.id,
        question: 'Qual o ramal do RH?',
        answer: '4321',
        keywords: ['ramal'],
        createdById: admin.id,
      },
    })
    const complete = vi.fn().mockResolvedValue('resposta')

    await askAgent({
      actor: { ...actor, sectorId: null },
      agent: 'assistant',
      message: 'qual o ramal do rh?',
      complete,
    })

    expect(complete.mock.calls[0][0].systemPrompt).not.toContain('4321')
  })
})
