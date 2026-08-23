import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSISTANT_HOURLY_LIMIT, ASSISTANT_NOT_FOUND_MESSAGE } from '@legends/shared'
import type { AgentCompletionInput } from '../lib/agent-client'

// Mocka a fronteira cara: a chamada ao provedor de LLM. Mesmo padrão de
// `routes/agents.test.ts` — o teste controla a resposta "da IA" sem rede.
const completion = vi.hoisted(() => vi.fn(async (_input: AgentCompletionInput) => 'Resposta da assistente.'))
vi.mock('../lib/agent-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/agent-client')>()),
  requestAgentCompletion: completion,
}))

import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'
import { updateAiSettings } from '../services/ai-settings-service'
import { AGENT_BAD_KEY_MESSAGE, AgentError } from '../lib/agent-error'

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  delete process.env.GEMINI_API_KEY
  completion.mockReset()
  completion.mockResolvedValue('Resposta da assistente.')
  app = buildApp()
  await app.ready()
})

/** Empresa com chave de IA cadastrada — sem isso `/assistant/chat` é 503. */
async function comChave(companyId: string, actorId: string) {
  await updateAiSettings({ companyId, actorId, body: { apiKey: 'chave-de-teste' } })
}

async function criarUsuario(role: string, email: string) {
  return prisma.user.create({
    data: { name: `Usuário ${role}`, email, passwordHash: 'x', role: role as never },
  })
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('POST /assistant/ask', () => {
  it('responde com fontes para quem tem a feature liberada', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-ask@empresa.com')
    await prisma.knowledgeEntry.create({
      data: {
        question: 'Quantos dias de férias?',
        answer: 'São 30 dias corridos.',
        keywords: ['ferias'],
        createdById: admin.id,
      },
    })
    const legend = await criarUsuario('LEGEND', 'legend-ask@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      headers: auth(token),
      payload: { question: 'quantos dias de férias eu tenho?' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.answered).toBe(true)
    expect(body.answer).toBe('São 30 dias corridos.')
    expect(body.sources).toHaveLength(1)
    expect(body.sources[0].question).toBe('Quantos dias de férias?')
    expect(typeof body.queryId).toBe('string')
    // Sem campo interno (companyId, createdById, timestamps) vazando até a resposta HTTP.
    expect(Object.keys(body.sources[0]).sort()).toEqual(['answer', 'category', 'id', 'question'])
  })

  it('sem chave de IA, responde ao cumprimento em vez de dizer que não encontrou', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-chat-oi@empresa.com')
    await prisma.knowledgeEntry.create({
      data: {
        question: 'Quantos dias de férias?',
        answer: 'São 30 dias corridos.',
        keywords: ['ferias'],
        createdById: admin.id,
      },
    })
    const legend = await criarUsuario('LEGEND', 'legend-chat-oi@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { message: 'oi' },
    })

    expect(res.statusCode).toBe(200)
    const resposta = res.json().conversation.messages[1].content
    expect(resposta).not.toBe(ASSISTANT_NOT_FOUND_MESSAGE)
    expect(resposta.toLowerCase()).toContain('ajudar')
    // Conversa não gasta IA nem quando a empresa tem chave — aqui nem existe.
    expect(completion).not.toHaveBeenCalled()
  })

  it('sem chave de IA, cumprimento colado na dúvida continua sendo dúvida', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-chat-oi-duvida@empresa.com')
    await prisma.knowledgeEntry.create({
      data: {
        question: 'Quantos dias de férias?',
        answer: 'São 30 dias corridos.',
        keywords: ['ferias'],
        createdById: admin.id,
      },
    })
    const legend = await criarUsuario('LEGEND', 'legend-chat-oi-duvida@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { message: 'oi, quantos dias de férias?' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().conversation.messages[1].content).toBe('São 30 dias corridos.')
  })

  it('bloqueia quem está em setor sem a feature', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-sem-feature@empresa.com')
    const token = signAccessToken(app, legend, [])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      headers: auth(token),
      payload: { question: 'quantos dias de férias?' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('recusa pergunta vazia com 400 em português', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-vazio@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      headers: auth(token),
      payload: { question: '' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Dados inválidos.')
    expect(res.json().issues).toBeDefined()
  })

  it('responde 429 com mensagem em português acima do teto', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-teto@empresa.com')
    await prisma.assistantQuery.createMany({
      data: Array.from({ length: ASSISTANT_HOURLY_LIMIT }, () => ({
        userId: legend.id,
        question: 'oi',
        matchedEntryIds: [],
      })),
    })
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      headers: auth(token),
      payload: { question: 'quantos dias de férias?' },
    })

    expect(res.statusCode).toBe(429)
    expect(res.json().message).toContain('perguntas na última hora')
  })

  it('exige autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { question: 'quantos dias de férias?' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /assistant/queries/:id/feedback', () => {
  async function perguntar() {
    const admin = await criarUsuario('ADMIN', `admin-fb-${Date.now()}@empresa.com`)
    await prisma.knowledgeEntry.create({
      data: {
        question: 'Quantos dias de férias?',
        answer: 'São 30 dias corridos.',
        keywords: ['ferias'],
        createdById: admin.id,
      },
    })
    const legend = await criarUsuario('LEGEND', `legend-fb-${Date.now()}@empresa.com`)
    const token = signAccessToken(app, legend, ['assistente'])
    const ask = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      headers: auth(token),
      payload: { question: 'quantos dias de férias?' },
    })
    return { queryId: ask.json().queryId as string, token }
  }

  it('aceita polegar para baixo com comentário', async () => {
    const { queryId, token } = await perguntar()

    const res = await app.inject({
      method: 'POST',
      url: `/assistant/queries/${queryId}/feedback`,
      headers: auth(token),
      payload: { rating: -1, comment: 'faltou o período aquisitivo' },
    })

    expect(res.statusCode).toBe(204)
  })

  it('recusa rating fora de -1 e 1', async () => {
    const { queryId, token } = await perguntar()

    for (const rating of [0, 2, -2]) {
      const res = await app.inject({
        method: 'POST',
        url: `/assistant/queries/${queryId}/feedback`,
        headers: auth(token),
        payload: { rating },
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it('recusa feedback de outra pessoa com 403', async () => {
    const { queryId } = await perguntar()
    const outro = await criarUsuario('LEGEND', `outro-fb-${Date.now()}@empresa.com`)
    const tokenOutro = signAccessToken(app, outro, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: `/assistant/queries/${queryId}/feedback`,
      headers: auth(tokenOutro),
      payload: { rating: 1 },
    })

    expect(res.statusCode).toBe(403)
  })

  it('recusa quem perdeu a feature com 403, mesmo sendo o dono da pergunta', async () => {
    const admin = await criarUsuario('ADMIN', `admin-fb-guard-${Date.now()}@empresa.com`)
    await prisma.knowledgeEntry.create({
      data: {
        question: 'Quantos dias de férias?',
        answer: 'São 30 dias corridos.',
        keywords: ['ferias'],
        createdById: admin.id,
      },
    })
    const legend = await criarUsuario('LEGEND', `legend-fb-guard-${Date.now()}@empresa.com`)
    // A pergunta é feita com um token que TEM a feature — senão /assistant/ask já barraria
    // com 403 antes de existir uma pergunta para avaliar.
    const tokenComFeature = signAccessToken(app, legend, ['assistente'])
    const ask = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      headers: auth(tokenComFeature),
      payload: { question: 'quantos dias de férias?' },
    })
    const queryId = ask.json().queryId as string

    // O token da chamada de feedback, do mesmo usuário (dono da pergunta), não tem a
    // feature — prova que o 403 vem da guarda de feature, não do dono da pergunta.
    const tokenSemFeature = signAccessToken(app, legend, [])
    const res = await app.inject({
      method: 'POST',
      url: `/assistant/queries/${queryId}/feedback`,
      headers: auth(tokenSemFeature),
      payload: { rating: 1 },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('rotas de curadoria da base', () => {
  it('LEGEND não acessa a base', async () => {
    const legend = await criarUsuario('LEGEND', `legend-kb-${Date.now()}@empresa.com`)
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({ method: 'GET', url: '/admin/knowledge', headers: auth(token) })
    expect(res.statusCode).toBe(403)
  })

  it('ADMIN cria, edita, lista e apaga entrada', async () => {
    const admin = await criarUsuario('ADMIN', `admin-kb-${Date.now()}@empresa.com`)
    const token = signAccessToken(app, admin)

    const criada = await app.inject({
      method: 'POST',
      url: '/admin/knowledge',
      headers: auth(token),
      payload: {
        category: 'Férias',
        question: 'Quantos dias de férias?',
        answer: 'São 30 dias corridos.',
        keywords: ['ferias'],
      },
    })
    expect(criada.statusCode).toBe(201)
    const id = criada.json().entry.id as string

    const editada = await app.inject({
      method: 'PATCH',
      url: `/admin/knowledge/${id}`,
      headers: auth(token),
      payload: { isActive: false },
    })
    expect(editada.statusCode).toBe(200)
    expect(editada.json().entry.isActive).toBe(false)

    const lista = await app.inject({ method: 'GET', url: '/admin/knowledge', headers: auth(token) })
    expect(lista.statusCode).toBe(200)
    expect(lista.json().entries).toHaveLength(1)
    expect(lista.json().categories).toEqual(['Férias'])

    const apagada = await app.inject({
      method: 'DELETE',
      url: `/admin/knowledge/${id}`,
      headers: auth(token),
    })
    expect(apagada.statusCode).toBe(204)
  })

  it('recusa pergunta vazia com 400', async () => {
    const admin = await criarUsuario('ADMIN', `admin-kb-400-${Date.now()}@empresa.com`)
    const token = signAccessToken(app, admin)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/knowledge',
      headers: auth(token),
      payload: { question: '', answer: 'Y' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Dados inválidos.')
  })

  it('devolve as três listas de lacunas para o admin', async () => {
    const admin = await criarUsuario('ADMIN', `admin-gaps-${Date.now()}@empresa.com`)
    const token = signAccessToken(app, admin)
    await prisma.assistantQuery.create({
      data: { userId: admin.id, question: 'Como peço reembolso?', matchedEntryIds: [] },
    })

    const res = await app.inject({ method: 'GET', url: '/admin/assistant/gaps', headers: auth(token) })

    expect(res.statusCode).toBe(200)
    expect(res.json().unanswered[0].count).toBe(1)
    expect(res.json().frequent).toEqual([])
    expect(res.json().negative).toEqual([])
  })

  it('cumprimento não vira lacuna: o painel mostra só a dúvida de verdade', async () => {
    const admin = await criarUsuario('ADMIN', `admin-gaps-conversa-${Date.now()}@empresa.com`)
    const token = signAccessToken(app, admin)
    await prisma.assistantQuery.createMany({
      data: [
        { userId: admin.id, question: 'oi', matchedEntryIds: [] },
        { userId: admin.id, question: 'obrigada!', matchedEntryIds: [] },
        { userId: admin.id, question: 'ok', matchedEntryIds: [] },
        { userId: admin.id, question: 'Como peço reembolso?', matchedEntryIds: [] },
      ],
    })

    const res = await app.inject({ method: 'GET', url: '/admin/assistant/gaps', headers: auth(token) })

    expect(res.statusCode).toBe(200)
    const perguntas = res.json().unanswered.map((gap: { sample: string }) => gap.sample)
    expect(perguntas).toEqual(['Como peço reembolso?'])
  })
})

describe('POST /assistant/chat', () => {
  it('responde e grava uma AssistantQuery reaproveitável pelo endpoint de feedback', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-chat@empresa.com')
    await comChave(admin.companyId, admin.id)
    const legend = await criarUsuario('LEGEND', 'legend-chat@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { message: 'quantos dias de férias?' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.conversation.messages).toHaveLength(2)
    expect(body.conversation.messages[1].content).toBe('Resposta da assistente.')
    expect(typeof body.queryId).toBe('string')

    const feedback = await app.inject({
      method: 'POST',
      url: `/assistant/queries/${body.queryId}/feedback`,
      headers: auth(token),
      payload: { rating: 1 },
    })
    expect(feedback.statusCode).toBe(204)
  })

  it('continua a mesma conversa quando conversationId é enviado', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-chat2@empresa.com')
    await comChave(admin.companyId, admin.id)
    const legend = await criarUsuario('LEGEND', 'legend-chat2@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const primeiro = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { message: 'oi' },
    })
    const conversationId = primeiro.json().conversation.id as string

    const segundo = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { conversationId, message: 'e férias?' },
    })

    expect(segundo.statusCode).toBe(200)
    expect(segundo.json().conversation.id).toBe(conversationId)
    expect(segundo.json().conversation.messages).toHaveLength(4)
  })

  it('bloqueia quem está em setor sem a feature', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-chat-sem-feature@empresa.com')
    const token = signAccessToken(app, legend, [])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { message: 'oi' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('recusa mensagem vazia com 400', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-chat-vazio@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { message: '' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('responde da base de conhecimento quando a empresa não cadastrou chave de IA', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-chat-sem-chave@empresa.com')
    await prisma.knowledgeEntry.create({
      data: {
        question: 'Quantos dias de férias?',
        answer: 'São 30 dias corridos.',
        keywords: ['ferias'],
        createdById: admin.id,
      },
    })
    const legend = await criarUsuario('LEGEND', 'legend-chat-sem-chave@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { message: 'quantos dias de férias?' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.conversation.messages).toHaveLength(2)
    expect(body.conversation.messages[1].content).toBe('São 30 dias corridos.')
    // Sem credencial da empresa, nenhum provedor é chamado — nem o do ambiente.
    expect(completion).not.toHaveBeenCalled()

    // O turno da base também rende feedback: é a mesma `AssistantQuery`.
    const feedback = await app.inject({
      method: 'POST',
      url: `/assistant/queries/${body.queryId}/feedback`,
      headers: auth(token),
      payload: { rating: 1 },
    })
    expect(feedback.statusCode).toBe(204)
  })

  it('sem chave e sem entrada na base, diz que não encontrou em vez de falhar', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-chat-sem-base@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { message: 'como funciona o vale-transporte?' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().conversation.messages[1].content).toBe(ASSISTANT_NOT_FOUND_MESSAGE)
  })

  it('sem chave, o turno da base continua na mesma conversa', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-chat-base-continua@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const primeiro = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { message: 'oi' },
    })
    const conversationId = primeiro.json().conversation.id as string

    const segundo = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { conversationId, message: 'e férias?' },
    })

    expect(segundo.statusCode).toBe(200)
    expect(segundo.json().conversation.id).toBe(conversationId)
    expect(segundo.json().conversation.messages).toHaveLength(4)
  })

  it('não esconde falha do provedor atrás da base: chave recusada sobe como erro', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-chat-chave-ruim@empresa.com')
    await comChave(admin.companyId, admin.id)
    await prisma.knowledgeEntry.create({
      data: {
        question: 'Quantos dias de férias?',
        answer: 'São 30 dias corridos.',
        keywords: ['ferias'],
        createdById: admin.id,
      },
    })
    completion.mockRejectedValue(new AgentError(AGENT_BAD_KEY_MESSAGE, 502))
    const legend = await criarUsuario('LEGEND', 'legend-chat-chave-ruim@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { message: 'quantos dias de férias?' },
    })

    expect(res.statusCode).toBe(502)
    expect(res.json().message).toBe(AGENT_BAD_KEY_MESSAGE)
  })

  it('exige autenticação', async () => {
    const res = await app.inject({ method: 'POST', url: '/assistant/chat', payload: { message: 'oi' } })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /assistant/chat/conversations e /assistant/chat/conversations/:id', () => {
  it('lista e recupera a conversa da própria pessoa', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-chat-list@empresa.com')
    await comChave(admin.companyId, admin.id)
    const legend = await criarUsuario('LEGEND', 'legend-chat-list@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const ask = await app.inject({
      method: 'POST',
      url: '/assistant/chat',
      headers: auth(token),
      payload: { message: 'oi' },
    })
    const conversationId = ask.json().conversation.id as string

    const lista = await app.inject({ method: 'GET', url: '/assistant/chat/conversations', headers: auth(token) })
    expect(lista.statusCode).toBe(200)
    expect(lista.json().conversations).toHaveLength(1)

    const outraLegend = await criarUsuario('LEGEND', 'outra-legend-chat-list@empresa.com')
    const tokenOutro = signAccessToken(app, outraLegend, ['assistente'])
    const naoAcha = await app.inject({
      method: 'GET',
      url: `/assistant/chat/conversations/${conversationId}`,
      headers: auth(tokenOutro),
    })
    expect(naoAcha.statusCode).toBe(404)

    const acha = await app.inject({
      method: 'GET',
      url: `/assistant/chat/conversations/${conversationId}`,
      headers: auth(token),
    })
    expect(acha.statusCode).toBe(200)
  })
})

describe('persona da assistente', () => {
  it('devolve o nome padrão quando a empresa não configurou um, e reflete o valor salvo', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-persona@empresa.com')
    const token = signAccessToken(app, admin)

    const padrao = await app.inject({ method: 'GET', url: '/assistant/persona', headers: auth(token) })
    expect(padrao.statusCode).toBe(200)
    expect(padrao.json().name).toBe('Assistente de RH')

    const salvo = await app.inject({
      method: 'PATCH',
      url: '/admin/assistant/persona',
      headers: auth(token),
      payload: { name: 'Aria' },
    })
    expect(salvo.statusCode).toBe(200)
    expect(salvo.json().name).toBe('Aria')

    const depois = await app.inject({ method: 'GET', url: '/assistant/persona', headers: auth(token) })
    expect(depois.json().name).toBe('Aria')
  })

  it('LEGEND não edita a persona', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-persona@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/assistant/persona',
      headers: auth(token),
      payload: { name: 'Aria' },
    })

    expect(res.statusCode).toBe(403)
  })
})
