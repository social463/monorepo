import { randomBytes, createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { Prisma, type User } from '@prisma/client'
import {
  THIRD_PARTY_INVITE_MAX_MINUTES,
  THIRD_PARTY_INVITE_MIN_MINUTES,
  type FeatureKey,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { hashPassword } from '../lib/password'
import { signAccessToken } from '../lib/jwt'
import { issueRefreshTokenForLogin, type IssuedRefresh } from './refresh-token-service'
import { recordAuditLog } from './audit-log-service'

export class ThirdPartyInviteError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'ThirdPartyInviteError'
  }
}

export function hashThirdPartyInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function newRawToken(): string {
  return randomBytes(32).toString('base64url')
}

function clampDuration(minutes: number): number {
  return Math.min(THIRD_PARTY_INVITE_MAX_MINUTES, Math.max(THIRD_PARTY_INVITE_MIN_MINUTES, minutes))
}

export async function createThirdPartyInvite(
  createdById: string,
  expiresInMinutes: number,
  enabledFeatures: FeatureKey[],
  sectorId: string,
) {
  const sector = await prisma.sector.findUniqueOrThrow({ where: { id: sectorId } })
  const duration = clampDuration(Math.floor(expiresInMinutes))
  const rawToken = newRawToken()
  const expiresAt = new Date(Date.now() + duration * 60_000)
  const invite = await scopedPrisma(sector.companyId).thirdPartyInvite.create({
    data: {
      tokenHash: hashThirdPartyInviteToken(rawToken),
      createdById,
      enabledFeatures,
      sectorId,
      expiresAt,
    },
  })
  await recordAuditLog({ actorId: createdById, entityType: 'ThirdPartyInvite', entityId: invite.id, action: 'CREATE', after: invite, companyId: sector.companyId })
  return { invite, rawToken }
}

export async function listThirdPartyInvites(companyId: string) {
  return scopedPrisma(companyId).thirdPartyInvite.findMany({ orderBy: { createdAt: 'desc' } })
}

export async function revokeThirdPartyInvite(id: string, actorId: string, companyId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const before = await db.thirdPartyInvite.findUnique({ where: { id } })
  if (!before || before.usedAt || before.revokedAt) return
  const after = await db.thirdPartyInvite.update({ where: { id }, data: { revokedAt: new Date() } })
  await recordAuditLog({ actorId, entityType: 'ThirdPartyInvite', entityId: id, action: 'UPDATE', before, after, companyId })
}

export async function deleteThirdPartyInvite(id: string, actorId: string, companyId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const invite = await db.thirdPartyInvite.findUnique({ where: { id } })
  if (!invite) throw new ThirdPartyInviteError('Convite não encontrado', 404)
  await db.thirdPartyInvite.delete({ where: { id } })
  await recordAuditLog({ actorId, entityType: 'ThirdPartyInvite', entityId: id, action: 'DELETE', before: invite, companyId })
}

export async function getValidThirdPartyInvite(rawToken: string) {
  const invite = await prisma.thirdPartyInvite.findUnique({
    where: { tokenHash: hashThirdPartyInviteToken(rawToken) },
    include: { createdBy: { select: { name: true } } },
  })
  if (!invite || invite.usedAt || invite.revokedAt || invite.expiresAt.getTime() <= Date.now()) {
    throw new ThirdPartyInviteError('Convite expirado ou inválido', 404)
  }
  return invite
}

export interface AcceptedThirdParty {
  accessToken: string
  user: User
  refresh: IssuedRefresh
}

export async function acceptThirdPartyInvite(
  app: FastifyInstance,
  input: { token: string; name: string; email: string; password: string },
): Promise<AcceptedThirdParty> {
  const invite = await getValidThirdPartyInvite(input.token)
  const existing = await prisma.user.findUnique({ where: { email: input.email } })
  if (existing) {
    throw new ThirdPartyInviteError('E-mail já cadastrado', 409)
  }

  const passwordHash = await hashPassword(input.password)
  const user = await prisma.$transaction(async (tx) => {
    let created: User
    try {
      created = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          role: 'THIRD_PARTY',
          enabledFeatures: invite.enabledFeatures as FeatureKey[],
          sectorId: invite.sectorId,
          companyId: invite.companyId,
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ThirdPartyInviteError('E-mail já cadastrado', 409)
      }
      throw err
    }
    const claimed = await tx.thirdPartyInvite.updateMany({
      where: { id: invite.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    })
    if (claimed.count !== 1) {
      throw new ThirdPartyInviteError('Convite inválido ou revogado', 404)
    }
    return created
  })

  const accessToken = signAccessToken(app, user)
  const refresh = await issueRefreshTokenForLogin(user.id, false)
  return { accessToken, user, refresh }
}
