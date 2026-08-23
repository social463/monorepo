import type { FastifyInstance } from 'fastify'
import { getBadgeCatalog, listBadgesForUser } from '../services/badge-service'
import { findUserInCompany } from '../lib/tenant-scope'
import { toAwardedBadgeDTO, toBadgeCatalogEntryDTO } from '../lib/serialize'

export async function badgeRoutes(app: FastifyInstance) {
  app.get('/badges', { onRequest: [app.authenticate, app.requireFeature('selos')] }, async (request, reply) => {
    const catalog = await getBadgeCatalog(request.user.sub)
    return reply.send({ badges: catalog.map(toBadgeCatalogEntryDTO) })
  })

  app.get('/users/:id/badges', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const target = await findUserInCompany(request.user.companyId, id)
    if (!target) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    const awarded = await listBadgesForUser(id)
    return reply.send({ badges: awarded.map(toAwardedBadgeDTO) })
  })
}
