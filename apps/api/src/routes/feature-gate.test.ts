import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function makeThirdParty(app: ReturnType<typeof buildApp>, enabledFeatures: string[]) {
  const user = await prisma.user.create({
    data: {
      name: 'Terceirizado',
      email: `terceirizado-${Date.now()}-${Math.random()}@x.com`,
      passwordHash: 'x',
      role: 'THIRD_PARTY',
      enabledFeatures,
    },
  })
  return app.jwt.sign({ sub: user.id, role: 'THIRD_PARTY', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: enabledFeatures })
}

describe('gate de features para terceirizados', () => {
  it('bloqueia rotas de features não liberadas e libera as habilitadas', async () => {
    const app = buildApp()
    await app.ready()

    const noneToken = await makeThirdParty(app, [])
    const votarToken = await makeThirdParty(app, ['votar'])
    const selosToken = await makeThirdParty(app, ['selos'])
    const destaquesToken = await makeThirdParty(app, ['destaques'])
    const notifToken = await makeThirdParty(app, ['notificacoes'])
    const resenhaToken = await makeThirdParty(app, ['resenha'])
    const devToken = await makeThirdParty(app, ['quinta-desenvolvimento'])
    const retroToken = await makeThirdParty(app, ['retrospectivas'])
    const coinsToken = await makeThirdParty(app, ['coins'])

    const votesBlocked = await app.inject({
      method: 'GET',
      url: '/votes/me',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(votesBlocked.statusCode).toBe(403)
    const votesAllowed = await app.inject({
      method: 'GET',
      url: '/votes/me',
      headers: { authorization: `Bearer ${votarToken}` },
    })
    expect(votesAllowed.statusCode).toBe(200)

    const badgesBlocked = await app.inject({
      method: 'GET',
      url: '/badges',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(badgesBlocked.statusCode).toBe(403)
    const badgesAllowed = await app.inject({
      method: 'GET',
      url: '/badges',
      headers: { authorization: `Bearer ${selosToken}` },
    })
    expect(badgesAllowed.statusCode).toBe(200)

    const highlightsBlocked = await app.inject({
      method: 'GET',
      url: '/highlights',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(highlightsBlocked.statusCode).toBe(403)
    const highlightsAllowed = await app.inject({
      method: 'GET',
      url: '/highlights',
      headers: { authorization: `Bearer ${destaquesToken}` },
    })
    expect(highlightsAllowed.statusCode).toBe(200)

    const notifBlocked = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(notifBlocked.statusCode).toBe(403)
    const notifAllowed = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: `Bearer ${notifToken}` },
    })
    expect(notifAllowed.statusCode).toBe(200)

    const reviewsBlocked = await app.inject({
      method: 'GET',
      url: '/reviews',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(reviewsBlocked.statusCode).toBe(403)
    const reviewsAllowed = await app.inject({
      method: 'GET',
      url: '/reviews',
      headers: { authorization: `Bearer ${resenhaToken}` },
    })
    expect(reviewsAllowed.statusCode).toBe(200)

    const devBlocked = await app.inject({
      method: 'GET',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(devBlocked.statusCode).toBe(403)
    const devAllowed = await app.inject({
      method: 'GET',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${devToken}` },
    })
    expect(devAllowed.statusCode).toBe(200)

    const coinsBlocked = await app.inject({
      method: 'GET',
      url: '/me/coins',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(coinsBlocked.statusCode).toBe(403)
    const coinsAllowed = await app.inject({
      method: 'GET',
      url: '/me/coins',
      headers: { authorization: `Bearer ${coinsToken}` },
    })
    expect(coinsAllowed.statusCode).toBe(200)

    const retroBlocked = await app.inject({
      method: 'GET',
      url: '/retro/rooms',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(retroBlocked.statusCode).toBe(403)
    const retroAllowed = await app.inject({
      method: 'GET',
      url: '/retro/rooms',
      headers: { authorization: `Bearer ${retroToken}` },
    })
    expect(retroAllowed.statusCode).toBe(200)

    const lendasToken = await makeThirdParty(app, ['lendas'])

    const showcaseBlocked = await app.inject({
      method: 'GET',
      url: '/users/showcase',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(showcaseBlocked.statusCode).toBe(403)
    const showcaseAllowed = await app.inject({
      method: 'GET',
      url: '/users/showcase',
      headers: { authorization: `Bearer ${lendasToken}` },
    })
    expect(showcaseAllowed.statusCode).toBe(200)

    await app.close()
  })
})
