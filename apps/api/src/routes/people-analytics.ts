import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ACCESS_LOG_PATH_MAX_LENGTH, PEOPLE_ANALYTICS_RANGES } from '@legends/shared'
import { getEngagementOverview, getPeopleOverview, recordAccess } from '../services/people-analytics-service'
import { touchPresence } from '../services/presence-service'

const accessLogSchema = z.object({
  path: z.string().min(1).max(ACCESS_LOG_PATH_MAX_LENGTH),
})

const analyticsQuerySchema = z.object({
  range: z.enum(PEOPLE_ANALYTICS_RANGES).default('30d'),
  sectorId: z.string().min(1).optional(),
})

export async function peopleAnalyticsRoutes(app: FastifyInstance) {
  // Área de Gente e Gestão: ADMIN global, ou SUBADMIN do setor com a feature
  // `gente-gestao` ligada. Subadmin de outro setor não entra.
  const adminOrSubadmin = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  /**
   * Ping de navegação. Aberto a qualquer autenticado e best-effort: uma falha
   * ao gravar não pode virar erro na tela de quem está navegando, então o
   * catch responde 204 do mesmo jeito (só registra no log do servidor).
   *
   * Grava DUAS coisas de propósitos diferentes: a linha do `AccessLog` (série
   * de navegação, People Analytics) e o carimbo de presença (último sinal, que
   * acende a bolinha do ranking). Quem navegou está on-line — seria desperdício
   * exigir um heartbeat separado para descobrir isso.
   */
  app.post('/access-logs', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = accessLogSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      await Promise.all([
        recordAccess({
          userId: request.user.sub,
          companyId: request.user.companyId,
          path: parsed.data.path,
        }),
        touchPresence(request.user.sub, request.user.companyId),
      ])
    } catch (err) {
      request.log.error(err)
    }
    return reply.code(204).send()
  })

  /**
   * Heartbeat de presença: "continuo aqui".
   *
   * Separado do `/access-logs` porque NÃO gera linha de navegação — quem está
   * parado lendo o mural há vinte minutos não visitou vinte telas, e inflar o
   * People Analytics com isso estragaria o dado de tela mais vista.
   */
  app.post('/me/presence', { onRequest: [app.authenticate] }, async (request, reply) => {
    try {
      await touchPresence(request.user.sub, request.user.companyId)
    } catch (err) {
      request.log.error(err)
    }
    return reply.code(204).send()
  })

  app.get('/admin/people/overview', adminOrSubadmin, async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    return reply.send({
      overview: await getPeopleOverview({
        companyId: request.user.companyId,
        sectorId: resolveSectorId(request, parsed.data.sectorId),
        range: parsed.data.range,
      }),
    })
  })

  app.get('/admin/people/engagement', adminOrSubadmin, async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    return reply.send({
      engagement: await getEngagementOverview({
        companyId: request.user.companyId,
        sectorId: resolveSectorId(request, parsed.data.sectorId),
        range: parsed.data.range,
      }),
    })
  })
}

/**
 * O SUBADMIN enxerga só o próprio setor: o `sectorId` da query é *ignorado*
 * (não é erro — a UI dele simplesmente não oferece o filtro). O ADMIN escolhe
 * livremente; sem filtro, vê a empresa inteira.
 */
function resolveSectorId(request: { user: { role: string; sectorId: string } }, requested?: string): string | null {
  if (request.user.role === 'SUBADMIN') return request.user.sectorId
  return requested ?? null
}
