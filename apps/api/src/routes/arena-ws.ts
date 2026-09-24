import type { FastifyInstance } from 'fastify'
import { isArenaMode, type ArenaClientMessage, type BodyInput, type ArenaMode } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getArenaHub, type ArenaUser } from '../lib/arena-hub'
import { sanitizeAvatarOptions } from '../lib/serialize'

/** Anexado ao request no preValidation, para o handler do socket ficar síncrono. */
interface ArenaRequest {
  _arenaUser?: ArenaUser
  _arenaCompanyId?: string
  _arenaId?: string
  _arenaMode?: ArenaMode
}

/** Mesmo motivo do heartbeat do escritório: nginx derruba socket ocioso. */
export const ARENA_HEARTBEAT_INTERVAL_MS = 30_000

/** Shape do input vindo do fio — nada aqui confia no cliente. */
function isArenaInput(value: unknown): value is BodyInput {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return (
    Number.isFinite(input.seq) &&
    Number.isFinite(input.dx) &&
    Number.isFinite(input.dy) &&
    Number.isFinite(input.dtMs)
  )
}

/** Normaliza o que veio do fio antes de entrar na simulação. */
function sanitizeInput(input: BodyInput): BodyInput {
  // `sprint` vira booleano de verdade: `stepBody` só olha se é verdadeiro, e
  // aceitar uma string truthy funcionaria, mas deixaria lixo do cliente
  // atravessando a simulação.
  return { seq: input.seq, dx: input.dx, dy: input.dy, dtMs: input.dtMs, sprint: input.sprint === true }
}

export async function arenaWsRoutes(app: FastifyInstance) {
  app.get(
    '/arena/ws',
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
          // Mesmo gate do escritório neste marco. Feature própria de arena é
          // decisão de produto, e inventá-la agora criaria uma chave que
          // ninguém sabe ligar.
          if (payload.role !== 'ADMIN' && !(payload.features ?? []).includes('escritorio')) {
            return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
          }
        } catch {
          return reply.code(401).send({ message: 'Não autorizado' })
        }

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, active: true, avatarSeed: true, avatarOptions: true },
        })
        if (!user || !user.active) return reply.code(401).send({ message: 'Não autorizado' })

        ;(request as ArenaRequest)._arenaUser = {
          id: user.id,
          name: user.name,
          avatarSeed: user.avatarSeed ?? null,
          avatarOptions: sanitizeAvatarOptions(user.avatarOptions),
        }
        ;(request as ArenaRequest)._arenaCompanyId = companyId
        // O modo é da INSTÂNCIA: quem abre a arena escolhe, e quem entra
        // depois joga o que já está rolando. Trocar no meio zeraria a partida
        // de quem está dentro.
        const modo = (request.query as { modo?: string }).modo
        ;(request as ArenaRequest)._arenaMode = isArenaMode(modo) ? modo : 'mata-mata'
        ;(request as ArenaRequest)._arenaId =
          (request.query as { arenaId?: string }).arenaId ?? (isArenaMode(modo) ? modo : 'padrao')
      },
    },
    (connection, request) => {
      const ws = connection.socket
      const user = (request as ArenaRequest)._arenaUser as ArenaUser
      const companyId = (request as ArenaRequest)._arenaCompanyId as string
      const arenaId = (request as ArenaRequest)._arenaId as string

      const hub = getArenaHub(companyId, arenaId)
      // Cenário gerado: nada de mapa do escritório aqui (ver `arenaMapDocument`).
      hub.configure(undefined, (request as ArenaRequest)._arenaMode)
      hub.join(ws, user, arenaId)

      const heartbeat = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.ping()
      }, ARENA_HEARTBEAT_INTERVAL_MS)
      heartbeat.unref?.()

      ws.on('message', (raw: unknown) => {
        let msg: ArenaClientMessage
        try {
          msg = JSON.parse(String(raw)) as ArenaClientMessage
        } catch {
          return
        }
        if (msg.type === 'input' && isArenaInput(msg.input)) {
          hub.applyInput(ws, user.id, sanitizeInput(msg.input))
        } else if (msg.type === 'fire' && Number.isFinite(msg.angle)) {
          hub.fire(ws, user.id, msg.angle)
        } else if (msg.type === 'kick' && Number.isFinite(msg.angle)) {
          // O gesto vem do fio; a força, não. Qualquer coisa fora de `passe`
          // vira chute — o padrão é o gesto mais comum, e lixo do cliente não
          // atravessa a simulação (mesmo cuidado de `sanitizeInput`).
          hub.kick(ws, user.id, msg.angle, msg.power === 'passe' ? 'passe' : 'chute')
        } else if (msg.type === 'unstuck') {
          // Sem payload: o servidor já sabe onde a pessoa está e para onde a
          // pista aponta ali. Aceitar posição aqui seria aceitar teleporte.
          hub.unstuck(ws, user.id)
        } else if (msg.type === 'chat' && typeof msg.text === 'string') {
          hub.chat(ws, user.id, msg.text)
        } else if (msg.type === 'leave-arena') {
          hub.leave(ws, user.id)
          ws.close()
        }
      })

      ws.on('close', () => {
        clearInterval(heartbeat)
        hub.leave(ws, user.id)
      })
    },
  )
}
