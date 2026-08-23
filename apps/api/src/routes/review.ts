import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  REVIEW_MAX_LENGTH,
  REVIEW_REACTIONS,
  MAX_REVIEW_MENTIONS,
  REVIEW_POLL_MAX_OPTIONS,
  REVIEW_POLL_MIN_OPTIONS,
  REVIEW_POLL_OPTION_MAX_LENGTH,
  REVIEW_POLL_QUESTION_MAX_LENGTH,
} from '@legends/shared'
import {
  ReviewError,
  createComment,
  createReview,
  deleteComment,
  deleteReview,
  getReviewForViewer,
  listComments,
  listFeed,
  listReviewPollVotes,
  shareReview,
  toggleCommentReaction,
  toggleReviewReaction,
  unshareReview,
  voteReviewPoll,
} from '../services/review-service'
import {
  notifyReviewComment,
  notifyReviewCommentReply,
  notifyReviewMention,
  notifyReviewPollPublished,
  notifyReviewReaction,
  notifyReviewShared,
} from '../services/notification-service'
import { toReactorRef, toReviewCommentDTO, toReviewDTO } from '../lib/serialize'
import { reviewHub } from '../lib/review-hub'

/** Limite do feed: default 20, mínimo 1, máximo 50. */
function clampLimit(raw: string | undefined, fallback = 20): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), 50)
}

const gifSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})
const imageSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})
const pollSchema = z.object({
  question: z.string().trim().min(1).max(REVIEW_POLL_QUESTION_MAX_LENGTH),
  options: z
    .array(z.string().trim().min(1).max(REVIEW_POLL_OPTION_MAX_LENGTH))
    .min(REVIEW_POLL_MIN_OPTIONS)
    .max(REVIEW_POLL_MAX_OPTIONS)
    .refine(
      (options) => new Set(options.map((option) => option.toLocaleLowerCase('pt-BR'))).size === options.length,
      { message: 'As opções da enquete precisam ser diferentes.' },
    ),
})
const contentSchema = z
  .object({
    content: z.string().trim().max(REVIEW_MAX_LENGTH).optional().default(''),
    mentionedUserIds: z.array(z.string()).max(MAX_REVIEW_MENTIONS).optional(),
    gif: gifSchema.optional(),
    image: imageSchema.optional(),
  })
  .refine((v) => v.content.trim().length >= 1 || v.gif || v.image, {
    message: 'Escreva algo ou anexe um GIF ou imagem.',
  })
const reviewContentSchema = z
  .object({
    content: z.string().trim().max(REVIEW_MAX_LENGTH).optional().default(''),
    mentionedUserIds: z.array(z.string()).max(MAX_REVIEW_MENTIONS).optional(),
    gif: gifSchema.optional(),
    image: imageSchema.optional(),
    poll: pollSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.content.trim().length < 1 && !value.gif && !value.image && !value.poll) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Escreva algo ou adicione um GIF, imagem ou enquete.' })
    }
    if ([value.gif, value.image, value.poll].filter(Boolean).length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Adicione um GIF, uma imagem ou uma enquete, não mais de um.',
      })
    }
  })
const reactionSchema = z.object({ emoji: z.enum(REVIEW_REACTIONS) })
const invalidContent = { message: `Escreva algo (até ${REVIEW_MAX_LENGTH} caracteres) ou anexe um GIF ou imagem.` }
const invalidReviewContent = {
  message: `Escreva algo (até ${REVIEW_MAX_LENGTH} caracteres) ou adicione um GIF, imagem ou enquete válida.`,
}

