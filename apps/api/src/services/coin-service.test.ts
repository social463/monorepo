import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { awardCoins, awardFixedCoins, getCoinBalance, listActiveCoinRules, listCoinTransactions, spendCoins, refundCoins } from './coin-service'
import { dayFromYmd } from '../lib/sao-paulo-date'

async function createUser(companyId = DEFAULT_COMPANY_ID, sectorId?: string) {
  return prisma.user.create({
    data: {
      name: 'Lenda',
      email: `lenda-${Date.now()}-${Math.random()}@x.com`,
      passwordHash: 'x',
      role: 'LEGEND',
      companyId,
      ...(sectorId ? { sectorId } : {}),
    },
  })
}

function createRule(input: {
  event: 'VOTE_CAST' | 'FEEDBACK_PUBLISHED' | 'FEEDBACK_REACTION' | 'MOOD_ANSWERED'
  amount: number
  capWindow?: 'NONE' | 'DAY' | 'WEEK' | 'MONTH'
  capAmount?: number | null
  active?: boolean
  companyId?: string
}) {
  return prisma.coinRule.create({
    data: {
      event: input.event,
      amount: input.amount,
      capWindow: input.capWindow ?? 'NONE',
      capAmount: input.capAmount ?? null,
      active: input.active ?? true,
      companyId: input.companyId ?? DEFAULT_COMPANY_ID,
    },
  })
}

