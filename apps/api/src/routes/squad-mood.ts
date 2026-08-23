import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { MoodHistoryPageDTO } from '@legends/shared'
import {
  getTeamMoodGroups,
  getMemberMoodHistory,
  MoodAccessError,
} from '../services/squad-mood-service'
import {
  getMoodOverview,
  MoodOverviewError,
  MOOD_OVERVIEW_MAX_DAYS,
  MOOD_OVERVIEW_MIN_DAYS,
} from '../services/mood-analytics-service'

const historyQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

const overviewQuerySchema = z.object({
  days: z.coerce.number().int().min(MOOD_OVERVIEW_MIN_DAYS).max(MOOD_OVERVIEW_MAX_DAYS).optional(),
  sectorId: z.string().min(1).optional(),
})

export async function squadMoodRoutes(app: FastifyInstance) {
  app.get('/me/led-squads/moods', { onRequest: [app.authenticate] }, async (request, reply) => {
    const squads = await getTeamMoodGroups(request.user.sub)
    return reply.send({ squads })
  })

  app.get('/users/:userId/mood-history', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const parsed = historyQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      const page: MoodHistoryPageDTO = await getMemberMoodHistory(
        request.user.sub,
        userId,
        parsed.data.cursor ?? null,
        parsed.data.limit ?? 10,
      )
      return reply.send(page)
    } catch (err) {
      if (err instanceof MoodAccessError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // Painel agregado de clima (Gente e Gestão). Anônimo por construção: o DTO
  // não carrega `userId` em campo nenhum — ver mood-analytics-service.
  // Restrito ao ADMIN global e ao SUBADMIN do setor com `gente-gestao`; o
  // acompanhamento do próprio squad pelo líder fica em `/me/led-squads/moods`.
  app.get(
    '/admin/mood/overview',
    { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] },
    async (request, reply) => {
      const parsed = overviewQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
      }
      try {
        const overview = await getMoodOverview({
          companyId: request.user.companyId,
          viewerRole: request.user.role,
          viewerSectorId: request.user.sectorId,
          days: parsed.data.days,
          sectorId: parsed.data.sectorId ?? null,
        })
        return reply.send({ overview })
      } catch (err) {
        if (err instanceof MoodOverviewError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )
}
