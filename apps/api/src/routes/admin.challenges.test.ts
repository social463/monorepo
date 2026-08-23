import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

type App = ReturnType<typeof buildApp>

async function tokenFor(app: App, role: 'ADMIN' | 'SUBADMIN' | 'LEGEND', sectorId = DEFAULT_SECTOR_ID) {
  const user = await prisma.user.create({
    data: { name: role, email: `${role}-${Math.random()}@x.com`, passwordHash: 'x', role, sectorId },
  })
  const token = app.jwt.sign({ sub: user.id, role, sectorId, companyId: DEFAULT_COMPANY_ID, features: ['desafios'] })
  return { user, token, headers: { authorization: `Bearer ${token}` } }
}

async function seedPendingSubmission(app: App, rewardCoins = 150) {
  const admin = await tokenFor(app, 'ADMIN')
  const created = await app.inject({
    method: 'POST',
    url: '/admin/challenges',
    headers: admin.headers,
    payload: {
      title: 'Ler um livro',
      description: 'Conte o que aprendeu.',
      category: 'Conhecimento',
      rewardCoins,
      sectorId: null,
    },
  })
  // A rota de admin devolve o DTO envelopado (`{ challenge }`), igual ao resto da casa.
  const challenge = created.json().challenge

  const legend = await tokenFor(app, 'LEGEND')
  const submitted = await app.inject({
    method: 'POST',
    url: `/challenges/${challenge.id}/submissions`,
    headers: legend.headers,
    payload: { note: 'Pronto.' },
  })
  return { admin, legend, challenge, submission: submitted.json() }
}

describe('rotas de admin de desafios', () => {
  it('nega acesso a quem não é admin', async () => {
    const app = buildApp()
    await app.ready()
    const legend = await tokenFor(app, 'LEGEND')

    const list = await app.inject({ method: 'GET', url: '/admin/challenge-submissions', headers: legend.headers })
    expect(list.statusCode).toBe(403)

    const create = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: legend.headers,
      payload: { title: 'X', description: 'D', rewardCoins: 10, sectorId: null },
    })
    expect(create.statusCode).toBe(403)
  })

  it('aprova creditando a recompensa e recusa a segunda aprovação com 409', async () => {
    const app = buildApp()
    await app.ready()
    const { admin, legend, submission } = await seedPendingSubmission(app, 150)

    const first = await app.inject({
      method: 'POST',
      url: `/admin/challenge-submissions/${submission.id}/approve`,
      headers: admin.headers,
    })
    expect(first.statusCode).toBe(200)
    expect(first.json().status).toBe('APPROVED')

    const second = await app.inject({
      method: 'POST',
      url: `/admin/challenge-submissions/${submission.id}/approve`,
      headers: admin.headers,
    })
    expect(second.statusCode).toBe(409)

    const balance = await prisma.coinTransaction.aggregate({
      where: { userId: legend.user.id },
      _sum: { amount: true },
    })
    expect(balance._sum.amount).toBe(150)
  })

  it('exige motivo com tamanho mínimo na rejeição', async () => {
    const app = buildApp()
    await app.ready()
    const { admin, submission } = await seedPendingSubmission(app)

    const short = await app.inject({
      method: 'POST',
      url: `/admin/challenge-submissions/${submission.id}/reject`,
      headers: admin.headers,
      payload: { rejectionReason: 'não' },
    })
    expect(short.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'POST',
      url: `/admin/challenge-submissions/${submission.id}/reject`,
      headers: admin.headers,
      payload: { rejectionReason: 'A evidência enviada não confere.' },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().rejectionReason).toBe('A evidência enviada não confere.')
  })

  it('lista a fila paginada e filtrada', async () => {
    const app = buildApp()
    await app.ready()
    const { admin, legend, challenge } = await seedPendingSubmission(app)

    const page = await app.inject({
      method: 'GET',
      url: `/admin/challenge-submissions?status=PENDING&userId=${legend.user.id}&challengeId=${challenge.id}&limit=10`,
      headers: admin.headers,
    })

    expect(page.statusCode).toBe(200)
    const body = page.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].user.id).toBe(legend.user.id)
    expect(body).toHaveProperty('nextCursor')
  })

  it('processa lote reportando sucessos e falhas', async () => {
    const app = buildApp()
    await app.ready()
    const { admin, submission } = await seedPendingSubmission(app)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenge-submissions/batch',
      headers: admin.headers,
      payload: { ids: [submission.id, 'id-que-nao-existe'], decision: 'APPROVE' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.succeeded).toEqual([submission.id])
    expect(body.failed).toHaveLength(1)
    expect(body.failed[0].id).toBe('id-que-nao-existe')
  })

  it('exige motivo quando o lote é de rejeição', async () => {
    const app = buildApp()
    await app.ready()
    const { admin, submission } = await seedPendingSubmission(app)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenge-submissions/batch',
      headers: admin.headers,
      payload: { ids: [submission.id], decision: 'REJECT' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('exporta CSV com o content-type certo', async () => {
    const app = buildApp()
    await app.ready()
    const { admin } = await seedPendingSubmission(app)

    const res = await app.inject({
      method: 'GET',
      url: '/admin/challenge-submissions/export.csv',
      headers: admin.headers,
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.body).toContain('Pessoa;E-mail;Desafio')
  })
})
