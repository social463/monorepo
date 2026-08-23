import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import {
  LPC_STYLE,
  isCharacterOptions,
  migrateCharacterOptions,
  sanitizeCharacterOptions,
  type CharacterOptions,
} from '@legends/shared'
import { AuthError, authenticateUser, changePassword, registerUser } from '../services/auth-service'
import { toPublicUser } from '../lib/serialize'
import { prisma } from '../lib/prisma'
import { getOfficeHub } from '../lib/office-hub'
import { REFRESH_COOKIE, refreshCookieOptions, clearRefreshCookieOptions } from '../lib/refresh-cookie'
import { signAccessToken } from '../lib/jwt'
import { analytics } from '../lib/analytics/request'
import {
  issueRefreshTokenForLogin,
  rotateRefreshToken,
  revokeByRawToken,
  revokeAllForUser,
  hashToken,
  RefreshError,
} from '../services/refresh-token-service'
import { sectorFeaturesFor } from '../lib/sector-features'

async function companyNameFor(companyId: string): Promise<string | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId } })
  return company?.name ?? null
}

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  position: z.string().optional(),
  squad: z.string().optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  remember: z.boolean().optional().default(false),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})

const characterOptionsSchema = z.custom<CharacterOptions>(isCharacterOptions, {
  message: 'Personagem inválido',
})

const updateMeSchema = z.object({
  avatarStyle: z.literal(LPC_STYLE).nullable().optional(),
  avatarSeed: z.string().min(1).max(64).nullable().optional(),
  avatarOptions: characterOptionsSchema.nullable().optional(),
})

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    try {
      const user = await registerUser(parsed.data)
      const sectorFeatures = await sectorFeaturesFor(user.sectorId)
      const accessToken = signAccessToken(app, user, sectorFeatures)
      const refresh = await issueRefreshTokenForLogin(user.id, false)
      reply.setCookie(
        REFRESH_COOKIE,
        refresh.rawToken,
        refreshCookieOptions(refresh.persistent, refresh.expiresAt),
      )
      return reply
        .code(201)
        .send({
          accessToken,
          user: toPublicUser(user, sectorFeatures, { companyName: await companyNameFor(user.companyId) }),
        })
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(409).send({ message: err.message })
      }
      throw err
    }
  })

  app.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    try {
      const user = await authenticateUser(parsed.data.email, parsed.data.password)
      const sectorFeatures = await sectorFeaturesFor(user.sectorId)
      const accessToken = signAccessToken(app, user, sectorFeatures)
      const refresh = await issueRefreshTokenForLogin(user.id, parsed.data.remember)
      reply.setCookie(
        REFRESH_COOKIE,
        refresh.rawToken,
        refreshCookieOptions(refresh.persistent, refresh.expiresAt),
      )
      // Contexto montado do usuário, não de `request.user`: `/login` é rota
      // pública e o JWT só passa a existir na resposta.
      analytics.capture(
        'user_logged_in',
        { method: 'password' },
        {
          userId: user.id,
          companyId: user.companyId,
          sectorId: user.sectorId,
          role: user.role,
        },
      )
      return reply.send({
        accessToken,
        user: toPublicUser(user, sectorFeatures, { companyName: await companyNameFor(user.companyId) }),
      })
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(401).send({ message: err.message })
      }
      throw err
    }
  })

  app.post('/refresh', async (request, reply) => {
    const raw = request.cookies[REFRESH_COOKIE]
    if (!raw) {
      return reply.code(401).send({ message: 'Não autorizado' })
    }
    try {
      const rotated = await rotateRefreshToken(raw)
      const user = await prisma.user.findUnique({ where: { id: rotated.userId } })
      if (!user || !user.active) {
        await revokeByRawToken(rotated.rawToken)
        reply.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions())
        return reply.code(401).send({ message: 'Não autorizado' })
      }
      const accessToken = signAccessToken(app, user, await sectorFeaturesFor(user.sectorId))
      reply.setCookie(
        REFRESH_COOKIE,
        rotated.rawToken,
        refreshCookieOptions(rotated.persistent, rotated.expiresAt),
      )
      return reply.send({ accessToken })
    } catch (err) {
      if (err instanceof RefreshError) {
        reply.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions())
        return reply.code(401).send({ message: 'Não autorizado' })
      }
      throw err
    }
  })

  app.post('/logout', async (request, reply) => {
    const raw = request.cookies[REFRESH_COOKIE]
    if (raw) {
      await revokeByRawToken(raw)
    }
    reply.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions())
    return reply.code(204).send()
  })

  app.get('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } })
    if (!user) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    return reply.send({
      user: toPublicUser(user, await sectorFeaturesFor(user.sectorId), {
        companyName: await companyNameFor(user.companyId),
      }),
    })
  })

  app.patch('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = updateMeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const { avatarStyle, avatarSeed, avatarOptions } = parsed.data
    const data: Prisma.UserUpdateInput = {}
    if (avatarStyle !== undefined) data.avatarStyle = avatarStyle
    if (avatarSeed !== undefined) data.avatarSeed = avatarSeed

    if (avatarStyle === LPC_STYLE) {
      if (!avatarOptions) {
        return reply.code(400).send({ message: 'Dados inválidos' })
      }
      data.avatarOptions = sanitizeCharacterOptions(avatarOptions) as unknown as Prisma.InputJsonValue
    } else if (avatarStyle !== undefined) {
      // limpou o estilo: limpa as escolhas junto
      data.avatarOptions = Prisma.DbNull
    } else if (avatarOptions !== undefined) {
      data.avatarOptions =
        avatarOptions === null
          ? Prisma.DbNull
          : (sanitizeCharacterOptions(avatarOptions) as unknown as Prisma.InputJsonValue)
    }

    const user = await prisma.user.update({ where: { id: request.user.sub }, data })

    // Se a pessoa está no escritório, o personagem troca ao vivo. Usa
    // migrateCharacterOptions (não isCharacterOptions) porque o valor cru do
    // banco pode ser v1 legado — quem só alterou o avatarSeed sem migrar o
    // avatarOptions não pode virar null no broadcast.
    if (data.avatarSeed !== undefined || data.avatarOptions !== undefined) {
      getOfficeHub(request.user.companyId).updateAvatar(user.id, user.avatarSeed ?? null, migrateCharacterOptions(user.avatarOptions))
    }

    return reply.send({
      user: toPublicUser(user, await sectorFeaturesFor(user.sectorId), {
        companyName: await companyNameFor(user.companyId),
      }),
    })
  })

  app.post('/change-password', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    try {
      await changePassword(request.user.sub, parsed.data.currentPassword, parsed.data.newPassword)
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(400).send({ message: err.message })
      }
      throw err
    }

    // Preserva o flag de persistência da sessão atual (se o cookie existir).
    const raw = request.cookies[REFRESH_COOKIE]
    let persistent = false
    if (raw) {
      const current = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } })
      if (current) persistent = current.persistent
    }

    // Revoga tudo ANTES de emitir o novo token, para não revogar o recém-criado.
    // Num único commit: ou ambos acontecem, ou nenhum — assim a sessão atual
    // nunca fica sem refresh token válido se a emissão falhar.
    const refresh = await prisma.$transaction(async (tx) => {
      await revokeAllForUser(request.user.sub, tx)
      return issueRefreshTokenForLogin(request.user.sub, persistent, tx)
    })
    reply.setCookie(
      REFRESH_COOKIE,
      refresh.rawToken,
      refreshCookieOptions(refresh.persistent, refresh.expiresAt),
    )
    return reply.code(204).send()
  })
}
