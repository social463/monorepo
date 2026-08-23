import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  createProduct,
  updateProduct,
  deleteProduct,
  listProductsForAdmin,
  listOrdersForAdmin,
} from './store-admin-service'
import { ProductNotFoundError } from './store-service'

async function makeAdmin() {
  return prisma.user.create({
    data: { name: 'Gestora', email: `g-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
}

function actorOf(id: string) {
  return { id, companyId: DEFAULT_COMPANY_ID }
}

async function ensureOtherCompany() {
  await prisma.company.upsert({
    where: { id: 'company-outra' }, update: {},
    create: { id: 'company-outra', name: 'Outra', slug: 'outra' },
  })
}

const BASE = {
  title: 'Fone', description: 'Bom fone', category: 'Equipamento' as const,
  priceInCoins: 100, stock: 5,
}

describe('CRUD de produto', () => {
  it('cria produto ativo e grava auditoria', async () => {
    const admin = await makeAdmin()
    const product = await createProduct(actorOf(admin.id), BASE)

    expect(product.isActive).toBe(true)
    expect(product.createdById).toBe(admin.id)
    const audit = await prisma.adminAuditLog.findFirst({
      where: { entityType: 'StoreProduct', entityId: product.id },
    })
    expect(audit?.action).toBe('CREATE')
  })

  it('atualiza só os campos enviados', async () => {
    const admin = await makeAdmin()
    const product = await createProduct(actorOf(admin.id), BASE)

    const updated = await updateProduct(actorOf(admin.id), product.id, { priceInCoins: 150 })

    expect(updated.priceInCoins).toBe(150)
    expect(updated.title).toBe('Fone')
    expect(updated.stock).toBe(5)
  })

  it('preserva os oito campos não enviados, inclusive isActive false e isDigital true', async () => {
    const admin = await makeAdmin()
    const product = await createProduct(actorOf(admin.id), {
      title: 'Cadeira gamer',
      description: 'algo',
      category: 'Equipamento',
      priceInCoins: 300,
      stock: 2,
      imageKey: 'capa/cadeira.png',
      isDigital: true,
      isActive: false,
    })

    const updated = await updateProduct(actorOf(admin.id), product.id, { priceInCoins: 999 })

    expect(updated.priceInCoins).toBe(999)
    // Os OITO campos não tocados pelo update: se `!== undefined` virar checagem de
    // verdade (ex. `input.isActive`), `isActive: false` some silenciosamente daqui.
    expect(updated.title).toBe('Cadeira gamer')
    expect(updated.description).toBe('algo')
    expect(updated.category).toBe('Equipamento')
    expect(updated.stock).toBe(2)
    expect(updated.imageKey).toBe('capa/cadeira.png')
    expect(updated.isDigital).toBe(true)
    expect(updated.isActive).toBe(false)
  })

  it('apaga o produto e mantém o pedido antigo com productId nulo', async () => {
    const admin = await makeAdmin()
    const product = await createProduct(actorOf(admin.id), BASE)
    const order = await prisma.storeOrder.create({
      data: { userId: admin.id, productId: product.id, productTitle: 'Fone', pricePaid: 100,
              companyId: DEFAULT_COMPANY_ID },
    })

    await deleteProduct(actorOf(admin.id), product.id)

    const kept = await prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(kept.productId).toBeNull()
    expect(kept.productTitle).toBe('Fone')
    expect(kept.pricePaid).toBe(100)
  })

  it('recusa produto de outra empresa no update', async () => {
    const admin = await makeAdmin()
    await ensureOtherCompany()
    const alheio = await prisma.storeProduct.create({
      data: { ...BASE, createdById: admin.id, companyId: 'company-outra' },
    })

    await expect(
      updateProduct(actorOf(admin.id), alheio.id, { priceInCoins: 1 }),
    ).rejects.toBeInstanceOf(ProductNotFoundError)
  })

  it('recusa produto de outra empresa no delete', async () => {
    const admin = await makeAdmin()
    await ensureOtherCompany()
    const alheio = await prisma.storeProduct.create({
      data: { ...BASE, createdById: admin.id, companyId: 'company-outra' },
    })

    await expect(
      deleteProduct(actorOf(admin.id), alheio.id),
    ).rejects.toBeInstanceOf(ProductNotFoundError)

    const stillThere = await prisma.storeProduct.findUnique({ where: { id: alheio.id } })
    expect(stillThere).not.toBeNull()
  })

  it('lista inclusive produto inativo e sem estoque (a fila precisa ver tudo)', async () => {
    const admin = await makeAdmin()
    await createProduct(actorOf(admin.id), { ...BASE, isActive: false })
    await createProduct(actorOf(admin.id), { ...BASE, title: 'Zerado', stock: 0 })

    expect(await listProductsForAdmin(actorOf(admin.id))).toHaveLength(2)
  })
})

describe('fila de pedidos', () => {
  // `createdAt` é TIMESTAMP(3): sem `id` como desempate, duas linhas do mesmo
  // milissegundo têm ordem indefinida entre páginas — um pedido pendente pode
  // repetir numa página e nunca aparecer em outra (achado #5 da revisão final).
  it('pagina sem repetir nem pular pedidos com o mesmo createdAt', async () => {
    const admin = await makeAdmin()
    const product = await createProduct(actorOf(admin.id), BASE)
    const sameInstant = new Date('2026-08-01T12:00:00.000Z')

    const created = await Promise.all(
      Array.from({ length: 25 }, () =>
        prisma.storeOrder.create({
          data: {
            userId: admin.id,
            productId: product.id,
            productTitle: product.title,
            pricePaid: product.priceInCoins,
            companyId: DEFAULT_COMPANY_ID,
            createdAt: sameInstant,
          },
        }),
      ),
    )

    const page1 = await listOrdersForAdmin(actorOf(admin.id), {}, 1)
    const page2 = await listOrdersForAdmin(actorOf(admin.id), {}, 2)

    expect(page1.total).toBe(25)
    expect(page1.orders).toHaveLength(20)
    expect(page2.orders).toHaveLength(5)
    const seenIds = [...page1.orders, ...page2.orders].map((o) => o.id)
    expect(new Set(seenIds).size).toBe(25)
    expect(seenIds.sort()).toEqual(created.map((o) => o.id).sort())
  })
})
