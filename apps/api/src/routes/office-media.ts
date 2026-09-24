import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AccessToken } from 'livekit-server-sdk'
import {
  OFFICE_BROADCAST_ROOM,
  isLeaderRole,
  type OfficeMediaTokenResponse,
  type OfficeConfigDTO,
} from '@legends/shared'
import { getOfficeHub } from '../lib/office-hub'
import { resolveLivekitConfig } from '../lib/config'
import { getOfficeSettings } from '../services/office-setting-service'
import { isOfficeGuestPayload } from '../services/office-guest-service'

const bodySchema = z.object({ room: z.string().min(1) })

/**
 * Assina tokens do LiveKit. A autorização é a POSIÇÃO REAL no office-hub:
 * só sai token para a sala que corresponde ao tile onde a pessoa está —
 * é isso que torna o isolamento acústico das zonas estrutural.
 */
export async function officeMediaRoutes(app: FastifyInstance) {
  const livekit = resolveLivekitConfig(process.env)

  async function resolveParticipant(request: FastifyRequest, reply: FastifyReply) {
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? ''
    try {
      const payload = app.jwt.verify(bearer)
      if (isOfficeGuestPayload(payload)) return { sub: payload.sub, role: 'GUEST' as const, guest: true, companyId: payload.companyId }
    } catch {
      // cai para o fluxo normal de access token abaixo
    }
    try {
      await request.jwtVerify()
      if (request.user.role === 'THIRD_PARTY' && !(request.user.features ?? []).includes('escritorio')) {
        reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
        return null
      }
      return { sub: request.user.sub, role: request.user.role, guest: false, companyId: request.user.companyId }
    } catch {
      reply.code(401).send({ message: 'Não autorizado' })
      return null
    }
  }

  app.post('/office/media-token', async (request, reply) => {
    const participant = await resolveParticipant(request, reply)
    if (!participant) return
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const hub = getOfficeHub(participant.companyId)

    // Alto-falante: sala global, sem checagem de zona. O interruptor do admin
    // é a primeira barreira (custo); o grant canPublish é a segunda (só
    // liderança fala — imposto pelo próprio servidor LiveKit).
    if (parsed.data.room === OFFICE_BROADCAST_ROOM) {
      const { broadcastEnabled } = await getOfficeSettings(participant.companyId)
      if (!broadcastEnabled) {
        return reply.code(403).send({ message: 'O alto-falante está desativado' })
      }
      const occupant = hub.occupantOf(participant.sub)
      if (!occupant) {
        return reply.code(409).send({ message: 'Entre no escritório antes de conectar a mídia' })
      }
      const accessToken = new AccessToken(livekit.apiKey, livekit.apiSecret, {
        identity: occupant.userId,
        name: occupant.name,
        ttl: '5m',
      })
      accessToken.addGrant({
        roomJoin: true,
        room: OFFICE_BROADCAST_ROOM,
        canSubscribe: true,
        canPublish: !participant.guest && isLeaderRole(participant.role),
      })
      const response: OfficeMediaTokenResponse = {
        token: await accessToken.toJwt(),
        url: livekit.url,
      }
      return reply.send(response)
    }

    const occupant = hub.occupantOf(participant.sub)
    if (!occupant) {
      return reply.code(409).send({ message: 'Entre no escritório antes de conectar a mídia' })
    }

    const allowed = hub.mediaRoomOf(occupant)
    if (parsed.data.room !== allowed) {
      return reply.code(403).send({ message: 'Você não está nessa sala' })
    }
    const room = hub.roomOf(occupant)
    if (room && !room.voiceEnabled) {
      return reply.code(403).send({ message: 'A voz está desativada nesta sala' })
    }
    // Tirado da chamada e ainda parado dentro da sala: sem isto o cliente
    // pediria outro token e voltaria sozinho, porque a sala é derivada da
    // POSIÇÃO e o personagem continua lá. Sair da área limpa a marca.
    if (room && hub.isRemovedFromRoom(participant.sub, room.id)) {
      return reply.code(403).send({ message: 'Você saiu desta reunião. Saia da sala e entre de novo para voltar.' })
    }

    const accessToken = new AccessToken(livekit.apiKey, livekit.apiSecret, {
      identity: occupant.userId,
      name: occupant.name,
      // Token é credencial bearer — TTL curto limita a janela de escuta de quem saiu da sala com um cliente adulterado.
      ttl: '5m',
    })
    accessToken.addGrant({ roomJoin: true, room: parsed.data.room })

    const response: OfficeMediaTokenResponse = {
      token: await accessToken.toJwt(),
      url: livekit.url,
    }
    return reply.send(response)
  })

  app.get('/office/config', { onRequest: [app.authenticate, app.requireFeature('escritorio')] }, async (request): Promise<OfficeConfigDTO> => {
    return getOfficeSettings(request.user.companyId)
  })
}
