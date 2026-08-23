import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'

async function criarUsuario(role: string, email: string, sectorId?: string) {
  return prisma.user.create({
    data: { name: `Usuário ${role}`, email, passwordHash: 'x', role: role as never, ...(sectorId ? { sectorId } : {}) },
  })
}

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
})

describe('rotas de admin de desafios', () => {
  it('MEMBER recebe 403', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-desafio-rota@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, legend)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: auth,
      payload: { title: 'X', description: 'D', category: 'Cultura', rewardCoins: 10 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('categoria fora da lista canônica é 400', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-desafio-categoria@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: auth,
      payload: { title: 'X', description: 'D', category: 'Fofoca', rewardCoins: 10 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('ADMIN cria e recebe 201 com o DTO', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-desafio-cria@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: auth,
      payload: {
        title: 'Semana do bem-estar',
        description: 'Mexa o corpo',
        category: 'Bem-estar',
        rewardCoins: 50,
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().challenge.category).toBe('Bem-estar')
    expect(res.json().challenge).not.toHaveProperty('imageKey')
  })

  it('SUBADMIN não cria desafio da empresa inteira', async () => {
    const setor = await prisma.sector.create({ data: { name: 'Financeiro Rota', slug: 'financeiro-rota' } })
    const sub = await criarUsuario('SUBADMIN', 'sub-desafio-empresa@empresa.com', setor.id)
    const auth = { authorization: `Bearer ${signAccessToken(app, sub)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: auth,
      payload: {
        title: 'X',
        description: 'D',
        category: 'Cultura',
        rewardCoins: 10,
        sectorId: null,
      },
    })
    expect(res.statusCode).toBe(403)
  })

  it('SUBADMIN cria desafio do próprio setor quando sectorId vem omitido', async () => {
    const setor = await prisma.sector.create({ data: { name: 'RH Rota', slug: 'rh-rota' } })
    const sub = await criarUsuario('SUBADMIN', 'sub-desafio-omitido@empresa.com', setor.id)
    const auth = { authorization: `Bearer ${signAccessToken(app, sub)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: auth,
      payload: { title: 'Café com o setor', description: 'D', category: 'Cultura', rewardCoins: 10 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().challenge.sectorId).toBe(setor.id)
  })

  it('ADMIN cria desafio da empresa inteira quando sectorId vem omitido', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-desafio-omitido@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: auth,
      payload: { title: 'Indicar um talento', description: 'D', category: 'Cultura', rewardCoins: 10 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().challenge.sectorId).toBeNull()
  })

  it('exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/challenges' })
    expect(res.statusCode).toBe(401)
  })

  it('lista, atualiza, reordena e apaga desafios', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-desafio-crud@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const primeiro = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: auth,
      payload: { title: 'Primeiro', description: 'D', category: 'Cultura', rewardCoins: 10 },
    })
    const segundo = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: auth,
      payload: { title: 'Segundo', description: 'D', category: 'Cultura', rewardCoins: 10 },
    })
    expect(primeiro.statusCode).toBe(201)
    expect(segundo.statusCode).toBe(201)
    const idPrimeiro = primeiro.json().challenge.id
    const idSegundo = segundo.json().challenge.id

    const listagem = await app.inject({ method: 'GET', url: '/admin/challenges', headers: auth })
    expect(listagem.statusCode).toBe(200)
    expect(listagem.json().challenges).toHaveLength(2)

    const alterado = await app.inject({
      method: 'PATCH',
      url: `/admin/challenges/${idPrimeiro}`,
      headers: auth,
      payload: { title: 'Primeiro Editado' },
    })
    expect(alterado.statusCode).toBe(200)
    expect(alterado.json().challenge.title).toBe('Primeiro Editado')

    const reordenado = await app.inject({
      method: 'POST',
      url: '/admin/challenges/reorder',
      headers: auth,
      payload: { ids: [idSegundo, idPrimeiro] },
    })
    expect(reordenado.statusCode).toBe(204)

    const apagado = await app.inject({ method: 'DELETE', url: `/admin/challenges/${idPrimeiro}`, headers: auth })
    expect(apagado.statusCode).toBe(204)
    expect(await prisma.challenge.count()).toBe(1)
  })
})
