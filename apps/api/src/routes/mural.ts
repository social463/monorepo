import type { FastifyInstance } from 'fastify'
import { getMuralItems } from '../services/mural-service'

export async function muralRoutes(app: FastifyInstance) {
  app.get('/mural', { onRequest: [app.authenticate] }, async (request, reply) => {
    const items = await getMuralItems(request.user.sub, request.user.sectorId)
    return reply.send({ items })
  })
}
