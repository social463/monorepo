/**
 * Central de Treinamentos e painel de T&D (Administração › Gente e Gestão).
 *
 * Guarda: `requireSectorFeature('gente-gestao')` — `requireAdmin` liberaria todo
 * SUBADMIN, de qualquer setor, e o bloco é de um time específico.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  MAX_TRAINING_REASONS,
  TRAINING_COURSE_TITLE_MAX_LENGTH,
  TRAINING_INSTITUTION_MAX_LENGTH,
  TRAINING_LEARNING_TYPE_MAX_LENGTH,
  TRAINING_MAX_HOURS,
  TRAINING_MAX_INVESTMENT_CENTS,
  TRAINING_MAX_SLA_DAYS,
  TRAINING_MIN_SLA_DAYS,
  TRAINING_NOTES_MAX_LENGTH,
  TRAINING_PRIORITIES,
  TRAINING_REASONS,
  TRAINING_REJECTION_REASON_MAX_LENGTH,
  TRAINING_SPONSORS,
  TRAINING_SPONSOR_OTHER_MAX_LENGTH,
  TRAINING_TYPES,
  type TrainingRecordsPageDTO,
} from '@legends/shared'
import { toTrainingRecordDTO } from '../lib/serialize'
import {
  createTrainingRecord,
  exportTrainingCsv,
  getTrainingSlaDays,
  listTrainingFilterOptions,
  listTrainingRecords,
  reviewTrainingRecord,
  setTrainingSlaDays,
  trainingOverview,
} from '../services/training-service'
import { handleTrainingError, trainingActorOf } from './training'

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * Filtros da URL. Todos texto e todos opcionais — `.optional()` em cada um, em
 * vez de um `Record<string, string>`, para que filtro escrito errado vire 400
 * em vez de recorte silenciosamente ignorado.
 */
const filtersSchema = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  year: z.string().regex(/^\d{4}$/).optional(),
  semester: z.string().optional(),
  quarter: z.string().optional(),
  sector: z.string().optional(),
  squad: z.string().optional(),
  leader: z.string().optional(),
  positionCategory: z.string().optional(),
  employmentType: z.string().optional(),
  learningType: z.string().optional(),
  institution: z.string().optional(),
  sponsor: z.enum(TRAINING_SPONSORS).optional(),
  reason: z.enum(TRAINING_REASONS).optional(),
  participationStatus: z.string().optional(),
  validationStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  sla: z.string().optional(),
  priority: z.string().optional(),
  source: z.string().optional(),
  eventId: z.string().optional(),
  search: z.string().optional(),
})

const listSchema = filtersSchema.extend({ page: z.coerce.number().int().min(1).optional() })

const adminRecordSchema = z.object({
  userId: z.string().min(1),
  courseTitle: z.string().trim().min(1).max(TRAINING_COURSE_TITLE_MAX_LENGTH),
  learningType: z.string().trim().min(1).max(TRAINING_LEARNING_TYPE_MAX_LENGTH),
  modality: z.string().trim().max(40).nullable().optional(),
  trainingType: z.enum(TRAINING_TYPES).nullable().optional(),
  hours: z.number().min(0).max(TRAINING_MAX_HOURS),
  institution: z.string().trim().max(TRAINING_INSTITUTION_MAX_LENGTH).nullable().optional(),
  sponsor: z.enum(TRAINING_SPONSORS),
  sponsorOther: z.string().trim().max(TRAINING_SPONSOR_OTHER_MAX_LENGTH).nullable().optional(),
  investmentCents: z.number().int().min(0).max(TRAINING_MAX_INVESTMENT_CENTS).nullable().optional(),
  reasons: z.array(z.enum(TRAINING_REASONS)).min(1).max(MAX_TRAINING_REASONS),
  priority: z.enum(TRAINING_PRIORITIES).optional(),
  completionDate: ymd,
  requestDate: ymd.nullable().optional(),
  notes: z.string().trim().max(TRAINING_NOTES_MAX_LENGTH).nullable().optional(),
})

const reviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  rejectionReason: z.string().trim().max(TRAINING_REJECTION_REASON_MAX_LENGTH).nullable().optional(),
})

const settingsSchema = z.object({
  slaDays: z.number().int().min(TRAINING_MIN_SLA_DAYS).max(TRAINING_MAX_SLA_DAYS),
})

const idParams = z.object({ id: z.string().min(1) })

export async function trainingAdminRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  app.get('/admin/training/records', guard, async (request, reply) => {
    const parsed = listSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Filtros inválidos.', issues: parsed.error.issues })
    }
    const { page = 1, ...filters } = parsed.data
    const [result, slaDays] = await Promise.all([
      listTrainingRecords(request.user.companyId, filters, page),
      getTrainingSlaDays(request.user.companyId),
    ])
    const response: TrainingRecordsPageDTO = {
      records: await Promise.all(result.rows.map((row) => toTrainingRecordDTO(row, slaDays))),
      page: result.page,
      pageCount: result.pageCount,
      total: result.total,
      pending: result.pending,
    }
    return reply.send(response)
  })

  app.get('/admin/training/overview', guard, async (request, reply) => {
    const parsed = filtersSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Filtros inválidos.', issues: parsed.error.issues })
    }
    return reply.send(await trainingOverview(request.user.companyId, parsed.data))
  })

  app.get('/admin/training/filters', guard, async (request, reply) => {
    return reply.send(await listTrainingFilterOptions(request.user.companyId))
  })

  /** Cadastro pelo próprio T&D, em nome de outra pessoa — nasce já validado. */
  app.post('/admin/training/records', guard, async (request, reply) => {
    const parsed = adminRecordSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const slaDays = await getTrainingSlaDays(request.user.companyId)
      const created = await createTrainingRecord({
        ...parsed.data,
        companyId: request.user.companyId,
        actorId: request.user.sub,
        source: 'Cadastro pelo T&D',
      })
      return reply.code(201).send(await toTrainingRecordDTO(created, slaDays))
    } catch (err) {
      return handleTrainingError(err, reply)
    }
  })

  app.post('/admin/training/records/:id/review', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = reviewSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const slaDays = await getTrainingSlaDays(request.user.companyId)
      const updated = await reviewTrainingRecord(params.data.id, body.data, trainingActorOf(request))
      return reply.send(await toTrainingRecordDTO(updated, slaDays))
    } catch (err) {
      return handleTrainingError(err, reply)
    }
  })

  app.get('/admin/training/records.csv', guard, async (request, reply) => {
    const parsed = filtersSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Filtros inválidos.', issues: parsed.error.issues })
    }
    const csv = await exportTrainingCsv(request.user.companyId, parsed.data)
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="treinamentos.csv"')
      .send(csv)
  })

  app.get('/admin/training/settings', guard, async (request, reply) => {
    return reply.send({ slaDays: await getTrainingSlaDays(request.user.companyId) })
  })

  app.put('/admin/training/settings', guard, async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      return reply.send({ slaDays: await setTrainingSlaDays(trainingActorOf(request), parsed.data.slaDays) })
    } catch (err) {
      return handleTrainingError(err, reply)
    }
  })
}
