/**
 * Metas e OKRs. Rotas finas: validam, chamam `okr-service` e devolvem DTO.
 *
 * Sem feature de setor — meta é da empresa inteira, como Manifesto e Benefícios.
 * Terceirizado fica de fora: número de receita e churn não é para conta externa.
 * Quem pode o quê em cada item vem no mapa `permissions` de cada DTO.
 *
 * Spec: `docs/superpowers/specs/2026-09-17-modulo-metas-okr-design.md`.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  OKR_AGGREGATIONS,
  OKR_CODE_MAX_LENGTH,
  OKR_COMMENT_MAX_LENGTH,
  OKR_CONFIDENCE_LEVELS,
  OKR_CYCLE_STATUSES,
  OKR_DEPENDENCY_CALC_TYPES,
  OKR_DEPENDENCY_STRATEGIES,
  OKR_DESCRIPTION_MAX_LENGTH,
  OKR_DIRECTIONS,
  OKR_METRIC_TYPES,
  OKR_NAME_MAX_LENGTH,
  OKR_ROLES,
  OKR_SCOPES,
  OKR_SOURCE_REF_MAX_LENGTH,
  OKR_STATUSES,
  OKR_UNIT_MAX_LENGTH,
  OKR_VISIBILITIES,
} from '@legends/shared'
import {
  OkrError,
  createCheckIn,
  createCycle,
  createKeyResult,
  createObjective,
  cycleSummary,
  deleteCheckIn,
  deleteObjective,
  getCycle,
  getObjective,
  listCheckIns,
  listCycleObjectives,
  listCycles,
  personResults,
  updateCheckIn,
  updateCycle,
  updateKeyResult,
  updateObjective,
  type OkrViewer,
} from '../services/okr-service'

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.')
const finite = z.number().finite()
const idParams = z.object({ id: z.string().min(1) })

const assignmentsSchema = z.array(z.object({ personId: z.string().min(1), role: z.enum(OKR_ROLES) })).max(100)

const objectiveSchema = z.object({
  cycleId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  code: z.string().trim().max(OKR_CODE_MAX_LENGTH).nullable().optional(),
  name: z.string().trim().min(1).max(OKR_NAME_MAX_LENGTH),
  description: z.string().trim().max(OKR_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  scope: z.enum(OKR_SCOPES),
  status: z.enum(OKR_STATUSES).optional(),
  visibility: z.enum(OKR_VISIBILITIES).optional(),
  finishDate: ymd.nullable().optional(),
  weight: finite.min(0).max(1).nullable().optional(),
  aggregation: z.enum(OKR_AGGREGATIONS).optional(),
  manualProgress: finite.min(0).nullable().optional(),
  confidenceLevel: z.enum(OKR_CONFIDENCE_LEVELS).nullable().optional(),
  assignments: assignmentsSchema.optional(),
})
const objectiveUpdateSchema = objectiveSchema.omit({ cycleId: true }).partial()

const keyResultSchema = z.object({
  code: z.string().trim().max(OKR_CODE_MAX_LENGTH).nullable().optional(),
  name: z.string().trim().min(1).max(OKR_NAME_MAX_LENGTH),
  description: z.string().trim().max(OKR_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  metricType: z.enum(OKR_METRIC_TYPES),
  unit: z.string().trim().max(OKR_UNIT_MAX_LENGTH).nullable().optional(),
  baseline: finite.optional(),
  target: finite,
  direction: z.enum(OKR_DIRECTIONS).optional(),
  weight: finite.min(0).max(1).nullable().optional(),
  status: z.enum(OKR_STATUSES).optional(),
  finishDate: ymd.nullable().optional(),
  assignments: assignmentsSchema.optional(),
  dependencies: z
    .object({
      strategy: z.enum(OKR_DEPENDENCY_STRATEGIES),
      calcType: z.enum(OKR_DEPENDENCY_CALC_TYPES),
      items: z
        .array(z.object({ dependsOnKrId: z.string().min(1), weight: finite.min(0).max(1).nullable().optional() }))
        .max(50),
    })
    .nullable()
    .optional(),
})
const keyResultUpdateSchema = keyResultSchema.partial()

const checkInSchema = z.object({
  value: finite.nullable().optional(),
  numerator: finite.min(0).nullable().optional(),
  denominator: finite.min(0).nullable().optional(),
  comment: z.string().max(OKR_COMMENT_MAX_LENGTH).nullable().optional(),
  effectiveAt: ymd.optional(),
  source: z.enum(['MANUAL', 'AUTOMATION']).optional(),
  sourceRef: z.string().trim().max(OKR_SOURCE_REF_MAX_LENGTH).nullable().optional(),
  confidenceLevel: z.enum(OKR_CONFIDENCE_LEVELS).nullable().optional(),
})
const checkInUpdateSchema = z.object({ comment: z.string().max(OKR_COMMENT_MAX_LENGTH).nullable() })

const progressRangeSchema = z.object({
  min: finite.nullable(),
  max: finite.nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida.'),
})
const decimalsSchema = z.object({
  percentage: z.number().int().min(0).max(6),
  numeric: z.number().int().min(0).max(6),
  currency: z.number().int().min(0).max(6),
})
const cycleSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(OKR_CYCLE_STATUSES).optional(),
  startDate: ymd,
  finishDate: ymd,
  forceCommentOnCheckIn: z.boolean().optional(),
  updateWindowStart: ymd.nullable().optional(),
  updateWindowFinish: ymd.nullable().optional(),
  progressRanges: z.array(progressRangeSchema).max(12).optional(),
  decimals: decimalsSchema.optional(),
})
const cycleUpdateSchema = cycleSchema.partial()

const cyclesQuery = z.object({ status: z.enum(OKR_CYCLE_STATUSES).optional() })
const objectivesQuery = z.object({
  scope: z.enum(OKR_SCOPES).optional(),
  person_id: z.string().min(1).optional(),
  parent_id: z.string().min(1).optional(),
})
const resultsQuery = z.object({ cycle_id: z.string().min(1).optional() })

function viewerOf(request: FastifyRequest): OkrViewer {
  return {
    userId: request.user.sub,
    companyId: request.user.companyId,
    role: request.user.role,
    adminAccess: request.user.adminAccess,
    features: request.user.features,
  }
}

function handle(reply: FastifyReply, err: unknown) {
  if (err instanceof OkrError) return reply.code(err.status).send({ message: err.message })
  throw err
}

const invalid = (reply: FastifyReply, issues?: unknown) => reply.code(400).send({ message: 'Dados inválidos.', issues })

export async function okrRoutes(app: FastifyInstance) {
  const gate = {
    onRequest: [
      app.authenticate,
      async (request: FastifyRequest, reply: FastifyReply) => {
        if (request.user.role === 'THIRD_PARTY') return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
      },
      // Liberado por setor. A recusa ao terceirizado vem antes e não depende
      // da allowlist dele: metas são dado interno da empresa.
      app.requireFeature('metas'),
    ],
  }

  app.get('/okr/cycles', gate, async (request, reply) => {
    const query = cyclesQuery.safeParse(request.query)
    if (!query.success) return invalid(reply, query.error.flatten())
    return reply.send({ cycles: await listCycles(viewerOf(request), query.data.status) })
  })

  app.post('/okr/cycles', gate, async (request, reply) => {
    const body = cycleSchema.safeParse(request.body)
    if (!body.success) return invalid(reply, body.error.issues)
    try {
      return reply.code(201).send({ cycle: await createCycle(viewerOf(request), body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/okr/cycles/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = cycleUpdateSchema.safeParse(request.body)
    if (!params.success || !body.success) return invalid(reply, body.success ? undefined : body.error.issues)
    try {
      return reply.send({ cycle: await updateCycle(viewerOf(request), params.data.id, body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/okr/cycles/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return invalid(reply)
    try {
      return reply.send({ cycle: await getCycle(viewerOf(request), params.data.id) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/okr/cycles/:id/objectives', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const query = objectivesQuery.safeParse(request.query)
    if (!params.success || !query.success) return invalid(reply)
    try {
      const objectives = await listCycleObjectives(viewerOf(request), params.data.id, {
        scope: query.data.scope,
        personId: query.data.person_id,
        parentId: query.data.parent_id,
      })
      return reply.send({ objectives })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/okr/cycles/:id/summary', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return invalid(reply)
    try {
      return reply.send({ summary: await cycleSummary(viewerOf(request), params.data.id) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/okr/objectives', gate, async (request, reply) => {
    const body = objectiveSchema.safeParse(request.body)
    if (!body.success) return invalid(reply, body.error.flatten())
    try {
      return reply.code(201).send({ objective: await createObjective(viewerOf(request), body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/okr/objectives/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return invalid(reply)
    try {
      return reply.send({ objective: await getObjective(viewerOf(request), params.data.id) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/okr/objectives/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = objectiveUpdateSchema.safeParse(request.body)
    if (!params.success || !body.success) return invalid(reply, body.success ? undefined : body.error.flatten())
    try {
      return reply.send({ objective: await updateObjective(viewerOf(request), params.data.id, body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/okr/objectives/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return invalid(reply)
    try {
      await deleteObjective(viewerOf(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/okr/objectives/:id/key-results', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = keyResultSchema.safeParse(request.body)
    if (!params.success || !body.success) return invalid(reply, body.success ? undefined : body.error.flatten())
    try {
      return reply.code(201).send({ objective: await createKeyResult(viewerOf(request), params.data.id, body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/okr/key-results/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = keyResultUpdateSchema.safeParse(request.body)
    if (!params.success || !body.success) return invalid(reply, body.success ? undefined : body.error.flatten())
    try {
      return reply.send({ objective: await updateKeyResult(viewerOf(request), params.data.id, body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/okr/key-results/:id/check-ins', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return invalid(reply)
    try {
      return reply.send({ checkIns: await listCheckIns(viewerOf(request), params.data.id) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/okr/key-results/:id/check-ins', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = checkInSchema.safeParse(request.body)
    if (!params.success || !body.success) return invalid(reply, body.success ? undefined : body.error.flatten())
    try {
      return reply.code(201).send({ checkIn: await createCheckIn(viewerOf(request), params.data.id, body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/okr/check-ins/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = checkInUpdateSchema.safeParse(request.body)
    if (!params.success || !body.success) return invalid(reply, body.success ? undefined : body.error.flatten())
    try {
      return reply.send({ checkIn: await updateCheckIn(viewerOf(request), params.data.id, body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/okr/check-ins/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return invalid(reply)
    try {
      await deleteCheckIn(viewerOf(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/okr/people/:id/results', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const query = resultsQuery.safeParse(request.query)
    if (!params.success || !query.success) return invalid(reply)
    try {
      return reply.send({ results: await personResults(viewerOf(request), params.data.id, query.data.cycle_id) })
    } catch (err) {
      return handle(reply, err)
    }
  })
}
