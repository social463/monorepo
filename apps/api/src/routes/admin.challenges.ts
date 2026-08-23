import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  CHALLENGE_BATCH_MAX_ITEMS,
  CHALLENGE_SUBMISSION_PAGE_SIZE,
  CHALLENGE_SUBMISSION_STATUSES,
  REJECTION_REASON_MAX_LENGTH,
  REJECTION_REASON_MIN_LENGTH,
  type ChallengeSubmissionPage,
} from '@legends/shared'
import { toChallengeSubmissionDTO } from '../lib/serialize'
import { ChallengeError, type ChallengeActor } from '../services/challenge-service'
import {
  approveSubmission,
  exportSubmissionsCsv,
  listSubmissions,
  rejectSubmission,
  reviewBatch,
  type SubmissionFilters,
} from '../services/challenge-submission-service'

function actorOf(request: FastifyRequest): ChallengeActor {
  return {
    id: request.user.sub,
    role: request.user.role,
    adminAccess: request.user.adminAccess,
    sectorId: request.user.sectorId,
    companyId: request.user.companyId,
  }
}

const filtersSchema = z.object({
  status: z.enum(CHALLENGE_SUBMISSION_STATUSES).optional(),
  userId: z.string().trim().min(1).optional(),
  challengeId: z.string().trim().min(1).optional(),
  sectorId: z.string().trim().min(1).optional(),
})

const pageSchema = filtersSchema.extend({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(CHALLENGE_SUBMISSION_PAGE_SIZE),
})

const rejectSchema = z.object({
  rejectionReason: z.string().trim().min(REJECTION_REASON_MIN_LENGTH).max(REJECTION_REASON_MAX_LENGTH),
})

const batchSchema = z
  .object({
    ids: z.array(z.string().trim().min(1)).min(1).max(CHALLENGE_BATCH_MAX_ITEMS),
    decision: z.enum(['APPROVE', 'REJECT']),
    rejectionReason: z.string().trim().min(REJECTION_REASON_MIN_LENGTH).max(REJECTION_REASON_MAX_LENGTH).optional(),
  })
  // Rejeitar em lote sem motivo gravaria motivo vazio em todo mundo.
  .refine((v) => v.decision === 'APPROVE' || Boolean(v.rejectionReason), {
    message: 'Informe o motivo da rejeição.',
    path: ['rejectionReason'],
  })

export async function adminChallengeSubmissionRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/admin/challenge-submissions', guard, async (request, reply) => {
    const parsed = pageSchema.safeParse(request.query ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { cursor, limit, ...filters } = parsed.data
    const result = await listSubmissions(actorOf(request), filters as SubmissionFilters, { cursor, limit })
    const page: ChallengeSubmissionPage = {
      items: await Promise.all(result.items.map(toChallengeSubmissionDTO)),
      nextCursor: result.nextCursor,
    }
    return reply.send(page)
  })

  app.get('/admin/challenge-submissions/export.csv', guard, async (request, reply) => {
    const parsed = filtersSchema.safeParse(request.query ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const csv = await exportSubmissionsCsv(actorOf(request), parsed.data)
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="resultados-desafios.csv"')
      .send(csv)
  })

  app.post('/admin/challenge-submissions/:id/approve', guard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const submission = await approveSubmission(actorOf(request), id)
      return reply.send(await toChallengeSubmissionDTO(submission))
    } catch (err) {
      if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/admin/challenge-submissions/:id/reject', guard, async (request, reply) => {
    const parsed = rejectSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    try {
      const submission = await rejectSubmission(actorOf(request), id, parsed.data.rejectionReason)
      return reply.send(await toChallengeSubmissionDTO(submission))
    } catch (err) {
      if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/admin/challenge-submissions/batch', guard, async (request, reply) => {
    const parsed = batchSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { ids, decision, rejectionReason } = parsed.data
    const result = await reviewBatch(actorOf(request), ids, decision, rejectionReason ?? null)
    return reply.send(result)
  })
}
