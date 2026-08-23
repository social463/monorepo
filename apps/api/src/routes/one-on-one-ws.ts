import type { FastifyInstance } from 'fastify'
import { oneOnOneHub, type OneOnOneConnection } from '../lib/one-on-one-hub'

export async function oneOnOneWsRoutes(app: FastifyInstance) {
  app.get(
    '/one-on-ones/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const token = (request.query as { token?: string }).token ?? ''
        let payload: { sub: string; role: string; features?: string[] }
        try {
          payload = app.jwt.verify(token) as { sub: string; role: string; features?: string[] }
        } catch {
          return reply.code(401).send({ message: 'Não autorizado' })
        }
        // Mesma regra do `app.requireFeature('um-a-um')` que guarda as rotas
        // HTTP do 1:1 — repetida aqui porque o decorator roda em `onRequest`
        // sobre `request.user`, e o handshake do WebSocket traz o token na query.
        const isAdmin = payload.role === 'ADMIN' || payload.role === 'SUBADMIN'
        if (!isAdmin && !(payload.features ?? []).includes('um-a-um')) {
          return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
        }
        ;(request as { _wsUserId?: string })._wsUserId = payload.sub
      },
    },
    (connection, request) => {
      // O canal é o próprio usuário: ele nunca escolhe o que assinar, e por isso
      // não há mensagem de cliente para tratar. Quem decide o que cada pessoa
      // recebe é o servidor, no `emit` de cada escrita.
      const conn: OneOnOneConnection = {
        socket: connection.socket,
        userId: (request as { _wsUserId?: string })._wsUserId as string,
      }
      oneOnOneHub.subscribe(conn)
      connection.socket.on('close', () => {
        oneOnOneHub.unsubscribe(conn)
      })
    },
  )
}
