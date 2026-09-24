import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_CONVERSATION_MAX_MESSAGES, AGENT_MESSAGE_MAX_LENGTH } from '@legends/shared'

import type { AgentCompletionInput } from '../lib/agent-client'

// Mocka a fronteira cara: a chamada ao provedor de LLM. O teste controla o que
// "a IA" responde e inspeciona o prompt que ela recebeu — daí o parâmetro
// tipado, que é o que dá tipo a `completion.mock.calls[n][0]`.
const completion = vi.hoisted(() =>
  vi.fn(async (_input: AgentCompletionInput) => 'Resposta do agente.'),
)
vi.mock('../lib/agent-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/agent-client')>()),
  requestAgentCompletion: completion,
}))

import { buildApp } from '../app'
import { AgentError } from '../lib/agent-error'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'
import { updateAiSettings } from '../services/ai-settings-service'

async function criarUsuario(role: string, email: string, companyId?: string) {
  return prisma.user.create({
    data: {
      name: `Usuário ${role}`,
      email,
      passwordHash: 'x',
      role: role as never,
      ...(companyId ? { companyId } : {}),
    },
  })
}

/** Empresa com chave de IA cadastrada — sem isso todo pedido é 503. */
async function comChave(companyId: string, actorId: string) {
  await updateAiSettings({ companyId, actorId, body: { apiKey: 'chave-de-teste' } })
}

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  completion.mockReset()
  completion.mockResolvedValue('Resposta do agente.')
  app = buildApp()
  await app.ready()
})

