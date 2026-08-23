import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { gifsEnabled, searchGifs, GifError } from '../lib/giphy-client'

const searchQuery = z.object({ q: z.string().optional(), pos: z.string().optional() })

export async function gifRoutes(app: FastifyInstance) {
  app.get('/gifs/config', async (_request, reply) => {
    return reply.send({ enabled: gifsEnabled() })
  })

  app.get('/gifs/search', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = searchQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ message: 'Busca inválida.', issues: parsed.error.flatten() })
    try {
      const result = await searchGifs({ query: parsed.data.q ?? '', pos: parsed.data.pos })
      return reply.send(result)
    } catch (err) {
      if (err instanceof GifError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
