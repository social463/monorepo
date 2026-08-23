import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

let app: ReturnType<typeof buildApp>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
})

async function makeUser(role: 'LEGEND' | 'ADMIN' = 'LEGEND') {
  return prisma.user.create({
    data: { name: 'Pessoa', email: `r-${Math.random()}@x.com`, passwordHash: 'x', role, sectorId: DEFAULT_SECTOR_ID },
  })
}

function tokenFor(user: { id: string; role: string }) {
  return app.jwt.sign({
    sub: user.id,
    role: user.role,
    sectorId: DEFAULT_SECTOR_ID,
    companyId: DEFAULT_COMPANY_ID,
    features: ['coins'],
  })
}

async function makeProduct(priceInCoins = 100, stock = 5) {
  const admin = await makeUser('ADMIN')
  return prisma.storeProduct.create({
    data: { title: 'Fone', category: 'Equipamento', priceInCoins, stock, createdById: admin.id, companyId: DEFAULT_COMPANY_ID },
  })
}

describe('GET /store/products', () => {
  it('exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/store/products' })
    expect(res.statusCode).toBe(401)
  })

  it('devolve o catálogo disponível', async () => {
    const user = await makeUser()
    await makeProduct()
    const res = await app.inject({
      method: 'GET',
      url: '/store/products',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().products).toHaveLength(1)
    // A chave do S3 NUNCA sai: só a URL derivada.
    expect(res.json().products[0]).not.toHaveProperty('imageKey')
  })
})

describe('POST /store/orders', () => {
  it('recusa corpo inválido com 400 e issues', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/store/orders',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('issues')
  })

  it('devolve 400 e mensagem em português quando falta saldo', async () => {
    const user = await makeUser()
    const product = await makeProduct(100)
    const res = await app.inject({
      method: 'POST',
      url: '/store/orders',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { productId: product.id },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Saldo insuficiente para resgatar este produto.')
  })

  it('resgata e devolve o saldo já atualizado', async () => {
    const user = await makeUser()
    await prisma.coinTransaction.create({
      data: {
        userId: user.id,
        kind: 'MANUAL_CREDIT',
        amount: 300,
        dedupeKey: `MANUAL:${Math.random()}`,
        day: new Date('2026-08-02'),
        companyId: DEFAULT_COMPANY_ID,
      },
    })
    const product = await makeProduct(100)

    const res = await app.inject({
      method: 'POST',
      url: '/store/orders',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { productId: product.id },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().balance).toBe(200)
    expect(res.json().order.pricePaid).toBe(100)
    expect(res.json().order).not.toHaveProperty('adminNotes')
  })
})
