import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  listAvailableProducts,
  redeemProduct,
  listMyOrders,
  InsufficientBalanceError,
  OutOfStockError,
  ProductUnavailableError,
} from './store-service'

async function makeUser() {
  return prisma.user.create({
    data: { name: 'Pessoa', email: `p-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
  })
}

/** Credita saldo pelo caminho normal do livro-razão (ajuste manual do admin). */
async function credit(userId: string, amount: number) {
  await prisma.coinTransaction.create({
    data: {
      userId, kind: 'MANUAL_CREDIT', amount, reason: 'saldo de teste',
      dedupeKey: `MANUAL:${Math.random()}`, day: new Date('2026-08-02'),
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

function balanceOf(userId: string) {
  return prisma.coinTransaction
    .aggregate({ where: { userId }, _sum: { amount: true } })
    .then((r) => r._sum.amount ?? 0)
}

async function makeProduct(overrides: Partial<{ priceInCoins: number; stock: number; isActive: boolean; title: string }> = {}) {
  const admin = await makeUser()
  return prisma.storeProduct.create({
    data: {
      title: overrides.title ?? 'Fone',
      category: 'Equipamento',
      priceInCoins: overrides.priceInCoins ?? 100,
      stock: overrides.stock ?? 5,
      isActive: overrides.isActive ?? true,
      createdById: admin.id,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

function customer(id: string) {
  return { id, companyId: DEFAULT_COMPANY_ID }
}

describe('vitrine', () => {
  it('esconde produto inativo e produto sem estoque', async () => {
    await makeProduct({ title: 'Ativo com estoque' })
    await makeProduct({ title: 'Inativo', isActive: false })
    await makeProduct({ title: 'Zerado', stock: 0 })

    const products = await listAvailableProducts(DEFAULT_COMPANY_ID)

    expect(products.map((p) => p.title)).toEqual(['Ativo com estoque'])
  })
})

describe('resgate', () => {
  it('debita o preço exato, tira 1 do estoque e congela título e preço', async () => {
    const user = await makeUser()
    await credit(user.id, 300)
    const product = await makeProduct({ priceInCoins: 120, stock: 5 })

    const { order, balance } = await redeemProduct(customer(user.id), product.id)

    expect(balance).toBe(180)
    expect(order.status).toBe('PENDING')
    expect(order.productTitle).toBe('Fone')
    expect(order.pricePaid).toBe(120)
    const after = await prisma.storeProduct.findUniqueOrThrow({ where: { id: product.id } })
    expect(after.stock).toBe(4)
  })

  it('recusa por saldo insuficiente e não grava NADA', async () => {
    const user = await makeUser()
    await credit(user.id, 50)
    const product = await makeProduct({ priceInCoins: 120, stock: 5 })

    await expect(redeemProduct(customer(user.id), product.id)).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    )

    expect(await prisma.storeOrder.count()).toBe(0)
    expect(await balanceOf(user.id)).toBe(50)
    const after = await prisma.storeProduct.findUniqueOrThrow({ where: { id: product.id } })
    expect(after.stock).toBe(5)
  })

  // Não basta esconder da vitrine: a chamada direta ao service tem de recusar.
  it('recusa produto inativo mesmo com saldo sobrando', async () => {
    const user = await makeUser()
    await credit(user.id, 500)
    const product = await makeProduct({ isActive: false })

    await expect(redeemProduct(customer(user.id), product.id)).rejects.toBeInstanceOf(
      ProductUnavailableError,
    )
  })

  it('recusa produto com estoque zero mesmo com saldo sobrando', async () => {
    const user = await makeUser()
    await credit(user.id, 500)
    const product = await makeProduct({ stock: 0 })

    await expect(redeemProduct(customer(user.id), product.id)).rejects.toBeInstanceOf(
      OutOfStockError,
    )
  })

  // Duas PESSOAS diferentes disputando o último item: quem protege é o UPDATE
  // condicional (stock > 0), que trava a linha e reavalia o predicado.
  it('dois resgates simultâneos do último item: um conclui, o outro é recusado', async () => {
    const a = await makeUser()
    const b = await makeUser()
    await credit(a.id, 500)
    await credit(b.id, 500)
    const product = await makeProduct({ priceInCoins: 100, stock: 1 })

    const results = await Promise.allSettled([
      redeemProduct(customer(a.id), product.id),
      redeemProduct(customer(b.id), product.id),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const after = await prisma.storeProduct.findUniqueOrThrow({ where: { id: product.id } })
    expect(after.stock).toBe(0)
    expect(await prisma.storeOrder.count()).toBe(1)
  })

  // A MESMA pessoa clicando duas vezes: quem protege é o advisory lock. Sem ele,
  // os dois aggregates leem 100 e o saldo termina negativo.
  it('dois resgates simultâneos da mesma pessoa não deixam o saldo negativo', async () => {
    const user = await makeUser()
    await credit(user.id, 100)
    const product = await makeProduct({ priceInCoins: 100, stock: 5 })

    const results = await Promise.allSettled([
      redeemProduct(customer(user.id), product.id),
      redeemProduct(customer(user.id), product.id),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await balanceOf(user.id)).toBe(0)
    expect(await prisma.storeOrder.count()).toBe(1)
  })

  // `createdAt` é TIMESTAMP(3): sem `id` como desempate, duas linhas do mesmo
  // milissegundo têm ordem indefinida entre páginas — uma pode repetir numa
  // página e nunca aparecer em outra (achado #5 da revisão final).
  it('pagina sem repetir nem pular pedidos com o mesmo createdAt', async () => {
    const user = await makeUser()
    await credit(user.id, 100_000)
    const product = await makeProduct({ priceInCoins: 1, stock: 1000 })
    const sameInstant = new Date('2026-08-01T12:00:00.000Z')

    const created = await Promise.all(
      Array.from({ length: 25 }, () =>
        prisma.storeOrder.create({
          data: {
            userId: user.id,
            productId: product.id,
            productTitle: product.title,
            pricePaid: 1,
            companyId: DEFAULT_COMPANY_ID,
            createdAt: sameInstant,
          },
        }),
      ),
    )

    const page1 = await listMyOrders(customer(user.id), 1)
    const page2 = await listMyOrders(customer(user.id), 2)

    expect(page1.total).toBe(25)
    expect(page1.orders).toHaveLength(20)
    expect(page2.orders).toHaveLength(5)
    const seenIds = [...page1.orders, ...page2.orders].map((o) => o.id)
    expect(new Set(seenIds).size).toBe(25)
    expect(seenIds.sort()).toEqual(created.map((o) => o.id).sort())
  })

  it('preço alterado depois não muda o valor registrado no pedido antigo', async () => {
    const user = await makeUser()
    await credit(user.id, 500)
    const product = await makeProduct({ priceInCoins: 100, stock: 5 })
    await redeemProduct(customer(user.id), product.id)

    await prisma.storeProduct.update({
      where: { id: product.id },
      data: { priceInCoins: 999, title: 'Fone Premium' },
    })

    const { orders } = await listMyOrders(customer(user.id), 1)
    expect(orders[0].pricePaid).toBe(100)
    expect(orders[0].productTitle).toBe('Fone')
  })
})
