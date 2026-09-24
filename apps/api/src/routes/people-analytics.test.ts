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
      // Os dois cards fixos de 7 e 30 dias viraram um só, da JANELA (seção 4.1).
      uniqueUsersInRange: expect.any(Number),
      accessesInRange: expect.any(Number),
      adoptionRate: expect.any(Number),
      feedbacksCount: expect.any(Number),
      feedbackReactionsCount: expect.any(Number),
      postsPublished: expect.any(Number),
      feedbacksByCategory: expect.any(Array),
      feedbacksByTag: expect.any(Array),
      engagementSeries: expect.any(Array),
      byRole: expect.any(Array),
      bySquad: expect.any(Array),
    })
    // A janela efetiva volta na resposta — é dela que sai a legenda dinâmica.
    expect(overview.days).toBe(30)
    expect(overview.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
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

  it('aceita período personalizado e recusa intervalo inválido com mensagem em português', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'admin@empresa.com', { role: 'ADMIN' })

    const ok = await app.inject({
      method: 'GET',
      url: '/admin/people/overview?range=custom&from=2026-06-01&to=2026-06-10',
      headers: auth(token),
    })
    expect(ok.json().overview.days).toBe(10)
    expect(ok.json().overview.from).toBe('2026-06-01')

    const invertido = await app.inject({
      method: 'GET',
      url: '/admin/people/overview?range=custom&from=2026-06-10&to=2026-06-01',
      headers: auth(token),
    })
    expect(invertido.statusCode).toBe(400)
    expect(invertido.json().message).toMatch(/data inicial não pode ser depois/i)

    const semPar = await app.inject({
      method: 'GET',
      url: '/admin/people/overview?range=custom&from=2026-06-01',
      headers: auth(token),
    })
    expect(semPar.statusCode).toBe(400)
    await app.close()
  })

  it('mapa de calor é endpoint próprio e traz o tempo médio derivado', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'admin@empresa.com', { role: 'ADMIN' })

    const res = await app.inject({ method: 'GET', url: '/admin/people/heatmap', headers: auth(token) })

    expect(res.statusCode).toBe(200)
    expect(res.json().heatmap).toMatchObject({
      cells: expect.any(Array),
      sessions: expect.any(Number),
      days: 30,
    })
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

describe('GET /admin/people/inova', () => {
  it('responde 403 para LEGEND e 200 para ADMIN, com o contrato do DTO', async () => {
    const app = buildApp()
    await app.ready()
    const lenda = await tokenFor(app, 'lenda@empresa.com')
    const negado = await app.inject({ method: 'GET', url: '/admin/people/inova', headers: auth(lenda) })
    expect(negado.statusCode).toBe(403)

    const token = await tokenFor(app, 'admin@empresa.com', { role: 'ADMIN' })
    const res = await app.inject({ method: 'GET', url: '/admin/people/inova?range=90d', headers: auth(token) })
    const { inova } = res.json()

    expect(res.statusCode).toBe(200)
    expect(inova.range).toBe('90d')
    expect(inova).toMatchObject({ totalAccesses: 0, uniqueUsers: 0, topPage: null, byPage: [], recentLogs: [], recentLogsTotal: 0 })
    await app.close()
  })

  it('só conta páginas do Guia, com quem acessou no log', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'admin@empresa.com', { role: 'ADMIN' })

    const gina = await prisma.user.create({
      data: { name: 'Gina', email: 'gina@x.com', passwordHash: 'x', sectorId: DEFAULT_SECTOR_ID },
    })
    await prisma.accessLog.createMany({
      data: [
        { userId: gina.id, path: '/comunidade-inova/guia/prompts' },
        { userId: gina.id, path: '/comunidade-inova/guia/prompts' },
        // Fora do Guia: não deve contar.
        { userId: gina.id, path: '/comunidade-inova/projetos' },
      ],
    })

    const res = await app.inject({ method: 'GET', url: '/admin/people/inova', headers: auth(token) })
    const { inova } = res.json()

    expect(inova.totalAccesses).toBe(2)
    expect(inova.uniqueUsers).toBe(1)
    expect(inova.topPage).toEqual({
      path: '/comunidade-inova/guia/prompts',
      label: 'Guia: Prompts',
      accesses: 2,
      uniqueUsers: 1,
    })
    expect(inova.recentLogsTotal).toBe(2)
    expect(inova.recentLogs).toHaveLength(2)
    expect(inova.recentLogs[0]).toMatchObject({
      userName: 'Gina',
      userEmail: 'gina@x.com',
      path: '/comunidade-inova/guia/prompts',
      label: 'Guia: Prompts',
    })
    await app.close()
  })

  it('SUBADMIN recebe os acessos recortados no próprio setor', async () => {
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
        { userId: gina.id, path: '/comunidade-inova/guia' },
        { userId: dev.id, path: '/comunidade-inova/guia' },
      ],
    })

    const res = await app.inject({
      method: 'GET',
      url: `/admin/people/inova?sectorId=${DEFAULT_SECTOR_ID}`,
      headers: auth(token),
    })
    const { inova } = res.json()

    expect(inova.sectorId).toBe(gente.id)
    expect(inova.totalAccesses).toBe(1)
    expect(inova.recentLogs.map((row: { userName: string }) => row.userName)).toEqual(['Gina'])
    await app.close()
  })
})

