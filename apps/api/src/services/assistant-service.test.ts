import { beforeEach, describe, expect, it } from 'vitest'
import { ASSISTANT_HOURLY_LIMIT, ASSISTANT_NOT_FOUND_MESSAGE } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { AssistantError } from '../lib/assistant-error'
import {
  askAssistant,
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  listAssistantGaps,
  listKnowledgeEntries,
  recordAssistantFeedback,
  updateKnowledgeEntry,
  type AssistantActor,
} from './assistant-service'

const SECTOR = 'sector-dev-produto'

async function criarUsuario(email: string, role = 'LEGEND', companyId = 'company-emr') {
  return prisma.user.create({
    data: { name: 'Pessoa', email, passwordHash: 'x', role: role as never, sectorId: SECTOR, companyId },
  })
}

function ator(user: { id: string; role: string; sectorId: string; companyId: string }): AssistantActor {
  return { id: user.id, role: user.role, sectorId: user.sectorId, companyId: user.companyId }
}

async function criarEntrada(autorId: string, over: Record<string, unknown> = {}) {
  return prisma.knowledgeEntry.create({
    data: {
      question: 'Quantos dias de férias eu tenho?',
      answer: 'São 30 dias corridos após 12 meses de trabalho.',
      keywords: ['ferias'],
      createdById: autorId,
      ...over,
    },
  })
}

beforeEach(() => {
  delete process.env.GEMINI_API_KEY
})

describe('askAssistant', () => {
  it('responde com a base e registra as entradas que casaram quando não há IA', async () => {
    const user = await criarUsuario('pergunta-ok@empresa.com')
    const entrada = await criarEntrada(user.id)

    const result = await askAssistant(ator(user), 'quantos dias de férias eu tenho?')

    expect(result.answered).toBe(true)
    expect(result.source).toBe('KNOWLEDGE_BASE')
    expect(result.answer).toBe('São 30 dias corridos após 12 meses de trabalho.')
    expect(result.sources.map((s) => s.id)).toEqual([entrada.id])

    const registrada = await prisma.assistantQuery.findUniqueOrThrow({ where: { id: result.queryId } })
    expect(registrada.userId).toBe(user.id)
    expect(registrada.matchedEntryIds).toEqual([entrada.id])
    expect(registrada.answer).toBe(result.answer)
  })

  it('devolve "não encontrei" e registra a lacuna quando nada casa', async () => {
    const user = await criarUsuario('lacuna@empresa.com')
    await criarEntrada(user.id)

    const result = await askAssistant(ator(user), 'qual a política de estacionamento?')

    expect(result.answered).toBe(false)
    expect(result.source).toBe('NONE')
    expect(result.answer).toBe(ASSISTANT_NOT_FOUND_MESSAGE)
    expect(result.sources).toEqual([])

    const registrada = await prisma.assistantQuery.findUniqueOrThrow({ where: { id: result.queryId } })
    expect(registrada.matchedEntryIds).toEqual([])
  })

  it('casa entrada do próprio setor do usuário', async () => {
    // As demais entradas do arquivo usam sectorId: null (empresa inteira). Sem
    // este caso, apagar `{ sectorId: actor.sectorId }` do OR do service deixaria
    // a suíte verde e o setor inteiro perderia acesso à própria base.
    const user = await criarUsuario('setor-proprio@empresa.com')
    const entrada = await criarEntrada(user.id, { sectorId: SECTOR })

    const result = await askAssistant(ator(user), 'quantos dias de férias eu tenho?')

    expect(result.answered).toBe(true)
    expect(result.sources.map((s) => s.id)).toEqual([entrada.id])
  })

  it('ignora entrada inativa e entrada de outro setor', async () => {
    const user = await criarUsuario('escopo@empresa.com')
    const outroSetor = await prisma.sector.create({
      data: { name: 'RH', slug: `rh-${Date.now()}` },
    })
    await criarEntrada(user.id, { isActive: false })
    await criarEntrada(user.id, { sectorId: outroSetor.id })

    const result = await askAssistant(ator(user), 'quantos dias de férias?')

    expect(result.answered).toBe(false)
  })

  it('nunca usa base de outra empresa como contexto', async () => {
    const outra = await prisma.company.create({ data: { name: 'Outra', slug: `outra-${Date.now()}` } })
    const autorOutra = await criarUsuario('autor-outra@empresa.com', 'ADMIN', outra.id)
    await prisma.knowledgeEntry.create({
      data: {
        question: 'Quantos dias de férias?',
        answer: 'Segredo da outra empresa.',
        keywords: ['ferias'],
        createdById: autorOutra.id,
        companyId: outra.id,
      },
    })
    const user = await criarUsuario('isolado@empresa.com')

    const result = await askAssistant(ator(user), 'quantos dias de férias?')

    expect(result.answered).toBe(false)
    expect(JSON.stringify(result)).not.toContain('Segredo da outra empresa.')
  })

  it('recusa com 429 acima do teto de perguntas por hora', async () => {
    const user = await criarUsuario('teto@empresa.com')
    await prisma.assistantQuery.createMany({
      data: Array.from({ length: ASSISTANT_HOURLY_LIMIT }, () => ({
        userId: user.id,
        question: 'oi',
        matchedEntryIds: [],
      })),
    })

    await expect(askAssistant(ator(user), 'quantos dias de férias?')).rejects.toMatchObject({
      status: 429,
    })
    await expect(askAssistant(ator(user), 'quantos dias de férias?')).rejects.toBeInstanceOf(AssistantError)
  })

  it('não conta perguntas de mais de uma hora atrás no teto', async () => {
    const user = await criarUsuario('janela@empresa.com')
    await criarEntrada(user.id)
    const antiga = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await prisma.assistantQuery.createMany({
      data: Array.from({ length: ASSISTANT_HOURLY_LIMIT }, () => ({
        userId: user.id,
        question: 'oi',
        matchedEntryIds: [],
        createdAt: antiga,
      })),
    })

    const result = await askAssistant(ator(user), 'quantos dias de férias?')
    expect(result.answered).toBe(true)
  })
})

