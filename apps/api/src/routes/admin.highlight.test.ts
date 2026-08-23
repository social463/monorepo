import { describe, it, expect, vi } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

vi.mock('../lib/gemini-client', () => ({
  buildCongratsText: vi.fn(async () => 'Parabéns pelo destaque!'),
}))
vi.mock('../lib/card-renderer', () => ({ renderCard: vi.fn(async () => Buffer.from('89504e470d0a1a0a', 'hex')) }))
vi.mock('../lib/highlight-storage', () => ({
  saveCardPng: vi.fn(async (companyId: string, m: string) => `https://cdn.test/highlights/${companyId}/${m}.png`),
  highlightStorageEnabled: () => true,
}))

async function adminToken(app: ReturnType<typeof buildApp>) {
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Admin', email: 'admin@empresa.com', password: 'changeme123' } })
  await prisma.user.update({ where: { email: 'admin@empresa.com' }, data: { role: 'ADMIN' } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@empresa.com', password: 'changeme123' } })
  return res.json().accessToken as string
}

async function seedClosedPeriodWithVotes() {
  const category = await prisma.recognitionCategory.create({ data: { name: 'Colab', slug: 'colab' } })
  const ana = await prisma.user.create({ data: { name: 'Ana', email: 'ana@empresa.com', passwordHash: 'x' } })
  const v1 = await prisma.user.create({ data: { name: 'V1', email: 'v1@empresa.com', passwordHash: 'x' } })
  const period = await prisma.votingPeriod.create({
    data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'), status: 'CLOSED' },
  })
  await prisma.vote.create({ data: { voterId: v1.id, votedId: ana.id, periodId: period.id, justification: 'ótimo', categories: { create: [{ categoryId: category.id }] } } })
  await prisma.badge.create({ data: { slug: 'destaque-do-mes', name: 'Destaque do Mês', description: 'x', kind: 'HIGHLIGHT', iconKey: 'trophy', threshold: 0 } })
  return { period, ana }
}

describe('GET /admin/periods/:id/highlight', () => {
  it('returns status NONE for a period with no highlight yet', async () => {
    const app = buildApp(); await app.ready()
    const token = await adminToken(app)
    const { period } = await seedClosedPeriodWithVotes()

    const res = await app.inject({
      method: 'GET',
      url: `/admin/periods/${period.id}/highlight`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().highlight.status).toBe('NONE')
    expect(res.json().highlight.winner).toBeNull()
    await app.close()
  })

  it('returns status DRAFT with winner name and non-null text after generating a draft', async () => {
    const app = buildApp(); await app.ready()
    const token = await adminToken(app)
    const { period } = await seedClosedPeriodWithVotes()

    await app.inject({ method: 'POST', url: `/admin/periods/${period.id}/highlight`, headers: { authorization: `Bearer ${token}` } })

    const res = await app.inject({
      method: 'GET',
      url: `/admin/periods/${period.id}/highlight`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().highlight.status).toBe('DRAFT')
    expect(res.json().highlight.winner.name).toBe('Ana')
    expect(res.json().highlight.text).not.toBeNull()
    expect(res.json().highlight.imageUrl).toBeNull()
    await app.close()
  })

  it('returns 404 for an unknown period id', async () => {
    const app = buildApp(); await app.ready()
    const token = await adminToken(app)

    const res = await app.inject({
      method: 'GET',
      url: '/admin/periods/unknown-id-that-does-not-exist/highlight',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('returns 401 without a token', async () => {
    const app = buildApp(); await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/admin/periods/whatever/highlight',
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})

describe('admin highlight routes', () => {
  it('generates a draft (201) and refuses a second generation (409)', async () => {
    const app = buildApp(); await app.ready()
    const token = await adminToken(app)
    const { period } = await seedClosedPeriodWithVotes()

    const first = await app.inject({ method: 'POST', url: `/admin/periods/${period.id}/highlight`, headers: { authorization: `Bearer ${token}` } })
    expect(first.statusCode).toBe(201)
    expect(first.json().highlight.status).toBe('DRAFT')
    expect(first.json().highlight.winner.name).toBe('Ana')

    const second = await app.inject({ method: 'POST', url: `/admin/periods/${period.id}/highlight`, headers: { authorization: `Bearer ${token}` } })
    expect(second.statusCode).toBe(409)
    await app.close()
  })

  it('returns 422 when there are no votes', async () => {
    const app = buildApp(); await app.ready()
    const token = await adminToken(app)
    const period = await prisma.votingPeriod.create({
      data: { monthRef: '2026-08', startsAt: new Date('2026-08-01'), endsAt: new Date('2026-08-31'), status: 'CLOSED' },
    })
    const res = await app.inject({ method: 'POST', url: `/admin/periods/${period.id}/highlight`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(422)
    await app.close()
  })

  it('edits the text, generates the image without publishing, then publishes awarding the badge', async () => {
    const app = buildApp(); await app.ready()
    const token = await adminToken(app)
    const { period, ana } = await seedClosedPeriodWithVotes()
    await app.inject({ method: 'POST', url: `/admin/periods/${period.id}/highlight`, headers: { authorization: `Bearer ${token}` } })

    const edit = await app.inject({
      method: 'PATCH', url: `/admin/periods/${period.id}/highlight`,
      headers: { authorization: `Bearer ${token}` }, payload: { text: 'Texto revisado' },
    })
    expect(edit.statusCode).toBe(200)
    expect(edit.json().highlight.text).toBe('Texto revisado')
    expect(edit.json().highlight.imageUrl).toBeNull()

    const image = await app.inject({ method: 'POST', url: `/admin/periods/${period.id}/highlight/image`, headers: { authorization: `Bearer ${token}` } })
    expect(image.statusCode).toBe(200)
    expect(image.json().highlight.status).toBe('DRAFT')
    expect(image.json().highlight.imageUrl).toBe('https://cdn.test/highlights/company-emr/2026-06.png')

    const pub = await app.inject({ method: 'POST', url: `/admin/periods/${period.id}/highlight/publish`, headers: { authorization: `Bearer ${token}` } })
    expect(pub.statusCode).toBe(200)
    expect(pub.json().highlight.status).toBe('PUBLISHED')

    const awarded = await prisma.userBadge.findFirst({ where: { userId: ana.id, periodId: period.id } })
    expect(awarded).not.toBeNull()
    await app.close()
  })

  it('does not publish or award the badge when only generating the image', async () => {
    const app = buildApp(); await app.ready()
    const token = await adminToken(app)
    const { period, ana } = await seedClosedPeriodWithVotes()
    await app.inject({ method: 'POST', url: `/admin/periods/${period.id}/highlight`, headers: { authorization: `Bearer ${token}` } })
    const image = await app.inject({ method: 'POST', url: `/admin/periods/${period.id}/highlight/image`, headers: { authorization: `Bearer ${token}` } })
    expect(image.statusCode).toBe(200)

    const fresh = await prisma.votingPeriod.findUniqueOrThrow({ where: { id: period.id } })
    expect(fresh.highlightStatus).toBe('DRAFT')
    expect(await prisma.userBadge.findFirst({ where: { userId: ana.id, periodId: period.id } })).toBeNull()
    await app.close()
  })

  it('allows editing the month the highlight refers to while it is a draft', async () => {
    const app = buildApp(); await app.ready()
    const token = await adminToken(app)
    const { period } = await seedClosedPeriodWithVotes()
    await app.inject({ method: 'POST', url: `/admin/periods/${period.id}/highlight`, headers: { authorization: `Bearer ${token}` } })

    const edit = await app.inject({
      method: 'PATCH', url: `/admin/periods/${period.id}/highlight`,
      headers: { authorization: `Bearer ${token}` }, payload: { text: 'Texto revisado', highlightMonthRef: '2026-05' },
    })
    expect(edit.statusCode).toBe(200)
    expect(edit.json().highlight.highlightMonthRef).toBe('2026-05')
    expect(edit.json().highlight.imageUrl).toBeNull()
    await app.close()
  })

  it('refuses to publish before generating the image', async () => {
    const app = buildApp(); await app.ready()
    const token = await adminToken(app)
    const { period } = await seedClosedPeriodWithVotes()
    await app.inject({ method: 'POST', url: `/admin/periods/${period.id}/highlight`, headers: { authorization: `Bearer ${token}` } })

    const pub = await app.inject({ method: 'POST', url: `/admin/periods/${period.id}/highlight/publish`, headers: { authorization: `Bearer ${token}` } })
    expect(pub.statusCode).toBe(409)
    await app.close()
  })

  it('forbids a non-admin (403)', async () => {
    const app = buildApp(); await app.ready()
    const res = await app.inject({ method: 'POST', url: `/admin/periods/whatever/highlight` })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