describe('awardCoins', () => {
  it('credita o valor da regra ativa', async () => {
    const user = await createUser()
    await createRule({ event: 'VOTE_CAST', amount: 50 })

    const outcome = await awardCoins({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      event: 'VOTE_CAST',
      reference: 'voto-1',
    })

    expect(outcome).toMatchObject({ status: 'CREDITED', amount: 50 })
    expect(await getCoinBalance(user.id, DEFAULT_COMPANY_ID)).toBe(50)
  })

  it('não credita quando não há regra ou quando a regra está inativa', async () => {
    const user = await createUser()
    expect(
      await awardCoins({ userId: user.id, companyId: DEFAULT_COMPANY_ID, event: 'VOTE_CAST', reference: 'v1' }),
    ).toEqual({ status: 'NO_RULE' })

    await createRule({ event: 'VOTE_CAST', amount: 50, active: false })
    expect(
      await awardCoins({ userId: user.id, companyId: DEFAULT_COMPANY_ID, event: 'VOTE_CAST', reference: 'v1' }),
    ).toEqual({ status: 'RULE_INACTIVE' })
    expect(await getCoinBalance(user.id, DEFAULT_COMPANY_ID)).toBe(0)
  })

  it('paga uma vez por ação: mesma referência é DUPLICATE, referências distintas pagam de novo', async () => {
    const user = await createUser()
    await createRule({ event: 'FEEDBACK_PUBLISHED', amount: 20 })
    const args = { userId: user.id, companyId: DEFAULT_COMPANY_ID, event: 'FEEDBACK_PUBLISHED' } as const

    expect(await awardCoins({ ...args, reference: 'fb-1' })).toMatchObject({ status: 'CREDITED' })
    expect(await awardCoins({ ...args, reference: 'fb-1' })).toEqual({ status: 'DUPLICATE' })
    expect(await awardCoins({ ...args, reference: 'fb-2' })).toMatchObject({ status: 'CREDITED' })

    expect(await getCoinBalance(user.id, DEFAULT_COMPANY_ID)).toBe(40)
  })

  it('respeita o teto diário sem crédito parcial', async () => {
    const user = await createUser()
    await createRule({ event: 'FEEDBACK_REACTION', amount: 4, capWindow: 'DAY', capAmount: 10 })
    const args = { userId: user.id, companyId: DEFAULT_COMPANY_ID, event: 'FEEDBACK_REACTION' } as const

    await awardCoins({ ...args, reference: 'r1' })
    await awardCoins({ ...args, reference: 'r2' })
    const third = await awardCoins({ ...args, reference: 'r3' })

    // 4 + 4 = 8; o terceiro crédito levaria a 12 > 10, então nada é creditado.
    expect(third).toMatchObject({ status: 'CAP_REACHED', capAmount: 10, used: 8 })
    expect(await getCoinBalance(user.id, DEFAULT_COMPANY_ID)).toBe(8)
  })

  it('conta o teto semanal de segunda a domingo', async () => {
    const user = await createUser()
    await createRule({ event: 'MOOD_ANSWERED', amount: 10, capWindow: 'WEEK', capAmount: 10 })
    const args = { userId: user.id, companyId: DEFAULT_COMPANY_ID, event: 'MOOD_ANSWERED' } as const
    // 2026-07-27 é segunda e 2026-08-02 é o domingo da MESMA semana civil.
    const monday = new Date('2026-07-27T12:00:00.000Z')
    const sunday = new Date('2026-08-02T12:00:00.000Z')
    const nextMonday = new Date('2026-08-03T12:00:00.000Z')

    expect(await awardCoins({ ...args, reference: '2026-07-27', now: monday })).toMatchObject({ status: 'CREDITED' })
    expect(await awardCoins({ ...args, reference: '2026-08-02', now: sunday })).toMatchObject({ status: 'CAP_REACHED' })
    // Semana nova: o teto zera.
    expect(await awardCoins({ ...args, reference: '2026-08-03', now: nextMonday })).toMatchObject({ status: 'CREDITED' })
    expect(await getCoinBalance(user.id, DEFAULT_COMPANY_ID)).toBe(20)
  })

  it('conta o teto mensal só dentro do mês civil', async () => {
    const user = await createUser()
    await createRule({ event: 'VOTE_CAST', amount: 30, capWindow: 'MONTH', capAmount: 30 })
    const args = { userId: user.id, companyId: DEFAULT_COMPANY_ID, event: 'VOTE_CAST' } as const

    expect(
      await awardCoins({ ...args, reference: 'jun', now: new Date('2026-06-30T12:00:00.000Z') }),
    ).toMatchObject({ status: 'CREDITED' })
    expect(
      await awardCoins({ ...args, reference: 'jul', now: new Date('2026-07-01T12:00:00.000Z') }),
    ).toMatchObject({ status: 'CREDITED' })
    expect(
      await awardCoins({ ...args, reference: 'jul-2', now: new Date('2026-07-15T12:00:00.000Z') }),
    ).toMatchObject({ status: 'CAP_REACHED' })
  })

  it('ajuste manual (sem regra) não consome o teto', async () => {
    const user = await createUser()
    const rule = await createRule({ event: 'VOTE_CAST', amount: 10, capWindow: 'DAY', capAmount: 10 })
    await prisma.coinTransaction.create({
      data: {
        userId: user.id,
        kind: 'MANUAL_CREDIT',
        amount: 100,
        reason: 'palestra',
        dedupeKey: 'MANUAL:teste',
        day: dayFromYmd('2026-07-27'),
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    const outcome = await awardCoins({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      event: 'VOTE_CAST',
      reference: 'voto-1',
      now: new Date('2026-07-27T12:00:00.000Z'),
    })

    expect(outcome).toMatchObject({ status: 'CREDITED' })
    expect(await getCoinBalance(user.id, DEFAULT_COMPANY_ID)).toBe(110)
    const credited = await prisma.coinTransaction.findFirst({ where: { ruleId: rule.id } })
    expect(credited?.amount).toBe(10)
  })

  it('isola por empresa: regra de outra empresa não credita, extrato não vaza', async () => {
    const otherCompany = await prisma.company.create({
      data: { name: 'Outra Coins', slug: `outra-coins-${Date.now()}` },
    })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Coins', slug: `setor-coins-${Date.now()}`, companyId: otherCompany.id, enabledFeatures: [] },
    })
    const otherUser = await createUser(otherCompany.id, otherSector.id)
    await createRule({ event: 'VOTE_CAST', amount: 50, companyId: DEFAULT_COMPANY_ID })

    // Usuário da outra empresa: a regra da empresa default não vale para ele.
    expect(
      await awardCoins({ userId: otherUser.id, companyId: otherCompany.id, event: 'VOTE_CAST', reference: 'v1' }),
    ).toEqual({ status: 'NO_RULE' })

    await createRule({ event: 'VOTE_CAST', amount: 7, companyId: otherCompany.id })
    await awardCoins({ userId: otherUser.id, companyId: otherCompany.id, event: 'VOTE_CAST', reference: 'v1' })

    expect(await getCoinBalance(otherUser.id, otherCompany.id)).toBe(7)
    // Consultado a partir da empresa default, o mesmo usuário não tem saldo nem extrato.
    expect(await getCoinBalance(otherUser.id, DEFAULT_COMPANY_ID)).toBe(0)
    const leaked = await listCoinTransactions(otherUser.id, DEFAULT_COMPANY_ID, { page: 1, pageSize: 30 })
    expect(leaked.total).toBe(0)
  })
})

describe('extrato e regras', () => {
  it('lista o extrato paginado, mais recente primeiro, e soma crédito com débito', async () => {
    const user = await createUser()
    await createRule({ event: 'FEEDBACK_PUBLISHED', amount: 20 })
    await awardCoins({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      event: 'FEEDBACK_PUBLISHED',
      reference: 'fb-1',
    })
    await prisma.coinTransaction.create({
      data: {
        userId: user.id,
        kind: 'MANUAL_DEBIT',
        amount: -5,
        reason: 'ajuste',
        dedupeKey: 'MANUAL:debito',
        day: dayFromYmd('2026-07-27'),
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    expect(await getCoinBalance(user.id, DEFAULT_COMPANY_ID)).toBe(15)

    const firstPage = await listCoinTransactions(user.id, DEFAULT_COMPANY_ID, { page: 1, pageSize: 1 })
    expect(firstPage.total).toBe(2)
    expect(firstPage.entries).toHaveLength(1)
    expect(firstPage.entries[0].kind).toBe('MANUAL_DEBIT')

    const secondPage = await listCoinTransactions(user.id, DEFAULT_COMPANY_ID, { page: 2, pageSize: 1 })
    expect(secondPage.entries[0].kind).toBe('EARN')

    const onlyEarn = await listCoinTransactions(user.id, DEFAULT_COMPANY_ID, {
      page: 1,
      pageSize: 30,
      kind: 'EARN',
    })
    expect(onlyEarn.total).toBe(1)
  })

  it('listActiveCoinRules devolve só as regras ativas da empresa', async () => {
    await createRule({ event: 'VOTE_CAST', amount: 50 })
    await createRule({ event: 'MOOD_ANSWERED', amount: 10, active: false })

    const rules = await listActiveCoinRules(DEFAULT_COMPANY_ID)
    expect(rules.map((r) => r.event)).toEqual(['VOTE_CAST'])
  })
})

describe('awardFixedCoins', () => {
  it('credita o valor explícito sem depender de CoinRule', async () => {
    const user = await prisma.user.create({
      data: { name: 'Fixa', email: `fixa-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })

    const result = await awardFixedCoins({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      amount: 250,
      event: 'CHALLENGE_APPROVED',
      reference: 'sub-1',
    })

    expect(result).toMatchObject({ status: 'CREDITED', amount: 250 })
    const tx = await prisma.coinTransaction.findFirstOrThrow({ where: { userId: user.id } })
    expect(tx.dedupeKey).toBe('CHALLENGE_APPROVED:sub-1')
    expect(tx.ruleId).toBeNull()
    expect(tx.kind).toBe('EARN')
  })

  it('é idempotente pela mesma referência', async () => {
    const user = await prisma.user.create({
      data: { name: 'Dup', email: `dup-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })
    const input = {
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      amount: 100,
      event: 'CHALLENGE_APPROVED' as const,
      reference: 'sub-2',
    }

    await awardFixedCoins(input)
    expect(await awardFixedCoins(input)).toEqual({ status: 'DUPLICATE' })
    expect(await prisma.coinTransaction.count({ where: { userId: user.id } })).toBe(1)
  })

  it('não lança nada quando o valor não é positivo', async () => {
    const user = await prisma.user.create({
      data: { name: 'Zero', email: `zero-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })
    expect(
      await awardFixedCoins({
        userId: user.id,
        companyId: DEFAULT_COMPANY_ID,
        amount: 0,
        event: 'CHALLENGE_APPROVED',
        reference: 'sub-3',
      }),
    ).toEqual({ status: 'SKIPPED' })
    expect(await prisma.coinTransaction.count({ where: { userId: user.id } })).toBe(0)
  })
})

describe('spendCoins / refundCoins', () => {
  async function makeUser() {
    return prisma.user.create({
      data: { name: 'Pessoa', email: `s-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })
  }

  it('gasto grava lançamento negativo com kind SPEND', async () => {
    const user = await makeUser()
    const out = await spendCoins({
      userId: user.id, companyId: DEFAULT_COMPANY_ID, amount: 120, orderId: 'order-1',
    })

    expect(out.status).toBe('RECORDED')
    const row = await prisma.coinTransaction.findFirst({ where: { userId: user.id } })
    expect(row?.kind).toBe('SPEND')
    expect(row?.amount).toBe(-120)
    expect(row?.event).toBeNull()
    expect(row?.dedupeKey).toBe('STORE_ORDER:order-1')
  })

  it('estorno grava lançamento positivo com kind REFUND', async () => {
    const user = await makeUser()
    await refundCoins({ userId: user.id, companyId: DEFAULT_COMPANY_ID, amount: 120, orderId: 'order-2' })

    const row = await prisma.coinTransaction.findFirst({ where: { userId: user.id } })
    expect(row?.kind).toBe('REFUND')
    expect(row?.amount).toBe(120)
    expect(row?.dedupeKey).toBe('STORE_REFUND:order-2')
  })

  // Esta é a rede que garante "cancelar duas vezes não credita duas": vem do
  // banco (unique userId+dedupeKey), não da lógica de quem chama.
  it('estorno repetido do mesmo pedido devolve DUPLICATE e não credita de novo', async () => {
    const user = await makeUser()
    await refundCoins({ userId: user.id, companyId: DEFAULT_COMPANY_ID, amount: 50, orderId: 'order-3' })
    const segunda = await refundCoins({
      userId: user.id, companyId: DEFAULT_COMPANY_ID, amount: 50, orderId: 'order-3',
    })

    expect(segunda.status).toBe('DUPLICATE')
    expect(await getCoinBalance(user.id, DEFAULT_COMPANY_ID)).toBe(50)
  })
})
