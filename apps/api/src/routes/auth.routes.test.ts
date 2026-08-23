import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { hashPassword } from '../lib/password'

async function setup() {
  const app = buildApp()
  await app.ready()
  const email = `route-${Date.now()}@x.com`
  await prisma.user.create({
    data: { name: 'Teste', email, passwordHash: await hashPassword('senha-atual-1') },
  })
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'senha-atual-1' },
  })
  const token = login.json().accessToken as string
  const cookie = login.cookies.find((c) => c.name === 'legends.refresh')!
  return { app, email, token, cookie }
}

describe('POST /auth/change-password', () => {
  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      payload: { currentPassword: 'x', newPassword: 'novasenha8' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('troca a senha e revoga sessões antigas', async () => {
    const { app, email, token } = await setup()
    // segunda sessão (deve ser revogada)
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'senha-atual-1' } })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'senha-atual-1', newPassword: 'nova-senha-2' },
    })
    expect(res.statusCode).toBe(204)
    expect(res.cookies.find((c) => c.name === 'legends.refresh')).toBeDefined()

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    // exatamente 1 refresh token ativo (a sessão atual, recém-emitida)
    const active = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })
    expect(active).toBe(1)

    const relogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'nova-senha-2' } })
    expect(relogin.statusCode).toBe(200)
    await app.close()
  })

  it('rejeita senha atual incorreta com 400', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'errada', newPassword: 'nova-senha-2' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
