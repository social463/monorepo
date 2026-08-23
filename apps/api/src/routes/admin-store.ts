import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  STORE_ADMIN_NOTES_MAX_LENGTH,
  STORE_BATCH_MAX_IDS,
  STORE_ORDER_PAGE_SIZE,
  STORE_ORDER_STATUSES,
  STORE_PRICE_MAX,
  STORE_PRICE_MIN,
  STORE_PRODUCT_CATEGORIES,
  STORE_PRODUCT_DESCRIPTION_MAX_LENGTH,
  STORE_PRODUCT_TITLE_MAX_LENGTH,
  STORE_STOCK_MAX,
} from '@legends/shared'
import { toStoreOrderAdminDTO, toStoreProductDTO } from '../lib/serialize'
import {
  createProduct,
  deleteProduct,
  exportOrdersCsv,
  listOrdersForAdmin,
  listProductsForAdmin,
  updateOrderStatus,
  updateOrdersBatch,
  updateProduct,
} from '../services/store-admin-service'
import { StoreError } from '../services/store-service'

const idParamsSchema = z.object({ id: z.string().min(1) })

const productSchema = z.object({
  title: z.string().trim().min(1).max(STORE_PRODUCT_TITLE_MAX_LENGTH),
  description: z.string().trim().max(STORE_PRODUCT_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  category: z.enum(STORE_PRODUCT_CATEGORIES),
  priceInCoins: z.number().int().min(STORE_PRICE_MIN).max(STORE_PRICE_MAX),
  stock: z.number().int().min(0).max(STORE_STOCK_MAX),
  imageKey: z.string().min(1).nullable().optional(),
  isDigital: z.boolean().optional(),
  isActive: z.boolean().optional(),
})
const productPatchSchema = productSchema.partial()

const orderFiltersSchema = z.object({
  status: z.enum(STORE_ORDER_STATUSES).optional(),
  userId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
})

const orderPatchSchema = z.object({
  status: z.enum(STORE_ORDER_STATUSES),
  adminNotes: z.string().trim().max(STORE_ADMIN_NOTES_MAX_LENGTH).nullable().optional(),
})

const batchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(STORE_BATCH_MAX_IDS),
  status: z.enum(STORE_ORDER_STATUSES),
  adminNotes: z.string().trim().max(STORE_ADMIN_NOTES_MAX_LENGTH).nullable().optional(),
})

function handleStoreError(err: unknown, reply: FastifyReply) {
  if (err instanceof StoreError) return reply.code(err.status).send({ message: err.message })
  throw err
}

function actorFrom(request: { user: { sub: string; companyId: string } }) {
  return { id: request.user.sub, companyId: request.user.companyId }
}

export async function adminStoreRoutes(app: FastifyInstance) {
  // requireSectorFeature e NÃO requireAdminOrSubadmin: a loja é um bloco de Gente e
  // Gestão. requireAdminOrSubadmin liberaria o SUBADMIN de qualquer setor, e não há
  // sectorId no produto para recortar isso no service.
  const guard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  app.get('/admin/store/products', guard, async (request) => {
    const products = await listProductsForAdmin(actorFrom(request))
    return { products: products.map(toStoreProductDTO) }
  })

  app.post('/admin/store/products', guard, async (request, reply) => {
    const parsed = productSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const product = await createProduct(actorFrom(request), parsed.data)
    return reply.code(201).send({ product: toStoreProductDTO(product) })
  })

  app.patch('/admin/store/products/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const parsed = productPatchSchema.safeParse(request.body)
    if (!params.success || !parsed.success) {
      const issues = [...(params.success ? [] : params.error.issues), ...(parsed.success ? [] : parsed.error.issues)]
      return reply.code(400).send({ message: 'Dados inválidos', issues })
    }
    try {
      const product = await updateProduct(actorFrom(request), params.data.id, parsed.data)
      return { product: toStoreProductDTO(product) }
    } catch (err) {
      return handleStoreError(err, reply)
    }
  })

  app.delete('/admin/store/products/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: params.error.issues })
    }
    try {
      await deleteProduct(actorFrom(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleStoreError(err, reply)
    }
  })

  app.get('/admin/store/orders', guard, async (request, reply) => {
    const parsed = orderFiltersSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { page, ...filters } = parsed.data
    const { orders, total } = await listOrdersForAdmin(actorFrom(request), filters, page)
    return { orders: orders.map(toStoreOrderAdminDTO), total, page, pageSize: STORE_ORDER_PAGE_SIZE }
  })

  app.patch('/admin/store/orders/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const parsed = orderPatchSchema.safeParse(request.body)
    if (!params.success || !parsed.success) {
      const issues = [...(params.success ? [] : params.error.issues), ...(parsed.success ? [] : parsed.error.issues)]
      return reply.code(400).send({ message: 'Dados inválidos', issues })
    }
    try {
      // DESVIO do brief original: `adminNotes` passa DIRETO, sem `?? null`. Omitir o
      // campo no PATCH precisa PRESERVAR a nota anterior — não apagá-la. Um `?? null`
      // aqui faria "aprovar com nota, depois entregar sem digitar nada" apagar a nota
      // da aprovação em silêncio.
      const order = await updateOrderStatus(
        actorFrom(request), params.data.id, parsed.data.status, parsed.data.adminNotes,
      )
      return { order: toStoreOrderAdminDTO(order) }
    } catch (err) {
      return handleStoreError(err, reply)
    }
  })

  app.post('/admin/store/orders/batch', guard, async (request, reply) => {
    const parsed = batchSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    // O lote nunca falha inteiro: o resultado diz o que passou e o que não. Mesmo
    // desvio do PATCH individual: `adminNotes` passa direto, sem `?? null`.
    return updateOrdersBatch(
      actorFrom(request), parsed.data.ids, parsed.data.status, parsed.data.adminNotes,
    )
  })

  app.get('/admin/store/orders/export', guard, async (request, reply) => {
    const parsed = orderFiltersSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { page: _page, ...filters } = parsed.data
    const csv = await exportOrdersCsv(actorFrom(request), filters)
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="pedidos-loja.csv"')
      .send(csv)
  })
}
