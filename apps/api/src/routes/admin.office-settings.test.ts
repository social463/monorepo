import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function makeUser(app: ReturnType<typeof buildApp>, role: 'ADMIN' | 'LEGEND') {
  const user = await prisma.user.create({
    data: { name: role, email: `${role.toLowerCase()}@x.com`, passwordHash: 'x', role },
  })
  return app.jwt.sign({ sub: user.id, role, sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
}

describe('/admin/office-settings', () => {
  it('exige admin (401 sem token, 403 para lenda)', async () => {
    const app = buildApp()
    await app.ready()
    expect((await app.inject({ method: 'GET', url: '/admin/office-settings' })).statusCode).toBe(401)
    const legend = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/office-settings',
      headers: { authorization: `Bearer ${legend}` },
      payload: { broadcastEnabled: true },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('admin liga, o GET reflete e persiste', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const before = await app.inject({
      method: 'GET', url: '/admin/office-settings', headers: { authorization: `Bearer ${admin}` },
    })
    expect(before.json()).toEqual({ broadcastEnabled: false, activeMapPublicationId: null })

    const patch = await app.inject({
      method: 'PATCH',
      url: '/admin/office-settings',
      headers: { authorization: `Bearer ${admin}` },
      payload: { broadcastEnabled: true },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json()).toEqual({ broadcastEnabled: true, activeMapPublicationId: null })

    const after = await app.inject({
      method: 'GET', url: '/admin/office-settings', headers: { authorization: `Bearer ${admin}` },
    })
    expect(after.json()).toEqual({ broadcastEnabled: true, activeMapPublicationId: null })
    await app.close()
  })

  it('400 com body inválido', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/office-settings',
      headers: { authorization: `Bearer ${admin}` },
      payload: { broadcastEnabled: 'sim' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
