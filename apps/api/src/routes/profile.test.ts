import { describe, it, expect, vi, afterEach } from 'vitest'
import { MAX_FEATURED_BADGES, DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import * as badgeService from '../services/badge-service'
import { createSector } from '../services/sector-service'
import { dayFromYmd } from '../lib/sao-paulo-date'
import { materializeVoteFeedbacks } from '../services/vote-feedback-service'

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  const meId = reg.json().user.id as string

  const target = await prisma.user.create({ data: { name: 'Bruno', email: 'bruno@empresa.com', passwordHash: 'x', position: 'Backend', squad: 'Core' } })
  const voter = await prisma.user.create({ data: { name: 'Carla', email: 'carla@empresa.com', passwordHash: 'x' } })
  const cat = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
  const period = await prisma.votingPeriod.create({
    data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'), status: 'CLOSED', highlightStatus: 'PUBLISHED' },
  })
  // createdAt dentro da janela do período: o mês do feedback é o dia em que a
  // pessoa votou, não o da publicação.
  await prisma.vote.create({ data: { voterId: voter.id, votedId: target.id, periodId: period.id, justification: 'Trabalho excelente em equipe.', createdAt: new Date('2026-06-15T12:00:00.000Z'), categories: { create: [{ categoryId: cat.id }] } } })
  // O destaque do período já está publicado: é aí que o texto do voto vira o
  // feedback que o perfil agrega.
  await materializeVoteFeedbacks(period.id)

  return { app, token, meId, target }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('profile routes', () => {
  it('returns a single user (GET /users/:id)', async () => {
    const { app, token, target } = await setup()
    const res = await app.inject({ method: 'GET', url: `/users/${target.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.name).toBe('Bruno')
    await app.close()
  })

  it('traz o nível do dono do perfil, não o de quem está olhando', async () => {
    const { app, token, meId, target } = await setup()
    await prisma.xpTransaction.create({
      data: {
        userId: target.id,
        event: 'VOTE_CAST',
        amount: 600,
        dedupeKey: 'VOTE_CAST:seed-alvo',
        day: dayFromYmd('2026-06-01'),
        companyId: DEFAULT_COMPANY_ID,
      },
    })
    await prisma.xpTransaction.create({
      data: {
        userId: meId,
        event: 'VOTE_CAST',
        amount: 9_000,
        dedupeKey: 'VOTE_CAST:seed-viewer',
        day: dayFromYmd('2026-06-01'),
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/users/${target.id}/profile`,
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.json().xp).toMatchObject({ points: 600, level: { name: 'Prata', next: 'Ouro' } })
    await app.close()
  })

  it('returns 404 for unknown user', async () => {
    const { app, token } = await setup()
    const res = await app.inject({ method: 'GET', url: '/users/unknown-id', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('returns the aggregated profile (GET /users/:id/profile)', async () => {
    const { app, token, target } = await setup()
    const res = await app.inject({ method: 'GET', url: `/users/${target.id}/profile`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.user.name).toBe('Bruno')
    expect(body.stats.totalFeedbacksReceived).toBe(1)
    expect(body.stats.monthsWithFeedback).toBe(1)
    expect(body.categoryBreakdown[0]).toEqual({ categorySlug: 'colaboracao', categoryName: 'Colaboração', count: 1 })
    expect(body.months).toEqual(['2026-06'])
    // Progressão do DONO do perfil. Sem lançamento nenhum, zero e Bronze — quem
    // decide não afirmar nível é a tela.
    expect(body.xp).toMatchObject({ points: 0, level: { name: 'Bronze' } })
    expect(Array.isArray(body.badges)).toBe(true)
    await app.close()
  })

  it('votingEnabled reflete a feature "votar" do SETOR do dono do perfil (não do viewer)', async () => {
    const { app, token, target } = await setup()
    const before = await app.inject({ method: 'GET', url: `/users/${target.id}/profile`, headers: { authorization: `Bearer ${token}` } })
    expect(before.json().votingEnabled).toBe(true) // setor default tem "votar" habilitada

    const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin-profile-voting@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorSemVotar = await createSector({ name: 'Setor Sem Votar', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
    await prisma.user.update({ where: { id: target.id }, data: { sectorId: sectorSemVotar.id } })

    const after = await app.inject({ method: 'GET', url: `/users/${target.id}/profile`, headers: { authorization: `Bearer ${token}` } })
    expect(after.json().votingEnabled).toBe(false)
    await app.close()
  })

  it('inclui o nome do setor do dono do perfil (user.sectorName)', async () => {
    const { app, token, target } = await setup()
    const res = await app.inject({ method: 'GET', url: `/users/${target.id}/profile`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.sectorName).toBe('Desenvolvimento de Produto')
    await app.close()
  })

  it('o texto do voto chega na lista de feedbacks do perfil', async () => {
    // A rota /users/:id/votes não existe mais: o histórico de reconhecimento
    // virou feedback na publicação do destaque.
    const { app, token, target } = await setup()
    const res = await app.inject({ method: 'GET', url: `/users/${target.id}/feedbacks`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().feedbacks).toHaveLength(1)
    expect(res.json().feedbacks[0].message).toBe('Trabalho excelente em equipe.')
    expect(res.json().feedbacks[0].categories.map((c: { name: string }) => c.name)).toEqual(['Colaboração'])
    await app.close()
  })

  it('requires authentication (401)', async () => {
    const { app, target } = await setup()
    const res = await app.inject({ method: 'GET', url: `/users/${target.id}/profile` })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('concede selo de tempo de casa ao abrir o perfil', async () => {
    const { app, token } = await setup()
    const veterano = await prisma.user.create({
      data: { name: 'Veterano', email: 'veterano@empresa.com', passwordHash: 'x', joinedAt: new Date('2023-01-01') },
    })
    await prisma.badge.create({
      data: { slug: 'tempo-de-casa-1-ano', name: '1 ano de casa', description: '1 ano', kind: 'TENURE', iconKey: 'fe-medal-bronze', threshold: 1 },
    })

    const res = await app.inject({ method: 'GET', url: `/users/${veterano.id}/profile`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const slugs = res.json().badges.map((b: { badge: { slug: string } }) => b.badge.slug)
    expect(slugs).toContain('tempo-de-casa-1-ano')
    await app.close()
  })

  it('retorna 200 mesmo que a avaliação de selos de tempo de casa lance erro', async () => {
    const { app, token, target } = await setup()
    const spy = vi.spyOn(badgeService, 'evaluateTenureBadgesForUser').mockRejectedValueOnce(new Error('boom'))

    const res = await app.inject({ method: 'GET', url: `/users/${target.id}/profile`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    // garante que o caminho de erro foi exercitado (spy interceptou a chamada real)
    expect(spy).toHaveBeenCalledOnce()
    await app.close()
  })

  it('retorna 404 quando o :id pertence a outra empresa (GET /users/:id)', async () => {
    const { app, token } = await setup()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Perfil', slug: 'outra-empresa-perfil-test' } })
    const outsider = await prisma.user.create({ data: { name: 'Fora', email: 'fora-perfil@x.com', passwordHash: 'x', companyId: otherCompany.id } })
    const res = await app.inject({ method: 'GET', url: `/users/${outsider.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('retorna 404 quando o :id pertence a outra empresa (GET /users/:id/profile)', async () => {
    const { app, token } = await setup()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Perfil2', slug: 'outra-empresa-perfil2-test' } })
    const outsider = await prisma.user.create({ data: { name: 'Fora2', email: 'fora-perfil2@x.com', passwordHash: 'x', companyId: otherCompany.id } })
    const res = await app.inject({ method: 'GET', url: `/users/${outsider.id}/profile`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('retorna 404 quando o :id pertence a outra empresa (GET /users/:id/votes)', async () => {
    const { app, token } = await setup()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Perfil3', slug: 'outra-empresa-perfil3-test' } })
    const outsider = await prisma.user.create({ data: { name: 'Fora3', email: 'fora-perfil3@x.com', passwordHash: 'x', companyId: otherCompany.id } })
    const res = await app.inject({ method: 'GET', url: `/users/${outsider.id}/votes`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('PUT /me/featured-badges', () => {
  async function makeOwnedBadge(meId: string, slug: string) {
    const badge = await prisma.badge.create({
      data: { slug, name: slug, description: 'd', kind: 'IMPACT', iconKey: 'fire', threshold: 0 },
    })
    return prisma.userBadge.create({ data: { userId: meId, badgeId: badge.id } })
  }

  it('destaca os selos escolhidos e retorna a lista com featured', async () => {
    const { app, token, meId } = await setup()
    const ub = await makeOwnedBadge(meId, 'meu-selo')

    const res = await app.inject({
      method: 'PUT',
      url: '/me/featured-badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeIds: [ub.id] },
    })

    expect(res.statusCode).toBe(200)
    const featured = res.json().badges.find((b: { id: string; featured: boolean }) => b.id === ub.id)
    expect(featured.featured).toBe(true)
    await app.close()
  })

  it('aceita lista vazia (limpa os destaques)', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'PUT',
      url: '/me/featured-badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeIds: [] },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('rejeita acima do limite (400)', async () => {
    const { app, token, meId } = await setup()
    const ids: string[] = []
    for (let i = 0; i < MAX_FEATURED_BADGES + 1; i += 1) {
      const ub = await makeOwnedBadge(meId, `extra-${i}`)
      ids.push(ub.id)
    }
    const res = await app.inject({
      method: 'PUT',
      url: '/me/featured-badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeIds: ids },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejeita selo de outro usuário (400)', async () => {
    const { app, token, target } = await setup()
    const badge = await prisma.badge.create({
      data: { slug: 'alheio', name: 'alheio', description: 'd', kind: 'IMPACT', iconKey: 'fire', threshold: 0 },
    })
    const ub = await prisma.userBadge.create({ data: { userId: target.id, badgeId: badge.id } })
    const res = await app.inject({
      method: 'PUT',
      url: '/me/featured-badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeIds: [ub.id] },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('exige autenticação (401)', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'PUT', url: '/me/featured-badges', payload: { badgeIds: [] } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
