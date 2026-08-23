import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function setup(role: 'ADMIN' | 'LEGEND' = 'ADMIN') {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  await prisma.user.update({ where: { email: 'ana@empresa.com' }, data: { role } })
  // O papel viaja no token: precisa de um login novo depois da promoção.
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'ana@empresa.com', password: 'changeme123' },
  })
  return { app, token: login.json().accessToken as string, registered: reg }
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

describe('admin — catálogo de tópicos de 1:1', () => {
  it('cria um tópico', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/one-on-one-topics',
      headers: auth(token),
      payload: { theme: 'Carreira', text: 'Onde você quer chegar?' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().template.theme).toBe('Carreira')
    await app.close()
  })

  it('lista inclusive os inativos', async () => {
    const { app, token } = await setup()
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@empresa.com' } })
    await prisma.oneOnOneTopicTemplate.createMany({
      data: [
        { theme: 'A', text: 'ativo', companyId: user.companyId },
        { theme: 'A', text: 'inativo', active: false, companyId: user.companyId },
      ],
    })

    const res = await app.inject({ method: 'GET', url: '/admin/one-on-one-topics', headers: auth(token) })

    expect(res.json().templates).toHaveLength(2)
    await app.close()
  })

  it('desativa sem apagar', async () => {
    const { app, token } = await setup()
    const criado = await app.inject({
      method: 'POST',
      url: '/admin/one-on-one-topics',
      headers: auth(token),
      payload: { theme: 'Carreira', text: 'Onde você quer chegar?' },
    })
    const id = criado.json().template.id

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/one-on-one-topics/${id}`,
      headers: auth(token),
      payload: { active: false },
    })

    expect(res.json().template.active).toBe(false)
    await app.close()
  })

  it('grava auditoria na criação', async () => {
    const { app, token } = await setup()
    await app.inject({
      method: 'POST',
      url: '/admin/one-on-one-topics',
      headers: auth(token),
      payload: { theme: 'Carreira', text: 'Onde você quer chegar?' },
    })

    expect(await prisma.adminAuditLog.count({ where: { entityType: 'OneOnOneTopicTemplate' } })).toBe(1)
    await app.close()
  })

  it('colaborador comum recebe 403', async () => {
    const { app, token } = await setup('LEGEND')
    const res = await app.inject({ method: 'GET', url: '/admin/one-on-one-topics', headers: auth(token) })

    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
