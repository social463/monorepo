import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { signAccessToken } from './jwt'

describe('signAccessToken', () => {
  it('usa sectorFeatures para papéis normais e a allowlist individual só para THIRD_PARTY', async () => {
    const app = buildApp()
    await app.ready()

    const legend = { id: 'u1', role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', enabledFeatures: ['votar'] } as any
    const legendToken = signAccessToken(app, legend, ['votar', 'selos'])
    const legendPayload = app.jwt.verify(legendToken) as { role: string; features: string[] }
    expect(legendPayload.role).toBe('LEGEND')
    // features do setor, não a allowlist individual (que é só para THIRD_PARTY)
    expect(legendPayload.features).toEqual(['votar', 'selos'])

    const thirdParty = { id: 'u2', role: 'THIRD_PARTY', sectorId: 'sector-dev-produto', companyId: 'company-emr', enabledFeatures: ['escritorio', 'time'] } as any
    const thirdPartyToken = signAccessToken(app, thirdParty, ['votar', 'selos'])
    const thirdPartyPayload = app.jwt.verify(thirdPartyToken) as { role: string; features: string[] }
    expect(thirdPartyPayload.role).toBe('THIRD_PARTY')
    // ignora sectorFeatures — allowlist individual do convite, sector-agnostic
    expect(thirdPartyPayload.features).toEqual(['escritorio', 'time'])

    await app.close()
  })

  it('sem sectorFeatures, papel normal recebe features vazio', async () => {
    const app = buildApp()
    await app.ready()

    const legend = { id: 'u1', role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', enabledFeatures: [] } as any
    const token = signAccessToken(app, legend)
    const payload = app.jwt.verify(token) as { features: string[] }
    expect(payload.features).toEqual([])

    await app.close()
  })

  it('inclui companyId do usuário no payload', async () => {
    const app = buildApp()
    await app.ready()

    const legend = { id: 'u1', role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-b', enabledFeatures: [] } as any
    const token = signAccessToken(app, legend)
    const payload = app.jwt.verify(token) as { companyId: string }
    expect(payload.companyId).toBe('company-b')

    await app.close()
  })
})
