import { describe, it, expect } from 'vitest'
import { MOOD_ALREADY_ANSWERED_MESSAGE, MOOD_REASON_REQUIRED_MESSAGE } from '@legends/shared'
import { buildApp } from '../app'

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

describe('mood routes', () => {
  it('GET /me/mood/today retorna mood null quando não há registro', async () => {
    const { app, token } = await setup()
    const res = await app.inject({ method: 'GET', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.mood).toBeNull()
    expect(body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await app.close()
  })

  it('PUT /me/mood/today cria o registro do dia e retorna o humor', async () => {
    const { app, token } = await setup()
    const res = await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'GOOD' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().mood).toBe('GOOD')

    const get = await app.inject({ method: 'GET', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` } })
    expect(get.json().mood).toBe('GOOD')
    await app.close()
  })

  // Vale a PRIMEIRA resposta do dia. A tela nem oferece o botão de alterar; a
  // API recusa também, senão a regra valeria só para quem usa a interface.
  it('PUT /me/mood/today recusa a segunda resposta do mesmo dia', async () => {
    const { app, token } = await setup()
    await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'GOOD' } })
    const res = await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'HARD', reason: 'WORKLOAD' } })
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toBe(MOOD_ALREADY_ANSWERED_MESSAGE)

    // A primeira resposta fica de pé, e continua sendo uma linha só.
    const get = await app.inject({ method: 'GET', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` } })
    expect(get.json().mood).toBe('GOOD')
    const { prisma } = await import('../lib/prisma')
    expect(await prisma.moodEntry.count()).toBe(1)
    await app.close()
  })

  it('PUT /me/mood/today aceita nota opcional e GET a retorna', async () => {
    const { app, token } = await setup()
    const res = await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'LOW', note: 'Semana corrida', reason: 'WORKLOAD' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().mood).toBe('LOW')
    expect(res.json().note).toBe('Semana corrida')

    const get = await app.inject({ method: 'GET', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` } })
    expect(get.json().note).toBe('Semana corrida')
    await app.close()
  })

  it('PUT /me/mood/today sem nota guarda note null', async () => {
    const { app, token } = await setup()
    const res = await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'GOOD' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().note).toBeNull()
    await app.close()
  })

  it('PUT /me/mood/today com nota acima do limite retorna 400', async () => {
    const { app, token } = await setup()
    const res = await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'GOOD', note: 'x'.repeat(281) } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('PUT /me/mood/today com mood inválido retorna 400', async () => {
    const { app, token } = await setup()
    const res = await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'FELIZ' } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('PUT /me/mood/today aceita motivo em humor negativo e o mantém no dia', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'PUT',
      url: '/me/mood/today',
      headers: { authorization: `Bearer ${token}` },
      payload: { mood: 'LOW', note: 'Muita demanda', reason: 'WORKLOAD' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().reason).toBe('WORKLOAD')

    const get = await app.inject({ method: 'GET', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` } })
    expect(get.json().reason).toBe('WORKLOAD')
    await app.close()
  })

  // O motivo é o que o painel de clima usa para dizer O QUÊ está pesando: um
  // balde "Não informado" que cresce sozinho esvaziaria o painel inteiro.
  it('PUT /me/mood/today recusa humor negativo sem motivo', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'PUT',
      url: '/me/mood/today',
      headers: { authorization: `Bearer ${token}` },
      payload: { mood: 'HARD' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe(MOOD_REASON_REQUIRED_MESSAGE)

    const { prisma } = await import('../lib/prisma')
    expect(await prisma.moodEntry.count()).toBe(0)
    await app.close()
  })

  it('PUT /me/mood/today segue aceitando humor positivo sem motivo', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'PUT',
      url: '/me/mood/today',
      headers: { authorization: `Bearer ${token}` },
      payload: { mood: 'GOOD' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().reason).toBeNull()
    await app.close()
  })

  // Os dois motivos que saíram da lista continuam no enum do Prisma para o
  // painel ler o passado — mas ninguém pode escolhê-los de novo.
  it('PUT /me/mood/today recusa motivo legado', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'PUT',
      url: '/me/mood/today',
      headers: { authorization: `Bearer ${token}` },
      payload: { mood: 'LOW', reason: 'RECOGNITION' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('PUT /me/mood/today descarta o motivo quando o humor não é negativo', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'PUT',
      url: '/me/mood/today',
      headers: { authorization: `Bearer ${token}` },
      payload: { mood: 'GREAT', reason: 'WORKLOAD' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().reason).toBeNull()
    await app.close()
  })

  it('PUT /me/mood/today com motivo fora da lista retorna 400', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'PUT',
      url: '/me/mood/today',
      headers: { authorization: `Bearer ${token}` },
      payload: { mood: 'LOW', reason: 'CAFE_RUIM' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('exige autenticação (401 sem token)', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/me/mood/today' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('PUT /me/mood/today credita EMR Coins uma vez por dia', async () => {
    const { app, token } = await setup()
    const { prisma } = await import('../lib/prisma')
    await prisma.coinRule.create({ data: { event: 'MOOD_ANSWERED', amount: 10 } })

    await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'GOOD' } })
    await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'HARD', reason: 'WORKLOAD' } })

    const entries = await prisma.coinTransaction.findMany()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ event: 'MOOD_ANSWERED', amount: 10, kind: 'EARN' })
    await app.close()
  })

  it('PUT /me/mood/today concede selo de ofensiva e notifica quando o recorde atinge o limiar', async () => {
    const { app, token } = await setup()
    const { prisma } = await import('../lib/prisma')
    const { dayFromYmd } = await import('../lib/sao-paulo-date')
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@empresa.com' } })
    // Pré-semeia 7 dias úteis consecutivos → bestStreak 7, independente de "hoje".
    await prisma.moodEntry.createMany({
      data: ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-08', '2026-06-09'].map(
        (ymd) => ({ userId: user.id, mood: 'GOOD' as const, day: dayFromYmd(ymd) }),
      ),
    })
    const badge = await prisma.badge.create({
      data: { slug: 'ofensiva-7-dias-uteis', name: 'Em chamas', description: 'x', kind: 'STREAK', iconKey: 'fe-fire', threshold: 7 },
    })

    const res = await app.inject({
      method: 'PUT',
      url: '/me/mood/today',
      headers: { authorization: `Bearer ${token}` },
      payload: { mood: 'GOOD' },
    })
    expect(res.statusCode).toBe(200)

    const owned = await prisma.userBadge.findMany({ where: { userId: user.id, badgeId: badge.id } })
    expect(owned).toHaveLength(1)
    const notifs = await prisma.notification.findMany({ where: { userId: user.id, type: 'BADGE_EARNED' } })
    expect(notifs.length).toBeGreaterThanOrEqual(1)
    await app.close()
  })
})
