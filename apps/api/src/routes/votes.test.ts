import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

function currentOpenPeriodData() {
  const now = new Date()
  return {
    monthRef: now.toISOString().slice(0, 7),
    startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    endsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    status: 'OPEN' as const,
  }
}

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  const voterId = reg.json().user.id as string
  const voted = await prisma.user.create({ data: { name: 'Bruno', email: 'bruno@empresa.com', passwordHash: 'x' } })
  const category = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
  await prisma.votingPeriod.create({
    data: currentOpenPeriodData(),
  })
  return { app, token, voterId, voted, category }
}

describe('vote routes', () => {
  /**
   * Com a votação **aberta**: o feedback do voto não espera mais a publicação do
   * destaque para aparecer no perfil de quem recebeu. O que continua guardado
   * até a publicação é quem foi o Destaque do Mês, que não sai daqui.
   */
  it('o feedback do voto aparece no perfil de quem recebeu ainda na votação', async () => {
    const { app, token, voted, category } = await setup()
    const justification = 'Ajudou muito no incidente de produção.'
    const criado = await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voted.id, categoryIds: [category.id], justification },
    })
    expect(criado.statusCode).toBe(201)

    const perfil = await app.inject({
      method: 'GET',
      url: `/users/${voted.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(perfil.json().total).toBe(1)
    const feedback = perfil.json().feedbacks[0]
    expect(feedback.message).toBe(justification)
    expect(feedback.author.name).toBe('Ana')
    expect(feedback.categories.map((c: { name: string }) => c.name)).toEqual(['Colaboração'])
    // Privado: aparecer no perfil é uma coisa, ir para o mural é decisão de quem recebeu.
    expect(feedback.sharedAt).toBeNull()
    await app.close()
  })

  it('avisa quem recebeu e avalia os selos dele na hora do voto', async () => {
    const { app, token, voted, category } = await setup()
    await prisma.badge.create({
      data: { slug: 'reconhecido-voto', name: 'Reconhecido', description: '1 feedback', kind: 'IMPACT', iconKey: 'star', threshold: 1 },
    })
    await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voted.id, categoryIds: [category.id], justification: 'Ajudou muito no incidente de produção.' },
    })

    const tipos = (await prisma.notification.findMany({ where: { userId: voted.id } })).map((n) => n.type)
    expect(tipos).toContain('FEEDBACK_RECEIVED')
    expect(tipos).toContain('BADGE_EARNED')
    await app.close()
  })

  it('um voto rende um feedback só, ligado a ele', async () => {
    const { app, token, voted, category } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voted.id, categoryIds: [category.id], justification: 'Ajudou muito no incidente de produção.' },
    })
    const voteId = res.json().vote.id
    expect(await prisma.feedback.count({ where: { voteId } })).toBe(1)
    await app.close()
  })

  it('creates a vote (201)', async () => {
    const { app, token, voted, category } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voted.id, categoryIds: [category.id], justification: 'Ajudou muito no incidente de produção.' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().vote.voted.name).toBe('Bruno')
    await app.close()
  })

  it('credita EMR Coins ao votante quando há regra ativa', async () => {
    const { app, token, voterId, voted, category } = await setup()
    await prisma.coinRule.create({ data: { event: 'VOTE_CAST', amount: 50 } })

    const res = await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voted.id, categoryIds: [category.id], justification: 'Ajudou muito no incidente de produção.' },
    })
    expect(res.statusCode).toBe(201)

    const entries = await prisma.coinTransaction.findMany({ where: { userId: voterId } })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ event: 'VOTE_CAST', amount: 50 })
    await app.close()
  })

  it('rejects a short justification (400)', async () => {
    const { app, token, voted, category } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voted.id, categoryIds: [category.id], justification: 'curto' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects an admin trying to vote (403)', async () => {
    const { app, token, voterId, voted, category } = await setup()
    await prisma.user.update({ where: { id: voterId }, data: { role: 'ADMIN' } })
    const res = await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voted.id, categoryIds: [category.id], justification: 'justificativa bem detalhada' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('rejects voting for yourself (400)', async () => {
    const { app, token, voterId, category } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voterId, categoryIds: [category.id], justification: 'tentando votar em mim mesmo' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects a second vote in the same period (409)', async () => {
    const { app, token, voted, category } = await setup()
    const otherVoted = await prisma.user.create({ data: { name: 'Carla', email: 'carla@empresa.com', passwordHash: 'x' } })
    await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voted.id, categoryIds: [category.id], justification: 'justificativa bem detalhada' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: otherVoted.id, categoryIds: [category.id], justification: 'tentando votar de novo' },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('requires authentication (401)', async () => {
    const { app, voted, category } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/votes',
      payload: { votedId: voted.id, categoryIds: [category.id], justification: 'justificativa bem detalhada' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('lists my votes in the current period', async () => {
    const { app, token, voted, category } = await setup()
    await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voted.id, categoryIds: [category.id], justification: 'justificativa bem detalhada' },
    })
    const res = await app.inject({
      method: 'GET',
      url: '/votes/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().votes).toHaveLength(1)
    expect(res.json().votes[0].categories[0].name).toBe('Colaboração')
    await app.close()
  })

  it('rejeita mais de MAX_VOTE_CATEGORIES categorias (400)', async () => {
    const { app, token, voted, category } = await setup()
    const c2 = await prisma.recognitionCategory.create({ data: { name: 'Inovação', slug: 'inovacao' } })
    const c3 = await prisma.recognitionCategory.create({ data: { name: 'Liderança', slug: 'lideranca' } })
    const c4 = await prisma.recognitionCategory.create({ data: { name: 'Qualidade', slug: 'qualidade' } })
    const res = await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voted.id, categoryIds: [category.id, c2.id, c3.id, c4.id], justification: 'texto válido aqui' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejeita zero categorias (400)', async () => {
    const { app, token, voted } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/votes',
      headers: { authorization: `Bearer ${token}` },
      payload: { votedId: voted.id, categoryIds: [], justification: 'texto válido aqui' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
