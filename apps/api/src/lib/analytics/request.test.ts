import type { FastifyRequest } from 'fastify'
import { describe, expect, it } from 'vitest'
import { analyticsContextFrom } from './request'

const asRequest = (user: unknown) => ({ user }) as FastifyRequest

describe('analyticsContextFrom', () => {
  it('lê empresa, setor, pessoa e papel do JWT', () => {
    expect(
      analyticsContextFrom(
        asRequest({ sub: 'user-1', role: 'ADMIN', sectorId: 'sector-1', companyId: 'company-acme' }),
      ),
    ).toEqual({ userId: 'user-1', role: 'ADMIN', sectorId: 'sector-1', companyId: 'company-acme' })
  })

  it('devolve tudo nulo em rota pública, sem quebrar', () => {
    expect(analyticsContextFrom(asRequest(undefined))).toEqual({
      userId: null,
      companyId: null,
      sectorId: null,
      role: null,
    })
  })

  // Convidado do escritório é assinado com `sectorId: ''` — string vazia é
  // ausência, não um setor chamado "".
  it('trata string vazia como ausência', () => {
    const context = analyticsContextFrom(
      asRequest({ sub: 'guest-1', role: 'GUEST', sectorId: '', companyId: 'company-acme' }),
    )
    expect(context.sectorId).toBeNull()
    expect(context.companyId).toBe('company-acme')
  })
})
