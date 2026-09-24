import type { FastifyInstance } from 'fastify'
import {
  type BodyInput,
  OFFICE_CHARACTER_NAME_MAX_LENGTH,
  OFFICE_GUEST_CHARACTER_PRESETS,
  OFFICE_GUEST_NAME_MAX_LENGTH,
  isDirection,
  isOfficeBallPower,
  isOfficeUserStatus,
  type OfficeClientMessage,
  type ActiveOfficeMapDTO,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getOfficeHub, type OfficeUser } from '../lib/office-hub'
import { removeLivekitParticipant } from '../lib/livekit-admin'
import { sanitizeAvatarOptions, sanitizeAvatarStyle } from '../lib/serialize'
import { getActiveOfficeMap } from '../services/office-map-service'
import { isOfficeGuestPayload } from '../services/office-guest-service'

/** Anexado ao request no preValidation para o handler do socket ficar síncrono. */
interface OfficeRequest {
  _officeUser?: OfficeUser
  _officeMap?: ActiveOfficeMapDTO
  _officeCompanyId?: string
}

/**
 * Ping periódico por conexão. Sem isso, uma sala parada (ninguém anda por um
 * tempo) fica com tráfego zero no socket — e o nginx derruba conexões ociosas
 * depois de `proxy_read_timeout` (60s por padrão). O intervalo aqui fica bem
 * abaixo disso para o socket nunca ficar realmente ocioso.
 */
export const OFFICE_HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Shape do input vindo do fio — nada aqui confia no cliente. Mesma checagem da
 * arena, e pelo mesmo motivo: número inválido atravessando a simulação vira
 * `NaN` na posição, e daí em diante o personagem some do mapa para todo mundo.
 */
