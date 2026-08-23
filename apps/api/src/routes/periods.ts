import type { FastifyInstance } from 'fastify'
import { getCurrentOpenPeriod, getNextScheduledPeriod } from '../services/voting-service'
import { toPeriodDTO } from '../lib/serialize'

export async function periodRoutes(app: FastifyInstance) {
  app.get('/periods/current', { onRequest: [app.authenticate] }, async (request, reply) => {
    const period = await getCurrentOpenPeriod(request.user.sectorId, request.user.companyId)
    return reply.send({ period: period ? toPeriodDTO(period) : null })
  })

  app.get('/periods/next', { onRequest: [app.authenticate] }, async (request, reply) => {
    const period = await getNextScheduledPeriod(request.user.sectorId, request.user.companyId)
    return reply.send({ period: period ? toPeriodDTO(period) : null })
  })
}