export async function reviewRoutes(app: FastifyInstance) {
  app.get('/reviews', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string }
    try {
      const { items, nextCursor, sharedReviewIds } = await listFeed(
        request.user.sub,
        request.user.companyId,
        request.user.sectorId,
        {
          cursor: query.cursor,
          limit: clampLimit(query.limit),
        },
      )
      return reply.send({
        items: items.map((r) => toReviewDTO(r, request.user.sub, sharedReviewIds.has(r.id))),
        nextCursor,
      })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const parsed = reviewContentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...invalidReviewContent, issues: parsed.error.flatten() })
    try {
      const review = await createReview({
        authorId: request.user.sub,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
        gif: parsed.data.gif,
        image: parsed.data.image,
        poll: parsed.data.poll,
        companyId: request.user.companyId,
      })
      try {
        await notifyReviewMention({
          recipientIds: review.mentions.map((m) => m.userId),
          actorId: request.user.sub,
          reviewId: review.id,
        }, request.user.companyId)
        // Enquete avisa o setor; quem foi marcado já recebeu a menção acima e
        // ganha as duas — são coisas diferentes ("te marcou" x "abriu enquete").
        if (review.poll) {
          await notifyReviewPollPublished({
            reviewId: review.id,
            question: review.poll.question,
            actorId: request.user.sub,
            sectorId: review.sectorId,
          }, request.user.companyId)
        }
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      reviewHub.broadcast({ type: 'feed:changed' })
      return reply.code(201).send({ review: toReviewDTO(review, request.user.sub, false) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/reviews/:id', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteReview({
        reviewId: id,
        userId: request.user.sub,
        role: request.user.role,
        adminAccess: request.user.adminAccess,
        companyId: request.user.companyId,
        sectorId: request.user.sectorId,
      })
      reviewHub.broadcast({ type: 'feed:changed' })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews/:id/reactions/toggle', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const parsed = reactionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Reação inválida.', issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const { review, added, reviewAuthorId, sharedByMe } = await toggleReviewReaction({
        reviewId: id,
        userId: request.user.sub,
        emoji: parsed.data.emoji,
        companyId: request.user.companyId,
        sectorId: request.user.sectorId,
      })
      if (added) {
        try {
          await notifyReviewReaction({ reviewAuthorId, actorId: request.user.sub, reviewId: id }, request.user.companyId)
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      }
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
      return reply.send({ review: toReviewDTO(review, request.user.sub, sharedByMe) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews/:id/poll/vote', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const parsed = z.object({ optionId: z.string().min(1) }).safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Escolha uma opção da enquete.', issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    try {
      const { review, sharedByMe } = await voteReviewPoll({
        reviewId: id,
        optionId: parsed.data.optionId,
        userId: request.user.sub,
        companyId: request.user.companyId,
        sectorId: request.user.sectorId,
      })
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
      return reply.send({ review: toReviewDTO(review, request.user.sub, sharedByMe) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/reviews/:id/poll/votes', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const poll = await listReviewPollVotes({
        reviewId: id,
        viewerId: request.user.sub,
        companyId: request.user.companyId,
        sectorId: request.user.sectorId,
      })
      const options = poll.options.map((option) => ({
        optionId: option.id,
        text: option.text,
        voters: option.votes.map((vote) => toReactorRef(vote.user)),
      }))
      return reply.send({
        pollId: poll.id,
        question: poll.question,
        totalVotes: options.reduce((total, option) => total + option.voters.length, 0),
        options,
      })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews/:id/share', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { reviewAuthorId, created } = await shareReview({
        reviewId: id,
        userId: request.user.sub,
        companyId: request.user.companyId,
        sectorId: request.user.sectorId,
      })
      if (created) {
        try {
          await notifyReviewShared({ reviewAuthorId, actorId: request.user.sub, reviewId: id }, request.user.companyId)
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      }
      const { review, sharedByMe } = await getReviewForViewer(
        id,
        request.user.sub,
        request.user.companyId,
        request.user.sectorId,
      )
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
      return reply.send({ review: toReviewDTO(review, request.user.sub, sharedByMe) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/reviews/:id/share', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await unshareReview({ reviewId: id, userId: request.user.sub, companyId: request.user.companyId })
      const { review, sharedByMe } = await getReviewForViewer(
        id,
        request.user.sub,
        request.user.companyId,
        request.user.sectorId,
      )
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
      return reply.send({ review: toReviewDTO(review, request.user.sub, sharedByMe) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/reviews/:id/comments', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query = request.query as { offset?: string; limit?: string }
    const limit = clampLimit(query.limit, 10)
    const offset = Math.max(0, Number(query.offset) || 0)
    try {
      const rows = await listComments(id, request.user.companyId, request.user.sectorId, { offset, limit })
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      return reply.send({ items: page.map((c) => toReviewCommentDTO(c, request.user.sub)), hasMore })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews/:id/comments', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const parsed = contentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...invalidContent, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const { comment, reviewAuthorId, replyRecipientIds } = await createComment({
        reviewId: id,
        authorId: request.user.sub,
        viewerSectorId: request.user.sectorId,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
        gif: parsed.data.gif,
        image: parsed.data.image,
        companyId: request.user.companyId,
      })
      try {
        await notifyReviewComment({ reviewAuthorId, actorId: request.user.sub, reviewId: id }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      try {
        await notifyReviewCommentReply({ recipientIds: replyRecipientIds, actorId: request.user.sub, reviewId: id }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      try {
        await notifyReviewMention({
          recipientIds: comment.mentions.map((m) => m.userId),
          actorId: request.user.sub,
          reviewId: id,
        }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      reviewHub.broadcast({ type: 'comments:changed', reviewId: id })
      return reply.code(201).send({ comment: toReviewCommentDTO(comment, request.user.sub) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/reviews/comments/:commentId', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { commentId } = request.params as { commentId: string }
    try {
      const { reviewId } = await deleteComment({
        commentId,
        userId: request.user.sub,
        role: request.user.role,
        adminAccess: request.user.adminAccess,
        companyId: request.user.companyId,
        sectorId: request.user.sectorId,
      })
      reviewHub.broadcast({ type: 'comments:changed', reviewId })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post(
    '/reviews/comments/:commentId/reactions/toggle',
    { onRequest: [app.authenticate, app.requireFeature('resenha')] },
    async (request, reply) => {
      const parsed = reactionSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ message: 'Reação inválida.', issues: parsed.error.flatten() })
      const { commentId } = request.params as { commentId: string }
      try {
        const { comment } = await toggleCommentReaction({
          commentId,
          userId: request.user.sub,
          emoji: parsed.data.emoji,
          companyId: request.user.companyId,
          sectorId: request.user.sectorId,
        })
        reviewHub.broadcast({ type: 'comments:changed', reviewId: comment.reviewId })
        return reply.send({ comment: toReviewCommentDTO(comment, request.user.sub) })
      } catch (err) {
        if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )
}
