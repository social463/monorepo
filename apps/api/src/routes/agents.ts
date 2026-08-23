import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { AGENT_MESSAGE_MAX_LENGTH, isAgentKey } from '@legends/shared'
import { AgentError } from '../lib/agent-error'
import { toAgentConversationDTO, toAgentConversationSummaryDTO } from '../lib/serialize'
import { askAgent, getConversation, listConversations, type AgentActor } from '../services/agent-service'
import { captureFor } from '../lib/analytics/request'

const agentParamsSchema = z.object({
  agent: z.string().refine(isAgentKey, { message: 'Agente desconhecido.' }),
})

const conversationParamsSchema = agentParamsSchema.extend({ id: z.string().min(1) })

const askSchema = z.object({
  conversationId: z.string().min(1).optional(),
  message: z.string().trim().min(1).max(AGENT_MESSAGE_MAX_LENGTH),
})

/** Erro de domínio → resposta com a mensagem já em português; o resto sobe. */
function handleAgentError(err: unknown, reply: FastifyReply) {
  if (err instanceof AgentError) return reply.code(err.status).send({ message: err.message })
  throw err
}

function actorFrom(request: { user: { sub: string; companyId: string } }): AgentActor {
  return { id: request.user.sub, companyId: request.user.companyId }
}

/**
 * Agentes de IA. O agente consome a cota paga da empresa, então não é rota de
 * colaborador — e nem de qualquer SUBADMIN: só do setor com a feature
 * `gente-gestao` ligada. ADMIN global passa.
 * A configuração da chave é mais restrita ainda e vive em
 * `routes/ai-settings.ts` (só ADMIN).
 */
export async function agentRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  app.post('/admin/agents/:agent/ask', guard, async (request, reply) => {
    const params = agentParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Agente inválido.', issues: params.error.issues })
    }
    const parsed = askSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    // Medimos também a chamada que falha: empresa sem chave cadastrada responde
    // 503, e uma série de `error` é justamente o sinal de que alguém está
    // tentando usar o agente e esbarrando na configuração.
    const startedAt = Date.now()
    try {
      const conversation = await askAgent({
        actor: actorFrom(request),
        agent: params.data.agent,
        conversationId: parsed.data.conversationId,
        message: parsed.data.message,
      })
      captureFor(request, 'ai_agent_invoked', {
        agent: params.data.agent,
        outcome: 'success',
        durationMs: Date.now() - startedAt,
      })
      return reply.send({ conversation: toAgentConversationDTO(conversation) })
    } catch (err) {
      captureFor(request, 'ai_agent_invoked', {
        agent: params.data.agent,
        outcome: 'error',
        durationMs: Date.now() - startedAt,
      })
      return handleAgentError(err, reply)
    }
  })

  app.get('/admin/agents/:agent/conversations', guard, async (request, reply) => {
    const params = agentParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Agente inválido.', issues: params.error.issues })
    }
    const conversations = await listConversations(actorFrom(request), params.data.agent)
    return reply.send({ conversations: conversations.map(toAgentConversationSummaryDTO) })
  })

  app.get('/admin/agents/:agent/conversations/:id', guard, async (request, reply) => {
    const params = conversationParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: params.error.issues })
    }
    try {
      const conversation = await getConversation(actorFrom(request), params.data.agent, params.data.id)
      return reply.send({ conversation: toAgentConversationDTO(conversation) })
    } catch (err) {
      return handleAgentError(err, reply)
    }
  })
}
