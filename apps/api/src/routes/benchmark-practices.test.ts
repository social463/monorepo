import { beforeEach, describe, expect, it } from 'vitest'
import { BENCHMARK_PRACTICE_MAX_TAGS, BENCHMARK_PRACTICE_TITLE_MAX_LENGTH } from '@legends/shared'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'

async function criarUsuario(role: string, email: string, companyId?: string) {
  return prisma.user.create({
    data: {
      name: `Usuário ${role}`,
      email,
      passwordHash: 'x',
      role: role as never,
      ...(companyId ? { companyId } : {}),
    },
  })
}

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
})

describe('rotas de práticas internas', () => {
  it('cria, lista, edita e remove', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-praticas@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const criada = await app.inject({
      method: 'POST',
      url: '/admin/benchmark-practices',
      headers: auth,
      payload: {
        category: 'Reconhecimento',
        title: 'Day off de aniversário',
        description: 'Folga no mês do aniversário',
        channel: 'Teams',
        tags: ['mensal', 'benefício'],
      },
    })
    expect(criada.statusCode).toBe(201)
    expect(criada.json().practice).toMatchObject({
      category: 'Reconhecimento',
      title: 'Day off de aniversário',
      channel: 'Teams',
      tags: ['mensal', 'benefício'],
      createdByName: admin.name,
    })

    const id = criada.json().practice.id
    const editada = await app.inject({
      method: 'PATCH',
      url: `/admin/benchmark-practices/${id}`,
      headers: auth,
      payload: { title: 'Day off no mês do aniversário', channel: null },
    })
    expect(editada.json().practice.title).toBe('Day off no mês do aniversário')
    expect(editada.json().practice.channel).toBeNull()

    const listagem = await app.inject({ method: 'GET', url: '/admin/benchmark-practices', headers: auth })
    expect(listagem.json().practices).toHaveLength(1)

    const removida = await app.inject({
      method: 'DELETE',
      url: `/admin/benchmark-practices/${id}`,
      headers: auth,
    })
    expect(removida.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/admin/benchmark-practices', headers: auth })).json().practices)
      .toHaveLength(0)
  })

  it('deduplica tags e recusa lista acima do teto', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-tags@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const criada = await app.inject({
      method: 'POST',
      url: '/admin/benchmark-practices',
      headers: auth,
      payload: { category: 'Engajamento', title: 'Gincana', tags: ['anual', 'anual', 'presencial'] },
    })
    expect(criada.json().practice.tags).toEqual(['anual', 'presencial'])

    const demais = await app.inject({
      method: 'POST',
      url: '/admin/benchmark-practices',
      headers: auth,
      payload: {
        category: 'Engajamento',
        title: 'Outra',
        tags: Array.from({ length: BENCHMARK_PRACTICE_MAX_TAGS + 1 }, (_, i) => `tag${i}`),
      },
    })
    expect(demais.statusCode).toBe(400)
  })

  it('recusa título acima do limite com 400', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-titulo@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/benchmark-practices',
      headers: auth,
      payload: { category: 'X', title: 'a'.repeat(BENCHMARK_PRACTICE_TITLE_MAX_LENGTH + 1) },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().issues).toBeDefined()
  })

  it('só o SUBADMIN do setor com a feature gerencia o inventário', async () => {
    const subadminGG = await criarUsuario('SUBADMIN', 'subadmin-gg-praticas@empresa.com')
    const subadminOutro = await criarUsuario('SUBADMIN', 'subadmin-outro-praticas@empresa.com')
    const legend = await criarUsuario('LEGEND', 'legend-praticas@empresa.com')

    const cadastrar = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/admin/benchmark-practices',
        headers: { authorization: `Bearer ${token}` },
        payload: { category: 'Cultura organizacional', title: 'Café com a liderança' },
      })
    const listar = (token: string) =>
      app.inject({ method: 'GET', url: '/admin/benchmark-practices', headers: { authorization: `Bearer ${token}` } })

    expect((await cadastrar(signAccessToken(app, subadminGG, ['gente-gestao']))).statusCode).toBe(201)
    expect((await cadastrar(signAccessToken(app, subadminOutro, ['cultura']))).statusCode).toBe(403)
    // Nem a leitura: o inventário é a base de comparação, não é dado de vitrine.
    expect((await listar(signAccessToken(app, subadminOutro))).statusCode).toBe(403)
    expect((await listar(signAccessToken(app, legend, ['gente-gestao']))).statusCode).toBe(403)
  })

  it('prática de outra empresa nunca aparece nem pode ser editada', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-iso-praticas@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const outra = await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })
    const alheia = await prisma.benchmarkPractice.create({
      data: { companyId: outra.id, category: 'X', title: 'Prática alheia' },
    })

    const listagem = await app.inject({ method: 'GET', url: '/admin/benchmark-practices', headers: auth })
    const edicao = await app.inject({
      method: 'PATCH',
      url: `/admin/benchmark-practices/${alheia.id}`,
      headers: auth,
      payload: { title: 'Invadida' },
    })
    const remocao = await app.inject({
      method: 'DELETE',
      url: `/admin/benchmark-practices/${alheia.id}`,
      headers: auth,
    })

    expect(listagem.json().practices).toHaveLength(0)
    expect(edicao.statusCode).toBe(404)
    expect(remocao.statusCode).toBe(404)
    // E continua intacta na empresa dona.
    expect((await prisma.benchmarkPractice.findUnique({ where: { id: alheia.id } }))?.title).toBe('Prática alheia')
  })

  it('sem token, 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/benchmark-practices' })).statusCode).toBe(401)
  })
})
