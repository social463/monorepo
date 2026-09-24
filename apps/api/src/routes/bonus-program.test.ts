import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_BONUS_PROGRAM, DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { hashPassword } from '../lib/password'
import { BONUS_PROGRAM_KEY } from '../services/bonus-program-service'

const app = buildApp()
let seq = 0

async function makeUser(role: 'LEGEND' | 'ADMIN', sectorId?: string) {
  seq += 1
  return prisma.user.create({
    data: {
      name: `Pessoa ${seq}`,
      email: `bonus-${seq}@empresa.com`,
      passwordHash: await hashPassword('x'),
      role,
      ...(sectorId ? { sectorId } : {}),
    },
  })
}

function tokenFor(user: { id: string; role: string; sectorId: string | null }) {
  return app.jwt.sign({
    sub: user.id,
    role: user.role,
    companyId: DEFAULT_COMPANY_ID,
    sectorId: user.sectorId ?? DEFAULT_SECTOR_ID,
    features: ['gente-gestao'],
  })
}

beforeEach(async () => {
  await app.ready()
})

describe('GET /bonus-program', () => {
  // A calculadora é do colaborador: sem os pools e o total de cotas ele não tem
  // como fazer a conta, então ler é de todo mundo logado.
  it('devolve os padrões da EMR para quem ainda não configurou', async () => {
    const user = await makeUser('LEGEND')
    const res = await app.inject({
      method: 'GET',
      url: '/bonus-program',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().settings).toEqual(DEFAULT_BONUS_PROGRAM)
  })

  it('exige estar logado', async () => {
    expect((await app.inject({ method: 'GET', url: '/bonus-program' })).statusCode).toBe(401)
  })

  it('JSON corrompido no banco cai no padrão em vez de derrubar a página', async () => {
    await prisma.appSetting.create({
      data: { key: BONUS_PROGRAM_KEY, companyId: DEFAULT_COMPANY_ID, value: '{ isso não é json' },
    })
    const user = await makeUser('LEGEND')

    const res = await app.inject({
      method: 'GET',
      url: '/bonus-program',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().settings.totalQuotas).toBe(DEFAULT_BONUS_PROGRAM.totalQuotas)
  })
})

describe('PUT /admin/bonus-program', () => {
  it('grava os números da empresa e devolve as metas ordenadas', async () => {
    const admin = await makeUser('ADMIN')
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/bonus-program',
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        totalQuotas: 2_000_000,
        deadline: '2029-06-30',
        // De propósito fora de ordem: quem digita não ordena.
        tiers: [
          { percent: 100, pool: 9_500_000 },
          { percent: 70, pool: 6_500_000 },
        ],
        manualId: null,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().settings.tiers.map((t: { percent: number }) => t.percent)).toEqual([70, 100])
    expect(res.json().settings.totalQuotas).toBe(2_000_000)
  })

  it('recusa total de cotas zerado — seria divisão por zero na tela', async () => {
    const admin = await makeUser('ADMIN')
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/bonus-program',
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { totalQuotas: 0, deadline: '2028-12-31', tiers: [{ percent: 100, pool: 1 }], manualId: null },
    })

    expect(res.statusCode).toBe(400)
  })

  it('recusa duas metas com o mesmo percentual', async () => {
    const admin = await makeUser('ADMIN')
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/bonus-program',
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        totalQuotas: 100,
        deadline: '2028-12-31',
        tiers: [
          { percent: 90, pool: 1 },
          { percent: 90, pool: 2 },
        ],
        manualId: null,
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/mesmo percentual/i)
  })

  it('colaborador sem o bloco de Gente e Gestão não grava', async () => {
    const user = await makeUser('LEGEND')
    const semFeature = app.jwt.sign({
      sub: user.id,
      role: user.role,
      companyId: DEFAULT_COMPANY_ID,
      sectorId: user.sectorId ?? DEFAULT_SECTOR_ID,
      features: [],
    })

    const res = await app.inject({
      method: 'PUT',
      url: '/admin/bonus-program',
      headers: { authorization: `Bearer ${semFeature}` },
      payload: { totalQuotas: 1, deadline: '2028-12-31', tiers: [{ percent: 100, pool: 1 }], manualId: null },
    })

    expect(res.statusCode).toBe(403)
  })

  it('o que foi gravado é o que a leitura devolve', async () => {
    const admin = await makeUser('ADMIN')
    await app.inject({
      method: 'PUT',
      url: '/admin/bonus-program',
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        totalQuotas: 500,
        deadline: '2030-01-31',
        tiers: [{ percent: 100, pool: 1_000 }],
        manualId: 'manual-todos-pelos-9',
      },
    })

    const leitura = await app.inject({
      method: 'GET',
      url: '/bonus-program',
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    })

    expect(leitura.json().settings).toEqual({
      totalQuotas: 500,
      deadline: '2030-01-31',
      tiers: [{ percent: 100, pool: 1_000 }],
      manualId: 'manual-todos-pelos-9',
    })
  })
})