describe('recordAssistantFeedback', () => {
  it('grava e depois atualiza o feedback da própria pergunta', async () => {
    const user = await criarUsuario('feedback-ok@empresa.com')
    await criarEntrada(user.id)
    const { queryId } = await askAssistant(ator(user), 'quantos dias de férias?')

    await recordAssistantFeedback(ator(user), queryId, { rating: 1 })
    await recordAssistantFeedback(ator(user), queryId, { rating: -1, comment: 'faltou o período aquisitivo' })

    const feedbacks = await prisma.assistantFeedback.findMany({ where: { queryId } })
    expect(feedbacks).toHaveLength(1)
    expect(feedbacks[0]?.rating).toBe(-1)
    expect(feedbacks[0]?.comment).toBe('faltou o período aquisitivo')
  })

  it('recusa feedback em pergunta de outra pessoa', async () => {
    const dono = await criarUsuario('dono-pergunta@empresa.com')
    const intruso = await criarUsuario('intruso@empresa.com')
    await criarEntrada(dono.id)
    const { queryId } = await askAssistant(ator(dono), 'quantos dias de férias?')

    await expect(recordAssistantFeedback(ator(intruso), queryId, { rating: 1 })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('trata pergunta inexistente como 404', async () => {
    const user = await criarUsuario('feedback-404@empresa.com')
    await expect(recordAssistantFeedback(ator(user), 'nao-existe', { rating: 1 })).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('CRUD da base de conhecimento', () => {
  it('ADMIN cria entrada da empresa inteira e grava auditoria', async () => {
    const admin = await criarUsuario('crud-admin@empresa.com', 'ADMIN')

    const criada = await createKnowledgeEntry(ator(admin), {
      category: 'Férias',
      question: 'Quantos dias de férias?',
      answer: 'São 30 dias corridos.',
      keywords: ['ferias'],
    })

    expect(criada.sectorId).toBeNull()
    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'KnowledgeEntry', entityId: criada.id } })
    expect(log?.action).toBe('CREATE')
    expect(log?.actorId).toBe(admin.id)
  })

  it('SUBADMIN cria no próprio setor mesmo sem informar o escopo', async () => {
    const subadmin = await criarUsuario('crud-sub@empresa.com', 'SUBADMIN')

    const criada = await createKnowledgeEntry(ator(subadmin), {
      question: 'Como peço reembolso?',
      answer: 'Pelo portal, até o dia 20.',
    })

    expect(criada.sectorId).toBe(subadmin.sectorId)
  })

  it('SUBADMIN não escreve fora do próprio setor', async () => {
    const subadmin = await criarUsuario('crud-sub-403@empresa.com', 'SUBADMIN')

    await expect(
      createKnowledgeEntry(ator(subadmin), {
        question: 'X',
        answer: 'Y',
        sectorId: null,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('SUBADMIN não edita entrada da empresa inteira', async () => {
    const admin = await criarUsuario('crud-admin-2@empresa.com', 'ADMIN')
    const daEmpresa = await createKnowledgeEntry(ator(admin), { question: 'X', answer: 'Y' })
    const subadmin = await criarUsuario('crud-sub-edit@empresa.com', 'SUBADMIN')

    await expect(updateKnowledgeEntry(ator(subadmin), daEmpresa.id, { answer: 'Z' })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('lista com filtro de categoria e devolve as categorias em uso', async () => {
    const admin = await criarUsuario('crud-lista@empresa.com', 'ADMIN')
    await createKnowledgeEntry(ator(admin), { category: 'Férias', question: 'A', answer: 'a' })
    await createKnowledgeEntry(ator(admin), { category: 'Benefícios', question: 'B', answer: 'b' })

    const todas = await listKnowledgeEntries(ator(admin), {})
    expect(todas.entries).toHaveLength(2)
    expect(todas.categories.sort()).toEqual(['Benefícios', 'Férias'])

    const soFerias = await listKnowledgeEntries(ator(admin), { category: 'Férias' })
    expect(soFerias.entries.map((e) => e.question)).toEqual(['A'])
  })

  it('SUBADMIN buscando por texto continua restrito ao próprio escopo de setor', async () => {
    const admin = await criarUsuario('crud-busca-admin@empresa.com', 'ADMIN')
    const subadmin = await criarUsuario('crud-busca-sub@empresa.com', 'SUBADMIN')
    const outroSetor = await prisma.sector.create({
      data: { name: 'Financeiro', slug: `financeiro-${Date.now()}` },
    })

    const daEmpresa = await createKnowledgeEntry(ator(admin), {
      question: 'Como peço reembolso de despesa?',
      answer: 'Pelo portal.',
      sectorId: null,
    })
    const doSetorDoSubadmin = await createKnowledgeEntry(ator(admin), {
      question: 'Reembolso de quilometragem',
      answer: 'Preencha o formulário.',
      sectorId: subadmin.sectorId,
    })
    await createKnowledgeEntry(ator(admin), {
      question: 'Reembolso de material de outro setor',
      answer: 'Fale com o gestor.',
      sectorId: outroSetor.id,
    })

    const resultado = await listKnowledgeEntries(ator(subadmin), { q: 'reembolso' })

    expect(resultado.entries.map((e) => e.id).sort()).toEqual([daEmpresa.id, doSetorDoSubadmin.id].sort())
  })

  it('apaga e registra auditoria de DELETE', async () => {
    const admin = await criarUsuario('crud-delete@empresa.com', 'ADMIN')
    const criada = await createKnowledgeEntry(ator(admin), { question: 'X', answer: 'Y' })

    await deleteKnowledgeEntry(ator(admin), criada.id)

    expect(await prisma.knowledgeEntry.findUnique({ where: { id: criada.id } })).toBeNull()
    const log = await prisma.adminAuditLog.findFirst({
      where: { entityType: 'KnowledgeEntry', entityId: criada.id, action: 'DELETE' },
    })
    expect(log).not.toBeNull()
  })
})

describe('listAssistantGaps', () => {
  const opcoes = { days: 30, limit: 20 }

  it('agrupa perguntas sem match pela forma normalizada', async () => {
    const user = await criarUsuario('lacuna-agrupa@empresa.com')
    const admin = await criarUsuario('lacuna-admin@empresa.com', 'ADMIN')
    await prisma.assistantQuery.createMany({
      data: [
        { userId: user.id, question: 'Quantos dias de licença paternidade?', matchedEntryIds: [] },
        { userId: user.id, question: 'quantos dias de licenca paternidade', matchedEntryIds: [] },
        { userId: user.id, question: 'Como peço reembolso?', matchedEntryIds: [] },
      ],
    })

    const gaps = await listAssistantGaps(ator(admin), opcoes)

    expect(gaps.unanswered[0]?.count).toBe(2)
    expect(gaps.unanswered[0]?.normalized).toBe('quantos dias de licenca paternidade')
    expect(gaps.unanswered[0]?.sample).toContain('licen')
    expect(gaps.unanswered).toHaveLength(2)
  })

  it('separa as respondidas na lista de mais frequentes', async () => {
    const user = await criarUsuario('lacuna-frequente@empresa.com')
    const admin = await criarUsuario('lacuna-admin-2@empresa.com', 'ADMIN')
    const entrada = await criarEntrada(admin.id)
    await prisma.assistantQuery.createMany({
      data: [
        { userId: user.id, question: 'Férias quantos dias?', matchedEntryIds: [entrada.id] },
        { userId: user.id, question: 'férias quantos dias', matchedEntryIds: [entrada.id] },
      ],
    })

    const gaps = await listAssistantGaps(ator(admin), opcoes)

    expect(gaps.unanswered).toHaveLength(0)
    expect(gaps.frequent[0]?.count).toBe(2)
  })

  it('lista entradas com feedback negativo, com os comentários', async () => {
    const user = await criarUsuario('lacuna-negativo@empresa.com')
    const admin = await criarUsuario('lacuna-admin-3@empresa.com', 'ADMIN')
    const entrada = await criarEntrada(admin.id)
    const query = await prisma.assistantQuery.create({
      data: { userId: user.id, question: 'férias?', matchedEntryIds: [entrada.id] },
    })
    await prisma.assistantFeedback.create({
      data: { queryId: query.id, userId: user.id, rating: -1, comment: 'faltou o período aquisitivo' },
    })

    const gaps = await listAssistantGaps(ator(admin), opcoes)

    expect(gaps.negative).toHaveLength(1)
    expect(gaps.negative[0]?.entry.id).toBe(entrada.id)
    expect(gaps.negative[0]?.negativeCount).toBe(1)
    expect(gaps.negative[0]?.comments).toEqual(['faltou o período aquisitivo'])
  })

  it('ignora id de entrada já apagada', async () => {
    const user = await criarUsuario('lacuna-orfa@empresa.com')
    const admin = await criarUsuario('lacuna-admin-4@empresa.com', 'ADMIN')
    const query = await prisma.assistantQuery.create({
      data: { userId: user.id, question: 'férias?', matchedEntryIds: ['entrada-apagada'] },
    })
    await prisma.assistantFeedback.create({
      data: { queryId: query.id, userId: user.id, rating: -1 },
    })

    const gaps = await listAssistantGaps(ator(admin), opcoes)

    expect(gaps.negative).toHaveLength(0)
  })

  it('SUBADMIN não vê negativo de entrada de outro setor; ADMIN vê', async () => {
    const admin = await criarUsuario('lacuna-admin-escopo@empresa.com', 'ADMIN')
    const subadmin = await criarUsuario('lacuna-sub-escopo@empresa.com', 'SUBADMIN')
    const outroSetor = await prisma.sector.create({
      data: { name: 'Financeiro', slug: `financeiro-gaps-${Date.now()}` },
    })
    const user = await criarUsuario('lacuna-user-escopo@empresa.com')
    const entradaDeOutroSetor = await criarEntrada(admin.id, {
      question: 'Reembolso de quilometragem?',
      sectorId: outroSetor.id,
    })
    const query = await prisma.assistantQuery.create({
      data: { userId: user.id, question: 'reembolso km?', matchedEntryIds: [entradaDeOutroSetor.id] },
    })
    await prisma.assistantFeedback.create({
      data: { queryId: query.id, userId: user.id, rating: -1, comment: 'não achei o valor por km' },
    })

    const gapsSubadmin = await listAssistantGaps(ator(subadmin), opcoes)
    expect(gapsSubadmin.negative.map((n) => n.entry.id)).not.toContain(entradaDeOutroSetor.id)

    const gapsAdmin = await listAssistantGaps(ator(admin), opcoes)
    expect(gapsAdmin.negative.map((n) => n.entry.id)).toContain(entradaDeOutroSetor.id)
  })

  it('não enxerga histórico de outra empresa', async () => {
    const outra = await prisma.company.create({ data: { name: 'Outra', slug: `outra-gaps-${Date.now()}` } })
    const daOutra = await criarUsuario('gaps-outra@empresa.com', 'LEGEND', outra.id)
    await prisma.assistantQuery.create({
      data: { userId: daOutra.id, question: 'segredo da outra', matchedEntryIds: [], companyId: outra.id },
    })
    const admin = await criarUsuario('gaps-admin-isolado@empresa.com', 'ADMIN')

    const gaps = await listAssistantGaps(ator(admin), opcoes)

    expect(gaps.unanswered).toHaveLength(0)
  })
})
