import { randomBytes, createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

const REFRESH_TTL_DAYS = 30

// Duas abas/requisições concorrentes podem rotacionar o mesmo cookie quase ao
// mesmo tempo (ex.: refresh silencioso ao abrir várias abas). A perdedora dessa
// corrida vê o token já revogado pela vencedora. Dentro desta janela, tratamos
// isso como corrida legítima (reemite a partir do token ativo da família) em
// vez de roubo — só fora dela é que revogamos a família inteira.
const REUSE_GRACE_MS = 10_000

/**
 * Aceita o client global ou um client de transação (`prisma.$transaction`),
 * permitindo agrupar revogar + emitir num único commit.
 */
type Db = Prisma.TransactionClient | typeof prisma

export class RefreshError extends Error {}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function newRawToken(): string {
  return randomBytes(32).toString('hex')
}

function expiryFromNow(): Date {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000)
}

export interface IssuedRefresh {
  rawToken: string
  expiresAt: Date
  persistent: boolean
}

interface CreatedToken {
  id: string
  rawToken: string
  expiresAt: Date
}

async function createTokenInFamily(
  userId: string,
  familyId: string,
  persistent: boolean,
  db: Db = prisma,
): Promise<CreatedToken> {
  const rawToken = newRawToken()
  const expiresAt = expiryFromNow()
  const record = await db.refreshToken.create({
    data: { userId, familyId, persistent, tokenHash: hashToken(rawToken), expiresAt },
  })
  return { id: record.id, rawToken, expiresAt }
}

export async function issueRefreshTokenForLogin(
  userId: string,
  persistent: boolean,
  db: Db = prisma,
): Promise<IssuedRefresh> {
  const familyId = randomBytes(16).toString('hex')
  const created = await createTokenInFamily(userId, familyId, persistent, db)
  return { rawToken: created.rawToken, expiresAt: created.expiresAt, persistent }
}

export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function revokeByRawToken(rawToken: string): Promise<void> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  })
  if (existing) await revokeFamily(existing.familyId)
}

export async function revokeAllForUser(userId: string, db: Db = prisma): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export interface RotationResult {
  userId: string
  rawToken: string
  expiresAt: Date
  persistent: boolean
}

interface ActiveRecord {
  id: string
  userId: string
  familyId: string
  persistent: boolean
}

async function rotateActiveRecord(existing: ActiveRecord): Promise<RotationResult> {
  const rawNext = newRawToken()
  const expiresAt = expiryFromNow()

  try {
    await prisma.$transaction(async (tx) => {
      // Revoga o token atual de forma condicional: só vence quem ainda estava
      // ativo. Se 0 linhas mudaram, outra requisição já rotacionou este token
      // (corrida/replay) — abortamos a transação.
      const revoked = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      if (revoked.count !== 1) {
        throw new RefreshError('Token reutilizado')
      }
      const created = await tx.refreshToken.create({
        data: {
          userId: existing.userId,
          familyId: existing.familyId,
          persistent: existing.persistent,
          tokenHash: hashToken(rawNext),
          expiresAt,
        },
      })
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { replacedBy: created.id },
      })
    })
  } catch (err) {
    // Corrida detectada dentro da transação: derruba a família inteira.
    if (err instanceof RefreshError) {
      await revokeFamily(existing.familyId)
    }
    throw err
  }

  return {
    userId: existing.userId,
    rawToken: rawNext,
    expiresAt,
    persistent: existing.persistent,
  }
}

export async function rotateRefreshToken(rawToken: string): Promise<RotationResult> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  })
  if (!existing) throw new RefreshError('Token inválido')

  if (existing.revokedAt) {
    // Token já rotacionado. Se a revogação foi muito recente, é provável que
    // seja uma segunda aba/requisição concorrente perdendo a corrida contra
    // quem rotacionou primeiro — não um replay de token roubado. Nesse caso,
    // reemitimos a partir do token ativo atual da família em vez de derrubá-la.
    const withinGraceWindow = Date.now() - existing.revokedAt.getTime() <= REUSE_GRACE_MS
    const active = withinGraceWindow
      ? await prisma.refreshToken.findFirst({
          where: { familyId: existing.familyId, revokedAt: null },
        })
      : null

    if (active) {
      return rotateActiveRecord(active)
    }

    await revokeFamily(existing.familyId)
    throw new RefreshError('Token reutilizado')
  }
  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new RefreshError('Token expirado')
  }

  return rotateActiveRecord(existing)
}
