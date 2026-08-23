import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

let app: FastifyInstance
beforeAll(async () => { app = buildApp(); await app.ready() })
afterAll(async () => { await app.close() })

/** O time de quem lidera é quem tem a pessoa como líder direto (`managerId`). */
async function mkUser(
  name: string,
  email: string,
  role: 'LEGEND' | 'LEAD' = 'LEGEND',
  extra: Record<string, unknown> = {},
) {
  return prisma.user.create({ data: { name, email, passwordHash: 'x', role, ...extra } })
}
function tokenFor(app: FastifyInstance, id: string) {
  return app.jwt.sign({ sub: id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
}

describe('rotas de humor do time', () => {
  it('GET /me/led-squads/moods retorna os liderados diretos com humor atual', async () => {
    const lead = await mkUser('Lia', 'lia-r@x.com', 'LEAD')
    const ana = await mkUser('Ana', 'ana-r@x.com', 'LEGEND', { managerId: lead.id })
    await mkUser('Lucas Barros', 'lucas-off-r@x.com', 'LEGEND', { managerId: lead.id, active: false })
    await mkUser('Monica', 'monica-left-r@x.com', 'LEGEND', { managerId: lead.id, leftAt: new Date('2026-07-10') })
    await prisma.moodEntry.create({ data: { userId: ana.id, day: new Date('2026-06-22'), mood: 'GREAT', note: null } })

    const res = await app.inject({
      method: 'GET', url: '/me/led-squads/moods',
      headers: { authorization: `Bearer ${tokenFor(app, lead.id)}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.squads).toHaveLength(1)
    expect(body.squads[0].members[0]).toMatchObject({ name: 'Ana', currentMood: { mood: 'GREAT', day: '2026-06-22' } })
    expect(body.squads[0].members.map((m: { id: string }) => m.id)).toEqual([ana.id])
  })

  it('GET /users/:id/mood-history pagina com cursor', async () => {
    const lead = await mkUser('Lia2', 'lia2-r@x.com', 'LEAD')
    const ana = await mkUser('Ana2', 'ana2-r@x.com', 'LEGEND', { managerId: lead.id })
    for (const d of ['2026-06-20', '2026-06-21', '2026-06-22']) {
      await prisma.moodEntry.create({ data: { userId: ana.id, day: new Date(d), mood: 'GOOD', note: d } })
    }
    const res = await app.inject({
      method: 'GET', url: `/users/${ana.id}/mood-history?limit=2`,
      headers: { authorization: `Bearer ${tokenFor(app, lead.id)}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().entries.map((e: { day: string }) => e.day)).toEqual(['2026-06-22', '2026-06-21'])
    expect(res.json().nextCursor).toBe('2026-06-21')
  })

  it('GET /users/:id/mood-history nega liderado que foi desligado', async () => {
    const lead = await mkUser('Lia4', 'lia4-r@x.com', 'LEAD')
    const former = await mkUser('Ex', 'ex-mood-r@x.com', 'LEGEND', {
      managerId: lead.id,
      leftAt: new Date('2026-07-10'),
    })

    const res = await app.inject({
      method: 'GET', url: `/users/${former.id}/mood-history`,
      headers: { authorization: `Bearer ${tokenFor(app, lead.id)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('GET /users/:id/mood-history nega quem não lidera a pessoa com 403', async () => {
    const outro = await mkUser('Léo', 'leo-r@x.com')
    const lead = await mkUser('Lia3', 'lia3-r@x.com', 'LEAD')
    const ana = await mkUser('Ana3', 'ana3-r@x.com', 'LEGEND', { managerId: lead.id })
    const res = await app.inject({
      method: 'GET', url: `/users/${ana.id}/mood-history`,
      headers: { authorization: `Bearer ${tokenFor(app, outro.id)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('exige autenticação (401 sem token)', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/led-squads/moods' })
    expect(res.statusCode).toBe(401)
  })
})
