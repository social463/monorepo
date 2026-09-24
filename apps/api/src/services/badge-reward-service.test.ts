import { describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { creditBadgeRewards, settleBadgesEarned } from './badge-reward-service'

/**
 * Documento 4, seção 11.4: o selo passou a pagar em duas moedas, com valor
 * configurado por selo. O funil existe para haver UM lugar que saiba disso —
 * `userBadge.create` aparece em seis pontos e o aviso era chamado de onze.
 */

vi.mock('./notification-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./notification-service')>()
  return { ...actual, notifyBadgesEarned: vi.fn().mockResolvedValue(undefined) }
})

const { notifyBadgesEarned } = await import('./notification-service')

const COMPANY = 'company-emr'

async function pessoa(email: string) {
  return prisma.user.create({ data: { name: 'Dev', email, passwordHash: 'x' } })
}

async function selo(slug: string, rewardPoints: number | null, rewardCoins: number | null) {
  return prisma.badge.create({
    data: {
      slug,
      name: `Selo ${slug}`,
      description: 'd',
      kind: 'IMPACT',
      iconKey: 'trophy',
      rewardPoints,
      rewardCoins,
      companyId: COMPANY,
    },
  })
}

describe('creditBadgeRewards', () => {
  it('credita Pontos e EMR Coins com o valor do selo', async () => {
    const user = await pessoa('credita@empresa.com')
    const badge = await selo('paga-os-dois', 50, 20)

    await creditBadgeRewards(user.id, [badge.id], COMPANY)

    const coins = await prisma.coinTransaction.findMany({ where: { userId: user.id } })
    const pontos = await prisma.xpTransaction.findMany({ where: { userId: user.id } })
    expect(coins).toHaveLength(1)
    expect(coins[0].amount).toBe(20)
    expect(coins[0].event).toBe('BADGE_EARNED')
    // `ruleId` null: o valor veio do selo, não de uma CoinRule.
    expect(coins[0].ruleId).toBeNull()
    expect(pontos[0].amount).toBe(50)
  })

  it('credita só a moeda configurada', async () => {
    const user = await pessoa('so-pontos@empresa.com')
    const badge = await selo('so-pontos', 30, null)

    await creditBadgeRewards(user.id, [badge.id], COMPANY)

    expect(await prisma.coinTransaction.count({ where: { userId: user.id } })).toBe(0)
    expect(await prisma.xpTransaction.count({ where: { userId: user.id } })).toBe(1)
  })

  it('selo sem recompensa nenhuma não gera lançamento', async () => {
    const user = await pessoa('sem-nada@empresa.com')
    const badge = await selo('sem-nada', null, null)

    await creditBadgeRewards(user.id, [badge.id], COMPANY)

    expect(await prisma.coinTransaction.count({ where: { userId: user.id } })).toBe(0)
    expect(await prisma.xpTransaction.count({ where: { userId: user.id } })).toBe(0)
  })

  /**
   * O dedupe é pelo `badgeId`, e não pelo id da concessão: é o que faz o selo
   * pagar uma vez por pessoa, para sempre. Sem isso, revogar e conceder de novo
   * pagaria duas vezes — e é essa idempotência que torna seguro chamar o funil
   * de onze lugares que às vezes se sobrepõem.
   */
  it('conquistar o mesmo selo de novo não paga de novo', async () => {
    const user = await pessoa('duas-vezes@empresa.com')
    const badge = await selo('paga-uma-vez', 10, 10)

    await creditBadgeRewards(user.id, [badge.id], COMPANY)
    await creditBadgeRewards(user.id, [badge.id], COMPANY)

    expect(await prisma.coinTransaction.count({ where: { userId: user.id } })).toBe(1)
    expect(await prisma.xpTransaction.count({ where: { userId: user.id } })).toBe(1)
  })

  it('selos diferentes pagam cada um o seu', async () => {
    const user = await pessoa('dois-selos@empresa.com')
    const a = await selo('selo-a', 10, 5)
    const b = await selo('selo-b', 20, 7)

    await creditBadgeRewards(user.id, [a.id, b.id], COMPANY)

    const coins = await prisma.coinTransaction.findMany({ where: { userId: user.id }, orderBy: { amount: 'asc' } })
    expect(coins.map((t) => t.amount)).toEqual([5, 7])
  })
})

describe('settleBadgesEarned', () => {
  it('credita e avisa', async () => {
    const user = await pessoa('fecha@empresa.com')
    const badge = await selo('credita-e-avisa', 15, 15)

    await settleBadgesEarned(user.id, [badge.id], COMPANY)

    expect(await prisma.coinTransaction.count({ where: { userId: user.id } })).toBe(1)
    expect(notifyBadgesEarned).toHaveBeenCalledWith(user.id, [badge.id], COMPANY)
  })

  it('lista vazia não faz nada', async () => {
    vi.mocked(notifyBadgesEarned).mockClear()
    await settleBadgesEarned('quem-quer-que-seja', [], COMPANY)
    expect(notifyBadgesEarned).not.toHaveBeenCalled()
  })

  /**
   * Best-effort, como a avaliação de selos já era: falha de crédito é logada e
   * não derruba o voto, o feedback ou o curso que gerou o selo — e não pode
   * levar o aviso junto.
   */
  it('falha no crédito não impede o aviso', async () => {
    const user = await pessoa('best-effort@empresa.com')
    vi.mocked(notifyBadgesEarned).mockClear()
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Id que não existe: a busca não acha o selo e nada é creditado, mas o
    // aviso segue seu caminho.
    await settleBadgesEarned(user.id, ['selo-que-nao-existe'], COMPANY)

    expect(notifyBadgesEarned).toHaveBeenCalled()
    erro.mockRestore()
  })
})
