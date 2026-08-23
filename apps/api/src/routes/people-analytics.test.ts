import { describe, it, expect } from 'vitest'
import { DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function tokenFor(
  app: ReturnType<typeof buildApp>,
  email: string,
  patch: Partial<{ role: string; sectorId: string }> = {},
) {
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: email, email, password: 'changeme123' } })
  if (Object.keys(patch).length > 0) {
    await prisma.user.update({ where: { email }, data: patch as { role: 'ADMIN' } })
  }
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

describe('POST /access-logs', () => {
  it('grava o acesso do usuário autenticado e responde 204', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'lenda@empresa.com')

    const res = await app.inject({
      method: 'POST',
      url: '/access-logs',
      headers: auth(token),
      payload: { path: '/mural?filtro=todos' },
    })

    expect(res.statusCode).toBe(204)
    const logs = await prisma.accessLog.findMany()
    expect(logs).toHaveLength(1)
    // Query string descartada e path normalizado antes de gravar.
    expect(logs[0].path).toBe('/mural')
    await app.close()
  })

  it('exige autenticação (401)', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/access-logs', payload: { path: '/mural' } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('rejeita corpo inválido com 400 + issues', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'lenda@empresa.com')
    const res = await app.inject({ method: 'POST', url: '/access-logs', headers: auth(token), payload: { path: '' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().issues).toBeDefined()
    await app.close()
  })
})

