import { describe, it, expect, beforeEach } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { hashPassword } from '../lib/password'

const EMAIL = 'lenda@example.com'
const PASSWORD = 'supersecret1'

beforeEach(async () => {
  await prisma.user.create({
    data: { name: 'Lenda', email: EMAIL, passwordHash: await hashPassword(PASSWORD) },
  })
})

function refreshCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? '']
  const cookie = raw.find((c) => c.startsWith('legends.refresh='))!
  return cookie.split(';')[0].split('=')[1]
}

describe('fluxo de refresh token', () => {
  it('login devolve accessToken e seta cookie de refresh httpOnly', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD, remember: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeTypeOf('string')
    const setCookie = res.headers['set-cookie'] as string | string[]
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : setCookie
    expect(cookieStr).toMatch(/legends\.refresh=/)
    expect(cookieStr.toLowerCase()).toContain('httponly')
    await app.close()
  })

  it('refresh rotaciona o cookie e devolve novo accessToken', async () => {
    const app = buildApp()
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD, remember: false },
    })
    const token = refreshCookie(login.headers['set-cookie'])

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { 'legends.refresh': token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeTypeOf('string')
    const newToken = refreshCookie(res.headers['set-cookie'])
    expect(newToken).not.toBe(token)
    await app.close()
  })

  it('reusar um refresh já rotacionado dentro da janela de graça rotaciona de novo (corrida entre abas)', async () => {
    const app = buildApp()
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD, remember: false },
    })
    const token = refreshCookie(login.headers['set-cookie'])
    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { 'legends.refresh': token },
    })
    const firstNewToken = refreshCookie(first.headers['set-cookie'])

    const reused = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { 'legends.refresh': token },
    })
    expect(reused.statusCode).toBe(200)
    const secondNewToken = refreshCookie(reused.headers['set-cookie'])
    expect(secondNewToken).not.toBe(token)
    expect(secondNewToken).not.toBe(firstNewToken)
    await app.close()
  })

  it('reusar um refresh rotacionado há muito tempo (fora da janela de graça) retorna 401', async () => {
    const app = buildApp()
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD, remember: false },
    })
    const token = refreshCookie(login.headers['set-cookie'])
    await app.inject({ method: 'POST', url: '/auth/refresh', cookies: { 'legends.refresh': token } })

    await prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    })

    const reused = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { 'legends.refresh': token },
    })
    expect(reused.statusCode).toBe(401)
    await app.close()
  })

  it('refresh sem cookie retorna 401', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'POST', url: '/auth/refresh' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('logout revoga e limpa o cookie', async () => {
    const app = buildApp()
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD, remember: false },
    })
    const token = refreshCookie(login.headers['set-cookie'])

    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { 'legends.refresh': token },
    })
    expect(out.statusCode).toBe(204)

    const after = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { 'legends.refresh': token },
    })
    expect(after.statusCode).toBe(401)
    await app.close()
  })

  it('remember=true gera cookie persistente (com Expires/Max-Age)', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD, remember: true },
    })
    const setCookie = res.headers['set-cookie'] as string | string[]
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : setCookie
    expect(cookieStr.toLowerCase()).toMatch(/expires=|max-age=/)
    await app.close()
  })

  it('remember=false gera cookie de sessão (sem Expires/Max-Age)', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD, remember: false },
    })
    const setCookie = res.headers['set-cookie'] as string | string[]
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : setCookie
    expect(cookieStr.toLowerCase()).not.toMatch(/expires=|max-age=/)
    await app.close()
  })
})
