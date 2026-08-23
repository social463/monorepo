import { Prisma } from '@prisma/client'
import { STORE_ORDER_PAGE_SIZE } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { spendCoins } from './coin-service'

/** Erro de domínio da loja: carrega o status HTTP, e a rota só faz instanceof. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class ProductNotFoundError extends StoreError {
  constructor() {
    super('Produto não encontrado.', 404)
  }
}
export class ProductUnavailableError extends StoreError {
  constructor() {
    super('Este produto não está disponível para resgate.', 409)
  }
}
export class OutOfStockError extends StoreError {
  constructor() {
    super('Este produto está sem estoque.', 409)
  }
}
export class InsufficientBalanceError extends StoreError {
  constructor() {
    super('Saldo insuficiente para resgatar este produto.', 400)
  }
}
export class OrderNotFoundError extends StoreError {
  constructor() {
    super('Pedido não encontrado.', 404)
  }
}
export class InvalidStatusTransitionError extends StoreError {
  constructor() {
    super('Não é possível mudar o pedido para este status.', 409)
  }
}
/** `spendCoins` recusou o débito por dedupeKey já usado — hoje inalcançável (o
 *  `orderId` é um cuid novo, minted dentro desta mesma transação), mas o
 *  invariante "um resgate debita exatamente uma vez" tem de valer por
 *  construção, não por confiar que um cuid nunca colide. */
export class SpendFailedError extends StoreError {
  constructor() {
    super('Não foi possível debitar os coins deste resgate.', 500)
  }
}

/** Só a capa: o DTO expõe URL derivada, nunca a chave crua. */
export const storeOrderInclude = { product: { select: { imageKey: true } } } as const
export type StoreOrderWithProduct = Prisma.StoreOrderGetPayload<{ include: typeof storeOrderInclude }>

export interface StoreCustomer {
  id: string
  companyId: string
}

/** Vitrine: só o que dá para resgatar agora. */
export function listAvailableProducts(companyId: string) {
  return scopedPrisma(companyId).storeProduct.findMany({
    where: { isActive: true, stock: { gt: 0 } },
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
  })
}

/**
 * Resgate: valida saldo e estoque, debita o livro-razão, baixa o estoque e cria o
 * pedido — tudo numa transação.
 *
 * A ORDEM das operações É a regra:
 *
 * 1. O advisory lock serializa os resgates DESTA pessoa. Sem ele, dois cliques
 *    rápidos leem o mesmo saldo no passo 3 e o saldo termina negativo — `aggregate`
 *    não trava nada, e Read Committed não resolve isso sozinho.
 * 2. Preço e disponibilidade são lidos DENTRO da transação; o produto pode ter
 *    mudado entre a vitrine e o clique.
 * 3. O saldo é somado DENTRO da transação, já protegido pelo lock do passo 1.
 * 4. O UPDATE CONDICIONAL é o que trava a linha do produto e reavalia `stock > 0`
 *    contra a versão já commitada — é ele, e não um SELECT anterior, que impede
 *    duas pessoas de levarem o mesmo último item. Mesmo padrão de
 *    challenge-submission-service.
 *
 * O `tx` cru não passa por `scopedPrisma`: `companyId` vai explícito em todo
 * `where` e `data`.
 */
export async function redeemProduct(
  actor: StoreCustomer,
  productId: string,
): Promise<{ order: StoreOrderWithProduct; balance: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store:${actor.id}`}))`

    const product = await tx.storeProduct.findFirst({
      where: { id: productId, companyId: actor.companyId },
    })
    if (!product) throw new ProductNotFoundError()
    if (!product.isActive) throw new ProductUnavailableError()

    const { _sum } = await tx.coinTransaction.aggregate({
      where: { userId: actor.id, companyId: actor.companyId },
      _sum: { amount: true },
    })
    const balance = _sum.amount ?? 0
    if (balance < product.priceInCoins) throw new InsufficientBalanceError()

    const { count } = await tx.storeProduct.updateMany({
      where: { id: productId, companyId: actor.companyId, isActive: true, stock: { gt: 0 } },
      data: { stock: { decrement: 1 } },
    })
    if (count === 0) throw new OutOfStockError()

    const order = await tx.storeOrder.create({
      data: {
        userId: actor.id,
        productId: product.id,
        // Congelados: o produto muda depois, o pedido é histórico.
        productTitle: product.title,
        pricePaid: product.priceInCoins,
        companyId: actor.companyId,
      },
      include: storeOrderInclude,
    })

    // A checagem do outcome (e não só o `await`) é o que torna simétrico com o
    // estorno em `updateOrderStatus`, que já trata `DUPLICATE` — e faz o débito
    // do resgate valer por construção, não por confiar que este `orderId` (cuid
    // novo, minted acima) nunca colide com um dedupeKey existente.
    const outcome = await spendCoins({
      userId: actor.id,
      companyId: actor.companyId,
      amount: product.priceInCoins,
      orderId: order.id,
      tx,
    })
    if (outcome.status !== 'RECORDED') throw new SpendFailedError()

    return { order, balance: balance - product.priceInCoins }
  })
}

export async function listMyOrders(
  actor: StoreCustomer,
  page: number,
): Promise<{ orders: StoreOrderWithProduct[]; total: number }> {
  const db = scopedPrisma(actor.companyId)
  const where = { userId: actor.id }
  const [orders, total] = await Promise.all([
    db.storeOrder.findMany({
      where,
      include: storeOrderInclude,
      // `id` desempata `createdAt` (TIMESTAMP(3)): sem ele, duas linhas do
      // mesmo milissegundo têm ordem indefinida entre páginas — uma pode
      // repetir numa página e nunca aparecer em outra. Mesmo padrão de
      // challenge-submission-service.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * STORE_ORDER_PAGE_SIZE,
      take: STORE_ORDER_PAGE_SIZE,
    }),
    db.storeOrder.count({ where }),
  ])
  return { orders, total }
}
