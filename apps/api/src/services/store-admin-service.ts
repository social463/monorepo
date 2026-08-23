import {
  canTransitionStoreOrder,
  STORE_EXPORT_MAX_ROWS,
  STORE_ORDER_PAGE_SIZE,
  STORE_ORDER_STATUS_LABELS,
  type CreateStoreProductRequest,
  type StoreOrderBatchResult,
  type StoreOrderStatus,
  type UpdateStoreProductRequest,
} from '@legends/shared'
import type { Prisma } from '@prisma/client'
import { csvCell, csvDate } from '../lib/csv'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'
import { refundCoins } from './coin-service'
import * as notificationService from './notification-service'
import { InvalidStatusTransitionError, OrderNotFoundError, ProductNotFoundError, StoreError } from './store-service'

export interface StoreAdminActor {
  id: string
  companyId: string
}

/**
 * A loja é da EMPRESA, não do setor: quem chega aqui já passou por
 * `requireSectorFeature('gente-gestao')` na rota, que libera o ADMIN global e o
 * SUBADMIN do setor com a feature ligada. Por isso não há recorte por sectorId.
 */
export function listProductsForAdmin(actor: StoreAdminActor) {
  return scopedPrisma(actor.companyId).storeProduct.findMany({
    orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { title: 'asc' }],
  })
}

/** Instantâneo dos OITO campos editáveis — usado nos dois lados (`before`/`after`) da
 *  auditoria para que um `before === after` no log signifique de fato "nada mudou",
 *  e não "só registrei os campos que lembrei de registrar". */
function auditSnapshot(product: {
  title: string
  description: string | null
  category: string
  priceInCoins: number
  stock: number
  imageKey: string | null
  isDigital: boolean
  isActive: boolean
}) {
  return {
    title: product.title,
    description: product.description,
    category: product.category,
    priceInCoins: product.priceInCoins,
    stock: product.stock,
    imageKey: product.imageKey,
    isDigital: product.isDigital,
    isActive: product.isActive,
  }
}

export async function createProduct(actor: StoreAdminActor, input: CreateStoreProductRequest) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.storeProduct.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        category: input.category,
        priceInCoins: input.priceInCoins,
        stock: input.stock,
        imageKey: input.imageKey ?? null,
        isDigital: input.isDigital ?? false,
        isActive: input.isActive ?? true,
        createdById: actor.id,
        companyId: actor.companyId,
      },
    })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'StoreProduct',
      entityId: product.id,
      action: 'CREATE',
      companyId: actor.companyId,
      after: auditSnapshot(product),
      tx,
    })
    return product
  })
}

/**
 * Campo ausente no input é campo preservado — `undefined` nunca vira `null` aqui.
 *
 * O pré-check via `scopedPrisma` é só para dar o 404 cedo e capturar o `before` da
 * auditoria; ele NÃO é a garantia de isolamento. A garantia de verdade é o
 * `companyId` repetido no `where` do `updateMany` dentro do `tx` — se a linha sumir
 * (ou nunca tiver sido desta empresa) entre o pré-check e a transação, `count` vem
 * 0 e vira `ProductNotFoundError`, não um `P2025` cru do Prisma vazando do service.
 */
export async function updateProduct(
  actor: StoreAdminActor,
  id: string,
  input: UpdateStoreProductRequest,
) {
  const current = await scopedPrisma(actor.companyId).storeProduct.findFirst({ where: { id } })
  if (!current) throw new ProductNotFoundError()

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.storeProduct.updateMany({
      where: { id, companyId: actor.companyId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.priceInCoins !== undefined ? { priceInCoins: input.priceInCoins } : {}),
        ...(input.stock !== undefined ? { stock: input.stock } : {}),
        ...(input.imageKey !== undefined ? { imageKey: input.imageKey } : {}),
        ...(input.isDigital !== undefined ? { isDigital: input.isDigital } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    })
    if (count === 0) throw new ProductNotFoundError()

    // `updateMany` não devolve a linha — releitura scoped, ainda dentro do `tx`.
    const product = await tx.storeProduct.findFirstOrThrow({ where: { id, companyId: actor.companyId } })

    await recordAuditLog({
      actorId: actor.id,
      entityType: 'StoreProduct',
      entityId: id,
      action: 'UPDATE',
      companyId: actor.companyId,
      before: auditSnapshot(current),
      after: auditSnapshot(product),
      tx,
    })
    return product
  })
}

