import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

function currentOpenPeriodData() {
  const now = new Date()
  return {
    monthRef: now.toISOString().slice(0, 7),
    startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    endsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    status: 'OPEN' as const,
  }
}

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  const voterId = reg.json().user.id as string
  return { app, token, voterId }
}

describe('badge routes', () => {
  it('lists the badge catalog with requirement and progress (GET /badges)', async () => {
    const { app, token } = await setup()
    await prisma.badge.create({
      data: { slug: 'conector', name: 'Conector', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao' },
    })
    const res = await app.inject({ method: 'GET', url: '/badges', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().badges).toHaveLength(1)
    expect(res.json().badges[0].threshold).toBe(5)
    expect(res.json().badges[0].requirement).toBe('Receba 5 feedbacks em colaboracao')
    expect(res.json().badges[0].progress).toEqual({ current: 0, target: 5 })
    await app.close()
  })

  it('lists badges awarded to a user (GET /users/:id/badges)', async () => {
    const { app, token, voterId } = await setup()
    const badge = await prisma.badge.create({
      data: { slug: 'reconhecido', name: 'Reconhecido', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    await prisma.userBadge.create({ data: { userId: voterId, badgeId: badge.id } })
    const res = await app.inject({ method: 'GET', url: `/users/${voterId}/badges`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().badges).toHaveLength(1)
    expect(res.json().badges[0].badge.name).toBe('Reconhecido')
    await app.close()
  })

  it('concede o selo ao votado ainda na votação — o feedback do voto vale na hora', async () => {
    const { app, token, voterId } = await setup()
    // selo: 1 feedback em colaboração
    const badge = await prisma.badge.create({
      data: { slug: 'primeiro-reconhecimento', name: 'Primeiro Reconhecimento', description: '1 em colaboração', kind: 'CATEGORY', iconKey: 'link', threshold: 1, categorySlug: 'colaboracao' },
    })
    const voted = await prisma.user.create({ data: { name: 'Bruno', email: 'bruno@empresa.com', passwordHash: 'x' } })
    const category = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
    await prisma.votingPeriod.create({
      data: currentOpenPeriodData(),
    })

    const voteRes = await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voted.id, categoryIds: [category.id], justification: 'Trabalho colaborativo excelente.' },
    })
    expect(voteRes.statusCode).toBe(201)
    expect(voterId).toBeTruthy()

    // O voto vira feedback na mesma transação, e feedback recebido conta para
    // selo na hora — não espera a publicação do destaque.
    const res = await app.inject({ method: 'GET', url: `/users/${voted.id}/badges`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().badges.map((b: { badge: { id: string } }) => b.badge.id)).toEqual([badge.id])
    expect(await prisma.notification.count({ where: { userId: voted.id } })).toBeGreaterThan(0)
    await app.close()
  })

  it('requires authentication (401)', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/badges' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('retorna 404 quando o :id pertence a outra empresa (GET /users/:id/badges)', async () => {
    const { app, token } = await setup()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Badges', slug: 'outra-empresa-badges-test' } })
    const outsider = await prisma.user.create({ data: { name: 'Fora Badges', email: 'fora-badges@x.com', passwordHash: 'x', companyId: otherCompany.id } })
    const res = await app.inject({ method: 'GET', url: `/users/${outsider.id}/badges`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