describe('rotas do agente', () => {
  it('persiste pergunta e resposta na ordem e devolve a conversa', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-agente@empresa.com')
    await comChave(admin.companyId, admin.id)
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/benchmark/ask',
      headers: auth,
      payload: { message: 'Benchmark de saúde mental em edtechs' },
    })

    expect(res.statusCode).toBe(200)
    const { conversation } = res.json()
    expect(conversation.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
    expect(conversation.messages[0].content).toBe('Benchmark de saúde mental em edtechs')
    expect(conversation.messages[1].content).toBe('Resposta do agente.')
    expect(conversation.title).toBe('Benchmark de saúde mental em edtechs')
    expect(conversation.agent).toBe('benchmark')
  })

  it('retoma a conversa com o histórico completo e manda o histórico para a IA', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-retoma@empresa.com')
    await comChave(admin.companyId, admin.id)
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const primeira = await app.inject({
      method: 'POST',
      url: '/admin/agents/benchmark/ask',
      headers: auth,
      payload: { message: 'Primeira pergunta' },
    })
    const conversationId = primeira.json().conversation.id

    completion.mockResolvedValueOnce('Segunda resposta.')
    const segunda = await app.inject({
      method: 'POST',
      url: '/admin/agents/benchmark/ask',
      headers: auth,
      payload: { conversationId, message: 'Segunda pergunta' },
    })

    expect(segunda.json().conversation.messages).toHaveLength(4)
    expect(segunda.json().conversation.messages.map((m: { content: string }) => m.content)).toEqual([
      'Primeira pergunta',
      'Resposta do agente.',
      'Segunda pergunta',
      'Segunda resposta.',
    ])
    // O turno anterior foi junto no request — é o que torna a conversa contínua.
    expect(completion.mock.calls[1][0].turns.map((t) => t.content)).toEqual([
      'Primeira pergunta',
      'Resposta do agente.',
      'Segunda pergunta',
    ])

    // E a conversa é recuperável depois, por GET.
    const recuperada = await app.inject({
      method: 'GET',
      url: `/admin/agents/benchmark/conversations/${conversationId}`,
      headers: auth,
    })
    expect(recuperada.json().conversation.messages).toHaveLength(4)
  })

  it('injeta as práticas cadastradas no system prompt', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-praticas-prompt@empresa.com')
    await comChave(admin.companyId, admin.id)
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    await app.inject({
      method: 'POST',
      url: '/admin/benchmark-practices',
      headers: auth,
      payload: { category: 'Reconhecimento', title: 'Day off de aniversário', channel: 'Teams' },
    })

    await app.inject({
      method: 'POST',
      url: '/admin/agents/benchmark/ask',
      headers: auth,
      payload: { message: 'Compare com o mercado' },
    })

    const { systemPrompt } = completion.mock.calls[0][0]
    expect(systemPrompt).toContain('- [Reconhecimento] Day off de aniversário (canal: Teams)')
  })

  it('sem chave cadastrada, responde 503 em português — não 500', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-sem-chave@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/benchmark/ask',
      headers: auth,
      payload: { message: 'Oi' },
    })

    expect(res.statusCode).toBe(503)
    expect(res.json().message).toContain('Agente de IA não configurado')
    expect(completion).not.toHaveBeenCalled()
  })

  it('falha da IA vira status tipado com mensagem em português, nunca 500', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-falha-ia@empresa.com')
    await comChave(admin.companyId, admin.id)
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    for (const [erro, status] of [
      [new AgentError('Limite de requisições da IA atingido. Tente novamente em instantes.', 429), 429],
      [new AgentError('A análise demorou demais para responder. Tente uma pergunta mais específica.', 504), 504],
    ] as const) {
      completion.mockRejectedValueOnce(erro)
      const res = await app.inject({
        method: 'POST',
        url: '/admin/agents/benchmark/ask',
        headers: auth,
        payload: { message: 'Pergunta' },
      })
      expect(res.statusCode).toBe(status)
      expect(res.json().message).toBe(erro.message)
    }
  })

  it('turno que falhou não deixa mensagem órfã na conversa', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-orfa@empresa.com')
    await comChave(admin.companyId, admin.id)
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    completion.mockRejectedValueOnce(new AgentError('Falhou.', 502))
    await app.inject({
      method: 'POST',
      url: '/admin/agents/benchmark/ask',
      headers: auth,
      payload: { message: 'Pergunta que falha' },
    })

    expect(await prisma.agentConversation.count()).toBe(0)
    expect(await prisma.agentMessage.count()).toBe(0)
  })

  it('recusa mensagem acima do limite de caracteres com 400', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-limite-msg@empresa.com')
    await comChave(admin.companyId, admin.id)
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/benchmark/ask',
      headers: auth,
      payload: { message: 'a'.repeat(AGENT_MESSAGE_MAX_LENGTH + 1) },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().issues).toBeDefined()
    expect(completion).not.toHaveBeenCalled()
  })

  it('recusa conversa acima do limite de mensagens com 400', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-limite-conversa@empresa.com')
    await comChave(admin.companyId, admin.id)
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const conversation = await prisma.agentConversation.create({
      data: { companyId: admin.companyId, userId: admin.id, agent: 'BENCHMARK', title: 'Cheia' },
    })
    await prisma.agentMessage.createMany({
      data: Array.from({ length: AGENT_CONVERSATION_MAX_MESSAGES }, (_, i) => ({
        companyId: admin.companyId,
        conversationId: conversation.id,
        role: i % 2 === 0 ? ('USER' as const) : ('ASSISTANT' as const),
        content: `msg ${i}`,
      })),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/benchmark/ask',
      headers: auth,
      payload: { conversationId: conversation.id, message: 'Mais uma' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain(`limite de ${AGENT_CONVERSATION_MAX_MESSAGES} mensagens`)
    expect(completion).not.toHaveBeenCalled()
  })

  it('agente desconhecido é 400', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-agente-invalido@empresa.com')
    await comChave(admin.companyId, admin.id)
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/inexistente/ask',
      headers: auth,
      payload: { message: 'Oi' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('recusa "inova" nesta rota genérica com 4xx e nunca chega no provedor de IA', async () => {
    // "inova" é um AgentKey válido (conversa, DTO e as rotas dedicadas
    // `/inova/admin/chat/*` dependem disso), mas esta rota genérica é gated por
    // `gente-gestao` (permissão errada para o INOVA) e o handler local só
    // reconhece `AgentError`, não `InovaError` — deixar passar aqui faria a
    // checagem de módulo do INOVA estourar como 500 em vez de 403, além de
    // liberar o chat do INOVA (e a cota de IA da empresa) para qualquer
    // SUBADMIN de Gente e Gestão, sem nenhum direito de administração do INOVA.
    const admin = await criarUsuario('ADMIN', 'admin-agente-inova@empresa.com')
    await comChave(admin.companyId, admin.id)
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const ask = await app.inject({
      method: 'POST',
      url: '/admin/agents/inova/ask',
      headers: auth,
      payload: { message: 'Oi' },
    })
    const conversations = await app.inject({
      method: 'GET',
      url: '/admin/agents/inova/conversations',
      headers: auth,
    })
    const conversation = await app.inject({
      method: 'GET',
      url: '/admin/agents/inova/conversations/qualquer-id',
      headers: auth,
    })

    expect(ask.statusCode).toBeGreaterThanOrEqual(400)
    expect(ask.statusCode).toBeLessThan(500)
    expect(conversations.statusCode).toBeGreaterThanOrEqual(400)
    expect(conversations.statusCode).toBeLessThan(500)
    expect(conversation.statusCode).toBeGreaterThanOrEqual(400)
    expect(conversation.statusCode).toBeLessThan(500)
    expect(completion).not.toHaveBeenCalled()
  })

  it('só o SUBADMIN do setor com a feature entra; os outros papéis, 403', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-guarda-agente@empresa.com')
    await comChave(admin.companyId, admin.id)

    // O "líder de Gente e Gestão" é o SUBADMIN do setor com `benchmarking`
    // ligada — a feature viaja no token, é assim que a guarda a enxerga.
    const subadminGG = await criarUsuario('SUBADMIN', 'subadmin-gg@empresa.com')
    const subadminOutro = await criarUsuario('SUBADMIN', 'subadmin-outro-setor@empresa.com')
    const legend = await criarUsuario('LEGEND', 'legend-agente@empresa.com')

    const pedir = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/admin/agents/benchmark/ask',
        headers: { authorization: `Bearer ${token}` },
        payload: { message: 'Pergunta' },
      })

    expect((await pedir(signAccessToken(app, admin))).statusCode).toBe(200)
    expect((await pedir(signAccessToken(app, subadminGG, ['gente-gestao']))).statusCode).toBe(200)
    expect((await pedir(signAccessToken(app, subadminOutro, ['cultura']))).statusCode).toBe(403)
    expect((await pedir(signAccessToken(app, subadminOutro))).statusCode).toBe(403)
    expect((await pedir(signAccessToken(app, legend, ['gente-gestao']))).statusCode).toBe(403)
  })

  it('conversa de outra pessoa da mesma empresa é 404 e não aparece na lista', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-dono@empresa.com')
    await comChave(admin.companyId, admin.id)
    const colega = await criarUsuario('SUBADMIN', 'colega-agente@empresa.com')

    const criada = await app.inject({
      method: 'POST',
      url: '/admin/agents/benchmark/ask',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: { message: 'Pergunta privada' },
    })
    const conversationId = criada.json().conversation.id
    const authColega = { authorization: `Bearer ${signAccessToken(app, colega, ['gente-gestao'])}` }

    const busca = await app.inject({
      method: 'GET',
      url: `/admin/agents/benchmark/conversations/${conversationId}`,
      headers: authColega,
    })
    const lista = await app.inject({
      method: 'GET',
      url: '/admin/agents/benchmark/conversations',
      headers: authColega,
    })

    expect(busca.statusCode).toBe(404)
    expect(lista.json().conversations).toHaveLength(0)
  })

  it('conversa de outra empresa nunca aparece', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-empresa-a-agente@empresa.com')
    await comChave(admin.companyId, admin.id)
    const criada = await app.inject({
      method: 'POST',
      url: '/admin/agents/benchmark/ask',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: { message: 'Pergunta da empresa A' },
    })

    const outra = await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })
    const adminB = await criarUsuario('ADMIN', 'admin-empresa-b-agente@outra.com', outra.id)
    const authB = { authorization: `Bearer ${signAccessToken(app, adminB)}` }

    const busca = await app.inject({
      method: 'GET',
      url: `/admin/agents/benchmark/conversations/${criada.json().conversation.id}`,
      headers: authB,
    })
    const lista = await app.inject({ method: 'GET', url: '/admin/agents/benchmark/conversations', headers: authB })

    expect(busca.statusCode).toBe(404)
    expect(lista.json().conversations).toHaveLength(0)
  })
})
