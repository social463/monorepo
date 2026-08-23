import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  adjustCoinsManually,
  createCoinRule,
  deleteCoinRule,
  getCoinReport,
  listCoinRules,
  updateCoinRule,
} from './coin-admin-service'
import { awardCoins, getCoinBalance } from './coin-service'
import { redeemProduct } from './store-service'

async function createActor() {
  const user = await prisma.user.create({
    data: { name: 'Admin', email: `admin-coin-${Date.now()}-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  return user.id
}

async function createLegend(companyId = DEFAULT_COMPANY_ID, sectorId?: string) {
  return prisma.user.create({
    data: {
      name: 'Lenda',
      email: `lenda-coin-${Date.now()}-${Math.random()}@x.com`,
      passwordHash: 'x',
      role: 'LEGEND',
      companyId,
      ...(sectorId ? { sectorId } : {}),
    },
  })
}

describe('CRUD de regra', () => {
  it('cria regra, audita e recusa segunda regra do mesmo evento', async () => {
    const actorId = await createActor()
    const rule = await createCoinRule(
      { event: 'VOTE_CAST', amount: 50, capWindow: 'NONE', capAmount: null },
      actorId,
      DEFAULT_COMPANY_ID,
    )
    expect(rule.capAmount).toBeNull()

    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'CoinRule', entityId: rule.id } })
    expect(logs.map((l) => l.action)).toEqual(['CREATE'])

    await expect(
      createCoinRule({ event: 'VOTE_CAST', amount: 10, capWindow: 'NONE', capAmount: null }, actorId, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('valida o par janela/teto', async () => {
    const actorId = await createActor()
    await expect(
      createCoinRule({ event: 'VOTE_CAST', amount: 10, capWindow: 'DAY', capAmount: null }, actorId, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({ status: 400 })

    await expect(
      createCoinRule({ event: 'VOTE_CAST', amount: 10, capWindow: 'DAY', capAmount: 5 }, actorId, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({ status: 400 })

    // capWindow NONE zera o teto informado por engano.
    const rule = await createCoinRule(
      { event: 'VOTE_CAST', amount: 10, capWindow: 'NONE', capAmount: 999 },
      actorId,
      DEFAULT_COMPANY_ID,
    )
    expect(rule.capAmount).toBeNull()
  })

  it('atualiza regra e registra before/after; voltar para NONE zera o teto', async () => {
    const actorId = await createActor()
    const rule = await createCoinRule(
      { event: 'MOOD_ANSWERED', amount: 10, capWindow: 'DAY', capAmount: 30 },
      actorId,
      DEFAULT_COMPANY_ID,
    )

    const updated = await updateCoinRule(rule.id, { capWindow: 'NONE' }, actorId, DEFAULT_COMPANY_ID)
    expect(updated.capAmount).toBeNull()
    expect(updated.capWindow).toBe('NONE')

    const logs = await prisma.adminAuditLog.findMany({
      where: { entityType: 'CoinRule', entityId: rule.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(logs.map((l) => l.action)).toEqual(['CREATE', 'UPDATE'])
    expect(logs[1].before).toMatchObject({ capAmount: 30 })

    await expect(updateCoinRule('nao-existe', { amount: 5 }, actorId, DEFAULT_COMPANY_ID)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('apagar regra preserva os lançamentos já pagos', async () => {
    const actorId = await createActor()
    const user = await createLegend()
    const rule = await createCoinRule(
      { event: 'VOTE_CAST', amount: 50, capWindow: 'NONE', capAmount: null },
      actorId,
      DEFAULT_COMPANY_ID,
    )
    await awardCoins({ userId: user.id, companyId: DEFAULT_COMPANY_ID, event: 'VOTE_CAST', reference: 'v1' })

    await deleteCoinRule(rule.id, actorId, DEFAULT_COMPANY_ID)

    expect(await listCoinRules(DEFAULT_COMPANY_ID)).toHaveLength(0)
    const entry = await prisma.coinTransaction.findFirstOrThrow({ where: { userId: user.id } })
    expect(entry.ruleId).toBeNull()
    expect(entry.event).toBe('VOTE_CAST')
    expect(await getCoinBalance(user.id, DEFAULT_COMPANY_ID)).toBe(50)
  })

  it('isola regras por empresa', async () => {
    const actorId = await createActor()
    const otherCompany = await prisma.company.create({
      data: { name: 'Outra Regra', slug: `outra-regra-${Date.now()}` },
    })
    const otherRule = await createCoinRule(
      { event: 'VOTE_CAST', amount: 9, capWindow: 'NONE', capAmount: null },
      actorId,
      otherCompany.id,
    )

    expect(await listCoinRules(DEFAULT_COMPANY_ID)).toHaveLength(0)
    await expect(updateCoinRule(otherRule.id, { amount: 1 }, actorId, DEFAULT_COMPANY_ID)).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('ajuste manual', () => {
  it('credita, audita e devolve o saldo novo', async () => {
    const actorId = await createActor()
    const user = await createLegend()

    const result = await adjustCoinsManually(
      { userId: user.id, amount: 75, reason: 'Palestra na Quinta de Dev' },
      actorId,
      DEFAULT_COMPANY_ID,
    )

    expect(result.balance).toBe(75)
    expect(result.transaction.kind).toBe('MANUAL_CREDIT')
    expect(result.transaction.actor?.id).toBe(actorId)

    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'CoinTransaction' } })
    expect(logs).toHaveLength(1)
    expect(logs[0].after).toMatchObject({ amount: 75, reason: 'Palestra na Quinta de Dev' })
  })

  it('permite dois ajustes seguidos no mesmo colaborador', async () => {
    const actorId = await createActor()
    const user = await createLegend()

    await adjustCoinsManually({ userId: user.id, amount: 10, reason: 'um' }, actorId, DEFAULT_COMPANY_ID)
    const second = await adjustCoinsManually({ userId: user.id, amount: 10, reason: 'dois' }, actorId, DEFAULT_COMPANY_ID)

    expect(second.balance).toBe(20)
  })

  it('recusa débito maior que o saldo, informando o disponível', async () => {
    const actorId = await createActor()
    const user = await createLegend()
    await adjustCoinsManually({ userId: user.id, amount: 30, reason: 'crédito' }, actorId, DEFAULT_COMPANY_ID)

    await expect(
      adjustCoinsManually({ userId: user.id, amount: -31, reason: 'estorno' }, actorId, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('30') })

    const ok = await adjustCoinsManually({ userId: user.id, amount: -30, reason: 'estorno' }, actorId, DEFAULT_COMPANY_ID)
    expect(ok.balance).toBe(0)
    expect(ok.transaction.kind).toBe('MANUAL_DEBIT')
  })

  // O ajuste manual reusa o advisory lock por pessoa da loja (`store:<userId>`):
  // sem ele, um débito manual e um resgate concorrentes da MESMA pessoa liam o
  // mesmo saldo, os dois passavam no cheque e o saldo terminava negativo com o
  // produto entregue mesmo assim (achado #7 da revisão final).
  it('débito manual e resgate concorrentes da mesma pessoa não deixam o saldo negativo', async () => {
    const actorId = await createActor()
    const user = await createLegend()
    await adjustCoinsManually({ userId: user.id, amount: 100, reason: 'saldo inicial' }, actorId, DEFAULT_COMPANY_ID)

    const shopAdmin = await createActor()
    const product = await prisma.storeProduct.create({
      data: {
        title: 'Produto concorrente',
        category: 'Equipamento',
        priceInCoins: 100,
        stock: 5,
        createdById: shopAdmin,
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    const results = await Promise.allSettled([
      adjustCoinsManually({ userId: user.id, amount: -100, reason: 'zerar saldo' }, actorId, DEFAULT_COMPANY_ID),
      redeemProduct({ id: user.id, companyId: DEFAULT_COMPANY_ID }, product.id),
    ])

    // Exatamente um dos dois vence: o outro lê o saldo já debitado (0) e recusa
    // — débito manual por saldo insuficiente, ou resgate por saldo insuficiente.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await getCoinBalance(user.id, DEFAULT_COMPANY_ID)).toBe(0)
  })

  it('recusa colaborador de outra empresa', async () => {
    const actorId = await createActor()
    const otherCompany = await prisma.company.create({
      data: { name: 'Outra Ajuste', slug: `outra-ajuste-${Date.now()}` },
    })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Ajuste', slug: `setor-ajuste-${Date.now()}`, companyId: otherCompany.id, enabledFeatures: [] },
    })
    const outsider = await createLegend(otherCompany.id, otherSector.id)

    await expect(
      adjustCoinsManually({ userId: outsider.id, amount: 10, reason: 'x' }, actorId, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('relatório', () => {
  it('agrega por evento, separa manuais e filtra por setor', async () => {
    const actorId = await createActor()
    const sector = await prisma.sector.create({
      data: { name: 'Setor Relatório', slug: `setor-relatorio-${Date.now()}`, enabledFeatures: [] },
    })
    const inSector = await createLegend(DEFAULT_COMPANY_ID, sector.id)
    const outSector = await createLegend()

    await createCoinRule({ event: 'VOTE_CAST', amount: 50, capWindow: 'NONE', capAmount: null }, actorId, DEFAULT_COMPANY_ID)
    await awardCoins({ userId: inSector.id, companyId: DEFAULT_COMPANY_ID, event: 'VOTE_CAST', reference: 'v1' })
    await awardCoins({ userId: outSector.id, companyId: DEFAULT_COMPANY_ID, event: 'VOTE_CAST', reference: 'v2' })
    await adjustCoinsManually({ userId: inSector.id, amount: 5, reason: 'bônus' }, actorId, DEFAULT_COMPANY_ID)

    const report = await getCoinReport(DEFAULT_COMPANY_ID, {})
    const voteRow = report.rows.find((row) => row.event === 'VOTE_CAST')
    expect(voteRow).toMatchObject({ totalAmount: 100, transactionCount: 2, userCount: 2, amount: 50 })
    expect(report.manual).toMatchObject({ creditedAmount: 5, debitedAmount: 0, transactionCount: 1 })
    expect(report.totalAmount).toBe(105)

    const bySector = await getCoinReport(DEFAULT_COMPANY_ID, { sectorId: sector.id })
    expect(bySector.rows.find((row) => row.event === 'VOTE_CAST')).toMatchObject({
      totalAmount: 50,
      userCount: 1,
    })
    expect(bySector.sectorId).toBe(sector.id)
  })

  it('recorta por período pelo dia civil', async () => {
    const actorId = await createActor()
    const user = await createLegend()
    await createCoinRule({ event: 'VOTE_CAST', amount: 50, capWindow: 'NONE', capAmount: null }, actorId, DEFAULT_COMPANY_ID)
    await awardCoins({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      event: 'VOTE_CAST',
      reference: 'v1',
      now: new Date('2026-06-15T12:00:00.000Z'),
    })

    const inRange = await getCoinReport(DEFAULT_COMPANY_ID, {
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-30T00:00:00.000Z'),
    })
    expect(inRange.totalAmount).toBe(50)
    expect(inRange.from).toBe('2026-06-01')

    const outOfRange = await getCoinReport(DEFAULT_COMPANY_ID, {
      from: new Date('2026-07-01T00:00:00.000Z'),
    })
    expect(outOfRange.totalAmount).toBe(0)
  })
})
