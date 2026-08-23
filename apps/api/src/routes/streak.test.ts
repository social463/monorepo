import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { todayInSaoPaulo, isBusinessDay } from '../lib/sao-paulo-date'

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  return { app, token }
}

describe('streak routes', () => {
  it('GET /me/streak retorna resumo zerado quando não há registros', async () => {
    const { app, token } = await setup()
    const res = await app.inject({ method: 'GET', url: '/me/streak', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ currentStreak: 0, bestStreak: 0, registeredToday: false })
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await app.close()
  })

  it('registrar humor de hoje reflete no streak (currentStreak 1, registeredToday true)', async () => {
    const { app, token } = await setup()
    await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'GOOD' } })
    const res = await app.inject({ method: 'GET', url: '/me/streak', headers: { authorization: `Bearer ${token}` } })
    const body = res.json()
    const expectedStreak = isBusinessDay(todayInSaoPaulo().ymd) ? 1 : 0
    expect(body.currentStreak).toBe(expectedStreak)
    expect(body.registeredToday).toBe(true)
    await app.close()
  })

  it('GET /me/streak/calendar sem month usa o mês atual e conta o boost de hoje', async () => {
    const { app, token } = await setup()
    await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'GOOD' } })
    const res = await app.inject({ method: 'GET', url: '/me/streak/calendar', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ref).toMatch(/^\d{4}-\d{2}$/)
    const expectedCount = isBusinessDay(todayInSaoPaulo().ymd) ? 1 : 0
    expect(body.count).toBe(expectedCount)
    expect(body.days).toHaveLength(expectedCount)
    await app.close()
  })

  it('GET /me/streak/calendar com month inválido retorna 400', async () => {
    const { app, token } = await setup()
    const res = await app.inject({ method: 'GET', url: '/me/streak/calendar?month=2026-13', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('exige autenticação (401 sem token)', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/me/streak' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
