import { describe, it, expect, vi, afterEach } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { signCalendarState } from '../lib/calendar/state'
import { updateCalendarSettings } from '../services/calendar-settings-service'

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@empresa.com' } })
  return { app, token, user }
}

async function configureGoogle(actorId: string) {
  await updateCalendarSettings({
    companyId: DEFAULT_COMPANY_ID,
    actorId,
    body: { google: { clientId: 'cid', clientSecret: 'csecret' } },
  })
}

function stubTokenResponse() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
            scope: 'calendar.events',
            id_token: `h.${Buffer.from(JSON.stringify({ email: 'ana@gmail.com' })).toString('base64url')}.s`,
          }),
          { status: 200 },
        ),
    ),
  )
}

afterEach(() => vi.restoreAllMocks())

describe('calendar routes', () => {
  it('GET /calendar/connections exige autenticação', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/calendar/connections' })).statusCode).toBe(401)
    await app.close()
  })

  it('GET /calendar/connections devolve estado vazio sem credenciais', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/connections',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ connections: [], available: [] })
    await app.close()
  })

  it('POST /calendar/connect/google devolve 409 sem credenciais na empresa', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/connect/google',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toContain('administrador')
    await app.close()
  })

  it('POST /calendar/connect/google devolve authorizeUrl', async () => {
    const { app, token, user } = await setup()
    await configureGoogle(user.id)
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/connect/google',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().authorizeUrl).toContain('accounts.google.com')
    await app.close()
  })

  it('POST /calendar/connect/:provider rejeita provedor desconhecido com 400', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/connect/apple',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('GET /calendar/callback/google salva a conexão e redireciona com sucesso', async () => {
    const { app, user } = await setup()
    await configureGoogle(user.id)
    stubTokenResponse()
    const state = signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' })

    const res = await app.inject({ method: 'GET', url: `/calendar/callback/google?code=c1&state=${state}` })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('calendario=ok')
    expect(await prisma.calendarConnection.count({ where: { userId: user.id } })).toBe(1)
    await app.close()
  })

  it('GET /calendar/callback/google com state inválido redireciona com erro e não cria conexão', async () => {
    const { app, user } = await setup()
    await configureGoogle(user.id)
    const res = await app.inject({ method: 'GET', url: '/calendar/callback/google?code=c1&state=forjado' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('calendario=erro')
    expect(await prisma.calendarConnection.count({ where: { userId: user.id } })).toBe(0)
    await app.close()
  })

  it('GET /calendar/callback/google com erro do provedor redireciona com erro', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/calendar/callback/google?error=access_denied' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('calendario=erro')
    await app.close()
  })

  it('DELETE /calendar/connections/google remove a conexão', async () => {
    const { app, token, user } = await setup()
    await configureGoogle(user.id)
    stubTokenResponse()
    const state = signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' })
    await app.inject({ method: 'GET', url: `/calendar/callback/google?code=c1&state=${state}` })

    const res = await app.inject({
      method: 'DELETE',
      url: '/calendar/connections/google',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(204)
    expect(await prisma.calendarConnection.count({ where: { userId: user.id } })).toBe(0)
    await app.close()
  })

  it('DELETE /calendar/connections/google devolve 404 sem conexão', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'DELETE',
      url: '/calendar/connections/google',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('uma pessoa não vê a conexão de outra', async () => {
    const { app, user } = await setup()
    await configureGoogle(user.id)
    stubTokenResponse()
    const state = signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' })
    await app.inject({ method: 'GET', url: `/calendar/callback/google?code=c1&state=${state}` })

    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Bia', email: 'bia@empresa.com', password: 'changeme123' },
    })
    const other = reg.json().accessToken as string
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/connections',
      headers: { authorization: `Bearer ${other}` },
    })
    expect(res.json().connections).toEqual([])
    await app.close()
  })
})
