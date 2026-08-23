import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  AGENT_MESSAGE_MAX_LENGTH,
  ASSISTANT_ANSWER_MAX_LENGTH,
  ASSISTANT_CATEGORY_MAX_LENGTH,
  ASSISTANT_COMMENT_MAX_LENGTH,
  ASSISTANT_GAPS_DEFAULT_DAYS,
  ASSISTANT_GAPS_DEFAULT_LIMIT,
  ASSISTANT_GAPS_MAX_DAYS,
  ASSISTANT_KEYWORDS_MAX_COUNT,
  ASSISTANT_KEYWORD_MAX_LENGTH,
  ASSISTANT_PERSONA_NAME_MAX_LENGTH,
  ASSISTANT_QUESTION_MAX_LENGTH,
  ASSISTANT_QUESTION_MIN_LENGTH,
} from '@legends/shared'
import { AssistantError } from '../lib/assistant-error'
import { AgentError } from '../lib/agent-error'
import { toAgentConversationDTO, toAgentConversationSummaryDTO, toAssistantSourceDTO, toKnowledgeEntryDTO } from '../lib/serialize'
import {
  askAssistant,
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  listAssistantGaps,
  listKnowledgeEntries,
  recordAssistantFeedback,
  updateKnowledgeEntry,
  type AssistantActor,
} from '../services/assistant-service'
import { askAssistantChat } from '../services/assistant-chat-service'
import { getConversation, listConversations, type AgentActor } from '../services/agent-service'
import { getAssistantPersona, setAssistantPersonaName } from '../services/assistant-persona-service'

const askSchema = z.object({
  question: z.string().trim().min(ASSISTANT_QUESTION_MIN_LENGTH).max(ASSISTANT_QUESTION_MAX_LENGTH),
})

const idParamsSchema = z.object({ id: z.string().min(1) })

const feedbackSchema = z.object({
  // Só -1 e 1: o banco aceitaria qualquer inteiro, a rota é a fronteira.
  rating: z.union([z.literal(-1), z.literal(1)]),
  comment: z.string().trim().max(ASSISTANT_COMMENT_MAX_LENGTH).nullable().optional(),
})

const knowledgeBaseSchema = {
  category: z.string().trim().max(ASSISTANT_CATEGORY_MAX_LENGTH).nullable().optional(),
  question: z.string().trim().min(1).max(ASSISTANT_QUESTION_MAX_LENGTH),
  answer: z.string().trim().min(1).max(ASSISTANT_ANSWER_MAX_LENGTH),
  keywords: z
    .array(z.string().trim().min(1).max(ASSISTANT_KEYWORD_MAX_LENGTH))
    .max(ASSISTANT_KEYWORDS_MAX_COUNT)
    .optional(),
  isActive: z.boolean().optional(),
  sectorId: z.string().min(1).nullable().optional(),
}
const createKnowledgeSchema = z.object(knowledgeBaseSchema)
const updateKnowledgeSchema = z.object(knowledgeBaseSchema).partial()

const knowledgeListQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  sectorId: z.string().min(1).optional(),
  isActive: z.enum(['true', 'false']).optional(),
})

const gapsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(ASSISTANT_GAPS_MAX_DAYS).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const chatAskSchema = z.object({
  conversationId: z.string().min(1).optional(),
  message: z.string().trim().min(1).max(AGENT_MESSAGE_MAX_LENGTH),
})

const conversationIdParamsSchema = z.object({ id: z.string().min(1) })

const personaSchema = z.object({ name: z.string().trim().min(1).max(ASSISTANT_PERSONA_NAME_MAX_LENGTH) })

/** Erro de domínio → resposta; o resto sobe. */
function handleAssistantError(err: unknown, reply: FastifyReply) {
  if (err instanceof AssistantError) return reply.code(err.status).send({ message: err.message })
  throw err
}

/** `AgentError` também nasce com mensagem em português e status próprio — mesmo tratamento. */
function handleAgentError(err: unknown, reply: FastifyReply) {
  if (err instanceof AgentError) return reply.code(err.status).send({ message: err.message })
  throw err
}

function actorFrom(request: {
  user: { sub: string; role: string; sectorId: string; companyId: string }
}): AssistantActor {
  return {
    id: request.user.sub,
    role: request.user.role,
    sectorId: request.user.sectorId,
    companyId: request.user.companyId,
  }
}

function agentActorFrom(request: {
  user: { sub: string; sectorId: string; companyId: string }
}): AgentActor {
  return { id: request.user.sub, companyId: request.user.companyId, sectorId: request.user.sectorId }
}