/**
 * Apaga o produto. Os pedidos sobrevivem com `productId` nulo (SetNull) e os
 * campos congelados intactos — histórico de resgate não se apaga junto com o item.
 *
 * Mesmo racional de `updateProduct`: o pré-check é só para o 404 cedo e o `before`
 * da auditoria; o isolamento de verdade vem do `companyId` repetido no `where` do
 * `deleteMany` dentro do `tx`.
 */
export async function deleteProduct(actor: StoreAdminActor, id: string): Promise<void> {
  const current = await scopedPrisma(actor.companyId).storeProduct.findFirst({ where: { id } })
  if (!current) throw new ProductNotFoundError()

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.storeProduct.deleteMany({ where: { id, companyId: actor.companyId } })
    if (count === 0) throw new ProductNotFoundError()

    await recordAuditLog({
      actorId: actor.id,
      entityType: 'StoreProduct',
      entityId: id,
      action: 'DELETE',
      companyId: actor.companyId,
      before: auditSnapshot(current),
      tx,
    })
  })
}

export const storeOrderAdminInclude = {
  product: { select: { imageKey: true } },
  user: { select: { id: true, name: true, email: true } },
  handledBy: { select: { id: true, name: true } },
} as const
export type StoreOrderWithRefs = Prisma.StoreOrderGetPayload<{ include: typeof storeOrderAdminInclude }>

export interface StoreOrderFilters {
  status?: StoreOrderStatus
  userId?: string
  productId?: string
}

function filtersToWhere(filters: StoreOrderFilters): Prisma.StoreOrderWhereInput {
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
  }
}

export async function listOrdersForAdmin(
  actor: StoreAdminActor,
  filters: StoreOrderFilters,
  page: number,
): Promise<{ orders: StoreOrderWithRefs[]; total: number }> {
  const db = scopedPrisma(actor.companyId)
  const where = filtersToWhere(filters)
  const [orders, total] = await Promise.all([
    db.storeOrder.findMany({
      where,
      include: storeOrderAdminInclude,
      // `id` desempata `createdAt` (TIMESTAMP(3)): sem ele, duas linhas do
      // mesmo milissegundo têm ordem indefinida entre páginas — uma pode
      // repetir numa página e nunca aparecer em outra (um pedido pendente que
      // ninguém nunca vê). Mesmo padrão de challenge-submission-service.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * STORE_ORDER_PAGE_SIZE,
      take: STORE_ORDER_PAGE_SIZE,
    }),
    db.storeOrder.count({ where }),
  ])
  return { orders, total }
}

async function loadOrder(actor: StoreAdminActor, id: string): Promise<StoreOrderWithRefs> {
  const order = await scopedPrisma(actor.companyId).storeOrder.findFirst({
    where: { id },
    include: storeOrderAdminInclude,
  })
  if (!order) throw new OrderNotFoundError()
  return order
}

/**
 * Muda o status do pedido, estornando quando cancela.
 *
 * O UPDATE CONDICIONAL vem primeiro de propósito: `where: { status: <o observado> }`
 * é o que toma o lock da linha e reavalia o predicado contra a versão já commitada.
 * Sob Read Committed, a transação concorrente bloqueia nele, vê que o status mudou e
 * devolve count 0 — é isso que impede aprovar e cancelar o mesmo pedido em paralelo,
 * ou estornar duas vezes. Reler o pedido com um SELECT simples NÃO teria esse efeito.
 *
 * O advisory lock por PESSOA é o mesmo do resgate: cancelamento e resgate da mesma
 * pessoa não podem correr em paralelo, senão o saldo lido lá fica velho.
 */
