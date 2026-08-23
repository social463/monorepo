import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function registerUser(app: Awaited<ReturnType<typeof buildApp>>, name: string, email: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { name, email, password: 'changeme123' } })
  return { token: res.json().accessToken as string, id: res.json().user.id as string }
}

/**
 * Payload de convidado tem campos além do FastifyJWT padrão (guest/name/presetId/
 * inviteId). Assinar via variável tipada evita o excess-property check do TS
 * contra o tipo estreito de FastifyJWT.payload — mesmo padrão de office-meetings.test.ts.
 */
function guestToken(app: Awaited<ReturnType<typeof buildApp>>): string {
  const guestPayload: {
    sub: string
    role: string
    sectorId: string
    companyId: string
    features: string[]
    guest: boolean
    name: string
    presetId: string
    inviteId: string
  } = {
    sub: 'guest-1', role: 'GUEST', sectorId: '', companyId: DEFAULT_COMPANY_ID,
    features: [], guest: true, name: 'Visita', presetId: 'p1', inviteId: 'i1',
  }
  return app.jwt.sign(guestPayload)
}

describe('rotas de férias', () => {
  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    expect((await app.inject({ method: 'GET', url: '/vacations?from=2026-08-01&to=2026-08-31' })).statusCode).toBe(401)
    await app.close()
  })

  it('lança e lista as férias de um liderado', async () => {
    const app = buildApp()
    await app.ready()
    const lead = await registerUser(app, 'Lider', 'lead-vac@x.com')
    const member = await registerUser(app, 'Liderado', 'member-vac@x.com')
    await prisma.user.update({ where: { id: lead.id }, data: { role: 'LEAD' } })
    // Quem lidera quem vem do líder direto, o mesmo do organograma.
    await prisma.user.update({ where: { id: member.id }, data: { managerId: lead.id } })

    const created = await app.inject({
      method: 'POST',
      url: '/vacations',
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: 'Férias' },
    })
    expect(created.statusCode).toBe(201)

    const list = await app.inject({
      method: 'GET',
      url: '/vacations?from=2026-08-01&to=2026-08-31',
      headers: { authorization: `Bearer ${lead.token}` },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().vacations.map((v: { startDate: string }) => v.startDate)).toEqual(['2026-08-03'])
    await app.close()
  })

  it('recusa lançamento de quem não gerencia (403)', async () => {
    const app = buildApp()
    await app.ready()
    const autor = await registerUser(app, 'Qualquer', 'qualquer-vac@x.com')
    const alvo = await registerUser(app, 'Alvo', 'alvo-vac@x.com')

    const res = await app.inject({
      method: 'POST',
      url: '/vacations',
      headers: { authorization: `Bearer ${autor.token}` },
      payload: { userId: alvo.id, startDate: '2026-08-03', endDate: '2026-08-14' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('recusa payload inválido (400)', async () => {
    const app = buildApp()
    await app.ready()
    const autor = await registerUser(app, 'Autor', 'autor-vac@x.com')
    const res = await app.inject({
      method: 'POST',
      url: '/vacations',
      headers: { authorization: `Bearer ${autor.token}` },
      payload: { userId: autor.id, startDate: '03/08/2026', endDate: '2026-08-14' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('recusa intervalo maior que 366 dias (400)', async () => {
    const app = buildApp()
    await app.ready()
    const autor = await registerUser(app, 'Autor2', 'autor2-vac@x.com')
    const res = await app.inject({
      method: 'GET',
      url: '/vacations?from=2026-01-01&to=2027-06-01',
      headers: { authorization: `Bearer ${autor.token}` },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('edita e remove o período', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await registerUser(app, 'Admin', 'admin-vac@x.com')
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } })
    const alvo = await registerUser(app, 'Alvo2', 'alvo2-vac@x.com')

    const created = await app.inject({
      method: 'POST', url: '/vacations', headers: { authorization: `Bearer ${admin.token}` },
      payload: { userId: alvo.id, startDate: '2026-08-03', endDate: '2026-08-14' },
    })
    const id = created.json().vacation.id as string

    const patched = await app.inject({
      method: 'PATCH', url: `/vacations/${id}`, headers: { authorization: `Bearer ${admin.token}` },
      payload: { endDate: '2026-08-18' },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().vacation.endDate).toBe('2026-08-18')

    const deleted = await app.inject({
      method: 'DELETE', url: `/vacations/${id}`, headers: { authorization: `Bearer ${admin.token}` },
    })
    expect(deleted.statusCode).toBe(204)
    expect(await prisma.vacation.count()).toBe(0)
    await app.close()
  })

  it('convidado (GUEST) toma 403, não 500, em GET /vacations e POST /vacations', async () => {
    const app = buildApp()
    await app.ready()
    const token = guestToken(app)

    const list = await app.inject({
      method: 'GET', url: '/vacations?from=2026-08-01&to=2026-08-31',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(list.statusCode).toBe(403)

    const created = await app.inject({
      method: 'POST', url: '/vacations', headers: { authorization: `Bearer ${token}` },
      payload: { userId: 'guest-1', startDate: '2026-08-03', endDate: '2026-08-14' },
    })
    expect(created.statusCode).toBe(403)
    await app.close()
  })

  it('GET /me/team/vacations devolve os grupos do gestor', async () => {
    const app = buildApp()
    await app.ready()
    const lead = await registerUser(app, 'Lider2', 'lead2-vac@x.com')
    const member = await registerUser(app, 'Liderado2', 'member2-vac@x.com')
    await prisma.user.update({ where: { id: lead.id }, data: { role: 'LEAD' } })
    await prisma.user.update({ where: { id: member.id }, data: { managerId: lead.id } })

    const res = await app.inject({
      method: 'GET', url: '/me/team/vacations', headers: { authorization: `Bearer ${lead.token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().groups[0].members[0].user.id).toBe(member.id)
    await app.close()
  })
})
