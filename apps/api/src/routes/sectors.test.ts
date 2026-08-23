import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { createSector } from '../services/sector-service'

async function registerAndToken(app: ReturnType<typeof buildApp>, email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: email.split('@')[0], email, password: 'changeme123' },
  })
  return res.json().accessToken as string
}

describe('GET /sectors', () => {
  it('não lista setores de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'ana-sectors@empresa.com')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Sectors', slug: 'outra-empresa-sectors' } })
    const externalSector = await prisma.sector.create({
      data: {
        name: 'Setor Externo',
        slug: 'setor-externo-route-test',
        companyId: otherCompany.id,
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/sectors',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const sectorIds = res.json().sectors.map((s: { id: string }) => s.id)
    expect(sectorIds).toContain('sector-dev-produto')
    expect(sectorIds).not.toContain(externalSector.id)
    await app.close()
  })

  it('lista setores ativos com só id e name (sem enabledFeatures/roles)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'sectors-list@empresa.com')
    const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin-sectors-list@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const extra = await createSector({ name: 'Setor Extra Listagem', enabledFeatures: ['votar'], roles: ['LEGEND'] }, admin.id, DEFAULT_COMPANY_ID)

    const res = await app.inject({ method: 'GET', url: '/sectors', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const sectors = res.json().sectors as Array<{ id: string; name: string }>
    const names = sectors.map((s) => s.name)
    expect(names).toContain('Setor Extra Listagem')
    expect(names).toContain('Desenvolvimento de Produto')
    const found = sectors.find((s) => s.id === extra.id)
    expect(found).toEqual({ id: extra.id, name: 'Setor Extra Listagem' })
    await app.close()
  })

  it('não lista setor inativo', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'sectors-inactive@empresa.com')
    const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin-sectors-inactive@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const inativo = await createSector({ name: 'Setor Desativado', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
    await prisma.sector.update({ where: { id: inativo.id }, data: { active: false } })

    const res = await app.inject({ method: 'GET', url: '/sectors', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const names = (res.json().sectors as Array<{ name: string }>).map((s) => s.name)
    expect(names).not.toContain('Setor Desativado')
    await app.close()
  })

  it('rejeita requisição sem autenticação (401)', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/sectors' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
