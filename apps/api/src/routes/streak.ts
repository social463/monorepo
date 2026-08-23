import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getStreakSummary, getStreakCalendar } from '../services/streak-service'
import { todayInSaoPaulo, monthRefOf } from '../lib/sao-paulo-date'

const calendarQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
})

export async function streakRoutes(app: FastifyInstance) {
  app.get('/me/streak', { onRequest: [app.authenticate] }, async (request, reply) => {
    const summary = await getStreakSummary(request.user.sub, request.user.companyId)
    return reply.send(summary)
  })

  app.get('/me/streak/calendar', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = calendarQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const monthRef = parsed.data.month ?? monthRefOf(todayInSaoPaulo().ymd)
    const calendar = await getStreakCalendar(request.user.sub, request.user.companyId, monthRef)
    return reply.send(calendar)
  })
}
