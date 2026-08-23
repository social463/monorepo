import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { STORE_ORDER_PAGE_SIZE } from '@legends/shared'
import { toStoreOrderDTO, toStoreProductDTO } from '../lib/serialize'
import {
  listAvailableProducts,
  listMyOrders,
  redeemProduct,
  StoreError,
} from '../services/store-service'

const createOrderSchema = z.object({ productId: z.string().min(1) })
const listOrdersQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1) })

function handleStoreError(err: unknown, reply: FastifyReply) {
  if (err instanceof StoreError) return reply.code(err.status).send({ message: err.message })
  throw err
}

export async function storeRoutes(app: FastifyInstance) {
  const withCoins = { onRequest: [app.authenticate, app.requireFeature('coins')] }

  app.get('/store/products', withCoins, async (request) => {
    const products = await listAvailableProducts(request.user.companyId)
    return { products: products.map(toStoreProductDTO) }
  })

  app.post('/store/orders', withCoins, async (request, reply) => {
    const parsed = createOrderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const actor = { id: request.user.sub, companyId: request.user.companyId }
    try {
      const { order, balance } = await redeemProduct(actor, parsed.data.productId)
      return reply.code(201).send({ order: toStoreOrderDTO(order), balance })
    } catch (err) {
      return handleStoreError(err, reply)
    }
  })

  app.get('/store/orders', withCoins, async (request, reply) => {
    const parsed = listOrdersQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const actor = { id: request.user.sub, companyId: request.user.companyId }
    const { orders, total } = await listMyOrders(actor, parsed.data.page)
    return {
      orders: orders.map(toStoreOrderDTO),
      total,
      page: parsed.data.page,
      pageSize: STORE_ORDER_PAGE_SIZE,
    }
  })
}
