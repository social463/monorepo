import type { UserRole } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function tokenFor(app: ReturnType<typeof buildApp>, email: string, role: UserRole) {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Alguém', email, password: 'changeme123' },
  })
  await prisma.user.update({ where: { email }, data: { role } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

describe('GET /super-admin/analytics', () => {
  it('nega acesso a quem não é da equipe interna', async () => {
    const app = buildApp()
    await app.ready()

    const semToken = await app.inject({ method: 'GET', url: '/super-admin/analytics' })
    expect(semToken.statusCode).toBe(401)

    const adminToken = await tokenFor(app, 'admin-analytics@empresa.com', 'ADMIN')
    const comoAdmin = await app.inject({
      method: 'GET',
      url: '/super-admin/analytics',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(comoAdmin.statusCode).toBe(403)
  })

  it('agrega adoção por empresa e por setor, sem misturar tenants', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'super-analytics@legends.internal', 'SUPER_ADMIN')

    const outra = await prisma.company.create({ data: { name: 'Empresa Beta', slug: 'empresa-beta' } })
    const setor = await prisma.sector.create({
      data: { name: 'Engenharia', slug: 'engenharia-beta', companyId: outra.id },
    })

    await prisma.analyticsEvent.createMany({
      data: [
        { name: 'vote_cast', userId: null, sectorId: setor.id, companyId: outra.id, source: 'api' },
        { name: 'vote_cast', userId: null, sectorId: setor.id, companyId: outra.id, source: 'api' },
        { name: 'feedback_given', userId: null, sectorId: setor.id, companyId: outra.id, source: 'api' },
      ],
    })

    const res = await app.inject({
      method: 'GET',
      url: '/super-admin/analytics?days=30',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.windowDays).toBe(30)

    const beta = body.companies.find((c: { companyId: string }) => c.companyId === outra.id)
    expect(beta.totalEvents).toBe(3)
    expect(beta.topEvents[0]).toEqual({ name: 'vote_cast', count: 2 })
    expect(beta.sectors).toHaveLength(1)
    expect(beta.sectors[0].sectorName).toBe('Engenharia')
    expect(beta.sectors[0].totalEvents).toBe(3)

    // Nenhuma outra empresa herda os eventos nem o setor da Beta. Não dá para
    // exigir zero aqui: o próprio login do super-admin gera `user_logged_in` na
    // empresa dele, e isso é uso de verdade.
    const outras = body.companies.filter((c: { companyId: string }) => c.companyId !== outra.id)
    for (const company of outras) {
      expect(company.topEvents.map((e: { name: string }) => e.name)).not.toContain('vote_cast')
      expect(company.sectors.map((s: { sectorId: string }) => s.sectorId)).not.toContain(setor.id)
    }
  })

  // Empresa que parou de usar é o caso mais importante de enxergar — se ela
  // sumisse da lista por não ter evento, o painel esconderia justamente o
  // churn que ele existe para detectar.
  it('lista empresa sem nenhum evento na janela', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'super-vazio@legends.internal', 'SUPER_ADMIN')

    const parada = await prisma.company.create({ data: { name: 'Empresa Parada', slug: 'empresa-parada' } })

    const res = await app.inject({
      method: 'GET',
      url: '/super-admin/analytics',
      headers: { authorization: `Bearer ${token}` },
    })

    const row = res.json().companies.find((c: { companyId: string }) => c.companyId === parada.id)
    expect(row).toBeDefined()
    expect(row.totalEvents).toBe(0)
    expect(row.activeUsers).toBe(0)
    expect(row.lastEventAt).toBeNull()
  })

  it('recusa janela fora do conjunto conhecido', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'super-janela@legends.internal', 'SUPER_ADMIN')

    const res = await app.inject({
      method: 'GET',
      url: '/super-admin/analytics?days=999',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(400)
  })
})
