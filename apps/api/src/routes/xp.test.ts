import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { awardXp } from '../services/xp-service'

async function adminToken(app: ReturnType<typeof buildApp>) {
  const email = 'admin-xp@empresa.com'
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Admin', email, password: 'changeme123' },
  })
  await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

/** Lenda SEM feature nenhuma: XP não é gated, ao contrário dos coins. */
async function legendToken(app: ReturnType<typeof buildApp>) {
  const user = await prisma.user.create({
    data: {
      name: 'Lenda',
      email: `lenda-xp-${Date.now()}-${Math.random()}@x.com`,
      passwordHash: 'x',
      role: 'LEGEND',
    },
  })
  const token = app.jwt.sign({
    sub: user.id,
    role: 'LEGEND',
    sectorId: DEFAULT_SECTOR_ID,
    companyId: DEFAULT_COMPANY_ID,
    features: [],
  })
  return { user, token }
}

describe('carteira de XP do colaborador', () => {
  it('devolve total e nível, sem exigir feature', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await legendToken(app)
    const rule = await prisma.xpRule.create({
      data: { event: 'VOTE_CAST', amount: 600, companyId: DEFAULT_COMPANY_ID },
    })
    await prisma.xpTransaction.create({
      data: {
        userId: user.id,
        event: 'VOTE_CAST',
        ruleId: rule.id,
        amount: 600,
        dedupeKey: 'VOTE_CAST:seed',
        day: new Date('2026-08-12T00:00:00.000Z'),
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    const res = await app.inject({ method: 'GET', url: '/me/xp', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ points: 600, level: { name: 'Prata', next: 'Ouro', progress: 10 } })
    await app.close()
  })

  it('quem nunca ganhou XP começa em Bronze zerado, não em erro', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    const res = await app.inject({ method: 'GET', url: '/me/xp', headers: { authorization: `Bearer ${token}` } })
    expect(res.json()).toMatchObject({ points: 0, level: { name: 'Bronze', progress: 0 } })
    await app.close()
  })
})

describe('awardXp', () => {
  it('não credita nada quando a empresa não cadastrou regra', async () => {
    const app = buildApp()
    await app.ready()
    const { user } = await legendToken(app)
    const outcome = await awardXp({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      event: 'VOTE_CAST',
      reference: 'voto-1',
    })
    expect(outcome).toEqual({ status: 'NO_RULE' })
    expect(await prisma.xpTransaction.count()).toBe(0)
    await app.close()
  })

  it('regra inativa não paga', async () => {
    const app = buildApp()
    await app.ready()
    const { user } = await legendToken(app)
    await prisma.xpRule.create({
      data: { event: 'VOTE_CAST', amount: 50, active: false, companyId: DEFAULT_COMPANY_ID },
    })
    const outcome = await awardXp({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      event: 'VOTE_CAST',
      reference: 'voto-1',
    })
    expect(outcome).toEqual({ status: 'RULE_INACTIVE' })
    await app.close()
  })

  // A idempotência é do banco (unique userId+dedupeKey), e é o que impede a
  // mesma ação de pagar duas vezes se a rota for chamada de novo.
  it('a mesma ação nunca paga duas vezes; ações distintas pagam separado', async () => {
    const app = buildApp()
    await app.ready()
    const { user } = await legendToken(app)
    await prisma.xpRule.create({ data: { event: 'VOTE_CAST', amount: 50, companyId: DEFAULT_COMPANY_ID } })

    const base = { userId: user.id, companyId: DEFAULT_COMPANY_ID, event: 'VOTE_CAST' as const }
    expect((await awardXp({ ...base, reference: 'voto-1' })).status).toBe('CREDITED')
    expect((await awardXp({ ...base, reference: 'voto-1' })).status).toBe('DUPLICATE')
    expect((await awardXp({ ...base, reference: 'voto-2' })).status).toBe('CREDITED')

    const total = await prisma.xpTransaction.aggregate({ where: { userId: user.id }, _sum: { amount: true } })
    expect(total._sum.amount).toBe(100)
    await app.close()
  })

  it('respeita o teto da janela, sem crédito parcial', async () => {
    const app = buildApp()
    await app.ready()
    const { user } = await legendToken(app)
    await prisma.xpRule.create({
      data: {
        event: 'FEEDBACK_REACTION',
        amount: 40,
        capWindow: 'DAY',
        capAmount: 100,
        companyId: DEFAULT_COMPANY_ID,
      },
    })
    const now = new Date('2026-08-12T15:00:00.000Z')
    const base = { userId: user.id, companyId: DEFAULT_COMPANY_ID, event: 'FEEDBACK_REACTION' as const, now }

    expect((await awardXp({ ...base, reference: 'a' })).status).toBe('CREDITED')
    expect((await awardXp({ ...base, reference: 'b' })).status).toBe('CREDITED')
    // 80 + 40 estouraria 100: não credita 20, não credita nada.
    expect(await awardXp({ ...base, reference: 'c' })).toMatchObject({ status: 'CAP_REACHED', used: 80 })

    const total = await prisma.xpTransaction.aggregate({ where: { userId: user.id }, _sum: { amount: true } })
    expect(total._sum.amount).toBe(80)
    await app.close()
  })
})

describe('CRUD de regras de XP', () => {
  it('cria, edita e apaga — e apagar a regra não apaga o XP já ganho', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const auth = { authorization: `Bearer ${token}` }

    const created = await app.inject({
      method: 'POST',
      url: '/admin/xp/rules',
      headers: auth,
      payload: { event: 'VOTE_CAST', amount: 50, capWindow: 'NONE' },
    })
    expect(created.statusCode).toBe(201)
    const ruleId = created.json().rule.id as string

    const { user } = await legendToken(app)
    await awardXp({ userId: user.id, companyId: DEFAULT_COMPANY_ID, event: 'VOTE_CAST', reference: 'voto-1' })

    const patched = await app.inject({
      method: 'PATCH',
      url: `/admin/xp/rules/${ruleId}`,
      headers: auth,
      payload: { amount: 80 },
    })
    expect(patched.json().rule).toMatchObject({ amount: 80, event: 'VOTE_CAST' })

    const removed = await app.inject({ method: 'DELETE', url: `/admin/xp/rules/${ruleId}`, headers: auth })
    expect(removed.statusCode).toBe(204)

    // SetNull no ruleId, `event` denormalizado: o extrato sobrevive à regra.
    const entry = await prisma.xpTransaction.findFirstOrThrow({ where: { userId: user.id } })
    expect(entry).toMatchObject({ ruleId: null, event: 'VOTE_CAST', amount: 50 })
    await app.close()
  })

  it('recusa a segunda regra do mesmo evento', async () => {
    const app = buildApp()
    await app.ready()
    const auth = { authorization: `Bearer ${await adminToken(app)}` }
    const payload = { event: 'MOOD_ANSWERED', amount: 10, capWindow: 'NONE' }
    await app.inject({ method: 'POST', url: '/admin/xp/rules', headers: auth, payload })
    const second = await app.inject({ method: 'POST', url: '/admin/xp/rules', headers: auth, payload })
    expect(second.statusCode).toBe(409)
    await app.close()
  })

  // Teto menor que o valor por ação faz a regra nunca pagar nada — parece bug
  // para quem configurou, então é recusado na hora.
  it('recusa teto menor que o valor por ação', async () => {
    const app = buildApp()
    await app.ready()
    const auth = { authorization: `Bearer ${await adminToken(app)}` }
    const res = await app.inject({
      method: 'POST',
      url: '/admin/xp/rules',
      headers: auth,
      payload: { event: 'VOTE_CAST', amount: 50, capWindow: 'DAY', capAmount: 10 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('colaborador não administra regra', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    const res = await app.inject({
      method: 'GET',
      url: '/admin/xp/rules',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
