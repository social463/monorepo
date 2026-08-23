import type { FastifyInstance } from 'fastify'
import { corporateMuralHub, type CorporateMuralConnection } from '../lib/corporate-mural-hub'

export async function corporateMuralWsRoutes(app: FastifyInstance) {
  app.get(
    '/corporate-posts/ws',
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
      const conn: CorporateMuralConnection = { socket: connection.socket }
      corporateMuralHub.subscribe(conn)
      connection.socket.on('close', () => {
        corporateMuralHub.unsubscribe(conn)
      })
    },
  )
}