export async function assistantRoutes(app: FastifyInstance) {
  app.post(
    '/assistant/ask',
    { onRequest: [app.authenticate, app.requireFeature('assistente')] },
    async (request, reply) => {
      const parsed = askSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
      }
      try {
        const result = await askAssistant(actorFrom(request), parsed.data.question)
        return reply.send({
          queryId: result.queryId,
          answer: result.answer,
          answered: result.answered,
          source: result.source,
          sources: result.sources.map(toAssistantSourceDTO),
        })
      } catch (err) {
        return handleAssistantError(err, reply)
      }
    },
  )

  /**
   * Chat multi-turno da assistente (agente `assistant` de `agent-service.ts`).
   * Mesma feature `assistente` da pergunta única — não sobe pra guarda de
   * `gente-gestao` porque é rota de colaborador, não de admin.
   */
  app.post(
    '/assistant/chat',
    { onRequest: [app.authenticate, app.requireFeature('assistente')] },
    async (request, reply) => {
      const parsed = chatAskSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
      }
      try {
        // O turno também é gravado como `AssistantQuery`: é o que o painel de
        // lacunas e o feedback (`/assistant/queries/:id/feedback`, reaproveitado
        // sem mudança) continuam consumindo.
        const { conversation, queryId } = await askAssistantChat({
          actor: actorFrom(request),
          conversationId: parsed.data.conversationId,
          message: parsed.data.message,
        })
        return reply.send({ conversation: toAgentConversationDTO(conversation), queryId })
      } catch (err) {
        return handleAgentError(err, reply)
      }
    },
  )

  app.get(
    '/assistant/chat/conversations',
    { onRequest: [app.authenticate, app.requireFeature('assistente')] },
    async (request, reply) => {
      const conversations = await listConversations(agentActorFrom(request), 'assistant')
      return reply.send({ conversations: conversations.map(toAgentConversationSummaryDTO) })
    },
  )

  app.get(
    '/assistant/chat/conversations/:id',
    { onRequest: [app.authenticate, app.requireFeature('assistente')] },
    async (request, reply) => {
      const params = conversationIdParamsSchema.safeParse(request.params)
      if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
      try {
        const conversation = await getConversation(agentActorFrom(request), 'assistant', params.data.id)
        return reply.send({ conversation: toAgentConversationDTO(conversation) })
      } catch (err) {
        return handleAgentError(err, reply)
      }
    },
  )

  /** Nome e avatar de exibição da assistente — qualquer autenticado lê, só admin/subadmin edita o nome. */
  app.get('/assistant/persona', { onRequest: [app.authenticate] }, async (request, reply) => {
    const persona = await getAssistantPersona(request.user.companyId)
    return reply.send(persona)
  })

  app.post(
    '/assistant/queries/:id/feedback',
    { onRequest: [app.authenticate, app.requireFeature('assistente')] },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params)
      if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
      const parsed = feedbackSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
      }
      try {
        await recordAssistantFeedback(actorFrom(request), params.data.id, parsed.data)
        return reply.code(204).send()
      } catch (err) {
        return handleAssistantError(err, reply)
      }
    },
  )

  const adminGuard = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/admin/knowledge', adminGuard, async (request, reply) => {
    const query = knowledgeListQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: query.error.issues })
    }
    const { entries, categories } = await listKnowledgeEntries(actorFrom(request), {
      q: query.data.q,
      category: query.data.category,
      sectorId: query.data.sectorId,
      isActive: query.data.isActive === undefined ? undefined : query.data.isActive === 'true',
    })
    return reply.send({ entries: entries.map(toKnowledgeEntryDTO), categories })
  })

  app.post('/admin/knowledge', adminGuard, async (request, reply) => {
    const parsed = createKnowledgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const created = await createKnowledgeEntry(actorFrom(request), parsed.data)
      return reply.code(201).send({ entry: toKnowledgeEntryDTO(created) })
    } catch (err) {
      return handleAssistantError(err, reply)
    }
  })

  app.patch('/admin/knowledge/:id', adminGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    const parsed = updateKnowledgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const updated = await updateKnowledgeEntry(actorFrom(request), params.data.id, parsed.data)
      return reply.send({ entry: toKnowledgeEntryDTO(updated) })
    } catch (err) {
      return handleAssistantError(err, reply)
    }
  })

  app.delete('/admin/knowledge/:id', adminGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      await deleteKnowledgeEntry(actorFrom(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleAssistantError(err, reply)
    }
  })

  app.patch('/admin/assistant/persona', adminGuard, async (request, reply) => {
    const parsed = personaSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    const persona = await setAssistantPersonaName(request.user.companyId, parsed.data.name)
    return reply.send(persona)
  })

  app.get('/admin/assistant/gaps', adminGuard, async (request, reply) => {
    const query = gapsQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: query.error.issues })
    }
    const gaps = await listAssistantGaps(actorFrom(request), {
      days: query.data.days ?? ASSISTANT_GAPS_DEFAULT_DAYS,
      limit: query.data.limit ?? ASSISTANT_GAPS_DEFAULT_LIMIT,
    })
    return reply.send({
      unanswered: gaps.unanswered,
      frequent: gaps.frequent,
      negative: gaps.negative.map((item) => ({
        entry: toKnowledgeEntryDTO(item.entry),
        negativeCount: item.negativeCount,
        comments: item.comments,
      })),
    })
  })
}
