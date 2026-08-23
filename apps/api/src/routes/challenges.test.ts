import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

const OTHER_SECTOR_ID = 'sector-gente-gestao'

async function ensureOtherSector() {
  await prisma.sector.upsert({
    where: { id: OTHER_SECTOR_ID },
    update: {},
    create: { id: OTHER_SECTOR_ID, name: 'Gente e Gestão', slug: 'gente-gestao', companyId: DEFAULT_COMPANY_ID },
  })
}

async function legendToken(app: ReturnType<typeof buildApp>) {
  const user = await prisma.user.create({
    data: {
      name: 'Lenda',
      email: `lenda-des-${Math.random()}@x.com`,
      passwordHash: 'x',
      role: 'LEGEND',
      sectorId: DEFAULT_SECTOR_ID,
    },
  })
  const token = app.jwt.sign({
    sub: user.id,
    role: 'LEGEND',
    sectorId: DEFAULT_SECTOR_ID,
    companyId: DEFAULT_COMPANY_ID,
    features: ['desafios'],
  })
  return { user, token }
}

async function seedChallenge(rewardCoins = 100) {
  const admin = await prisma.user.create({
    data: { name: 'Admin', email: `adm-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  return prisma.challenge.create({
    data: {
      title: 'Ler um livro',
      description: 'Conte o que aprendeu.',
      rewardCoins,
      companyId: DEFAULT_COMPANY_ID,
      createdById: admin.id,
    },
  })
}

describe('rotas de desafios do colaborador', () => {
  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/challenges' })
    expect(res.statusCode).toBe(401)
  })

  it('exige a feature "desafios" habilitada', async () => {
    const app = buildApp()
    await app.ready()
    const user = await prisma.user.create({
      data: {
        name: 'Sem feature',
        email: `sem-feature-${Math.random()}@x.com`,
        passwordHash: 'x',
        role: 'LEGEND',
        sectorId: DEFAULT_SECTOR_ID,
      },
    })
    const token = app.jwt.sign({
      sub: user.id,
      role: 'LEGEND',
      sectorId: DEFAULT_SECTOR_ID,
      companyId: DEFAULT_COMPANY_ID,
      features: [],
    })

    const res = await app.inject({ method: 'GET', url: '/challenges', headers: { authorization: `Bearer ${token}` } })

    expect(res.statusCode).toBe(403)
  })

  it('lista desafios com o estado da própria participação', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    await seedChallenge()

    const res = await app.inject({ method: 'GET', url: '/challenges', headers: { authorization: `Bearer ${token}` } })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ title: 'Ler um livro', rewardCoins: 100, mySubmission: null })
  })

  it('cria a participação e recusa a segunda com 409', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    const challenge = await seedChallenge()
    const headers = { authorization: `Bearer ${token}` }

    const first = await app.inject({
      method: 'POST',
      url: `/challenges/${challenge.id}/submissions`,
      headers,
      payload: { note: 'Terminei ontem.' },
    })
    expect(first.statusCode).toBe(201)
    expect(first.json()).toMatchObject({ status: 'PENDING', note: 'Terminei ontem.' })

    const second = await app.inject({
      method: 'POST',
      url: `/challenges/${challenge.id}/submissions`,
      headers,
      payload: {},
    })
    expect(second.statusCode).toBe(409)
  })

  it('valida a nota longa demais com 400', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    const challenge = await seedChallenge()

    const res = await app.inject({
      method: 'POST',
      url: `/challenges/${challenge.id}/submissions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { note: 'x'.repeat(501) },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('issues')
  })

  it('recusa evidenceKey fora do prefixo challenges/<próprio userId>/ com 400', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    const challenge = await seedChallenge()

    // Tentativa de apontar para o objeto de outra pessoa (ou qualquer outro
    // objeto do bucket, ex. um manual interno).
    const res = await app.inject({
      method: 'POST',
      url: `/challenges/${challenge.id}/submissions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { evidenceKey: 'challenges/outro-usuario-qualquer/arquivo.pdf' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('aceita evidenceKey dentro do próprio prefixo challenges/<userId>/', async () => {
    const app = buildApp()
    await app.ready()
    const { token, user } = await legendToken(app)
    const challenge = await seedChallenge()

    const res = await app.inject({
      method: 'POST',
      url: `/challenges/${challenge.id}/submissions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { evidenceKey: `challenges/${user.id}/prova.pdf` },
    })
    expect(res.statusCode).toBe(201)
  })

  it('devolve 404 para desafio inexistente', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)

    const res = await app.inject({
      method: 'POST',
      url: '/challenges/nao-existe/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('GET /challenges/:id', () => {
  it('devolve 200 para desafio visível', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    const challenge = await seedChallenge()

    const res = await app.inject({
      method: 'GET',
      url: `/challenges/${challenge.id}`,
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ title: 'Ler um livro', rewardCoins: 100 })
  })

  it('devolve 200 para desafio privado — D6: link direto abre para quem está no escopo', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `adm-priv-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const privado = await prisma.challenge.create({
      data: {
        title: 'Desafio privado',
        description: 'Só por link.',
        rewardCoins: 50,
        isPrivate: true,
        companyId: DEFAULT_COMPANY_ID,
        createdById: admin.id,
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/challenges/${privado.id}`,
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ title: 'Desafio privado', isPrivate: true })
  })

  it('devolve 404 para desafio de outro setor', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    await ensureOtherSector()
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `adm-outro-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const alheio = await prisma.challenge.create({
      data: {
        title: 'Desafio de outro setor',
        description: 'D',
        rewardCoins: 10,
        sectorId: OTHER_SECTOR_ID,
        companyId: DEFAULT_COMPANY_ID,
        createdById: admin.id,
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/challenges/${alheio.id}`,
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(404)
  })
})
