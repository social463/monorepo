import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { listPublishedHighlights } from '../services/highlight-service'
import { toHighlightDTO } from '../lib/serialize'

const highlightsQuerySchema = z.object({ sectorId: z.string().optional() })

export async function highlightRoutes(app: FastifyInstance) {
  // Com ?sectorId=<id>, mostra outro setor (padrão: o próprio); ?sectorId=all mostra todos.
  // THIRD_PARTY nunca escolhe: o parâmetro é ignorado, sempre vê o próprio setor.
  app.get('/highlights', { onRequest: [app.authenticate, app.requireFeature('destaques')] }, async (request, reply) => {
    const parsed = highlightsQuerySchema.safeParse(request.query)
    const requestedSectorId = parsed.success ? parsed.data.sectorId : undefined
    const sectorId =
      request.user.role === 'THIRD_PARTY'
        ? request.user.sectorId
        : requestedSectorId === 'all'
          ? undefined
          : (requestedSectorId ?? request.user.sectorId)
    const entries = await listPublishedHighlights(request.user.companyId, sectorId)
    return reply.send({ highlights: entries.map(toHighlightDTO) })
  })
}
