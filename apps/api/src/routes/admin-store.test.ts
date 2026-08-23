import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

let app: ReturnType<typeof buildApp>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
})

async function makeUser(role: 'LEGEND' | 'ADMIN' | 'SUBADMIN') {
  return prisma.user.create({
    data: { name: 'Pessoa', email: `as-${Math.random()}@x.com`, passwordHash: 'x', role, sectorId: DEFAULT_SECTOR_ID },
  })
}

function tokenFor(user: { id: string; role: string }, features: string[] = []) {
  return app.jwt.sign({
    sub: user.id,
    role: user.role,
    sectorId: DEFAULT_SECTOR_ID,
    companyId: DEFAULT_COMPANY_ID,
    features,
  })
}

const BODY = { title: 'Fone', category: 'Equipamento', priceInCoins: 100, stock: 5 }

describe('acesso ao /admin/store', () => {
  it('barra colaborador', async () => {
    const user = await makeUser('LEGEND')
    const res = await app.inject({
      method: 'GET', url: '/admin/store/products',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  // requireSectorFeature: SUBADMIN só entra com a feature do bloco ligada no setor dele.
  it('barra SUBADMIN sem a feature gente-gestao', async () => {
    const user = await makeUser('SUBADMIN')
    const res = await app.inject({
      method: 'GET', url: '/admin/store/products',
      headers: { authorization: `Bearer ${tokenFor(user, ['desenvolvimento-produto'])}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('libera SUBADMIN com a feature gente-gestao', async () => {
    const user = await makeUser('SUBADMIN')
    const res = await app.inject({
      method: 'GET', url: '/admin/store/products',
      headers: { authorization: `Bearer ${tokenFor(user, ['gente-gestao'])}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('libera ADMIN global sem feature nenhuma', async () => {
    const user = await makeUser('ADMIN')
    const res = await app.inject({
      method: 'GET', url: '/admin/store/products',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('CRUD de produto pela rota', () => {
  it('recusa preço zero com 400 e issues', async () => {
    const admin = await makeUser('ADMIN')
    const res = await app.inject({
      method: 'POST', url: '/admin/store/products',
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { ...BODY, priceInCoins: 0 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('issues')
  })

  it('cria produto', async () => {
    const admin = await makeUser('ADMIN')
    const res = await app.inject({
      method: 'POST', url: '/admin/store/products',
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: BODY,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().product.title).toBe('Fone')
  })
})

describe('fila pela rota', () => {
  async function pendingOrder(adminToken: string) {
    const created = await app.inject({
      method: 'POST', url: '/admin/store/products',
      headers: { authorization: `Bearer ${adminToken}` }, payload: BODY,
    })
    const productId = created.json().product.id
    const user = await makeUser('LEGEND')
    await prisma.coinTransaction.create({
      data: { userId: user.id, kind: 'MANUAL_CREDIT', amount: 500, dedupeKey: `MANUAL:${Math.random()}`,
              day: new Date('2026-08-02'), companyId: DEFAULT_COMPANY_ID },
    })
    const order = await app.inject({
      method: 'POST', url: '/store/orders',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id, role: 'LEGEND', sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID, features: ['coins'] })}` },
      payload: { productId },
    })
    return { orderId: order.json().order.id, userId: user.id }
  }

  it('a fila expõe a nota interna e a pessoa', async () => {
    const admin = await makeUser('ADMIN')
    const token = tokenFor(admin)
    const { orderId } = await pendingOrder(token)

    await app.inject({
      method: 'PATCH', url: `/admin/store/orders/${orderId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'APPROVED', adminNotes: 'Separado' },
    })
    const res = await app.inject({
      method: 'GET', url: '/admin/store/orders',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.json().orders[0].adminNotes).toBe('Separado')
    expect(res.json().orders[0].user.email).toBeTruthy()
  })

  it('lote responde com succeeded e failed', async () => {
    const admin = await makeUser('ADMIN')
    const token = tokenFor(admin)
    const a = await pendingOrder(token)
    const b = await pendingOrder(token)

    const res = await app.inject({
      method: 'POST', url: '/admin/store/orders/batch',
      headers: { authorization: `Bearer ${token}` },
      payload: { ids: [a.orderId, b.orderId], status: 'APPROVED' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().succeeded).toHaveLength(2)
    expect(res.json().failed).toHaveLength(0)
  })

  it('exporta CSV com o content-type de arquivo', async () => {
    const admin = await makeUser('ADMIN')
    const token = tokenFor(admin)
    await pendingOrder(token)

    const res = await app.inject({
      method: 'GET', url: '/admin/store/orders/export',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.body).toContain('Pessoa;E-mail;Produto')
  })

  // Desvio do brief: omitir `adminNotes` no PATCH precisa PRESERVAR a nota anterior,
  // não apagá-la. Este teste bate na ROTA (corpo HTTP sem a chave `adminNotes`), que é
  // o caminho que o `?? null` original quebrava — um teste que chama o service direto
  // com `undefined` explícito não pega essa regressão se o `?? null` voltar na rota.
  it('PATCH sem a chave adminNotes preserva a nota da decisão anterior', async () => {
    const admin = await makeUser('ADMIN')
    const token = tokenFor(admin)
    const { orderId } = await pendingOrder(token)

    await app.inject({
      method: 'PATCH', url: `/admin/store/orders/${orderId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'APPROVED', adminNotes: 'Separado' },
    })
    // Sem `adminNotes` no corpo — não é o mesmo que enviar `adminNotes: undefined`.
    await app.inject({
      method: 'PATCH', url: `/admin/store/orders/${orderId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'DELIVERED' },
    })

    const res = await app.inject({
      method: 'GET', url: '/admin/store/orders',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.json().orders[0].adminNotes).toBe('Separado')
  })
})

describe('limites de entrada da fila', () => {
  // A revisão da Task 8 apontou que o service faz `skip: (page - 1) * 20` sem
  // guarda: `page: 0` viraria skip negativo e um erro cru do Prisma no cliente.
  // Quem barra isso é o `.min(1)` do schema — este teste trava que ele continua ali.
  it('GET /admin/store/orders?page=0 devolve 400 com issues, não erro cru', async () => {
    const admin = await makeUser('ADMIN')
    const res = await app.inject({
      method: 'GET', url: '/admin/store/orders?page=0',
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('issues')
  })

  // STORE_BATCH_MAX_IDS existe no contrato justamente para isto: nada no service
  // limita o tamanho do lote, então quem trava é o `.max()` do schema na rota.
  it('POST /admin/store/orders/batch com 101 ids devolve 400 com issues', async () => {
    const admin = await makeUser('ADMIN')
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`)
    const res = await app.inject({
      method: 'POST', url: '/admin/store/orders/batch',
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { ids, status: 'APPROVED' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('issues')
  })
})
