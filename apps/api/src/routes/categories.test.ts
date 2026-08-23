import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function tokenFor(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  return res.json().accessToken as string
}

describe('GET /categories', () => {
  it('lista só as categorias ativas, na ordem do catálogo', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app)
    await prisma.recognitionCategory.create({ data: { name: 'Inovação', slug: 'inovacao' } })
    await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
    await prisma.recognitionCategory.create({ data: { name: 'Desativada', slug: 'desativada', active: false } })

    const res = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const names = res.json().categories.map((c: { name: string }) => c.name)
    expect(names).toEqual(['Colaboração', 'Inovação'])
    await app.close()
  })

  it('requires authentication (401)', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/categories' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('não inclui categoria global de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app)
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Categorias', slug: 'outra-empresa-categorias-test' } })
    await prisma.recognitionCategory.create({
      data: { name: 'Global Outra Empresa', slug: 'global-outra-empresa-cat', companyId: otherCompany.id },
    })

    const res = await app.inject({ method: 'GET', url: '/categories', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const names = res.json().categories.map((c: { name: string }) => c.name)
    expect(names).not.toContain('Global Outra Empresa')
    await app.close()
  })
})
