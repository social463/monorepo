import { describe, expect, it, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { OFFICE_GUEST_CHARACTER_PRESETS, DEFAULT_COMPANY_ID, createEmptyMapDocumentV1 } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

beforeEach(async () => {
  const document = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
  const map = await prisma.officeMap.create({ data: { name: 'Mapa de teste', companyId: DEFAULT_COMPANY_ID } })
  const publication = await prisma.officeMapPublication.create({
    data: {
      mapId: map.id,
      version: 1,
      schemaVersion: document.schemaVersion,
      mapData: document as unknown as Prisma.InputJsonValue,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  await prisma.officeSetting.create({ data: { companyId: DEFAULT_COMPANY_ID, activeMapPublicationId: publication.id } })
})

async function makeToken(app: ReturnType<typeof buildApp>, role: 'ADMIN' | 'LEGEND') {
  const user = await prisma.user.create({
    data: { name: role, email: `${role.toLowerCase()}-${Date.now()}@x.com`, passwordHash: 'x', role },
  })
  return app.jwt.sign({ sub: user.id, role, sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
}

describe('office guest invites', () => {
  it('permite apenas admin criar convite e convidado entrar com preset temporário', async () => {
    const app = buildApp()
    await app.ready()
    const adminToken = await makeToken(app, 'ADMIN')
    const legendToken = await makeToken(app, 'LEGEND')

    const forbidden = await app.inject({
      method: 'POST',
      url: '/admin/office-guest-invites',
      headers: { authorization: `Bearer ${legendToken}` },
      payload: { expiresInMinutes: 60 },
    })
    expect(forbidden.statusCode).toBe(403)

    const created = await app.inject({
      method: 'POST',
      url: '/admin/office-guest-invites',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { expiresInMinutes: 60 },
    })
    expect(created.statusCode).toBe(201)
    const url = new URL(created.json().invite.url)
    const rawInviteToken = url.pathname.split('/').at(-1)!

    const publicInvite = await app.inject({ method: 'GET', url: `/office/guest-invites/${rawInviteToken}` })
    expect(publicInvite.statusCode).toBe(200)
    expect(publicInvite.json().presets).toHaveLength(OFFICE_GUEST_CHARACTER_PRESETS.length)

    const session = await app.inject({
      method: 'POST',
      url: '/office/guest-session',
      payload: { token: rawInviteToken, name: 'Visitante', presetId: OFFICE_GUEST_CHARACTER_PRESETS[0].id },
    })
    expect(session.statusCode).toBe(200)
    expect(session.json().guest).toMatchObject({ name: 'Visitante', presetId: OFFICE_GUEST_CHARACTER_PRESETS[0].id })

    const map = await app.inject({
      method: 'GET',
      url: '/office/guest-map',
      headers: { authorization: `Bearer ${session.json().token}` },
    })
    expect(map.statusCode).toBe(200)
    expect(map.json().map.name).toBe('Mapa de teste')

    await app.close()
  })

  it('convite de uma empresa dá acesso ao mapa daquela empresa, não à de outra', async () => {
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Guest', slug: 'outra-empresa-guest-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Guest', slug: 'setor-outra-empresa-guest-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherAdmin = await prisma.user.create({
      data: { name: 'AdminOutraEmpresaGuest', email: 'admin-outra-empresa-guest@x.com', passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id, sectorId: otherSector.id },
    })
    const otherDocument = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    const otherMap = await prisma.officeMap.create({ data: { name: 'Mapa de outra empresa', companyId: otherCompany.id } })
    const otherPublication = await prisma.officeMapPublication.create({
      data: {
        mapId: otherMap.id, version: 1, schemaVersion: otherDocument.schemaVersion,
        mapData: otherDocument as unknown as Prisma.InputJsonValue, companyId: otherCompany.id,
      },
    })
    await prisma.officeSetting.create({ data: { companyId: otherCompany.id, activeMapPublicationId: otherPublication.id } })

    const otherAdminToken = app.jwt.sign({ sub: otherAdmin.id, role: 'ADMIN', sectorId: otherSector.id, companyId: otherCompany.id, features: [] })
    const created = await app.inject({
      method: 'POST',
      url: '/admin/office-guest-invites',
      headers: { authorization: `Bearer ${otherAdminToken}` },
      payload: { expiresInMinutes: 60 },
    })
    expect(created.statusCode).toBe(201)
    const url = new URL(created.json().invite.url)
    const rawInviteToken = url.pathname.split('/').at(-1)!

    const session = await app.inject({
      method: 'POST',
      url: '/office/guest-session',
      payload: { token: rawInviteToken, name: 'Visitante', presetId: OFFICE_GUEST_CHARACTER_PRESETS[0].id },
    })
    expect(session.statusCode).toBe(200)

    const map = await app.inject({
      method: 'GET',
      url: '/office/guest-map',
      headers: { authorization: `Bearer ${session.json().token}` },
    })
    expect(map.statusCode).toBe(200)
    expect(map.json().map.name).toBe('Mapa de outra empresa')
    expect(map.json().map.name).not.toBe('Mapa de teste')

    await app.close()
  })
})