/** Documento 4, seção 9.5: a trilha de Desenvolvimento & IA. */
describe('GET /admin/people/training', () => {
  it('responde 403 para quem não é do bloco de Gente e Gestão', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'lenda-training@empresa.com', { role: 'LEGEND' })

    const res = await app.inject({ method: 'GET', url: '/admin/people/training', headers: auth(token) })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('devolve os cards, os blocos e o catálogo de cargos', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'admin-training@empresa.com', { role: 'ADMIN' })
    await prisma.user.update({ where: { email: 'admin-training@empresa.com' }, data: { position: 'Head de G&G' } })

    const res = await app.inject({ method: 'GET', url: '/admin/people/training', headers: auth(token) })

    expect(res.statusCode).toBe(200)
    expect(res.json().training).toMatchObject({
      coursesPublished: expect.any(Number),
      completions: expect.any(Number),
      mandatoryCompletedPct: expect.any(Number),
    })
    expect(res.json().positions).toContain('Head de G&G')
    await app.close()
  })

  it('o filtro de cargo viaja na query', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'admin-cargo@empresa.com', { role: 'ADMIN' })

    const res = await app.inject({
      method: 'GET',
      url: '/admin/people/training?position=SRE',
      headers: auth(token),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().training.position).toBe('SRE')
    await app.close()
  })

  /**
   * O recorte do subadmin é do servidor (`resolveSectorId`), não da query: ele
   * fica preso ao próprio setor mesmo pedindo outro.
   */
  it('subadmin continua preso ao próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const gente = await prisma.sector.create({
      data: { name: 'Gente e Gestão', slug: 'gente-training', enabledFeatures: ['gente-gestao'] },
    })
    const outro = await prisma.sector.create({ data: { name: 'Comercial', slug: 'comercial-training' } })
    const token = await tokenFor(app, 'sub-training@empresa.com', { role: 'SUBADMIN', sectorId: gente.id })

    const res = await app.inject({
      method: 'GET',
      url: `/admin/people/training?sectorId=${outro.id}`,
      headers: auth(token),
    })

    expect(res.json().training.sectorId).toBe(gente.id)
    await app.close()
  })

  it('período personalizado sem as duas datas é 400 com mensagem tratada', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'admin-janela@empresa.com', { role: 'ADMIN' })

    const res = await app.inject({
      method: 'GET',
      url: '/admin/people/training?range=custom&from=2026-08-01',
      headers: auth(token),
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/data inicial e a final/i)
    await app.close()
  })
})
