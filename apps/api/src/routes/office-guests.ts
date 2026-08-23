import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  OFFICE_GUEST_CHARACTER_PRESETS,
  OFFICE_GUEST_INVITE_MAX_MINUTES,
  OFFICE_GUEST_INVITE_MIN_MINUTES,
  OFFICE_GUEST_NAME_MAX_LENGTH,
  type CreateOfficeGuestInviteResponse,
  type OfficeGuestInvitePublicDTO,
} from '@legends/shared'
import {
  OfficeGuestInviteError,
  createOfficeGuestInvite,
  getValidOfficeGuestInvite,
  isOfficeGuestPayload,
  issueOfficeGuestSession,
} from '../services/office-guest-service'
import { getActiveOfficeMap } from '../services/office-map-service'

const createInviteSchema = z.object({
  expiresInMinutes: z.number().int().min(OFFICE_GUEST_INVITE_MIN_MINUTES).max(OFFICE_GUEST_INVITE_MAX_MINUTES),
})

const guestSessionSchema = z.object({
  token: z.string().min(16),
  name: z.string().trim().min(1).max(OFFICE_GUEST_NAME_MAX_LENGTH),
  presetId: z.string().min(1),
})

const tokenParamsSchema = z.object({ token: z.string().min(16) })

function badInput(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ message: 'Dados inválidos', issues: error.issues })
}

function inviteUrl(request: { protocol: string; hostname: string; headers: Record<string, unknown> }, token: string): string {
  const host = typeof request.headers.host === 'string' ? request.headers.host : request.hostname
  return `${request.protocol}://${host}/convidado/${encodeURIComponent(token)}`
}

export async function officeGuestRoutes(app: FastifyInstance) {
  const adminOnly = { onRequest: [app.authenticate, app.requireAdmin] }

  app.post('/admin/office-guest-invites', adminOnly, async (request, reply): Promise<CreateOfficeGuestInviteResponse | FastifyReply> => {
    const parsed = createInviteSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    const { invite, rawToken } = await createOfficeGuestInvite(request.user.sub, parsed.data.expiresInMinutes, request.user.companyId)
    return reply.code(201).send({
      invite: {
        id: invite.id,
        url: inviteUrl(request, rawToken),
        expiresAt: invite.expiresAt.toISOString(),
        createdAt: invite.createdAt.toISOString(),
      },
    })
  })

  app.get('/office/guest-invites/:token', async (request, reply): Promise<OfficeGuestInvitePublicDTO | FastifyReply> => {
    const parsed = tokenParamsSchema.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const invite = await getValidOfficeGuestInvite(parsed.data.token)
      return {
        expiresAt: invite.expiresAt.toISOString(),
        presets: OFFICE_GUEST_CHARACTER_PRESETS,
      }
    } catch (err) {
      if (err instanceof OfficeGuestInviteError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })

  app.post('/office/guest-session', async (request, reply) => {
    const parsed = guestSessionSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      return await issueOfficeGuestSession(app, parsed.data)
    } catch (err) {
      if (err instanceof OfficeGuestInviteError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })

  app.get('/office/guest-map', async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? ''
    try {
      const payload = app.jwt.verify(token)
      if (!isOfficeGuestPayload(payload)) {
        return reply.code(401).send({ message: 'Não autorizado' })
      }
      return getActiveOfficeMap(payload.companyId)
    } catch {
      return reply.code(401).send({ message: 'Não autorizado' })
    }
  })
}
