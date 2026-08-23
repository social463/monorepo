import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import {
  issueRefreshTokenForLogin,
  rotateRefreshToken,
  revokeByRawToken,
  revokeAllForUser,
  RefreshError,
} from './refresh-token-service'

async function makeUser() {
  return prisma.user.create({
    data: { name: 'Dev', email: 'dev@example.com', passwordHash: 'x' },
  })
}

describe('refresh-token-service', () => {
  it('emite um refresh persistido como hash, nunca em claro', async () => {
    const user = await makeUser()
    const { rawToken } = await issueRefreshTokenForLogin(user.id, true)
    const stored = await prisma.refreshToken.findFirst({ where: { userId: user.id } })
    expect(stored).not.toBeNull()
    expect(stored!.tokenHash).not.toBe(rawToken)
    expect(stored!.persistent).toBe(true)
  })

  it('rotaciona: emite novo token e revoga o anterior na mesma família', async () => {
    const user = await makeUser()
    const { rawToken } = await issueRefreshTokenForLogin(user.id, false)
    const result = await rotateRefreshToken(rawToken)
    expect(result.rawToken).not.toBe(rawToken)

    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } })
    expect(tokens).toHaveLength(2)
    const old = tokens.find((t) => t.replacedBy !== null)!
    const next = tokens.find((t) => t.replacedBy === null)!
    expect(old.revokedAt).not.toBeNull()
    expect(old.replacedBy).toBe(next.id)
    expect(next.familyId).toBe(old.familyId)
    expect(next.persistent).toBe(false)
  })

  it('detecta reúso de um token revogado há muito tempo (fora da janela de graça) e derruba a família', async () => {
    const user = await makeUser()
    const { rawToken } = await issueRefreshTokenForLogin(user.id, true)
    await rotateRefreshToken(rawToken) // rawToken agora está revogado

    // Simula que a revogação aconteceu bem antes da janela de graça (corrida
    // legítima entre abas vs. replay de um token antigo roubado).
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    })

    await expect(rotateRefreshToken(rawToken)).rejects.toBeInstanceOf(RefreshError)

    const active = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    })
    expect(active).toBe(0)
  })

  it('reúso dentro da janela de graça (corrida entre abas) reemite a partir do token ativo, sem derrubar a família', async () => {
    const user = await makeUser()
    const { rawToken } = await issueRefreshTokenForLogin(user.id, true)
    const first = await rotateRefreshToken(rawToken) // rawToken agora está revogado, first.rawToken é o ativo

    // Uma segunda aba, que ainda tinha o cookie antigo em mãos, tenta rotacionar
    // o mesmo rawToken logo em seguida (corrida, não roubo).
    const second = await rotateRefreshToken(rawToken)

    expect(second.rawToken).not.toBe(rawToken)
    expect(second.rawToken).not.toBe(first.rawToken)

    const active = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    })
    expect(active).toBe(1)
  })

  it('rejeita token inexistente', async () => {
    await expect(rotateRefreshToken('nao-existe')).rejects.toBeInstanceOf(RefreshError)
  })

  it('rejeita token expirado', async () => {
    const user = await makeUser()
    const { rawToken } = await issueRefreshTokenForLogin(user.id, false)
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    await expect(rotateRefreshToken(rawToken)).rejects.toBeInstanceOf(RefreshError)
  })

  it('logout revoga a família a partir do token apresentado', async () => {
    const user = await makeUser()
    const { rawToken } = await issueRefreshTokenForLogin(user.id, false)
    await revokeByRawToken(rawToken)
    const active = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    })
    expect(active).toBe(0)
  })
})

describe('revokeAllForUser', () => {
  it('revoga todos os refresh tokens ativos do usuário', async () => {
    const user = await prisma.user.create({
      data: { name: 'Teste', email: `revoke-${Date.now()}@x.com`, passwordHash: 'x' },
    })
    await issueRefreshTokenForLogin(user.id, false)
    await issueRefreshTokenForLogin(user.id, true)

    await revokeAllForUser(user.id)

    const active = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    })
    expect(active).toBe(0)
  })

  it('não afeta tokens de outros usuários (isolamento por userId)', async () => {
    const ts = Date.now()
    const userA = await prisma.user.create({
      data: { name: 'UserA', email: `revoke-a-${ts}@x.com`, passwordHash: 'x' },
    })
    const userB = await prisma.user.create({
      data: { name: 'UserB', email: `revoke-b-${ts}@x.com`, passwordHash: 'x' },
    })

    await issueRefreshTokenForLogin(userA.id, false)
    await issueRefreshTokenForLogin(userB.id, false)

    await revokeAllForUser(userA.id)

    const activeA = await prisma.refreshToken.count({
      where: { userId: userA.id, revokedAt: null },
    })
    const activeB = await prisma.refreshToken.count({
      where: { userId: userB.id, revokedAt: null },
    })

    expect(activeA).toBe(0)
    expect(activeB).toBe(1)
  })
})