describe('GET /admin/people/overview', () => {
  it('responde 403 para LEGEND, LEAD e MANAGER', async () => {
    const app = buildApp()
    await app.ready()
    for (const role of ['LEGEND', 'LEAD', 'MANAGER']) {
      const token = await tokenFor(app, `${role.toLowerCase()}@empresa.com`, { role })
      const res = await app.inject({ method: 'GET', url: '/admin/people/overview', headers: auth(token) })
      expect(res.statusCode, role).toBe(403)
    }
    await app.close()
  })

  it('responde 200 para ADMIN e para SUBADMIN', async () => {
    const app = buildApp()
    await app.ready()
    // People Analytics é área de G&G: o SUBADMIN só entra pelo setor com a
    // feature ligada — o ADMIN global passa em qualquer setor.
    const gente = await prisma.sector.create({
      data: { name: 'Gente e Gestão', slug: 'gente-overview-200', enabledFeatures: ['gente-gestao'] },
    })
    for (const role of ['ADMIN', 'SUBADMIN']) {
      const token = await tokenFor(app, `${role.toLowerCase()}@empresa.com`, {
        role,
        ...(role === 'SUBADMIN' ? { sectorId: gente.id } : {}),
      })
      const res = await app.inject({ method: 'GET', url: '/admin/people/overview', headers: auth(token) })
      expect(res.statusCode, role).toBe(200)
    }
    await app.close()
  })

  it('devolve o contrato do DTO com range padrão de 30 dias', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'admin@empresa.com', { role: 'ADMIN' })

    const res = await app.inject({ method: 'GET', url: '/admin/people/overview', headers: auth(token) })
    const { overview } = res.json()

    expect(overview.range).toBe('30d')
    expect(overview.sectorId).toBeNull()
    expect(overview.accessSeries).toHaveLength(30)
    expect(overview).toMatchObject({
      activePeople: expect.any(Number),
      uniqueUsers7d: expect.any(Number),
      uniqueUsers30d: expect.any(Number),
      adoptionRate: expect.any(Number),
      feedbacksCount: expect.any(Number),
      feedbackReactionsCount: expect.any(Number),
      byRole: expect.any(Array),
      bySquad: expect.any(Array),
    })
    await app.close()
  })

  it('respeita o range da query e rejeita um range desconhecido', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'admin@empresa.com', { role: 'ADMIN' })

    const ok = await app.inject({ method: 'GET', url: '/admin/people/overview?range=7d', headers: auth(token) })
    expect(ok.json().overview.accessSeries).toHaveLength(7)

    const bad = await app.inject({ method: 'GET', url: '/admin/people/overview?range=1y', headers: auth(token) })
    expect(bad.statusCode).toBe(400)
    await app.close()
  })

  it('SUBADMIN só enxerga o próprio setor, mesmo passando sectorId de outro', async () => {
    const app = buildApp()
    await app.ready()
    const gente = await prisma.sector.create({
      data: { id: 'sector-gente', name: 'Gente e Gestão', slug: 'gente', enabledFeatures: ['gente-gestao'] },
    })
    const token = await tokenFor(app, 'sub@empresa.com', { role: 'SUBADMIN', sectorId: gente.id })
    // Uma lenda em cada setor: se o escopo vazasse, activePeople contaria as duas.
    await prisma.user.create({
      data: { name: 'Gina', email: 'gina@x.com', passwordHash: 'x', sectorId: gente.id },
    })
    await prisma.user.create({
      data: { name: 'Dev', email: 'dev@x.com', passwordHash: 'x', sectorId: DEFAULT_SECTOR_ID },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/admin/people/overview?sectorId=${DEFAULT_SECTOR_ID}`,
      headers: auth(token),
    })
    const { overview } = res.json()

    // O sectorId da query é ignorado: vale o do token.
    expect(overview.sectorId).toBe(gente.id)
    // Gina + o próprio subadmin (que também é do setor Gente).
    expect(overview.activePeople).toBe(2)
    await app.close()
  })

  it('ADMIN filtra pelo setor que escolher', async () => {
    const app = buildApp()
    await app.ready()
    const gente = await prisma.sector.create({
      data: { id: 'sector-gente', name: 'Gente e Gestão', slug: 'gente', enabledFeatures: ['gente-gestao'] },
    })
    const token = await tokenFor(app, 'admin@empresa.com', { role: 'ADMIN' })
    await prisma.user.create({ data: { name: 'Gina', email: 'gina@x.com', passwordHash: 'x', sectorId: gente.id } })

    const res = await app.inject({
      method: 'GET',
      url: `/admin/people/overview?sectorId=${gente.id}`,
      headers: auth(token),
    })
    expect(res.json().overview.sectorId).toBe(gente.id)
    expect(res.json().overview.activePeople).toBe(1)
    await app.close()
  })
})

describe('GET /admin/people/engagement', () => {
  it('responde 403 para LEGEND e 200 para ADMIN, com o contrato do DTO', async () => {
    const app = buildApp()
    await app.ready()
    const lenda = await tokenFor(app, 'lenda@empresa.com')
    const negado = await app.inject({ method: 'GET', url: '/admin/people/engagement', headers: auth(lenda) })
    expect(negado.statusCode).toBe(403)

    const token = await tokenFor(app, 'admin@empresa.com', { role: 'ADMIN' })
    const res = await app.inject({ method: 'GET', url: '/admin/people/engagement?range=90d', headers: auth(token) })
    const { engagement } = res.json()

    expect(res.statusCode).toBe(200)
    expect(engagement.range).toBe('90d')
    expect(engagement.mood).toMatchObject({ entries: 0, participants: 0, average: null })
    expect(engagement.mood.distribution).toHaveLength(5)
    expect(engagement.muralReach).toMatchObject({ postCount: 0, uniqueViewers: 0, posts: [] })
    expect(engagement.topScreens).toEqual([])
    await app.close()
  })

  it('SUBADMIN recebe o engajamento recortado no próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const gente = await prisma.sector.create({
      data: { id: 'sector-gente', name: 'Gente e Gestão', slug: 'gente', enabledFeatures: ['gente-gestao'] },
    })
    const token = await tokenFor(app, 'sub@empresa.com', { role: 'SUBADMIN', sectorId: gente.id })

    const gina = await prisma.user.create({
      data: { name: 'Gina', email: 'gina@x.com', passwordHash: 'x', sectorId: gente.id },
    })
    const dev = await prisma.user.create({
      data: { name: 'Dev', email: 'dev@x.com', passwordHash: 'x', sectorId: DEFAULT_SECTOR_ID },
    })
    await prisma.accessLog.createMany({
      data: [
        { userId: gina.id, path: '/mural' },
        { userId: dev.id, path: '/mural' },
        { userId: dev.id, path: '/mural' },
      ],
    })

    const res = await app.inject({
      method: 'GET',
      url: `/admin/people/engagement?sectorId=${DEFAULT_SECTOR_ID}`,
      headers: auth(token),
    })
    const { engagement } = res.json()

    expect(engagement.sectorId).toBe(gente.id)
    expect(engagement.topScreens).toEqual([
      { path: '/mural', label: 'Feed Corporativo', accesses: 1, uniqueUsers: 1 },
    ])
    expect(engagement.muralReach.uniqueViewers).toBe(1)
    await app.close()
  })
})
