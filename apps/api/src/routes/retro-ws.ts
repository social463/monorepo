import type { FastifyInstance } from 'fastify'
import { type RetroClientMessage, isLeaderRole, RETRO_FLOAT_REACTIONS } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getRoomMeta } from '../services/retro-service'
import { retroHub, type RetroConnection } from '../lib/retro-hub'

export async function retroWsRoutes(app: FastifyInstance) {
  app.get(
    '/retro/rooms/:id/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const token = (request.query as { token?: string }).token ?? ''
        let userId: string
        let role: string
        let companyId: string
        let features: string[] = []
        try {
          const payload = app.jwt.verify(token) as { sub: string; role: string; companyId: string; features?: string[] }
          userId = payload.sub
          role = payload.role
          companyId = payload.companyId
          features = payload.features ?? []
        } catch {
          return reply.code(401).send({ message: 'Não autorizado' })
        }
        if (role === 'THIRD_PARTY' && !features.includes('retrospectivas')) {
          return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
        }
        const { id } = request.params as { id: string }
        const meta = await getRoomMeta(id, companyId)
        if (!meta) return reply.code(404).send({ message: 'Sala não encontrada' })
        const isMember = meta.createdById === userId || meta.participantUserIds.includes(userId)
        if (!isMember && !isLeaderRole(role)) return reply.code(403).send({ message: 'Sem acesso' })

        // Fetch user name here so the handler stays synchronous before ws.on('message')
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
        const req = request as { _wsUserId?: string; _wsName?: string }
        req._wsUserId = userId
        req._wsName = user?.name ?? 'Alguém'
      },
    },
    (connection, request) => {
      const ws = connection.socket
      const { id: roomId } = request.params as { id: string }
      const req = request as { _wsUserId?: string; _wsName?: string }
      const userId = req._wsUserId as string
      const name = req._wsName as string

      const conn: RetroConnection = { socket: ws, userId, name }
      retroHub.subscribe(roomId, conn)
      const pushPresence = () =>
        retroHub.broadcast(roomId, () => ({ type: 'presence.changed', userIds: retroHub.presentUserIds(roomId) }))
      pushPresence()

      ws.on('message', (raw: unknown) => {
        let msg: RetroClientMessage
        try {
          msg = JSON.parse(String(raw)) as RetroClientMessage
        } catch {
          return
        }
        switch (msg.type) {
          case 'cursor':
            retroHub.broadcast(roomId, (viewerId) =>
              viewerId === userId ? null : { type: 'cursor.moved', userId, name, x: msg.x, y: msg.y },
            )
            break
          case 'card.grab':
            if (retroHub.grabCard(roomId, msg.cardId, userId, name)) {
              retroHub.broadcast(roomId, (viewerId) =>
                viewerId === userId ? null : { type: 'card.locked', cardId: msg.cardId, byUserId: userId, byName: name },
              )
            }
            break
          case 'card.move':
            if (retroHub.lockOwner(roomId, msg.cardId)?.userId === userId) {
              retroHub.broadcast(roomId, (viewerId) =>
                viewerId === userId ? null : { type: 'card.moving', cardId: msg.cardId, x: msg.x, y: msg.y, byUserId: userId },
              )
            }
            break
          case 'card.drop':
            if (retroHub.dropCard(roomId, msg.cardId, userId)) {
              retroHub.broadcast(roomId, () => ({ type: 'card.unlocked', cardId: msg.cardId }))
            }
            break
          case 'reaction.float':
            if ((RETRO_FLOAT_REACTIONS as readonly string[]).includes(msg.emoji)) {
              retroHub.broadcast(roomId, () => ({ type: 'reaction.floated', userId, name, emoji: msg.emoji }))
            }
            break
        }
      })

      ws.on('close', () => {
        const freed = retroHub.releaseLocksHeldBy(roomId, userId)
        retroHub.unsubscribe(roomId, conn)
        for (const cardId of freed) {
          retroHub.broadcast(roomId, () => ({ type: 'card.unlocked', cardId }))
        }
        pushPresence()
      })
    },
  )
}
