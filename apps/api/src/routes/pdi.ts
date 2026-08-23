import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  MAX_PDI_CHECKLIST_ITEMS,
  MAX_PDI_EVIDENCES_PER_ACTION,
  MAX_PDI_PRACTICAL_APPLICATION_LENGTH,
  MAX_PDI_REFLECTION_LENGTH,
  PDI_ACTION_DESCRIPTION_MAX_LENGTH,
  PDI_ACTION_NOTES_MAX_LENGTH,
  PDI_ACTION_PRIORITIES,
  PDI_ACTION_TYPES,
  PDI_COMPETENCY_MAX_LENGTH,
  PDI_EVIDENCE_KINDS,
  PDI_PLAN_STATUSES,
  PDI_PLAN_TITLE_MAX_LENGTH,
  PDI_REVIEW_COMMENT_MAX_LENGTH,
  PDI_EVIDENCE_CONTENT_TYPES,
  PDI_EVIDENCE_EXTENSIONS,
  PDI_EVIDENCE_MAX_BYTES,
  PDI_REVIEW_DECISIONS,
  PDI_SHOWCASE_VISIBILITIES,
  isPdiEvidenceContentType,
  type PdiEvidenceUploadConfig,
} from '@legends/shared'
import { buildPdiEvidenceKey, presignImageUpload, s3Config } from '../lib/s3-client'
import {
  PdiError,
  completeAction,
  createAction,
  createPlan,
  deleteAction,
  deletePlan,
  getPlan,
  getShowcase,
  listActionHistory,
  listEligibleLeaders,
  listMyPlans,
  listPendingReviews,
  myShowcaseVisibility,
  pdiDashboard,
  reviewAction,
  updateAction,
  updatePlan,
  updateShowcaseVisibility,
} from '../services/pdi-service'
import { getDevelopmentSettings } from '../services/development-settings-service'

const idParamsSchema = z.object({ id: z.string().min(1) })

const checklistSchema = z
  .array(z.object({ id: z.string().min(1), text: z.string().trim().min(1).max(200), done: z.boolean().default(false) }))
  .max(MAX_PDI_CHECKLIST_ITEMS)

const createPlanSchema = z.object({
  title: z.string().trim().min(1).max(PDI_PLAN_TITLE_MAX_LENGTH),
  leaderId: z.string().min(1).nullable().optional(),
  cyclePeriod: z.string().trim().max(20).nullable().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  status: z.enum(PDI_PLAN_STATUSES).optional(),
})
const updatePlanSchema = createPlanSchema.partial()

const createActionSchema = z.object({
  description: z.string().trim().min(1).max(PDI_ACTION_DESCRIPTION_MAX_LENGTH),
  type: z.enum(PDI_ACTION_TYPES),
  priority: z.enum(PDI_ACTION_PRIORITIES),
  dueDate: z.string().nullable().optional(),
  competency: z.string().trim().max(PDI_COMPETENCY_MAX_LENGTH).nullable().optional(),
  notes: z.string().trim().max(PDI_ACTION_NOTES_MAX_LENGTH).nullable().optional(),
  checklist: checklistSchema.optional(),
})

const updateActionSchema = createActionSchema.partial().extend({
  progressPct: z.number().int().min(0).max(100).optional(),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS']).optional(),
})

const completeActionSchema = z.object({
  practicalApplication: z.string().trim().min(1).max(MAX_PDI_PRACTICAL_APPLICATION_LENGTH),
  reflection: z.record(z.string().trim().max(MAX_PDI_REFLECTION_LENGTH)),
  evidences: z
    .array(
      z.object({
        kind: z.enum(PDI_EVIDENCE_KINDS),
        storageKey: z.string().min(1).nullable().optional(),
        fileName: z.string().max(255).nullable().optional(),
        mimeType: z.string().max(120).nullable().optional(),
        externalUrl: z.string().url().nullable().optional(),
      }),
    )
    .max(MAX_PDI_EVIDENCES_PER_ACTION),
})

const reviewSchema = z.object({
  decision: z.enum(PDI_REVIEW_DECISIONS),
  comment: z.string().trim().max(PDI_REVIEW_COMMENT_MAX_LENGTH).nullable().optional(),
})

const visibilitySchema = z.object({ visibility: z.enum(PDI_SHOWCASE_VISIBILITIES) })

const presignSchema = z.object({ contentType: z.string(), size: z.number().int().positive() })

