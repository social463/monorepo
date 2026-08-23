import type { FastifyInstance } from 'fastify'
import { getDirectReportsChart, getOrganizationChart } from '../services/organization-service'

export async function organizationRoutes(app: FastifyInstance) {
  app.get(
    '/organization',
    { onRequest: [app.authenticate, app.requireFeature('time')] },
    async (request, reply) => {
      return reply.send(await getOrganizationChart(request.user.companyId))
    },
  )

  /**
   * Só quem responde diretamente a quem pediu. Endpoint próprio, e não um
   * `?escopo=` no de cima, porque o recorte é do requisitante: nunca dá para
   * pedir o time de outra pessoa por aqui.
   */
  app.get(
    '/organization/direct-reports',
    { onRequest: [app.authenticate, app.requireFeature('time')] },
    async (request, reply) => {
      return reply.send(await getDirectReportsChart(request.user.companyId, request.user.sub))
    },
  )
}
