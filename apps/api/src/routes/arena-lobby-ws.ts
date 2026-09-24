import type { FastifyInstance } from 'fastify'
import type { ArenaLobbyClientMessage, ArenaLobbyMember } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getArenaLobbyHub } from '../lib/arena-lobby-hub'
import { sanitizeAvatarOptions } from '../lib/serialize'

/** Anexado ao request no preValidation, para o handler do socket ficar síncrono. */
interface ArenaLobbyRequest {
  _lobbyMember?: ArenaLobbyMember
  _lobbyCompanyId?: string
}

/** Mesmo motivo do heartbeat da arena: nginx derruba socket ocioso. */
export const ARENA_LOBBY_HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Socket do saguão — quem está no MENU da arena.
 *
 * Rota própria, e não um `arenaId` do socket da arena, porque o `ArenaHub`
 * simula: entrar nele é entrar em campo (time, spawn, partida). O saguão só
 * tem presença e conversa.
 */
export async function arenaLobbyWsRoutes(app: FastifyInstance) {
  app.get(
    '/arena/lobby/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const token = (request.query as { token?: string }).token ?? ''
        let userId: string
        let companyId: string
        try {
          const payload = app.jwt.verify(token) as {
            sub: string
            role?: string
            features?: string[]
            companyId: string
          }
          userId = payload.sub
          companyId = payload.companyId
          // Mesmo gate do socket da arena.
          if (payload.role !== 'ADMIN' && !(payload.features ?? []).includes('escritorio')) {
            return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
          }
        } catch {
          return reply.code(401).send({ message: 'Não autorizado' })
        }

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, active: true, photoUrl: true, avatarSeed: true, avatarOptions: true },
        })
        if (!user || !user.active) return reply.code(401).send({ message: 'Não autorizado' })

        ;(request as ArenaLobbyRequest)._lobbyMember = {
          userId: user.id,
          name: user.name,
          photoUrl: user.photoUrl,
          avatarSeed: user.avatarSeed ?? null,
          avatarOptions: sanitizeAvatarOptions(user.avatarOptions),
        }
        ;(request as ArenaLobbyRequest)._lobbyCompanyId = companyId
      },
    },
    (connection, request) => {
      const ws = connection.socket
      const member = (request as ArenaLobbyRequest)._lobbyMember as ArenaLobbyMember
      const companyId = (request as ArenaLobbyRequest)._lobbyCompanyId as string

      const hub = getArenaLobbyHub(companyId)
      hub.join(ws, member)

      const heartbeat = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.ping()
      }, ARENA_LOBBY_HEARTBEAT_INTERVAL_MS)
      heartbeat.unref?.()

      ws.on('message', (raw: unknown) => {
        let msg: ArenaLobbyClientMessage
        try {
          msg = JSON.parse(String(raw)) as ArenaLobbyClientMessage
        } catch {
          return
        }
        if (msg.type === 'chat' && typeof msg.text === 'string') {
          hub.chat(ws, member.userId, msg.text)
        }
      })

      ws.on('close', () => {
        clearInterval(heartbeat)
        hub.leave(ws, member.userId)
      })
    },
  )
}
