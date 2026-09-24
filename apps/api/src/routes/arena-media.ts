import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AccessToken } from 'livekit-server-sdk'
import {
  ARENA_LOBBY_ID,
  arenaMediaRoom,
  isArenaMode,
  type ArenaMediaTokenResponse,
} from '@legends/shared'
import { getArenaHub } from '../lib/arena-hub'
import { getArenaLobbyHub } from '../lib/arena-lobby-hub'
import { resolveLivekitConfig } from '../lib/config'

const bodySchema = z.object({ arenaId: z.string().min(1) })

/**
 * Assina tokens do LiveKit da arena e do saguão.
 *
 * A autorização é a PRESENÇA no hub, como no escritório: o cliente não escolhe
 * a sala, ele diz onde acha que está e o servidor só concorda se o socket dele
 * estiver mesmo lá. O nome da sala nem sai do cliente — quem o monta é
 * `arenaMediaRoom`, que precisa do `companyId` (ver o comentário lá: o modo é
 * igual em todo tenant).
 */
export async function arenaMediaRoutes(app: FastifyInstance) {
  const livekit = resolveLivekitConfig(process.env)

  app.post('/arena/media-token', { onRequest: [app.authenticate] }, async (request, reply) => {
    if (request.user.role !== 'ADMIN' && !(request.user.features ?? []).includes('escritorio')) {
      return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
    }
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { arenaId } = parsed.data
    // Só o saguão e os modos conhecidos: `arenaId` livre viraria sala LiveKit
    // livre, e daria a qualquer um um canal de voz privado do lado de dentro.
    if (arenaId !== ARENA_LOBBY_ID && !isArenaMode(arenaId)) {
      return reply.code(400).send({ message: 'Arena desconhecida' })
    }

    const companyId = request.user.companyId
    const nome =
      arenaId === ARENA_LOBBY_ID
        ? getArenaLobbyHub(companyId).nameOf(request.user.sub)
        : getArenaHub(companyId, arenaId).nameOf(request.user.sub)
    if (!nome) {
      return reply.code(409).send({ message: 'Entre na arena antes de conectar a mídia' })
    }

    const room = arenaMediaRoom(companyId, arenaId)
    const accessToken = new AccessToken(livekit.apiKey, livekit.apiSecret, {
      identity: request.user.sub,
      name: nome,
      // Mesmo TTL curto do escritório: token é credencial bearer.
      ttl: '5m',
    })
    accessToken.addGrant({ roomJoin: true, room })

    const response: ArenaMediaTokenResponse = {
      token: await accessToken.toJwt(),
      url: livekit.url,
      room,
    }
    return reply.send(response)
  })
}