export async function updateOrderStatus(
  actor: StoreAdminActor,
  id: string,
  next: StoreOrderStatus,
  adminNotes: string | null | undefined,
): Promise<StoreOrderWithRefs> {
  const current = await loadOrder(actor, id)
  if (!canTransitionStoreOrder(current.status, next)) throw new InvalidStatusTransitionError()

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store:${current.userId}`}))`

    const { count } = await tx.storeOrder.updateMany({
      where: { id, companyId: actor.companyId, status: current.status },
      data: {
        status: next,
        handledById: actor.id,
        handledAt: now,
        // `undefined` preserva a nota anterior; `null` limpa; qualquer string sobrescreve.
        ...(adminNotes !== undefined ? { adminNotes } : {}),
      },
    })
    if (count === 0) throw new InvalidStatusTransitionError()

    if (next === 'CANCELLED') {
      // Segunda rede: mesmo que o recheck acima escape, a unique (userId, dedupeKey)
      // barra o crédito repetido.
      const outcome = await refundCoins({
        userId: current.userId,
        companyId: actor.companyId,
        amount: current.pricePaid,
        orderId: current.id,
        tx,
        now,
      })
      if (outcome.status === 'DUPLICATE') throw new InvalidStatusTransitionError()

      // Produto apagado depois do resgate: estorna os coins e segue. Não há
      // para onde devolver o estoque, e o pedido continua valendo como histórico.
      if (current.productId) {
        await tx.storeProduct.updateMany({
          where: { id: current.productId, companyId: actor.companyId },
          data: { stock: { increment: 1 } },
        })
      }
    }

    await recordAuditLog({
      actorId: actor.id,
      entityType: 'StoreOrder',
      entityId: id,
      action: 'UPDATE',
      companyId: actor.companyId,
      // `adminNotes` no `before` também — sem ele, TODA mudança de status lê no
      // log como se tivesse criado a nota agora, mesmo quando ela já existia de
      // uma decisão anterior (ex.: aprovar com nota, entregar depois sem digitar
      // de novo).
      before: { status: current.status, adminNotes: current.adminNotes },
      // `adminNotes` no `after` precisa do MESMO tratamento de "omitido preserva"
      // que o `updateMany` acima já aplica: `adminNotes === undefined` (PATCH sem
      // nota) tem de gravar a nota que CONTINUA valendo (`current.adminNotes`), e
      // não `undefined` — `recordAuditLog` serializa com JSON.stringify, que
      // remove chaves `undefined`, e a UI de auditoria calcula "o que mudou" pela
      // união das chaves dos dois lados. Uma chave ausente do `after` mas presente
      // no `before` lê como "apagada", mesmo quando o valor nunca mudou.
      after: { status: next, adminNotes: adminNotes === undefined ? current.adminNotes : adminNotes },
      tx,
    })
  })

  // Best-effort e SEMPRE depois do commit: falha ao notificar não pode desfazer a
  // decisão nem o estorno.
  if (next !== 'PENDING') {
    try {
      await notificationService.notifyStoreOrderStatus(
        { id: current.id, userId: current.userId, productTitle: current.productTitle, pricePaid: current.pricePaid },
        next,
        actor.id,
        actor.companyId,
      )
    } catch (err) {
      console.error(`[store-admin-service] falha ao notificar decisão (pedido ${id})`, err)
    }
  }

  return loadOrder(actor, id)
}

/**
 * Lote: item a item, pelo MESMO caminho de código do individual. Nada de
 * Promise.all — erro de um não pode abortar nem sumir. O resultado sempre diz o
 * que passou e o que falhou.
 */
export async function updateOrdersBatch(
  actor: StoreAdminActor,
  ids: string[],
  next: StoreOrderStatus,
  adminNotes: string | null | undefined,
): Promise<StoreOrderBatchResult> {
  const result: StoreOrderBatchResult = { succeeded: [], failed: [] }

  for (const id of ids) {
    try {
      await updateOrderStatus(actor, id, next, adminNotes)
      result.succeeded.push(id)
    } catch (err) {
      const message = err instanceof StoreError ? err.message : 'Falha inesperada ao processar este pedido.'
      if (!(err instanceof StoreError)) {
        console.error(`[store-admin-service] falha no lote (pedido ${id})`, err)
      }
      result.failed.push({ id, message })
    }
  }

  return result
}

const CSV_HEADER = ['Pessoa', 'E-mail', 'Produto', 'Preço pago', 'Status', 'Resgatado em', 'Tratado em', 'Tratado por', 'Nota interna']

/**
 * CSV do recorte filtrado inteiro — não da página. Separador `;` e BOM UTF-8
 * porque o Excel em pt-BR abre assim sem pedir importação.
 */
export async function exportOrdersCsv(
  actor: StoreAdminActor,
  filters: StoreOrderFilters,
): Promise<string> {
  const rows = await scopedPrisma(actor.companyId).storeOrder.findMany({
    where: filtersToWhere(filters),
    include: storeOrderAdminInclude,
    // `id` desempata `createdAt`, mesmo racional de `listOrdersForAdmin` — aqui
    // não pagina, mas o corte em `STORE_EXPORT_MAX_ROWS` tem a mesma ordem
    // indefinida sem o desempate.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: STORE_EXPORT_MAX_ROWS,
  })

  const lines = [CSV_HEADER.join(';')]
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.user.name),
        csvCell(row.user.email),
        csvCell(row.productTitle),
        String(row.pricePaid),
        STORE_ORDER_STATUS_LABELS[row.status],
        csvDate(row.createdAt),
        csvDate(row.handledAt),
        csvCell(row.handledBy?.name ?? null),
        csvCell(row.adminNotes),
      ].join(';'),
    )
  }

  return `﻿${lines.join('\n')}\n`
}
