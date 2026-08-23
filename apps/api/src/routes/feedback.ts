import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  CUSTOM_CATEGORY_MAX_LENGTH,
  FEEDBACK_AI_PROMPT_MAX_LENGTH,
  FEEDBACK_CATEGORIES,
  FEEDBACK_COMMENT_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_REACTIONS,
  MAX_FEEDBACK_RECIPIENTS,
  MAX_RECOGNITION_CATEGORIES_PER_FEEDBACK,
  MIN_FEEDBACK_FIELD_LENGTH,
} from '@legends/shared'
import {
  FeedbackError,
  createFeedback,
  createFeedbackComment,
  deleteFeedback,
  deleteFeedbackComment,
  generateFeedbackMessage,
  listFeedbackComments,
  listFeedbacksForUser,
  listFeedbacksReceivedBy,
  listFeedbacksSentBy,
  listSharedFeedbacks,
  setFeedbackShared,
  toggleReaction,
  updateFeedback,
} from '../services/feedback-service'
import { getAiSettings } from '../services/ai-settings-service'
import { evaluateBadgesForUser, syncFeedbackBadgesForUser } from '../services/badge-service'
import { notifyFeedbackReceived, notifyReaction, notifyBadgesEarned } from '../services/notification-service'
import { awardCoins } from '../services/coin-service'
import { awardXp } from '../services/xp-service'
import {
  toFeedbackCommentDTO,
  toFeedbackDTO,
  toMyFeedbackDTO,
  toSharedFeedbackDTO,
} from '../lib/serialize'
import { findUserInCompany } from '../lib/tenant-scope'
import { captureFor } from '../lib/analytics/request'

/** Normaliza o limit de paginação: default 10, mínimo 1, máximo 50. */
function clampLimit(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 10
  return Math.min(Math.floor(n), 50)
}

const createFeedbackSchema = z.object({
  message: z.string().trim().min(MIN_FEEDBACK_FIELD_LENGTH).max(FEEDBACK_MESSAGE_MAX_LENGTH),
  category: z.enum(FEEDBACK_CATEGORIES),
  /** Reconhecimento grupal: o principal vem na URL, os demais aqui. */
  targetIds: z.array(z.string()).max(MAX_FEEDBACK_RECIPIENTS).optional(),
  categoryIds: z.array(z.string()).max(MAX_RECOGNITION_CATEGORIES_PER_FEEDBACK).optional(),
  customCategory: z.string().trim().max(CUSTOM_CATEGORY_MAX_LENGTH).optional(),
  isPublic: z.boolean().optional(),
})

const commentSchema = z.object({
  message: z.string().trim().min(1).max(FEEDBACK_COMMENT_MAX_LENGTH),
})

const generateSchema = z.object({
  targetNames: z.array(z.string().trim().min(1)).min(1).max(MAX_FEEDBACK_RECIPIENTS),
  categoryNames: z.array(z.string().trim().min(1)).max(MAX_RECOGNITION_CATEGORIES_PER_FEEDBACK).optional(),
  notes: z.string().trim().max(FEEDBACK_AI_PROMPT_MAX_LENGTH).optional(),
})

const updateFeedbackSchema = z.object({
  message: z.string().trim().min(MIN_FEEDBACK_FIELD_LENGTH),
})

const toggleReactionSchema = z.object({
  emoji: z.enum(FEEDBACK_REACTIONS),
})

const invalidBody = { message: 'O feedback é obrigatório e precisa ser específico.' }

