import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'

const URL_OK = 'https://app.powerbi.com/view?r=abc'

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

describe('rotas de painéis de RH', () => {
  it('cria e lista painel na ordem de sortOrder', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-rota-painel@empresa.com')
    const token = signAccessToken(app, admin)
    const auth = { authorization: `Bearer ${token}` }

    const segundo = await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: auth,
      payload: { title: 'Segundo', embedUrl: URL_OK, sortOrder: 20 },
    })
    expect(segundo.statusCode).toBe(201)

    const primeiro = await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: auth,
      payload: { title: 'Primeiro', embedUrl: URL_OK, sortOrder: 10, height: 800 },
    })
    expect(primeiro.statusCode).toBe(201)
    expect(primeiro.json().dashboard.height).toBe(800)

    const listagem = await app.inject({ method: 'GET', url: '/admin/hr-dashboards', headers: auth })
    expect(listagem.statusCode).toBe(200)
    expect(listagem.json().dashboards.map((d: { title: string }) => d.title)).toEqual(['Primeiro', 'Segundo'])
    expect(listagem.json().allowedHosts).toContain('app.powerbi.com')
  })

  it('recusa esquema diferente de https com 400 em português', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-http-painel@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: auth,
      payload: { title: 'X', embedUrl: 'http://app.powerbi.com/view' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Somente endereços https são aceitos.')
  })

  it('recusa host fora da allowlist em chamada direta à API', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-host-painel@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: auth,
      payload: { title: 'X', embedUrl: 'https://evil.com/painel' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('não está entre as ferramentas liberadas')
  })

  it('recusa altura fora de 300–2000', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-altura-painel@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    for (const height of [299, 2001]) {
      const res = await app.inject({
        method: 'POST', url: '/admin/hr-dashboards', headers: auth,
        payload: { title: 'X', embedUrl: URL_OK, height },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().issues).toBeDefined()
    }
  })

  it('bloqueia quem não é admin nem subadmin', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-painel@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, legend)}` }

    const res = await app.inject({ method: 'GET', url: '/admin/hr-dashboards', headers: auth })
    expect(res.statusCode).toBe(403)
  })

  it('exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/hr-dashboards' })
    expect(res.statusCode).toBe(401)
  })

  it('esconde do subadmin o painel de outro setor', async () => {
    const setor = await prisma.sector.create({ data: { name: 'Gente e Gestão', slug: 'gente-e-gestao' } })
    const admin = await criarUsuario('ADMIN', 'admin-escopo-painel@empresa.com')
    const sub = await criarUsuario('SUBADMIN', 'sub-escopo-painel@empresa.com', setor.id)
    const adminAuth = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    // Painel de RH é área de G&G: a feature do setor viaja no token.
    const subAuth = { authorization: `Bearer ${signAccessToken(app, sub, ['gente-gestao'])}` }

    await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: adminAuth,
      payload: { title: 'De outro setor', embedUrl: URL_OK, sectorId: DEFAULT_SECTOR_ID },
    })
    await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: adminAuth,
      payload: { title: 'Do meu setor', embedUrl: URL_OK, sectorId: setor.id },
    })

    const listagem = await app.inject({ method: 'GET', url: '/admin/hr-dashboards', headers: subAuth })
    expect(listagem.json().dashboards.map((d: { title: string }) => d.title)).toEqual(['Do meu setor'])
  })

  it('atualiza e apaga um painel', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-crud-painel@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const criado = await app.inject({
      method: 'POST', url: '/admin/hr-dashboards', headers: auth,
      payload: { title: 'Headcount', embedUrl: URL_OK },
    })
    const id = criado.json().dashboard.id

    const alterado = await app.inject({
      method: 'PATCH', url: `/admin/hr-dashboards/${id}`, headers: auth,
      payload: { title: 'Headcount 2026' },
    })
    expect(alterado.statusCode).toBe(200)
    expect(alterado.json().dashboard.title).toBe('Headcount 2026')

    const apagado = await app.inject({ method: 'DELETE', url: `/admin/hr-dashboards/${id}`, headers: auth })
    expect(apagado.statusCode).toBe(204)
    expect(await prisma.hrDashboard.count()).toBe(0)
  })
})
