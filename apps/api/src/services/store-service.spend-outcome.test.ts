import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'

/**
 * Mocka a fronteira do livro-razão (mesmo padrão de
 * highlight-service.orchestration.test.ts, que mocka gemini-client,
 * card-renderer e highlight-storage): simula a única forma — hoje
 * inalcançável em produção, já que o `orderId` é um cuid novo minted dentro
 * da mesma transação — de `spendCoins` recusar o débito do resgate por
 * dedupeKey já usado.
 */
vi.mock('./coin-service', () => ({
  spendCoins: vi.fn(async () => ({ status: 'DUPLICATE' as const })),
}))

import { redeemProduct, SpendFailedError } from './store-service'

async function makeUser() {
  return prisma.user.create({
    data: { name: 'Pessoa', email: `p-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
  })
}

async function credit(userId: string, amount: number) {
  await prisma.coinTransaction.create({
    data: {
      userId, kind: 'MANUAL_CREDIT', amount, reason: 'saldo de teste',
      dedupeKey: `MANUAL:${Math.random()}`, day: new Date('2026-08-02'),
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

async function makeProduct() {
  const admin = await makeUser()
  return prisma.storeProduct.create({
    data: {
      title: 'Fone', category: 'Equipamento', priceInCoins: 100, stock: 5,
      createdById: admin.id, companyId: DEFAULT_COMPANY_ID,
    },
  })
}

function balanceOf(userId: string) {
  return prisma.coinTransaction
    .aggregate({ where: { userId }, _sum: { amount: true } })
    .then((r) => r._sum.amount ?? 0)
}

describe('redeemProduct — outcome de spendCoins', () => {
  // Achado #6 da revisão final: o resgate ignorava o retorno de `spendCoins`,
  // confiando por reasoning (não por construção) que o dedupeKey nunca
  // colidiria. Este teste força o outcome `DUPLICATE` e comprova que a
  // transação inteira reverte — não só que a chamada lança, mas que NADA fica
  // gravado: nem pedido, nem débito, nem baixa de estoque.
  it('reverte a transação inteira quando spendCoins não devolve RECORDED', async () => {
    const user = await makeUser()
    await credit(user.id, 300)
    const product = await makeProduct()

    await expect(
      redeemProduct({ id: user.id, companyId: DEFAULT_COMPANY_ID }, product.id),
    ).rejects.toBeInstanceOf(SpendFailedError)

    expect(await prisma.storeOrder.count()).toBe(0)
    const afterProduct = await prisma.storeProduct.findUniqueOrThrow({ where: { id: product.id } })
    expect(afterProduct.stock).toBe(5)
    // Só o crédito inicial de 300 sobrevive — nenhum SPEND foi gravado.
    expect(await balanceOf(user.id)).toBe(300)
    expect(await prisma.coinTransaction.count({ where: { userId: user.id, kind: 'SPEND' } })).toBe(0)
  })
})
