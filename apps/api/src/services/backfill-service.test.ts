import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { backfillForCompany, collectXpActions } from './backfill-service'
import { getXpPoints } from './xp-service'
import { awardCoins, getCoinBalance } from './coin-service'
import { dayFromYmd } from '../lib/sao-paulo-date'

async function createUser(name = 'Lenda') {
  return prisma.user.create({
    data: {
      name,
      email: `lenda-${Date.now()}-${Math.random()}@x.com`,
      passwordHash: 'x',
      role: 'LEGEND',
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

function createRule(input: {
  event: 'VOTE_CAST' | 'FEEDBACK_PUBLISHED' | 'FEEDBACK_REACTION' | 'MOOD_ANSWERED'
  amount: number
  capWindow?: 'NONE' | 'DAY' | 'WEEK' | 'MONTH'
  capAmount?: number | null
  active?: boolean
}) {
  return prisma.xpRule.create({
    data: {
      event: input.event,
      amount: input.amount,
      capWindow: input.capWindow ?? 'NONE',
      capAmount: input.capAmount ?? null,
      active: input.active ?? true,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

async function createFeedback(authorId: string, targetId: string, createdAt: Date) {
  return prisma.feedback.create({
    data: { authorId, targetId, message: 'ótimo trabalho', category: 'ELOGIO', createdAt, companyId: DEFAULT_COMPANY_ID },
  })
}

describe('backfillForCompany', () => {
  it('paga o histórico pelas regras ativas, com o dia da ação', async () => {
    const author = await createUser('Autora')
    const target = await createUser('Alvo')
    await createRule({ event: 'FEEDBACK_PUBLISHED', amount: 20 })
    await createRule({ event: 'MOOD_ANSWERED', amount: 10 })
    await createFeedback(author.id, target.id, new Date('2026-03-10T13:00:00.000Z'))
    await prisma.moodEntry.create({
      data: { userId: author.id, mood: 'GOOD', day: dayFromYmd('2026-03-11'), companyId: DEFAULT_COMPANY_ID },
    })

    const report = await backfillForCompany(DEFAULT_COMPANY_ID)

    expect(report).toMatchObject({ actions: 2, credited: 2, amount: 30, duplicates: 0, users: 1 })
    expect(await getXpPoints(author.id, DEFAULT_COMPANY_ID)).toBe(30)

    // O lançamento nasce no dia da ação, não no dia em que o backfill rodou.
    const entries = await prisma.xpTransaction.findMany({ where: { userId: author.id }, orderBy: { day: 'asc' } })
    expect(entries.map((entry) => entry.day.toISOString().slice(0, 10))).toEqual(['2026-03-10', '2026-03-11'])
  })

  it('roda duas vezes sem pagar de novo', async () => {
    const author = await createUser('Autora')
    const target = await createUser('Alvo')
    await createRule({ event: 'FEEDBACK_PUBLISHED', amount: 20 })
    await createFeedback(author.id, target.id, new Date('2026-03-10T13:00:00.000Z'))

    await backfillForCompany(DEFAULT_COMPANY_ID)
    const second = await backfillForCompany(DEFAULT_COMPANY_ID)

    expect(second).toMatchObject({ credited: 0, duplicates: 1, amount: 0, users: 0 })
    expect(await getXpPoints(author.id, DEFAULT_COMPANY_ID)).toBe(20)
  })

  it('respeita o teto da regra na janela em que a ação aconteceu', async () => {
    const author = await createUser('Autora')
    const target = await createUser('Alvo')
    // Teto de 20 no dia: o terceiro feedback do mesmo dia não cabe, mas o do
    // dia seguinte abre uma janela nova e é pago.
    await createRule({ event: 'FEEDBACK_PUBLISHED', amount: 10, capWindow: 'DAY', capAmount: 20 })
    await createFeedback(author.id, target.id, new Date('2026-03-10T12:00:00.000Z'))
    await createFeedback(author.id, target.id, new Date('2026-03-10T14:00:00.000Z'))
    await createFeedback(author.id, target.id, new Date('2026-03-10T16:00:00.000Z'))
    await createFeedback(author.id, target.id, new Date('2026-03-11T12:00:00.000Z'))

    const report = await backfillForCompany(DEFAULT_COMPANY_ID)

    expect(report).toMatchObject({ actions: 4, credited: 3, capped: 1, amount: 30 })
    expect(await getXpPoints(author.id, DEFAULT_COMPANY_ID)).toBe(30)
  })

  it('ignora evento sem regra ativa', async () => {
    const author = await createUser('Autora')
    const target = await createUser('Alvo')
    await createRule({ event: 'FEEDBACK_PUBLISHED', amount: 20, active: false })
    await createFeedback(author.id, target.id, new Date('2026-03-10T13:00:00.000Z'))

    const report = await backfillForCompany(DEFAULT_COMPANY_ID)

    expect(report).toMatchObject({ actions: 1, credited: 0, skipped: 1, amount: 0 })
    expect(await getXpPoints(author.id, DEFAULT_COMPANY_ID)).toBe(0)
  })

  it('paga coins pelas regras de coin, sem misturar com as de XP', async () => {
    const author = await createUser('Autora')
    const target = await createUser('Alvo')
    await createRule({ event: 'FEEDBACK_PUBLISHED', amount: 20 })
    await prisma.coinRule.create({
      data: { event: 'FEEDBACK_PUBLISHED', amount: 7, capWindow: 'NONE', capAmount: null, companyId: DEFAULT_COMPANY_ID },
    })
    await createFeedback(author.id, target.id, new Date('2026-03-10T13:00:00.000Z'))

    const coins = await backfillForCompany(DEFAULT_COMPANY_ID, 'coins')

    expect(coins).toMatchObject({ currency: 'coins', credited: 1, amount: 7 })
    expect(await getCoinBalance(author.id, DEFAULT_COMPANY_ID)).toBe(7)
    // O XP continua zerado: as duas moedas são backfills independentes.
    expect(await getXpPoints(author.id, DEFAULT_COMPANY_ID)).toBe(0)

    const xp = await backfillForCompany(DEFAULT_COMPANY_ID, 'xp')
    expect(xp).toMatchObject({ currency: 'xp', credited: 1, amount: 20 })
    expect(await getCoinBalance(author.id, DEFAULT_COMPANY_ID)).toBe(7)
  })

  it('não recredita coin de ação que o crédito ao vivo já pagou', async () => {
    const author = await createUser('Autora')
    const target = await createUser('Alvo')
    await prisma.coinRule.create({
      data: { event: 'FEEDBACK_PUBLISHED', amount: 7, capWindow: 'NONE', capAmount: null, companyId: DEFAULT_COMPANY_ID },
    })
    const feedback = await createFeedback(author.id, target.id, new Date('2026-03-10T13:00:00.000Z'))
    // Como se o crédito tivesse acontecido na hora do feedback.
    await awardCoins({
      userId: author.id,
      companyId: DEFAULT_COMPANY_ID,
      event: 'FEEDBACK_PUBLISHED',
      reference: feedback.id,
    })

    const report = await backfillForCompany(DEFAULT_COMPANY_ID, 'coins')

    expect(report).toMatchObject({ credited: 0, duplicates: 1, amount: 0 })
    expect(await getCoinBalance(author.id, DEFAULT_COMPANY_ID)).toBe(7)
  })

  it('coleta as ações em ordem cronológica e com a mesma referência do crédito ao vivo', async () => {
    const author = await createUser('Autora')
    const target = await createUser('Alvo')
    const feedback = await createFeedback(author.id, target.id, new Date('2026-03-10T13:00:00.000Z'))
    await prisma.feedbackReaction.create({
      data: {
        feedbackId: feedback.id,
        userId: target.id,
        emoji: '👏',
        createdAt: new Date('2026-03-09T13:00:00.000Z'),
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    const actions = await collectXpActions(DEFAULT_COMPANY_ID)

    expect(actions).toEqual([
      { userId: target.id, event: 'FEEDBACK_REACTION', reference: `${feedback.id}:👏`, at: new Date('2026-03-09T13:00:00.000Z') },
      { userId: author.id, event: 'FEEDBACK_PUBLISHED', reference: feedback.id, at: new Date('2026-03-10T13:00:00.000Z') },
    ])
  })
})
