import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function makeToken(app: ReturnType<typeof buildApp>, role: 'ADMIN' | 'LEGEND') {
  const user = await prisma.user.create({
    data: { name: role, email: `${role.toLowerCase()}-${Date.now()}@x.com`, passwordHash: 'x', role },
  })
  return app.jwt.sign({ sub: user.id, role, sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
}

async function subadminToken(app: ReturnType<typeof buildApp>, sectorId: string) {
  const email = `subadmin-${sectorId}@empresa.com`
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Subadmin', email, password: 'changeme123' } })
  await prisma.user.update({ where: { email }, data: { role: 'SUBADMIN', sectorId } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

describe('third-party invites', () => {
  it('admin cria convite, terceirizado consulta e aceita; só admin pode criar', async () => {
    const app = buildApp()
    await app.ready()
    const adminToken = await makeToken(app, 'ADMIN')
    const legendToken = await makeToken(app, 'LEGEND')

    const forbidden = await app.inject({
      method: 'POST',
      url: '/admin/third-party-invites',
      headers: { authorization: `Bearer ${legendToken}` },
      payload: { expiresInMinutes: 120, enabledFeatures: ['escritorio'] },
    })
    expect(forbidden.statusCode).toBe(403)

    const created = await app.inject({
      method: 'POST',
      url: '/admin/third-party-invites',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { expiresInMinutes: 120, enabledFeatures: ['escritorio', 'time'] },
    })
    expect(created.statusCode).toBe(201)
    const url = new URL(created.json().invite.url)
    const rawToken = url.pathname.split('/').at(-1)!

    const publicInvite = await app.inject({ method: 'GET', url: `/third-party-invites/${rawToken}` })
    expect(publicInvite.statusCode).toBe(200)
    expect(publicInvite.json()).not.toHaveProperty('enabledFeatures')

    const accepted = await app.inject({
      method: 'POST',
      url: `/third-party-invites/${rawToken}/accept`,
      payload: { name: 'Fulano', email: `fulano-${Date.now()}@x.com`, password: 'senha1234' },
    })
    expect(accepted.statusCode).toBe(201)
    expect(accepted.json().user.role).toBe('THIRD_PARTY')
    expect(accepted.json().user.enabledFeatures).toEqual(['escritorio', 'time'])

    const reused = await app.inject({
      method: 'POST',
      url: `/third-party-invites/${rawToken}/accept`,
      payload: { name: 'Outro', email: `outro-${Date.now()}@x.com`, password: 'senha1234' },
    })
    expect(reused.statusCode).toBe(404)

    const list = await app.inject({
      method: 'GET',
      url: '/admin/third-party-invites',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().invites.length).toBeGreaterThan(0)

    await app.close()
  })

  it('admin revoga um convite pendente e o accept passa a falhar', async () => {
    const app = buildApp()
    await app.ready()
    const adminToken = await makeToken(app, 'ADMIN')

    const created = await app.inject({
      method: 'POST',
      url: '/admin/third-party-invites',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { expiresInMinutes: 120, enabledFeatures: ['escritorio'] },
    })
    const url = new URL(created.json().invite.url)
    const rawToken = url.pathname.split('/').at(-1)!
    const inviteId = created.json().invite.id

    const revoked = await app.inject({
      method: 'POST',
      url: `/admin/third-party-invites/${inviteId}/revoke`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(revoked.statusCode).toBe(204)

    const publicInvite = await app.inject({ method: 'GET', url: `/third-party-invites/${rawToken}` })
    expect(publicInvite.statusCode).toBe(404)

    const accepted = await app.inject({
      method: 'POST',
      url: `/third-party-invites/${rawToken}/accept`,
      payload: { name: 'Fulano', email: `revogado-${Date.now()}@x.com`, password: 'senha1234' },
    })
    expect(accepted.statusCode).toBe(404)

    await app.close()
  })

  it('admin consegue excluir um convite independente do status (evita poluir a lista)', async () => {
    const app = buildApp()
    await app.ready()
    const adminToken = await makeToken(app, 'ADMIN')

    const created = await app.inject({
      method: 'POST',
      url: '/admin/third-party-invites',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { expiresInMinutes: 120, enabledFeatures: ['escritorio'] },
    })
    const inviteId = created.json().invite.id

    const deletePending = await app.inject({
      method: 'DELETE',
      url: `/admin/third-party-invites/${inviteId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(deletePending.statusCode).toBe(204)

    const list = await app.inject({
      method: 'GET',
      url: '/admin/third-party-invites',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(list.json().invites.map((i: { id: string }) => i.id)).not.toContain(inviteId)

    const deleteAgain = await app.inject({
      method: 'DELETE',
      url: `/admin/third-party-invites/${inviteId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(deleteAgain.statusCode).toBe(404)

    await app.close()
  })

  it('Subadmin só vê/cria convites do próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Convite', slug: 'setor-a-convite', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Convite', slug: 'setor-b-convite', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const adminB = await prisma.user.create({ data: { name: 'AdminB', email: 'adminb-convite@x.com', passwordHash: 'x', role: 'ADMIN', sectorId: sectorB.id } })
    await prisma.thirdPartyInvite.create({ data: { tokenHash: 'hash-b', createdById: adminB.id, sectorId: sectorB.id, expiresAt: new Date(Date.now() + 3600_000) } })

    const list = await app.inject({ method: 'GET', url: '/admin/third-party-invites', headers: { authorization: `Bearer ${token}` } })
    expect(list.json().invites).toHaveLength(0)

    const created = await app.inject({
      method: 'POST', url: '/admin/third-party-invites',
      headers: { authorization: `Bearer ${token}` },
      payload: { expiresInMinutes: 60, enabledFeatures: ['escritorio'] },
    })
    expect(created.statusCode).toBe(201)
    await app.close()
  })

  it('ADMIN de uma empresa não revoga nem apaga convite de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const adminTokenDefault = await makeToken(app, 'ADMIN')

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Invite Rota', slug: 'outra-empresa-invite-rota-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Invite Rota', slug: 'setor-outra-empresa-invite-rota-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherAdmin = await prisma.user.create({ data: { name: 'Admin Outra Invite', email: `admin-outra-invite-rota-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id, sectorId: otherSector.id } })
    const otherInvite = await prisma.thirdPartyInvite.create({
      data: { tokenHash: 'hash-outra-empresa-invite-rota', createdById: otherAdmin.id, enabledFeatures: [], sectorId: otherSector.id, companyId: otherCompany.id, expiresAt: new Date(Date.now() + 3600_000) },
    })

    const revoke = await app.inject({
      method: 'POST',
      url: `/admin/third-party-invites/${otherInvite.id}/revoke`,
      headers: { authorization: `Bearer ${adminTokenDefault}` },
    })
    expect(revoke.statusCode).toBe(204) // no-op silencioso: convite não existe no escopo do ator

    const stillPending = await prisma.thirdPartyInvite.findUniqueOrThrow({ where: { id: otherInvite.id } })
    expect(stillPending.revokedAt).toBeNull()

    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/third-party-invites/${otherInvite.id}`,
      headers: { authorization: `Bearer ${adminTokenDefault}` },
    })
    expect(del.statusCode).toBe(404)

    await app.close()
  })

  it('ADMIN de uma empresa não-padrão cria convite na própria empresa (não na empresa default)', async () => {
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Convite Admin', slug: 'outra-empresa-convite-admin-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Convite Admin', slug: 'setor-outra-empresa-convite-admin-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherAdmin = await prisma.user.create({
      data: { name: 'Admin Outra Convite', email: `admin-outra-convite-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id, sectorId: otherSector.id },
    })
    const token = app.jwt.sign({ sub: otherAdmin.id, role: 'ADMIN', sectorId: otherSector.id, companyId: otherCompany.id, features: [] })

    const created = await app.inject({
      method: 'POST',
      url: '/admin/third-party-invites',
      headers: { authorization: `Bearer ${token}` },
      payload: { expiresInMinutes: 60, enabledFeatures: ['escritorio'] },
    })
    expect(created.statusCode).toBe(201)

    const invite = await prisma.thirdPartyInvite.findUniqueOrThrow({ where: { id: created.json().invite.id } })
    expect(invite.companyId).toBe(otherCompany.id)
    expect(invite.sectorId).toBe(otherSector.id)

    // O próprio admin deve ver o convite que criou na sua listagem.
    const list = await app.inject({ method: 'GET', url: '/admin/third-party-invites', headers: { authorization: `Bearer ${token}` } })
    expect(list.json().invites.map((i: { id: string }) => i.id)).toContain(invite.id)

    await app.close()
  })
})
