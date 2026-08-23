import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function adminToken(app: ReturnType<typeof buildApp>) {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Admin', email: 'admin-coins@empresa.com', password: 'changeme123' },
  })
  await prisma.user.update({ where: { email: 'admin-coins@empresa.com' }, data: { role: 'ADMIN' } })
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'admin-coins@empresa.com', password: 'changeme123' },
  })
  return res.json().accessToken as string
}

async function subadminToken(app: ReturnType<typeof buildApp>) {
  const email = 'subadmin-coins@empresa.com'
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Sub', email, password: 'changeme123' } })
  await prisma.user.update({ where: { email }, data: { role: 'SUBADMIN', sectorId: DEFAULT_SECTOR_ID } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

/** Lenda com a feature `coins` no token (o gate lê `features` do JWT). */
async function legendToken(app: ReturnType<typeof buildApp>, features: string[] = ['coins']) {
  const user = await prisma.user.create({
    data: {
      name: 'Lenda',
      email: `lenda-coins-${Date.now()}-${Math.random()}@x.com`,
      passwordHash: 'x',
      role: 'LEGEND',
    },
  })
  const token = app.jwt.sign({
    sub: user.id,
    role: 'LEGEND',
    sectorId: DEFAULT_SECTOR_ID,
    companyId: DEFAULT_COMPANY_ID,
    features,
  })
  return { user, token }
}

describe('rotas de coins do colaborador', () => {
  it('devolve saldo e extrato, e exige a feature coins', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await legendToken(app)
    const rule = await prisma.coinRule.create({
      data: { event: 'VOTE_CAST', amount: 50, companyId: DEFAULT_COMPANY_ID },
    })
    await prisma.coinTransaction.create({
      data: {
        userId: user.id,
        kind: 'EARN',
        event: 'VOTE_CAST',
        ruleId: rule.id,
        amount: 50,
        dedupeKey: 'VOTE_CAST:v1',
        day: new Date('2026-07-30T00:00:00.000Z'),
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    const balance = await app.inject({ method: 'GET', url: '/me/coins', headers: { authorization: `Bearer ${token}` } })
    expect(balance.statusCode).toBe(200)
    expect(balance.json().balance).toBe(50)

    const ledger = await app.inject({
      method: 'GET',
      url: '/me/coins/transactions?page=1&pageSize=10',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(ledger.statusCode).toBe(200)
    expect(ledger.json()).toMatchObject({ total: 1, page: 1, pageSize: 10, balance: 50 })
    expect(ledger.json().entries[0]).toMatchObject({ event: 'VOTE_CAST', amount: 50, day: '2026-07-30' })

    const { token: noFeature } = await legendToken(app, [])
    const blocked = await app.inject({
      method: 'GET',
      url: '/me/coins',
      headers: { authorization: `Bearer ${noFeature}` },
    })
    expect(blocked.statusCode).toBe(403)

    const anon = await app.inject({ method: 'GET', url: '/me/coins' })
    expect(anon.statusCode).toBe(401)
    await app.close()
  })

  it('lista só as regras ativas no "como ganhar"', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    await prisma.coinRule.createMany({
      data: [
        { event: 'VOTE_CAST', amount: 50, companyId: DEFAULT_COMPANY_ID },
        { event: 'MOOD_ANSWERED', amount: 10, active: false, companyId: DEFAULT_COMPANY_ID },
      ],
    })

    const res = await app.inject({ method: 'GET', url: '/coins/rules', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().rules).toEqual([{ event: 'VOTE_CAST', amount: 50, capWindow: 'NONE', capAmount: null }])
    await app.close()
  })
})

describe('rotas de coins do admin', () => {
  it('faz o CRUD de regra', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const auth = { authorization: `Bearer ${token}` }

    const created = await app.inject({
      method: 'POST',
      url: '/admin/coins/rules',
      headers: auth,
      payload: { event: 'FEEDBACK_PUBLISHED', amount: 20, capWindow: 'WEEK', capAmount: 100 },
    })
    expect(created.statusCode).toBe(201)
    const ruleId = created.json().rule.id as string

    const duplicated = await app.inject({
      method: 'POST',
      url: '/admin/coins/rules',
      headers: auth,
      payload: { event: 'FEEDBACK_PUBLISHED', amount: 5, capWindow: 'NONE' },
    })
    expect(duplicated.statusCode).toBe(409)

    const invalid = await app.inject({
      method: 'POST',
      url: '/admin/coins/rules',
      headers: auth,
      payload: { event: 'VOTE_CAST', amount: 0, capWindow: 'NONE' },
    })
    expect(invalid.statusCode).toBe(400)

    const patched = await app.inject({
      method: 'PATCH',
      url: `/admin/coins/rules/${ruleId}`,
      headers: auth,
      payload: { active: false },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().rule.active).toBe(false)

    const listed = await app.inject({ method: 'GET', url: '/admin/coins/rules', headers: auth })
    expect(listed.json().rules).toHaveLength(1)

    const removed = await app.inject({ method: 'DELETE', url: `/admin/coins/rules/${ruleId}`, headers: auth })
    expect(removed.statusCode).toBe(204)

    const missing = await app.inject({ method: 'DELETE', url: `/admin/coins/rules/${ruleId}`, headers: auth })
    expect(missing.statusCode).toBe(404)
    await app.close()
  })

  it('nega acesso a lenda e a subadmin', async () => {
    const app = buildApp()
    await app.ready()
    const { token: legend } = await legendToken(app)
    const subadmin = await subadminToken(app)

    const asLegend = await app.inject({
      method: 'GET',
      url: '/admin/coins/rules',
      headers: { authorization: `Bearer ${legend}` },
    })
    expect(asLegend.statusCode).toBe(403)

    const asSubadmin = await app.inject({
      method: 'GET',
      url: '/admin/coins/rules',
      headers: { authorization: `Bearer ${subadmin}` },
    })
    expect(asSubadmin.statusCode).toBe(403)
    await app.close()
  })

  it('lê saldo/extrato de um colaborador e faz ajuste manual', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const auth = { authorization: `Bearer ${token}` }
    const { user } = await legendToken(app)

    const credit = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/coins/adjustments`,
      headers: auth,
      payload: { amount: 40, reason: 'Palestra na Quinta de Dev' },
    })
    expect(credit.statusCode).toBe(201)
    expect(credit.json()).toMatchObject({ balance: 40 })
    expect(credit.json().transaction).toMatchObject({ kind: 'MANUAL_CREDIT', amount: 40 })

    const balance = await app.inject({ method: 'GET', url: `/admin/users/${user.id}/coins`, headers: auth })
    expect(balance.json()).toMatchObject({ balance: 40, user: { id: user.id } })

    const ledger = await app.inject({
      method: 'GET',
      url: `/admin/users/${user.id}/coins/transactions?kind=MANUAL_CREDIT`,
      headers: auth,
    })
    expect(ledger.json().total).toBe(1)

    const overdraft = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/coins/adjustments`,
      headers: auth,
      payload: { amount: -41, reason: 'estorno' },
    })
    expect(overdraft.statusCode).toBe(409)
    expect(overdraft.json().message).toContain('40')

    const zeroed = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/coins/adjustments`,
      headers: auth,
      payload: { amount: 0, reason: 'nada' },
    })
    expect(zeroed.statusCode).toBe(400)

    const outsider = await app.inject({
      method: 'GET',
      url: '/admin/users/nao-existe/coins',
      headers: auth,
    })
    expect(outsider.statusCode).toBe(404)
    await app.close()
  })

  it('devolve o relatório agregado', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const auth = { authorization: `Bearer ${token}` }
    const { user } = await legendToken(app)
    const rule = await prisma.coinRule.create({
      data: { event: 'VOTE_CAST', amount: 50, companyId: DEFAULT_COMPANY_ID },
    })
    await prisma.coinTransaction.create({
      data: {
        userId: user.id,
        kind: 'EARN',
        event: 'VOTE_CAST',
        ruleId: rule.id,
        amount: 50,
        dedupeKey: 'VOTE_CAST:v1',
        day: new Date('2026-07-30T00:00:00.000Z'),
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    const res = await app.inject({ method: 'GET', url: '/admin/coins/report', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json().totalAmount).toBe(50)
    expect(res.json().rows.find((row: { event: string }) => row.event === 'VOTE_CAST')).toMatchObject({
      totalAmount: 50,
      transactionCount: 1,
      userCount: 1,
    })
    await app.close()
  })
})
