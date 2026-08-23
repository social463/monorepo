import type { FastifyInstance } from 'fastify'
import type { User } from '@prisma/client'

export interface AccessTokenPayload {
  sub: string
  role: string
  sectorId: string
  companyId: string
  features: string[]
  /**
   * Acesso administrativo delegado. Viaja no token como `role` e `features`:
   * ligar ou desligar o switch vale no próximo refresh (≤ 15 min) ou no próximo
   * login. Ver `docs/superpowers/specs/2026-08-15-acesso-admin-delegado-design.md`.
   */
  adminAccess: boolean
}

/**
 * `sectorFeatures` são as features do SETOR do usuário — ignoradas para
 * THIRD_PARTY, que continua com sua allowlist individual (enabledFeatures do
 * próprio convite), sector-agnostic.
 */
export function signAccessToken(app: FastifyInstance, user: User, sectorFeatures: string[] = []): string {
  const features =
    user.role === 'THIRD_PARTY'
      ? Array.isArray(user.enabledFeatures)
        ? (user.enabledFeatures as string[])
        : []
      : sectorFeatures
  const payload: AccessTokenPayload = {
    sub: user.id,
    role: user.role,
    sectorId: user.sectorId,
    companyId: user.companyId,
    features,
    adminAccess: user.adminAccess === true,
  }
  return app.jwt.sign(payload)
}
