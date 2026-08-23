import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  FEATURE_KEYS,
  THIRD_PARTY_INVITE_MAX_MINUTES,
  THIRD_PARTY_INVITE_MIN_MINUTES,
  type CreateThirdPartyInviteResponse,
  type ThirdPartyInviteListResponse,
  type ThirdPartyInvitePublicDTO,
  type AuthResponse,
} from '@legends/shared'
import {
  ThirdPartyInviteError,
  acceptThirdPartyInvite,
  createThirdPartyInvite,
  deleteThirdPartyInvite,
  getValidThirdPartyInvite,
  listThirdPartyInvites,
  revokeThirdPartyInvite,
} from '../services/third-party-invite-service'
import { toPublicUser } from '../lib/serialize'
import { REFRESH_COOKIE, refreshCookieOptions } from '../lib/refresh-cookie'
import { scopedPrisma } from '../lib/tenant-scope'

const createInviteSchema = z.object({
  expiresInMinutes: z.number().int().min(THIRD_PARTY_INVITE_MIN_MINUTES).max(THIRD_PARTY_INVITE_MAX_MINUTES),
  enabledFeatures: z.array(z.enum(FEATURE_KEYS)),
})

const acceptSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8),
})

const tokenParamsSchema = z.object({ token: z.string().min(16) })
const idParamsSchema = z.object({ id: z.string().min(1) })

function badInput(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ message: 'Dados inválidos', issues: error.issues })
}

function inviteUrl(request: { protocol: string; hostname: string; headers: Record<string, unknown> }, token: string): string {
  const host = typeof request.headers.host === 'string' ? request.headers.host : request.hostname
  return `${request.protocol}://${host}/terceirizado/convite/${encodeURIComponent(token)}`
}

export async function thirdPartyInviteRoutes(app: FastifyInstance) {
  const adminOrSubadmin = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.post('/admin/third-party-invites', adminOrSubadmin, async (request, reply): Promise<CreateThirdPartyInviteResponse | FastifyReply> => {
    const parsed = createInviteSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    const { invite, rawToken } = await createThirdPartyInvite(
      request.user.sub,
      parsed.data.expiresInMinutes,
      parsed.data.enabledFeatures,
      request.user.sectorId,
    )
    return reply.code(201).send({
      invite: {
        id: invite.id,
        url: inviteUrl(request, rawToken),
        enabledFeatures: invite.enabledFeatures as string[],
        expiresAt: invite.expiresAt.toISOString(),
        createdAt: invite.createdAt.toISOString(),
        usedAt: null,
        revokedAt: null,
      },
    })
  })

  app.get('/admin/third-party-invites', adminOrSubadmin, async (request, reply): Promise<ThirdPartyInviteListResponse> => {
    const invites = await listThirdPartyInvites(request.user.companyId)
    const scoped = request.user.role === 'SUBADMIN' ? invites.filter((i) => i.sectorId === request.user.sectorId) : invites
    return reply.send({
      invites: scoped.map((invite) => ({
        id: invite.id,
        url: null,
        enabledFeatures: invite.enabledFeatures as string[],
        expiresAt: invite.expiresAt.toISOString(),
        createdAt: invite.createdAt.toISOString(),
        usedAt: invite.usedAt ? invite.usedAt.toISOString() : null,
        revokedAt: invite.revokedAt ? invite.revokedAt.toISOString() : null,
      })),
    })
  })

  app.post('/admin/third-party-invites/:id/revoke', adminOrSubadmin, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    if (request.user.role === 'SUBADMIN') {
      const existing = await scopedPrisma(request.user.companyId).thirdPartyInvite.findUnique({ where: { id: parsed.data.id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Convite não encontrado' })
      }
    }
    await revokeThirdPartyInvite(parsed.data.id, request.user.sub, request.user.companyId)
    return reply.code(204).send()
  })

  app.delete('/admin/third-party-invites/:id', adminOrSubadmin, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    if (request.user.role === 'SUBADMIN') {
      const existing = await scopedPrisma(request.user.companyId).thirdPartyInvite.findUnique({ where: { id: parsed.data.id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Convite não encontrado' })
      }
    }
    try {
      await deleteThirdPartyInvite(parsed.data.id, request.user.sub, request.user.companyId)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ThirdPartyInviteError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })

  app.get('/third-party-invites/:token', async (request, reply): Promise<ThirdPartyInvitePublicDTO | FastifyReply> => {
    const parsed = tokenParamsSchema.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const invite = await getValidThirdPartyInvite(parsed.data.token)
      return { createdByName: invite.createdBy.name, expiresAt: invite.expiresAt.toISOString() }
    } catch (err) {
      if (err instanceof ThirdPartyInviteError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })

  app.post('/third-party-invites/:token/accept', async (request, reply): Promise<AuthResponse | FastifyReply> => {
    const params = tokenParamsSchema.safeParse(request.params)
    const body = acceptSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    try {
      const { accessToken, user, refresh } = await acceptThirdPartyInvite(app, {
        token: params.data.token,
        ...body.data,
      })
      reply.setCookie(REFRESH_COOKIE, refresh.rawToken, refreshCookieOptions(refresh.persistent, refresh.expiresAt))
      return reply.code(201).send({ accessToken, user: toPublicUser(user) })
    } catch (err) {
      if (err instanceof ThirdPartyInviteError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })
}
