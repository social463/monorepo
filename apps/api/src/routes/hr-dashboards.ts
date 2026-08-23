import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  HR_DASHBOARD_DESCRIPTION_MAX_LENGTH,
  HR_DASHBOARD_MAX_HEIGHT,
  HR_DASHBOARD_MIN_HEIGHT,
  HR_DASHBOARD_TITLE_MAX_LENGTH,
  HR_DASHBOARD_URL_MAX_LENGTH,
} from '@legends/shared'
import { HrDashboardError } from '../lib/hr-dashboard-error'
import { resolveHrDashboardAllowedHosts } from '../lib/config'
import { toHrDashboardDTO } from '../lib/serialize'
import {
  createHrDashboard,
  deleteHrDashboard,
  listHrDashboards,
  updateHrDashboard,
  type HrDashboardActor,
} from '../services/hr-dashboard-service'

const idParamsSchema = z.object({ id: z.string().min(1) })
const listQuerySchema = z.object({ scope: z.string().min(1).optional() })

const baseSchema = {
  title: z.string().trim().min(1).max(HR_DASHBOARD_TITLE_MAX_LENGTH),
  description: z.string().trim().max(HR_DASHBOARD_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  embedUrl: z.string().trim().min(1).max(HR_DASHBOARD_URL_MAX_LENGTH),
  height: z.number().int().min(HR_DASHBOARD_MIN_HEIGHT).max(HR_DASHBOARD_MAX_HEIGHT).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  sectorId: z.string().min(1).nullable().optional(),
}
const createSchema = z.object(baseSchema)
const updateSchema = z.object(baseSchema).partial()

/** Erro de domínio → resposta; o resto sobe. */
function handleHrDashboardError(err: unknown, reply: FastifyReply) {
  if (err instanceof HrDashboardError) return reply.code(err.status).send({ message: err.message })
  throw err
}

function actorFrom(request: { user: { sub: string; role: string; sectorId: string; companyId: string } }): HrDashboardActor {
  return {
    id: request.user.sub,
    role: request.user.role,
    sectorId: request.user.sectorId,
    companyId: request.user.companyId,
  }
}

export async function hrDashboardRoutes(app: FastifyInstance) {
  // Painel de RH é dado de liderança e área de Gente e Gestão: mesmo a leitura
  // exige ADMIN global ou SUBADMIN do setor com a feature `gente-gestao`.
  const guard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  app.get('/admin/hr-dashboards', guard, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: query.error.issues })
    }
    const dashboards = await listHrDashboards(actorFrom(request), query.data.scope)
    return reply.send({
      dashboards: dashboards.map(toHrDashboardDTO),
      allowedHosts: resolveHrDashboardAllowedHosts(process.env),
    })
  })

  app.post('/admin/hr-dashboards', guard, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const created = await createHrDashboard(actorFrom(request), parsed.data)
      return reply.code(201).send({ dashboard: toHrDashboardDTO(created) })
    } catch (err) {
      return handleHrDashboardError(err, reply)
    }
  })

  app.patch('/admin/hr-dashboards/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const updated = await updateHrDashboard(actorFrom(request), params.data.id, parsed.data)
      return reply.send({ dashboard: toHrDashboardDTO(updated) })
    } catch (err) {
      return handleHrDashboardError(err, reply)
    }
  })

  app.delete('/admin/hr-dashboards/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      await deleteHrDashboard(actorFrom(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleHrDashboardError(err, reply)
    }
  })
}
