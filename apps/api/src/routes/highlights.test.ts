import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { createSector } from '../services/sector-service'
import { signAccessToken } from '../lib/jwt'

async function devToken(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Dev', email: 'dev@empresa.com', password: 'changeme123' } })
  return res.json().accessToken as string
}

describe('GET /highlights', () => {
  it('lists only PUBLISHED highlights, most recent first', async () => {
    const app = buildApp(); await app.ready()
    const token = await devToken(app)
    const ana = await prisma.user.create({ data: { name: 'Ana', email: 'ana@empresa.com', passwordHash: 'x' } })

    await prisma.votingPeriod.create({
      data: { monthRef: '2026-05', startsAt: new Date('2026-05-01'), endsAt: new Date('2026-05-31'), status: 'CLOSED',
        winnerId: ana.id, winnerVotes: 4, highlightText: 'oi', highlightImagePath: '/highlights/2026-05.png', highlightStatus: 'PUBLISHED' },
    })
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'), status: 'CLOSED',
        winnerId: ana.id, winnerVotes: 6, highlightText: 'olá', highlightImagePath: '/highlights/2026-06.png', highlightStatus: 'PUBLISHED' },
    })
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-07', startsAt: new Date('2026-07-01'), endsAt: new Date('2026-07-31'), status: 'CLOSED',
        winnerId: ana.id, winnerVotes: 2, highlightText: 'rascunho', highlightImagePath: '/highlights/2026-07.png', highlightStatus: 'DRAFT' },
    })

    const res = await app.inject({ method: 'GET', url: '/highlights', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const list = res.json().highlights
    expect(list.map((h: { monthRef: string }) => h.monthRef)).toEqual(['2026-06', '2026-05'])
    expect(list[0].imageUrl).toBe('/api/highlights/2026-06.png')
    expect(list[0].winner.name).toBe('Ana')
    await app.close()
  })

  it('requires authentication (401)', async () => {
    const app = buildApp(); await app.ready()
    const res = await app.inject({ method: 'GET', url: '/highlights' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('mostra só os destaques do próprio setor do usuário logado', async () => {
    const app = buildApp(); await app.ready()
    const token = await devToken(app)
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-highlights-sector@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Destaques B', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    const bruno = await prisma.user.create({ data: { name: 'Bruno', email: 'bruno-destaque@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-08', startsAt: new Date('2026-08-01'), endsAt: new Date('2026-08-31'), status: 'CLOSED',
        sectorId: sectorB.id, winnerId: bruno.id, winnerVotes: 3, highlightText: 'oi', highlightImagePath: '/highlights/2026-08.png', highlightStatus: 'PUBLISHED' },
    })

    const res = await app.inject({ method: 'GET', url: '/highlights', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const list = res.json().highlights as Array<{ monthRef: string }>
    expect(list.map((h) => h.monthRef)).not.toContain('2026-08')
    await app.close()
  })

  it('?sectorId=<outro> mostra o destaque daquele setor', async () => {
    const app = buildApp(); await app.ready()
    const token = await devToken(app)
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-highlights-cross@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Destaques C (cross)', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    const bruno = await prisma.user.create({ data: { name: 'Bruno Cross', email: 'bruno-destaque-cross@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-08', startsAt: new Date('2026-08-01'), endsAt: new Date('2026-08-31'), status: 'CLOSED',
        sectorId: sectorB.id, winnerId: bruno.id, winnerVotes: 3, highlightText: 'oi', highlightImagePath: '/highlights/2026-08.png', highlightStatus: 'PUBLISHED' },
    })

    const res = await app.inject({ method: 'GET', url: `/highlights?sectorId=${sectorB.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const list = res.json().highlights as Array<{ monthRef: string }>
    expect(list.map((h) => h.monthRef)).toContain('2026-08')
    await app.close()
  })

  it('?sectorId=all mostra destaques de todos os setores', async () => {
    const app = buildApp(); await app.ready()
    const token = await devToken(app)
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-highlights-all@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Destaques D (all)', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    const bruno = await prisma.user.create({ data: { name: 'Bruno All', email: 'bruno-destaque-all@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-09', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-09-30'), status: 'CLOSED',
        sectorId: sectorB.id, winnerId: bruno.id, winnerVotes: 3, highlightText: 'oi', highlightImagePath: '/highlights/2026-09.png', highlightStatus: 'PUBLISHED' },
    })

    const res = await app.inject({ method: 'GET', url: '/highlights?sectorId=all', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const list = res.json().highlights as Array<{ monthRef: string }>
    expect(list.map((h) => h.monthRef)).toContain('2026-09')
    await app.close()
  })

  it('THIRD_PARTY: ?sectorId= é ignorado, sempre vê o próprio setor', async () => {
    const app = buildApp(); await app.ready()
    const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin-highlights-tp@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Destaques E (tp)', enabledFeatures: ['destaques'], roles: ['THIRD_PARTY'] }, admin.id, DEFAULT_COMPANY_ID)
    const bruno = await prisma.user.create({ data: { name: 'Bruno TP', email: 'bruno-destaque-tp@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-10', startsAt: new Date('2026-10-01'), endsAt: new Date('2026-10-31'), status: 'CLOSED',
        sectorId: sectorB.id, winnerId: bruno.id, winnerVotes: 3, highlightText: 'oi', highlightImagePath: '/highlights/2026-10.png', highlightStatus: 'PUBLISHED' },
    })
    const thirdParty = await prisma.user.create({
      data: { name: 'Terceirizado', email: 'terceirizado-destaque@empresa.com', passwordHash: 'x', role: 'THIRD_PARTY', enabledFeatures: ['destaques'] },
    })
    const token = signAccessToken(app, thirdParty, [])

    const res = await app.inject({ method: 'GET', url: `/highlights?sectorId=${sectorB.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const list = res.json().highlights as Array<{ monthRef: string }>
    expect(list.map((h) => h.monthRef)).not.toContain('2026-10')
    await app.close()
  })
})
