import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PEOPLE_ANALYTICS_RANGES } from '@legends/shared'
import { getLeadershipOverview } from '../services/leadership-analytics-service'

const overviewQuerySchema = z.object({
  range: z.enum(PEOPLE_ANALYTICS_RANGES).default('30d'),
})

export async function leadershipRoutes(app: FastifyInstance) {
  /**
   * Indicadores do time de quem chama. Aberta a qualquer autenticado porque o
   * recorte é o próprio time: quem não lidera ninguém recebe payload zerado —
   * não há como espiar o time alheio por aqui.
   */
  app.get('/me/team/analytics', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = overviewQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    return reply.send({
      overview: await getLeadershipOverview({
        viewerId: request.user.sub,
        companyId: request.user.companyId,
        range: parsed.data.range,
      }),
    })
  })
}
