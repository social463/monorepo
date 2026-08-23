import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { createEmptyMapDocumentV1, DEFAULT_COMPANY_ID } from '@legends/shared'
import { Prisma } from '@prisma/client'

async function seedActiveMap() {
  const document = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
  const map = await prisma.officeMap.create({ data: { name: 'Mapa de teste', companyId: DEFAULT_COMPANY_ID } })
  const publication = await prisma.officeMapPublication.create({
    data: { mapId: map.id, version: 1, schemaVersion: document.schemaVersion, mapData: document as unknown as Prisma.InputJsonValue, companyId: DEFAULT_COMPANY_ID },
  })
  await prisma.officeSetting.create({ data: { companyId: DEFAULT_COMPANY_ID, activeMapPublicationId: publication.id } })
}

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

describe('gate da feature escritorio', () => {
  it('bloqueia /office/map e /office/config sem a feature, libera com ela', async () => {
    await seedActiveMap()
    const app = buildApp()
    await app.ready()
    const noneToken = await makeThirdParty(app, [])
    const officeToken = await makeThirdParty(app, ['escritorio'])

    const blocked = await app.inject({
      method: 'GET',
      url: '/office/map',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(blocked.statusCode).toBe(403)

    const allowed = await app.inject({
      method: 'GET',
      url: '/office/map',
      headers: { authorization: `Bearer ${officeToken}` },
    })
    expect(allowed.statusCode).toBe(200)

    const configBlocked = await app.inject({
      method: 'GET',
      url: '/office/config',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(configBlocked.statusCode).toBe(403)

    await app.close()
  })
})
