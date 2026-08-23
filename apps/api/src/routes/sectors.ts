import type { FastifyInstance } from 'fastify'
import { scopedPrisma } from '../lib/tenant-scope'

export async function sectorRoutes(app: FastifyInstance) {
  app.get('/sectors', { onRequest: [app.authenticate] }, async (request, reply) => {
    const sectors = await scopedPrisma(request.user.companyId).sector.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    return reply.send({ sectors })
  })
}
