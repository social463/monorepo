import type { FastifyInstance } from 'fastify'
import { reviewHub, type ReviewConnection } from '../lib/review-hub'

export async function reviewWsRoutes(app: FastifyInstance) {
  app.get(
    '/reviews/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const token = (request.query as { token?: string }).token ?? ''
        try {
          app.jwt.verify(token)
        } catch {
          return reply.code(401).send({ message: 'Não autorizado' })
        }
      },
    },
    (connection) => {
      const conn: ReviewConnection = { socket: connection.socket }
      reviewHub.subscribe(conn)
      connection.socket.on('close', () => {
        reviewHub.unsubscribe(conn)
      })
    },
  )
}