function isBodyInput(value: unknown): value is BodyInput {
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
function sanitizeBodyInput(input: BodyInput): BodyInput {
  // `sprint` vira booleano de verdade: `stepBody` só olha se é verdadeiro, e
  // aceitar uma string truthy funcionaria, mas deixaria lixo do cliente
  // atravessando a simulação.
  return { seq: input.seq, dx: input.dx, dy: input.dy, dtMs: input.dtMs, sprint: input.sprint === true }
}

export async function officeWsRoutes(app: FastifyInstance) {
  app.get(
    '/office/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const token = (request.query as { token?: string }).token ?? ''
        let userId: string
        let companyId: string
        let isAdmin = false
        try {
          const payload = app.jwt.verify(token) as {
            sub: string
            role?: string
            guest?: boolean
            features?: string[]
            companyId: string
          }
          userId = payload.sub
          companyId = payload.companyId
          if (isOfficeGuestPayload(payload)) {
            const preset = OFFICE_GUEST_CHARACTER_PRESETS.find((candidate) => candidate.id === payload.presetId)
            if (!preset) return reply.code(401).send({ message: 'Não autorizado' })
            ;(request as OfficeRequest)._officeUser = {
              id: payload.sub,
              name: payload.name.trim().slice(0, OFFICE_GUEST_NAME_MAX_LENGTH),
              isGuest: true,
              officeCharacterName: null,
              avatarSeed: preset.seed,
              avatarOptions: preset.options,
              photoUrl: null,
              avatarStyle: 'lpc',
            }
            const activeMap = await getActiveOfficeMap(companyId)
            const requestedMapId = (request.query as { mapId?: string }).mapId
            if (requestedMapId && requestedMapId !== activeMap.map.id) {
              return reply.code(409).send({ message: 'O mapa ativo mudou; recarregue o escritório' })
            }
            ;(request as OfficeRequest)._officeMap = activeMap
            ;(request as OfficeRequest)._officeCompanyId = companyId
            return
          } else if (payload.role !== 'ADMIN' && !(payload.features ?? []).includes('escritorio')) {
            return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
          }
          isAdmin = payload.role === 'ADMIN'
        } catch {
          return reply.code(401).send({ message: 'Não autorizado' })
        }

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            name: true,
            active: true,
            photoUrl: true,
            avatarStyle: true,
            avatarSeed: true,
            avatarOptions: true,
            officeCharacterName: true,
          },
        })
        if (!user || !user.active) {
          return reply.code(401).send({ message: 'Não autorizado' })
        }

        ;(request as OfficeRequest)._officeUser = {
          id: user.id,
          isAdmin,
          officeCharacterName: user.officeCharacterName ?? null,
          avatarSeed: user.avatarSeed ?? null,
          avatarOptions: sanitizeAvatarOptions(user.avatarOptions),
          name: user.name,
          photoUrl: user.photoUrl,
          avatarStyle: sanitizeAvatarStyle(user.avatarStyle),
        }
        const activeMap = await getActiveOfficeMap(companyId)
        const requestedMapId = (request.query as { mapId?: string }).mapId
        if (requestedMapId && requestedMapId !== activeMap.map.id) {
          return reply.code(409).send({ message: 'O mapa ativo mudou; recarregue o escritório' })
        }
        ;(request as OfficeRequest)._officeMap = activeMap
        ;(request as OfficeRequest)._officeCompanyId = companyId
      },
    },
    (connection, request) => {
      const ws = connection.socket
      const user = (request as OfficeRequest)._officeUser as OfficeUser
      const runtime = (request as OfficeRequest)._officeMap as ActiveOfficeMapDTO
      const companyId = (request as OfficeRequest)._officeCompanyId as string
      const hub = getOfficeHub(companyId)

      hub.join(ws, user, runtime)

      // Mantém o socket "vivo" aos olhos de qualquer proxy no meio do caminho
      // (nginx). `.unref()` para o timer não segurar o processo Node aberto
      // (ex.: em testes que fecham o server sem fechar cada conexão).
      const heartbeat = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.ping()
      }, OFFICE_HEARTBEAT_INTERVAL_MS)
      heartbeat.unref?.()

      ws.on('message', (raw: unknown) => {
        let msg: OfficeClientMessage
        try {
          msg = JSON.parse(String(raw)) as OfficeClientMessage
        } catch {
          return
        }
        if (msg.type === 'input' && isBodyInput(msg.input)) {
          hub.applyInput(ws, user.id, sanitizeBodyInput(msg.input))
        } else if (msg.type === 'leave-office') {
          hub.leaveNow(ws, user.id)
          ws.close()
        } else if (msg.type === 'face' && isDirection(msg.dir)) {
          hub.face(ws, user.id, msg.dir)
        } else if (msg.type === 'call' && typeof msg.targetUserId === 'string') {
          hub.call(ws, user.id, msg.targetUserId)
        } else if (
          msg.type === 'call-response' &&
          typeof msg.callerId === 'string' &&
          typeof msg.accepted === 'boolean'
        ) {
          hub.callResponse(ws, user.id, msg.callerId, msg.accepted)
        } else if (msg.type === 'nearby-message' && typeof msg.text === 'string') {
          const kind = msg.kind === 'thought' || msg.kind === 'reaction' ? msg.kind : 'speech'
          hub.nearbyMessage(ws, user.id, msg.text, kind)
        } else if (msg.type === 'room-chat-message' && typeof msg.text === 'string') {
          hub.roomChatMessage(ws, user.id, msg.text)
        } else if (msg.type === 'confetti' && typeof msg.active === 'boolean') {
          hub.confetti(ws, user.id, msg.active)
        } else if (msg.type === 'raise-hand' && typeof msg.active === 'boolean') {
          hub.raiseHand(ws, user.id, msg.active)
        } else if (msg.type === 'ride-kart') {
          hub.rideKart(ws, user.id)
        } else if (msg.type === 'kick-ball' && isOfficeBallPower(msg.power)) {
          const charge = typeof msg.charge === 'number' ? msg.charge : undefined
          hub.kickBall(ws, user.id, msg.power, msg.sprint === true, charge)
        } else if (msg.type === 'set-paint-marker' && typeof msg.active === 'boolean') {
          hub.setPaintMarker(ws, user.id, msg.active)
        } else if (msg.type === 'fire-paintball') {
          // Sem payload de propósito: direção, alcance e alvo são do servidor.
          hub.firePaintball(ws, user.id)
        } else if (msg.type === 'set-status' && isOfficeUserStatus(msg.status)) {
          hub.setStatus(ws, user.id, msg.status)
        } else if (msg.type === 'set-character-name' && typeof msg.name === 'string') {
          if (user.isGuest) return
          const normalized = msg.name.trim().slice(0, OFFICE_CHARACTER_NAME_MAX_LENGTH) || null
          void prisma.user
            .update({ where: { id: user.id }, data: { officeCharacterName: normalized } })
            .then(() => hub.setCharacterName(ws, user.id, normalized))
            .catch(() => {})
        } else if (msg.type === 'set-editing' && typeof msg.editing === 'boolean') {
          hub.setEditing(ws, user.id, msg.editing)
        } else if (msg.type === 'set-room-lock' && typeof msg.locked === 'boolean') {
          hub.setRoomLock(ws, user.id, msg.locked)
        } else if (msg.type === 'remove-from-room' && typeof msg.userId === 'string') {
          const removed = hub.removeFromRoom(ws, user.id, msg.userId, { isAdmin: user.isAdmin })
          // Tirar do estado do hub barra a VOLTA (o token é negado enquanto a
          // pessoa não sair da área); o que corta o áudio de quem já está
          // conectado é o LiveKit. Best-effort e sem await: a resposta ao
          // cliente não espera a API de administração.
          if (removed?.mediaRoom) void removeLivekitParticipant(removed.mediaRoom, msg.userId)
        } else if (msg.type === 'start-room-audio' && typeof msg.videoId === 'string') {
          // O link/id é validado no hub (`parseYouTubeVideoId`) — aqui só o shape.
          hub.startRoomAudio(ws, user.id, msg.videoId, typeof msg.playlistId === 'string' ? msg.playlistId : null)
        } else if (
          msg.type === 'set-room-audio-item' &&
          typeof msg.playlistIndex === 'number' &&
          typeof msg.videoId === 'string'
        ) {
          hub.setRoomAudioItem(ws, user.id, msg.playlistIndex, msg.videoId)
        } else if (msg.type === 'stop-room-audio') {
          hub.stopRoomAudio(ws, user.id)
        } else if (msg.type === 'set-room-audio-paused' && typeof msg.paused === 'boolean') {
          hub.setRoomAudioPaused(ws, user.id, msg.paused)
        } else if (
          msg.type === 'knock' &&
          typeof msg.roomId === 'string' &&
          typeof msg.active === 'boolean'
        ) {
          hub.knock(ws, user.id, msg.roomId, msg.active)
        } else if (
          msg.type === 'knock-response' &&
          typeof msg.userId === 'string' &&
          typeof msg.accepted === 'boolean'
        ) {
          hub.knockResponse(ws, user.id, msg.userId, msg.accepted)
        } else if (
          msg.type === 'screen-annotation' &&
          typeof msg.sharerId === 'string' &&
          typeof msg.strokeId === 'string'
        ) {
          // Os pontos são validados no hub (`sanitizeAnnotationPoints`) — aqui
          // só o formato mínimo que decide o roteamento, como nas demais.
          hub.screenAnnotation(ws, user.id, msg)
        }
      })

      ws.on('close', () => {
        clearInterval(heartbeat)
        hub.leave(ws, user.id)
      })
    },
  )
}
