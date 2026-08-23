import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MIN_FEEDBACK_FIELD_LENGTH, PUBLIC_FEEDBACK_CATEGORIES } from '@legends/shared'
import {
  createDevelopmentThursdayEvent,
  deleteDevelopmentThursdayEvent,
  DevelopmentThursdayError,
  findDevelopmentThursdayEventForFeedback,
  isDevelopmentThursdayEventFinished,
  listDevelopmentThursdayEvents,
  updateDevelopmentThursdayEvent,
} from '../services/development-thursday-service'
import { FeedbackError, createFeedback, listFeedbacksForDevelopmentThursdayEvent } from '../services/feedback-service'
import { syncFeedbackBadgesForUser } from '../services/badge-service'
import { notifyBadgesEarned, notifyFeedbackReceived } from '../services/notification-service'
import { toDevelopmentThursdayEventDTO, toFeedbackDTO } from '../lib/serialize'

function clampLimit(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 10
  return Math.min(Math.floor(n), 50)
}

const listQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

const createEventSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(800),
  eventDate: z.coerce.date().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  sprintStart: z.coerce.date().optional(),
})
const updateEventSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(800).optional(),
  eventDate: z.coerce.date().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
})
const idParamsSchema = z.object({ id: z.string().min(1) })
const createEventFeedbackSchema = z.object({
  message: z.string().trim().min(MIN_FEEDBACK_FIELD_LENGTH),
  category: z.enum(PUBLIC_FEEDBACK_CATEGORIES).default('ELOGIO'),
})

export async function developmentThursdayRoutes(app: FastifyInstance) {
  app.get('/development-thursday/events', { onRequest: [app.authenticate, app.requireFeature('quinta-desenvolvimento')] }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: parsed.error.flatten() })
    }
    const events = await listDevelopmentThursdayEvents(parsed.data, request.user.companyId)
    return reply.send({ events: events.map(toDevelopmentThursdayEventDTO) })
  })

  app.get('/development-thursday/events/:id/feedbacks', { onRequest: [app.authenticate, app.requireFeature('quinta-desenvolvimento')] }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    }
    try {
      const event = await findDevelopmentThursdayEventForFeedback(params.data.id, request.user.companyId)
      const query = request.query as { offset?: string; limit?: string }
      const limit = clampLimit(query.limit)
      const offset = Math.max(0, Number(query.offset) || 0)
      const rows = await listFeedbacksForDevelopmentThursdayEvent(
        event.id,
        { id: request.user.sub, role: request.user.role },
        { offset, limit },
      )
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      return reply.send({ feedbacks: page.map((f) => toFeedbackDTO(f, request.user.sub)), hasMore })
    } catch (err) {
      if (err instanceof DevelopmentThursdayError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })

  app.post('/development-thursday/events/:id/feedbacks', { onRequest: [app.authenticate, app.requireFeature('quinta-desenvolvimento')] }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = createEventFeedbackSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'O feedback é obrigatório e precisa ser específico.' })
    }
    try {
      const event = await findDevelopmentThursdayEventForFeedback(params.data.id, request.user.companyId)
      if (!isDevelopmentThursdayEventFinished(event)) {
        return reply.code(409).send({ message: 'Feedbacks ficam disponíveis após a apresentação.' })
      }
      const feedback = await createFeedback({
        authorId: request.user.sub,
        targetId: event.presenterId,
        developmentThursdayEventId: event.id,
        ...body.data,
      })

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
      try {
        await notifyFeedbackReceived({
          id: feedback.id,
          targetId: event.presenterId,
          authorId: request.user.sub,
          author: { name: feedback.author.name },
        }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      return reply.code(201).send({ feedback: toFeedbackDTO(feedback, request.user.sub) })
    } catch (err) {
      if (err instanceof DevelopmentThursdayError || err instanceof FeedbackError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })

  app.post('/development-thursday/events', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = createEventSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    }
    try {
      const event = await createDevelopmentThursdayEvent({
        ...parsed.data,
        presenterId: request.user.sub,
        companyId: request.user.companyId,
      })
      return reply.code(201).send({ event: toDevelopmentThursdayEventDTO(event) })
    } catch (err) {
      if (err instanceof DevelopmentThursdayError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })

  app.patch('/development-thursday/events/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = updateEventSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.' })
    }
    try {
      const event = await updateDevelopmentThursdayEvent({
        id: params.data.id,
        authorId: request.user.sub,
        companyId: request.user.companyId,
        ...body.data,
      })
      return reply.send({ event: toDevelopmentThursdayEventDTO(event) })
    } catch (err) {
      if (err instanceof DevelopmentThursdayError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })

  app.delete('/development-thursday/events/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    }
    try {
      await deleteDevelopmentThursdayEvent({ id: params.data.id, authorId: request.user.sub, companyId: request.user.companyId })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof DevelopmentThursdayError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })
}