export async function feedbackRoutes(app: FastifyInstance) {
  // Mural de Feedbacks: o que a empresa inteira compartilhou, do mais recente para o
  // mais antigo. Terceirizado não enxerga a empresa toda — fica no próprio setor,
  // como já acontece em /users/showcase.
  app.get('/feedbacks/mural', { onRequest: [app.authenticate] }, async (request, reply) => {
    const query = request.query as { offset?: string; limit?: string; q?: string; categoryId?: string }
    const limit = clampLimit(query.limit)
    const offset = Math.max(0, Number(query.offset) || 0)
    const rows = await listSharedFeedbacks(request.user.companyId, {
      sectorId: request.user.role === 'THIRD_PARTY' ? request.user.sectorId : undefined,
      offset,
      limit,
      // Busca e filtro resolvem no servidor: filtrar depois da paginação
      // esconderia o resultado que está na página seguinte.
      q: query.q,
      categoryId: query.categoryId,
    })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    return reply.send({ feedbacks: page.map((f) => toSharedFeedbackDTO(f, request.user.sub)), hasMore })
  })

  /** Aba Recebidos: tudo que a pessoa recebeu, inclusive o que está privado. */
  app.get('/feedbacks/received', { onRequest: [app.authenticate] }, async (request, reply) => {
    const query = request.query as { offset?: string; limit?: string }
    const limit = clampLimit(query.limit)
    const offset = Math.max(0, Number(query.offset) || 0)
    const rows = await listFeedbacksReceivedBy(request.user.sub, request.user.companyId, { offset, limit })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    return reply.send({ feedbacks: page.map((f) => toMyFeedbackDTO(f, request.user.sub)), hasMore })
  })

  /** Aba Enviados: o que a pessoa escreveu, para acompanhar as respostas. */
  app.get('/feedbacks/sent', { onRequest: [app.authenticate] }, async (request, reply) => {
    const query = request.query as { offset?: string; limit?: string }
    const limit = clampLimit(query.limit)
    const offset = Math.max(0, Number(query.offset) || 0)
    const rows = await listFeedbacksSentBy(request.user.sub, request.user.companyId, { offset, limit })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    return reply.send({ feedbacks: page.map((f) => toMyFeedbackDTO(f, request.user.sub)), hasMore })
  })

  app.get('/feedbacks/:id/comments', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const comments = await listFeedbackComments(id, {
        id: request.user.sub,
        role: request.user.role,
        adminAccess: request.user.adminAccess,
        companyId: request.user.companyId,
      })
      return reply.send({ comments: comments.map(toFeedbackCommentDTO) })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/feedbacks/:id/comments', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = commentSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Escreva um comentário.', issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    try {
      const { comment } = await createFeedbackComment({
        feedbackId: id,
        message: parsed.data.message,
        viewer: {
          id: request.user.sub,
          role: request.user.role,
          adminAccess: request.user.adminAccess,
          companyId: request.user.companyId,
        },
      })
      return reply.code(201).send({ comment: toFeedbackCommentDTO(comment) })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/feedbacks/comments/:commentId', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { commentId } = request.params as { commentId: string }
    try {
      await deleteFeedbackComment({
        commentId,
        viewer: {
          id: request.user.sub,
          role: request.user.role,
          adminAccess: request.user.adminAccess,
          companyId: request.user.companyId,
        },
      })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /**
   * Se a empresa tem agente de IA configurado. É o que permite ao front esconder
   * "Escrever com IA" em vez de oferecer um botão que responde 503 — e é seguro
   * para colaborador porque devolve só o booleano, nunca provedor, modelo ou chave.
   */
  app.get('/ai/status', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { configured } = await getAiSettings(request.user.companyId)
    return reply.send({ configured })
  })

  /** "Escrever com IA" — rascunho do reconhecimento, com a chave da empresa. */
  app.post('/feedbacks/ai/generate', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = generateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Escolha ao menos um colega.', issues: parsed.error.flatten() })
    }
    try {
      const draft = await generateFeedbackMessage({
        companyId: request.user.companyId,
        authorId: request.user.sub,
        targetNames: parsed.data.targetNames,
        categoryNames: parsed.data.categoryNames ?? [],
        notes: parsed.data.notes,
      })
      return reply.send(draft)
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      // Sem chave cadastrada pela empresa, `AgentError` traz o status tratado.
      const status = (err as { status?: number }).status
      if (typeof status === 'number' && status >= 400 && status < 600) {
        return reply.code(status).send({ message: (err as Error).message })
      }
      throw err
    }
  })

  app.get('/users/:id/feedbacks', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const target = await findUserInCompany(request.user.companyId, id)
    if (!target) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    // `anchor` é o deep-link do mural: em vez de o front varrer página por
    // página atrás do feedback, o servidor devolve a página que o contém.
    const query = request.query as { offset?: string; limit?: string; categoryId?: string; anchor?: string }
    const limit = clampLimit(query.limit)
    const result = await listFeedbacksForUser(
      id,
      { id: request.user.sub, role: request.user.role, adminAccess: request.user.adminAccess },
      {
        offset: Math.max(0, Number(query.offset) || 0),
        limit,
        categoryId: query.categoryId,
        anchorId: query.anchor,
      },
    )
    const hasMore = result.feedbacks.length > limit
    const page = hasMore ? result.feedbacks.slice(0, limit) : result.feedbacks
    return reply.send({
      feedbacks: page.map((f) => toFeedbackDTO(f, request.user.sub)),
      hasMore,
      total: result.total,
      offset: result.offset,
    })
  })

  app.post('/users/:id/feedbacks', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = createFeedbackSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ ...invalidBody, issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    const target = await findUserInCompany(request.user.companyId, id)
    if (!target) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    try {
      const feedback = await createFeedback({
        authorId: request.user.sub,
        targetId: id,
        message: parsed.data.message,
        category: parsed.data.category,
        extraTargetIds: parsed.data.targetIds,
        categoryIds: parsed.data.categoryIds,
        customCategory: parsed.data.customCategory,
        isPublic: parsed.data.isPublic,
      })
      // Sincronização de selos é best-effort: o feedback já está persistido e os selos
      // são deriváveis/recomputáveis, então uma falha aqui não pode falhar o feedback.
      let awardedBadges: { badgeId: string }[] = []
      try {
        awardedBadges = (await syncFeedbackBadgesForUser(request.user.sub)).awarded
      } catch (badgeErr) {
        request.log.error(badgeErr)
      }
      try {
        await notifyBadgesEarned(request.user.sub, awardedBadges.map((b) => b.badgeId), request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      // Selos de quem RECEBEU: desde a unificação, CATEGORY/IMPACT/RECURRENCE
      // contam feedback recebido, então o selo pode sair na hora — antes só
      // saía na publicação do destaque do mês. Best-effort pelo mesmo motivo do
      // bloco acima.
      for (const recipient of feedback.recipients) {
        try {
          const earned = await evaluateBadgesForUser(recipient.userId)
          await notifyBadgesEarned(recipient.userId, earned.map((b) => b.badgeId), request.user.companyId)
        } catch (badgeErr) {
          request.log.error(badgeErr)
        }
      }
      // Notificação é best-effort pelo mesmo motivo — e vai para TODOS os
      // destinatários: no feedback grupal, avisar só o principal deixaria
      // o resto do time sabendo por acaso.
      for (const recipient of feedback.recipients) {
        try {
          await notifyFeedbackReceived({
            id: feedback.id,
            targetId: recipient.userId,
            authorId: request.user.sub,
            author: { name: feedback.author.name },
          }, request.user.companyId)
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      }
      // Crédito de EMR Coins ao autor, best-effort pelo mesmo motivo. A referência é
      // o id do feedback: dois feedbacks pagam duas vezes, o mesmo nunca paga de novo.
      try {
        await awardCoins({
          userId: request.user.sub,
          companyId: request.user.companyId,
          event: 'FEEDBACK_PUBLISHED',
          reference: feedback.id,
        })
      } catch (coinErr) {
        request.log.error(coinErr)
      }
      // XP em try próprio: as duas moedas têm regras independentes.
      try {
        await awardXp({
          userId: request.user.sub,
          companyId: request.user.companyId,
          event: 'FEEDBACK_PUBLISHED',
          reference: feedback.id,
        })
      } catch (xpErr) {
        request.log.error(xpErr)
      }
      captureFor(request, 'feedback_given', {
        category: parsed.data.category,
        length: parsed.data.message.length,
      })
      return reply.code(201).send({ feedback: toFeedbackDTO(feedback, request.user.sub) })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/feedbacks/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = updateFeedbackSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ ...invalidBody, issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    try {
      const feedback = await updateFeedback({
        feedbackId: id,
        userId: request.user.sub,
        ...parsed.data,
      })
      return reply.send({ feedback: toFeedbackDTO(feedback, request.user.sub) })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/feedbacks/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { authorId } = await deleteFeedback({ feedbackId: id, userId: request.user.sub })
      // Sincronização de selos é best-effort: o feedback já está persistido e os selos
      // são deriváveis/recomputáveis, então uma falha aqui não pode falhar o feedback.
      try {
        await syncFeedbackBadgesForUser(authorId)
      } catch (badgeErr) {
        request.log.error(badgeErr)
      }
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/feedbacks/:id/reactions/toggle', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = toggleReactionSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Reação inválida.', issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    try {
      const feedback = await toggleReaction({
        feedbackId: id,
        userId: request.user.sub,
        emoji: parsed.data.emoji,
        viewerRole: request.user.role,
        viewerAdminAccess: request.user.adminAccess,
      })
      // Só notifica quando a reação foi ADICIONADA (existe no resultado), não removida.
      const myReaction = feedback.reactions.find(
        (r) => r.userId === request.user.sub && r.emoji === parsed.data.emoji,
      )
      if (myReaction) {
        // Crédito de EMR Coins a quem reagiu, best-effort. A referência inclui o emoji:
        // emojis diferentes pagam separado, e tirar/recolocar o mesmo não repaga.
        try {
          await awardCoins({
            userId: request.user.sub,
            companyId: request.user.companyId,
            event: 'FEEDBACK_REACTION',
            reference: `${feedback.id}:${parsed.data.emoji}`,
          })
        } catch (coinErr) {
          request.log.error(coinErr)
        }
        // XP em try próprio: as duas moedas têm regras independentes.
        try {
          await awardXp({
            userId: request.user.sub,
            companyId: request.user.companyId,
            event: 'FEEDBACK_REACTION',
            reference: `${feedback.id}:${parsed.data.emoji}`,
          })
        } catch (xpErr) {
          request.log.error(xpErr)
        }
        try {
          await notifyReaction(
            { id: feedback.id, targetId: feedback.targetId, authorId: feedback.authorId },
            request.user.sub,
            myReaction.user.name,
            request.user.companyId,
          )
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      }
      return reply.send({ reactions: toFeedbackDTO(feedback, request.user.sub).reactions })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/feedbacks/:id/share', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const feedback = await setFeedbackShared({ feedbackId: id, userId: request.user.sub, shared: true })
      return reply.send({ feedback: toFeedbackDTO(feedback, request.user.sub) })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/feedbacks/:id/share', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const feedback = await setFeedbackShared({ feedbackId: id, userId: request.user.sub, shared: false })
      return reply.send({ feedback: toFeedbackDTO(feedback, request.user.sub) })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
