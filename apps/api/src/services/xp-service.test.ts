import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { awardXp, getXpPoints, revokeXp } from './xp-service'

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

function createRule(event: 'CORPORATE_POST_REACTION' | 'CORPORATE_POST_COMMENT', amount: number) {
  return prisma.xpRule.create({
    data: { event, amount, capWindow: 'NONE', active: true, companyId: DEFAULT_COMPANY_ID },
  })
}

describe('revokeXp', () => {
  it('apaga o lançamento em vez de debitar, e deixa recreditar depois', async () => {
    const user = await createUser()
    await createRule('CORPORATE_POST_REACTION', 1)

    await awardXp({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      event: 'CORPORATE_POST_REACTION',
      reference: 'post-1',
    })
    expect(await getXpPoints(user.id, DEFAULT_COMPANY_ID)).toBe(1)

    const revoked = await revokeXp({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      event: 'CORPORATE_POST_REACTION',
      reference: 'post-1',
    })

    expect(revoked).toEqual({ revoked: 1 })
    expect(await getXpPoints(user.id, DEFAULT_COMPANY_ID)).toBe(0)
    // Nada de lançamento negativo: a linha SAI do extrato. É o que mantém o
    // invariante de sinal que `computeLevel` e o backfill assumem.
    expect(await prisma.xpTransaction.count({ where: { userId: user.id } })).toBe(0)

    // Refez a ação: a unique (userId, dedupeKey) está livre, então paga de novo.
    const again = await awardXp({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      event: 'CORPORATE_POST_REACTION',
      reference: 'post-1',
    })
    expect(again.status).toBe('CREDITED')
    expect(await getXpPoints(user.id, DEFAULT_COMPANY_ID)).toBe(1)
  })

  it('sem crédito a estornar é no-op, não erro', async () => {
    const user = await createUser()
    await createRule('CORPORATE_POST_COMMENT', 2)

    await expect(
      revokeXp({
        userId: user.id,
        companyId: DEFAULT_COMPANY_ID,
        event: 'CORPORATE_POST_COMMENT',
        reference: 'post-inexistente',
      }),
    ).resolves.toEqual({ revoked: 0 })
  })

  it('não estorna o crédito de outra pessoa com a mesma referência', async () => {
    const a = await createUser('A')
    const b = await createUser('B')
    await createRule('CORPORATE_POST_REACTION', 1)
    for (const user of [a, b]) {
      await awardXp({
        userId: user.id,
        companyId: DEFAULT_COMPANY_ID,
        event: 'CORPORATE_POST_REACTION',
        reference: 'post-1',
      })
    }

    await revokeXp({
      userId: a.id,
      companyId: DEFAULT_COMPANY_ID,
      event: 'CORPORATE_POST_REACTION',
      reference: 'post-1',
    })

    expect(await getXpPoints(a.id, DEFAULT_COMPANY_ID)).toBe(0)
    expect(await getXpPoints(b.id, DEFAULT_COMPANY_ID)).toBe(1)
  })
})
