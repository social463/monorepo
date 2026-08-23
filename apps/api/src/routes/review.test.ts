import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { reviewHub } from '../lib/review-hub'

// Forçado (não `??`) para o teste ser hermético mesmo quando o .env local tem S3 real:
// o payload de imagem usa cdn.exemplo.com e precisa casar com assertImageHost.
process.env.S3_BUCKET = 'bucket-teste'
process.env.S3_REGION = 'us-east-1'
process.env.S3_PUBLIC_BASE_URL = 'https://cdn.exemplo.com'

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  const userId = reg.json().user.id as string
  return { app, token, userId }
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('review routes', () => {
  it('cria resenha (201) e rejeita > 280 (400)', async () => {
    const { app, token } = await setup()
    const ok = await app.inject({ method: 'POST', url: '/reviews', headers: auth(token), payload: { content: 'olá' } })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().review.content).toBe('olá')

    const tooLong = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: { content: 'x'.repeat(281) },
    })
    expect(tooLong.statusCode).toBe(400)
    await app.close()
  })

  it('lista o feed por cursor', async () => {
    const { app, token } = await setup()
    for (let i = 0; i < 3; i++)
      await app.inject({ method: 'POST', url: '/reviews', headers: auth(token), payload: { content: `r${i}` } })
    const res = await app.inject({ method: 'GET', url: '/reviews?limit=2', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    expect(res.json().items).toHaveLength(2)
    expect(res.json().nextCursor).toBeTruthy()
    await app.close()
  })

  it('comenta e notifica o autor da resenha', async () => {
    const { app, token, userId } = await setup()
    const author = await prisma.user.create({
      data: { name: 'Bea', email: 'bea@empresa.com', passwordHash: 'x' },
    })
    const review = await prisma.review.create({ data: { authorId: author.id, content: 'da Bea' } })
    const res = await app.inject({
      method: 'POST',
      url: `/reviews/${review.id}/comments`,
      headers: auth(token),
      payload: { content: 'massa!' },
    })
    expect(res.statusCode).toBe(201)
    const notif = await prisma.notification.findFirst({ where: { userId: author.id, type: 'REVIEW_COMMENT' } })
    expect(notif?.actorId).toBe(userId)
    await app.close()
  })

  it('reage à resenha e remove a reação (toggle)', async () => {
    const { app, token } = await setup()
    const r = await app.inject({ method: 'POST', url: '/reviews', headers: auth(token), payload: { content: 'r' } })
    const id = r.json().review.id
    const add = await app.inject({
      method: 'POST',
      url: `/reviews/${id}/reactions/toggle`,
      headers: auth(token),
      payload: { emoji: '😂' },
    })
    expect(add.json().review.reactions).toHaveLength(1)
    expect(add.json().review.reactorCount).toBe(1)
    const rm = await app.inject({
      method: 'POST',
      url: `/reviews/${id}/reactions/toggle`,
      headers: auth(token),
      payload: { emoji: '😂' },
    })
    expect(rm.json().review.reactions).toHaveLength(0)
    await app.close()
  })

  it('compartilha e a resenha aparece no mural; terceiro não exclui (403)', async () => {
    const { app, token } = await setup()
    const author = await prisma.user.create({
      data: { name: 'Cid', email: 'cid@empresa.com', passwordHash: 'x' },
    })
    const review = await prisma.review.create({ data: { authorId: author.id, content: 'pro mural' } })

    const share = await app.inject({ method: 'POST', url: `/reviews/${review.id}/share`, headers: auth(token) })
    expect(share.statusCode).toBe(200)
    expect(share.json().review.shareCount).toBe(1)
    expect(share.json().review.sharedByMe).toBe(true)

    const mural = await app.inject({ method: 'GET', url: '/mural', headers: auth(token) })
    const reviewItems = mural.json().items.filter((i: { type: string }) => i.type === 'review')
    expect(reviewItems).toHaveLength(1)
    expect(reviewItems[0].content).toBe('pro mural')

    const del = await app.inject({ method: 'DELETE', url: `/reviews/${review.id}`, headers: auth(token) })
    expect(del.statusCode).toBe(403)
    await app.close()
  })

  it('cria resenha só com imagem (201) e a devolve no DTO', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: { content: '', image: { url: 'https://cdn.exemplo.com/reviews/u/x.png', width: 100, height: 80 } },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().review.image).toEqual({ url: 'https://cdn.exemplo.com/reviews/u/x.png', width: 100, height: 80 })
    await app.close()
  })

  it('rejeita imagem + gif juntos (400)', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: {
        content: 'oi',
        gif: { url: 'https://media.giphy.com/a.gif', width: 10, height: 10 },
        image: { url: 'https://cdn.exemplo.com/reviews/u/x.png', width: 10, height: 10 },
      },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('GET /reviews não mostra resenha de outra empresa', async () => {
    const { app, token } = await setup()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Review Rota', slug: 'outra-empresa-review-rota-test' } })
    const outsider = await prisma.user.create({
      data: { name: 'ForaReviewRota', email: 'fora-review-rota@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    await prisma.review.create({ data: { authorId: outsider.id, content: 'de outra empresa', companyId: otherCompany.id } })

    const res = await app.inject({ method: 'GET', url: '/reviews', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    expect(res.json().items).toHaveLength(0)
    await app.close()
  })

  it('DELETE /reviews/:id/share pra resenha de outra empresa devolve 404 (não 500)', async () => {
    const { app, token } = await setup()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Unshare Rota', slug: 'outra-empresa-unshare-rota-test' } })
    const outsider = await prisma.user.create({
      data: { name: 'ForaUnshareRota', email: 'fora-unshare-rota@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await prisma.review.create({ data: { authorId: outsider.id, content: 'de outra empresa', companyId: otherCompany.id } })

    const res = await app.inject({ method: 'DELETE', url: `/reviews/${review.id}/share`, headers: auth(token) })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('review broadcasts', () => {
  it('emite broadcast feed:changed ao criar resenha', async () => {
    const { app, token } = await setup()
    const sent: string[] = []
    const conn = { socket: { send: (d: string) => sent.push(d) } }
    reviewHub.subscribe(conn)
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/reviews',
        headers: auth(token),
        payload: { content: 'tempo real' },
      })
      expect(res.statusCode).toBe(201)
      expect(sent).toContain(JSON.stringify({ type: 'feed:changed' }))
    } finally {
      reviewHub.unsubscribe(conn)
      await app.close()
    }
  })

  it('emite comments:changed (com reviewId) ao comentar', async () => {
    const { app, token } = await setup()
    const created = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: { content: 'base' },
    })
    const reviewId = created.json().review.id as string

    const sent: string[] = []
    const conn = { socket: { send: (d: string) => sent.push(d) } }
    reviewHub.subscribe(conn)
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/reviews/${reviewId}/comments`,
        headers: auth(token),
        payload: { content: 'comentário' },
      })
      expect(res.statusCode).toBe(201)
      expect(sent).toContain(JSON.stringify({ type: 'comments:changed', reviewId }))
    } finally {
      reviewHub.unsubscribe(conn)
      await app.close()
    }
  })
})

describe('review gif', () => {
  it('cria resenha só com gif (sem texto) e serializa o gif', async () => {
    const { app, token } = await setup()
    const r = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: { content: '', gif: { url: 'https://media.giphy.com/g.gif', width: 200, height: 150 } },
    })
    expect(r.statusCode).toBe(201)
    expect(r.json().review.gif).toEqual({ url: 'https://media.giphy.com/g.gif', width: 200, height: 150 })
    await app.close()
  })
})

describe('review mentions via rota', () => {
  it('cria resenha com menção, persiste e notifica o marcado', async () => {
    const { app, token, userId } = await setup()
    const alvo = await prisma.user.create({
      data: { name: 'Karina', email: 'karina@empresa.com', passwordHash: 'x' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: { content: 'boa @Karina', mentionedUserIds: [alvo.id] },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().review.mentions).toEqual([{ userId: alvo.id, name: 'Karina' }])
    const notif = await prisma.notification.findFirst({
      where: { userId: alvo.id, type: 'REVIEW_MENTION' },
    })
    expect(notif?.actorId).toBe(userId)
    await app.close()
  })
})

describe('notificação de enquete publicada', () => {
  it('avisa o setor, pula o autor e não vaza para outro setor nem para inativo', async () => {
    const { app, token, userId } = await setup()
    const colega = await prisma.user.create({
      data: { name: 'Bruno', email: 'bruno@empresa.com', passwordHash: 'x' },
    })
    const inativo = await prisma.user.create({
      data: { name: 'Carla', email: 'carla@empresa.com', passwordHash: 'x', active: false },
    })
    const outroSetor = await prisma.sector.create({ data: { name: 'Marketing', slug: 'marketing' } })
    const deOutroSetor = await prisma.user.create({
      data: { name: 'Dani', email: 'dani@empresa.com', passwordHash: 'x', sectorId: outroSetor.id },
    })

    const created = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: { content: '', poll: { question: 'Sushi ou pizza?', options: ['Sushi', 'Pizza'] } },
    })
    expect(created.statusCode).toBe(201)
    const reviewId = created.json().review.id as string

    const doColega = await prisma.notification.findFirst({
      where: { userId: colega.id, type: 'REVIEW_POLL_PUBLISHED' },
    })
    expect(doColega).toMatchObject({
      title: 'Ana abriu uma enquete: Sushi ou pizza?',
      link: `/resenha#${reviewId}`,
      actorId: userId,
    })

    for (const id of [userId, inativo.id, deOutroSetor.id]) {
      expect(
        await prisma.notification.count({ where: { userId: id, type: 'REVIEW_POLL_PUBLISHED' } }),
      ).toBe(0)
    }
    await app.close()
  })

  it('publicação sem enquete não avisa ninguém', async () => {
    const { app, token } = await setup()
    await prisma.user.create({ data: { name: 'Bruno', email: 'bruno@empresa.com', passwordHash: 'x' } })

    await app.inject({ method: 'POST', url: '/reviews', headers: auth(token), payload: { content: 'só texto' } })

    expect(await prisma.notification.count({ where: { type: 'REVIEW_POLL_PUBLISHED' } })).toBe(0)
    await app.close()
  })

  it('pergunta longa é cortada no título', async () => {
    const { app, token } = await setup()
    const colega = await prisma.user.create({
      data: { name: 'Bruno', email: 'bruno@empresa.com', passwordHash: 'x' },
    })
    const question = 'Qual das opções abaixo você considera a melhor para o time neste trimestre?'

    await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: { content: '', poll: { question, options: ['A', 'B'] } },
    })

    const notif = await prisma.notification.findFirst({
      where: { userId: colega.id, type: 'REVIEW_POLL_PUBLISHED' },
    })
    expect(notif?.title).toBe(
      'Ana abriu uma enquete: Qual das opções abaixo você considera a melhor para o time n…',
    )
    await app.close()
  })
})

describe('review poll via rota', () => {
  it('cria enquete, oculta resultado até votar e rejeita segundo voto', async () => {
    const { app, token } = await setup()
    const created = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: { content: '', poll: { question: 'Qual caminho?', options: ['A', 'B'] } },
    })
    expect(created.statusCode).toBe(201)
    const review = created.json().review
    expect(review.poll.totalVotes).toBeNull()
    expect(review.poll.options[0].voteCount).toBeNull()

    const hiddenVoters = await app.inject({
      method: 'GET',
      url: `/reviews/${review.id}/poll/votes`,
      headers: auth(token),
    })
    expect(hiddenVoters.statusCode).toBe(403)

    const voted = await app.inject({
      method: 'POST',
      url: `/reviews/${review.id}/poll/vote`,
      headers: auth(token),
      payload: { optionId: review.poll.options[0].id },
    })
    expect(voted.statusCode).toBe(200)
    expect(voted.json().review.poll).toMatchObject({ hasVoted: true, totalVotes: 1 })
    expect(voted.json().review.poll.options[0]).toMatchObject({ voteCount: 1, percentage: 100 })

    const voters = await app.inject({
      method: 'GET',
      url: `/reviews/${review.id}/poll/votes`,
      headers: auth(token),
    })
    expect(voters.statusCode).toBe(200)
    expect(voters.json()).toMatchObject({
      totalVotes: 1,
      options: [
        { optionId: review.poll.options[0].id, voters: [{ name: 'Ana' }] },
        { optionId: review.poll.options[1].id, voters: [] },
      ],
    })

    const duplicate = await app.inject({
      method: 'POST',
      url: `/reviews/${review.id}/poll/vote`,
      headers: auth(token),
      payload: { optionId: review.poll.options[1].id },
    })
    expect(duplicate.statusCode).toBe(409)
    await app.close()
  })

  it('rejeita enquete com opções repetidas e enquete junto de imagem', async () => {
    const { app, token } = await setup()
    const repeated = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: { content: '', poll: { question: 'Escolha', options: ['A', ' a '] } },
    })
    expect(repeated.statusCode).toBe(400)

    const mixed = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: {
        content: '',
        poll: { question: 'Escolha', options: ['A', 'B'] },
        image: { url: 'https://cdn.exemplo.com/reviews/u/x.png', width: 10, height: 10 },
      },
    })
    expect(mixed.statusCode).toBe(400)
    await app.close()
  })
})
