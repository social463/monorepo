import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { RANKING_MAX_ENTRIES } from '@legends/shared'
import { getRanking, getRankingOverview, getStreakRanking } from '../services/ranking-service'

const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(RANKING_MAX_ENTRIES).optional(),
})

export async function rankingRoutes(app: FastifyInstance) {
  // Sem `requireFeature`, pelo mesmo motivo do XP: a pontuação e o nível já
  // aparecem no card de perfil de todo mundo, e o ranking é a leitura pública
  // desse mesmo número. Empresa que não distribui XP simplesmente mostra um
  // ranking zerado — não uma tela quebrada.
  const authed = { onRequest: [app.authenticate] }
  // A visão da economia de XP é da empresa inteira (regras são por empresa, não
  // por setor), então é ADMIN global — igual ao CRUD de regras em /admin/xp.
  const adminOnly = { onRequest: [app.authenticate, app.requireAdmin] }

  app.get('/ranking', authed, async (request, reply) => {
    const parsed = limitQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const ranking = await getRanking(request.user.sub, request.user.companyId, {
      limit: parsed.data.limit,
    })
    return reply.send(ranking)
  })

  app.get('/ranking/streaks', authed, async (request, reply) => {
    const parsed = limitQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const ranking = await getStreakRanking(request.user.sub, request.user.companyId, {
      limit: parsed.data.limit,
    })
    return reply.send(ranking)
  })

  app.get('/admin/ranking/overview', adminOnly, async (request, reply) => {
    const overview = await getRankingOverview(request.user.companyId)
    return reply.send({ overview })
  })
}
