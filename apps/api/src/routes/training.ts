/**
 * Registro de treinamento pelo próprio colaborador.
 *
 * Sucede `/learning/external-certificates`, que era a mesma coisa sem carga
 * horária, instituição nem data de conclusão — ver
 * `docs/superpowers/specs/2026-09-12-modulo-de-treinamentos-td-design.md`.
 *
 * Sem feature de setor: registrar o próprio desenvolvimento vale para todo
 * mundo, inclusive para quem não consome o catálogo interno (`aprendizado`).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  MAX_TRAINING_REASONS,
  TRAINING_COURSE_TITLE_MAX_LENGTH,
  TRAINING_INSTITUTION_MAX_LENGTH,
  TRAINING_LEARNING_TYPE_MAX_LENGTH,
  TRAINING_MAX_HOURS,
  TRAINING_MAX_INVESTMENT_CENTS,
  TRAINING_NOTES_MAX_LENGTH,
  TRAINING_PARTICIPATION_STATUS,
  TRAINING_PRIORITIES,
  TRAINING_REASONS,
  TRAINING_SPONSORS,
  TRAINING_SPONSOR_OTHER_MAX_LENGTH,
  TRAINING_TYPES,
  isCountedTraining,
  trainingYear,
  type MyTrainingResponse,
} from '@legends/shared'
import { isFullAdmin } from '@legends/shared'
import { TrainingError } from '../lib/training-error'
import { toTrainingRecordDTO } from '../lib/serialize'
import {
  createTrainingRecord,
  deleteTrainingRecord,
  getTrainingSlaDays,
  listMyTrainingRecords,
  trainingIdentityOf,
  updateTrainingRecord,
  type TrainingActor,
} from '../services/training-service'

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.')

const recordSchema = z.object({
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
  attachmentKey: z.string().min(1).nullable().optional(),
})

/**
 * O PATCH é o MESMO para o dono e para o T&D — quem separa os poderes é o
 * serviço. Por isso `participationStatus` entra aqui, embora só o T&D possa
 * usá-lo: se o schema o descartasse, a tentativa do colaborador viraria um 200
 * silencioso que não mudou nada, em vez do 403 que explica.
 */
const updateSchema = recordSchema.partial().extend({
  participationStatus: z.enum(TRAINING_PARTICIPATION_STATUS).optional(),
})
const idParams = z.object({ id: z.string().min(1) })

export function trainingActorOf(request: FastifyRequest): TrainingActor {
  return {
    id: request.user.sub,
    role: request.user.role,
    sectorId: request.user.sectorId,
    companyId: request.user.companyId,
  }
}

/**
 * Quem administra o T&D: ADMIN pleno (inclusive acesso delegado) e o SUBADMIN do
 * setor com o bloco de Gente e Gestão ligado — o mesmo critério de
 * `requireSectorFeature('gente-gestao')`, aqui como predicado porque a rota do
 * colaborador precisa do BOOLEANO, não de um guarda que responde 403.
 */
export function managesTraining(user: FastifyRequest['user']): boolean {
  if (isFullAdmin(user)) return true
  return user.role === 'SUBADMIN' && (user.features ?? []).includes('gente-gestao')
}

export function handleTrainingError(err: unknown, reply: FastifyReply) {
  if (err instanceof TrainingError) return reply.code(err.status).send({ message: err.message })
  throw err
}

export async function trainingRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] }

  /** A identificação que vai no snapshot — a tela mostra antes de a pessoa enviar. */
  app.get('/training/identity', guard, async (request, reply) => {
    try {
      return reply.send(await trainingIdentityOf(request.user.sub, request.user.companyId))
    } catch (err) {
      return handleTrainingError(err, reply)
    }
  })

  app.get('/training/me', guard, async (request, reply) => {
    const [rows, slaDays] = await Promise.all([
      listMyTrainingRecords(request.user.sub, request.user.companyId),
      getTrainingSlaDays(request.user.companyId),
    ])
    const records = await Promise.all(rows.map((row) => toTrainingRecordDTO(row, slaDays)))

    // Resumo do ano corrente: é o número que a pessoa acompanha ("quantas horas
    // eu já fiz este ano?"), e por isso conta só o validado — igual ao painel.
    const year = new Date().getUTCFullYear()
    const doAno = records.filter(
      (record) => record.validationStatus === 'APPROVED' && trainingYear(record.completionDate) === year,
    )
    const response: MyTrainingResponse = {
      records,
      yearHours: Math.round(doAno.filter(isCountedTraining).reduce((sum, r) => sum + r.hours, 0) * 100) / 100,
      yearTrainings: doAno.length,
    }
    return reply.send(response)
  })

  app.post('/training/records', guard, async (request, reply) => {
    const parsed = recordSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const slaDays = await getTrainingSlaDays(request.user.companyId)
      const created = await createTrainingRecord({
        ...parsed.data,
        userId: request.user.sub,
        companyId: request.user.companyId,
        actorId: request.user.sub,
        source: 'Autoatendimento do colaborador',
      })
      return reply.code(201).send(await toTrainingRecordDTO(created, slaDays))
    } catch (err) {
      return handleTrainingError(err, reply)
    }
  })

  app.patch('/training/records/:id', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = updateSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.' })
    }
    try {
      const slaDays = await getTrainingSlaDays(request.user.companyId)
      const updated = await updateTrainingRecord(
        params.data.id,
        body.data,
        trainingActorOf(request),
        managesTraining(request.user),
      )
      return reply.send(await toTrainingRecordDTO(updated, slaDays))
    } catch (err) {
      return handleTrainingError(err, reply)
    }
  })

  app.delete('/training/records/:id', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      await deleteTrainingRecord(params.data.id, trainingActorOf(request), managesTraining(request.user))
      return reply.code(204).send()
    } catch (err) {
      return handleTrainingError(err, reply)
    }
  })
}