export async function pdiRoutes(app: FastifyInstance) {
  const gate = { onRequest: [app.authenticate, app.requireFeature('pdi')] }

  function viewerOf(request: { user: { sub: string; companyId: string } }) {
    return { userId: request.user.sub, companyId: request.user.companyId }
  }

  function handle(reply: { code: (n: number) => { send: (body: unknown) => unknown } }, err: unknown): unknown {
    if (err instanceof PdiError) return reply.code(err.status).send({ message: err.message })
    throw err
  }

  app.get('/pdi/plans', gate, async (request, reply) => {
    const viewer = viewerOf(request)
    const [plans, settings, visibility] = await Promise.all([
      listMyPlans(viewer),
      getDevelopmentSettings(viewer.companyId),
      myShowcaseVisibility(viewer),
    ])
    return reply.send({
      plans,
      settings: { leaderApprovalRequired: settings.leaderApprovalRequired },
      visibility,
    })
  })

  /** Líderes elegíveis: mesmo setor, papel acima na hierarquia. */
  app.get('/pdi/leaders', gate, async (request, reply) => {
    try {
      return reply.send({ leaders: await listEligibleLeaders(viewerOf(request)) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/pdi/plans/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      return reply.send({ plan: await getPlan(viewerOf(request), params.data.id) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/pdi/plans', gate, async (request, reply) => {
    const body = createPlanSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: body.error.flatten() })
    try {
      return reply.code(201).send({ plan: await createPlan(viewerOf(request), body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/pdi/plans/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = updatePlanSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      return reply.send({ plan: await updatePlan(viewerOf(request), params.data.id, body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/pdi/plans/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      await deletePlan(viewerOf(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/pdi/plans/:id/actions', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = createActionSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      return reply.code(201).send({ action: await createAction(viewerOf(request), params.data.id, body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/pdi/actions/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = updateActionSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      return reply.send({ action: await updateAction(viewerOf(request), params.data.id, body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/pdi/actions/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      await deleteAction(viewerOf(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/pdi/actions/:id/complete', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = completeActionSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      return reply.send(await completeAction(viewerOf(request), params.data.id, body.data))
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/pdi/actions/:id/history', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      return reply.send({ entries: await listActionHistory(viewerOf(request), params.data.id) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/pdi/reviews/pending', gate, async (request, reply) => {
    return reply.send({ items: await listPendingReviews(viewerOf(request)) })
  })

  app.post('/pdi/actions/:id/review', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = reviewSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      return reply.send({ action: await reviewAction(viewerOf(request), params.data.id, body.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/pdi/dashboard', gate, async (request, reply) => {
    return reply.send(await pdiDashboard(viewerOf(request)))
  })

  app.get('/pdi/showcase/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      return reply.send({ showcase: await getShowcase(viewerOf(request), params.data.id) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/pdi/evidences/config', gate, async (_request, reply) => {
    const config: PdiEvidenceUploadConfig = {
      enabled: s3Config() !== null,
      maxBytes: PDI_EVIDENCE_MAX_BYTES,
      allowedContentTypes: [...PDI_EVIDENCE_CONTENT_TYPES],
    }
    return reply.send(config)
  })

  /**
   * Presign do arquivo de evidência. A resposta devolve a `key` (não uma URL
   * pública): evidência de PDI só é lida por URL assinada, depois que o service
   * confere quem pode ver a ação.
   */
  app.post('/pdi/evidences/presign', gate, async (request, reply) => {
    if (!s3Config()) return reply.code(503).send({ message: 'Upload de evidências desabilitado.' })
    const body = presignSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ message: 'Requisição inválida.', issues: body.error.flatten() })
    if (!isPdiEvidenceContentType(body.data.contentType)) {
      return reply.code(400).send({ message: 'Formato não suportado. Use JPEG, PNG, WebP ou PDF.' })
    }
    if (body.data.size > PDI_EVIDENCE_MAX_BYTES) {
      return reply.code(400).send({ message: 'Arquivo muito grande (máx. 20MB).' })
    }
    const key = buildPdiEvidenceKey(request.user.companyId, PDI_EVIDENCE_EXTENSIONS[body.data.contentType])
    const uploadUrl = await presignImageUpload({ key, contentType: body.data.contentType })
    return reply.send({ uploadUrl, key })
  })

  app.put('/pdi/showcase/visibility', gate, async (request, reply) => {
    const body = visibilitySchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    return reply.send({ visibility: await updateShowcaseVisibility(viewerOf(request), body.data.visibility) })
  })
}
