import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getCelebrations } from '../services/celebration-service'

const querySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês deve estar no formato AAAA-MM')
    .optional(),
})

export async function celebrationRoutes(app: FastifyInstance) {
  app.get('/celebrations', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const celebrations = await getCelebrations(request.user.sub, new Date(), parsed.data.month)
    return reply.send(celebrations)
  })
}
