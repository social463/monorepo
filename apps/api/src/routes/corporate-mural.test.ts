import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

const FEATURES = ['mural-corporativo']

/** Cria um usuário com o papel pedido e devolve app + token já com a feature liberada. */
async function makeUser(app: ReturnType<typeof buildApp>, role: string, sectorId = 'sector-dev-produto') {
  const user = await prisma.user.create({
    data: {
      name: role.toLowerCase(),
      email: `${role.toLowerCase()}-${Math.random()}@empresa.com`,
      passwordHash: 'x',
      role: role as never,
      sectorId,
    },
  })
  const token = app.jwt.sign({
    sub: user.id,
    role,
    sectorId,
    companyId: 'company-emr',
    features: FEATURES,
  })
  return { user, token }
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('rotas do mural corporativo', () => {
  it('admin publica direto; liderança e lenda caem na fila (201 em todos)', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const lider = await makeUser(app, 'LEAD')
    const lenda = await makeUser(app, 'LEGEND')

    const direto = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { content: 'comunicado da G&G' },
    })
    expect(direto.statusCode).toBe(201)
    expect(direto.json().post.status).toBe('PUBLISHED')

    for (const quem of [lider, lenda]) {
      const res = await app.inject({
        method: 'POST',
        url: '/corporate-posts',
        headers: auth(quem.token),
        payload: { content: 'posso postar?' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().post.status).toBe('PENDING')
    }

    const tooLong = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { content: 'x'.repeat(5_001) },
    })
    expect(tooLong.statusCode).toBe(400)
    await app.close()
  })

  it('documento rico com cor ou link fora da lista é 400', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const corInvalida = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { body: { blocks: [{ type: 'paragraph', spans: [{ text: 'oi', color: 'roxo' }] }] } },
    })
    expect(corInvalida.statusCode).toBe(400)

    const linkInseguro = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      // `javascript:` é exatamente o que o documento fechado existe para barrar.
      payload: {
        body: { blocks: [{ type: 'paragraph', spans: [{ text: 'clique', href: 'javascript:alert(1)' }] }] },
      },
    })
    expect(linkInseguro.statusCode).toBe(400)

    const valido = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: {
        title: 'Aviso',
        body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Olá, ', bold: true }, { text: 'time' }] }] },
      },
    })
    expect(valido.statusCode).toBe(201)
    expect(valido.json().post.content).toBe('Olá, time')
    expect(valido.json().post.title).toBe('Aviso')
    await app.close()
  })

  it('o feed é o mesmo para setores diferentes e informa quem publica direto', async () => {
    const app = buildApp()
    await app.ready()
    const outroSetor = await prisma.sector.create({
      data: { name: 'Setor Mural Rotas', slug: `setor-mural-rotas-${Math.random()}`, enabledFeatures: [] },
    })
    const admin = await makeUser(app, 'ADMIN')
    const lenda = await makeUser(app, 'LEGEND', outroSetor.id)

    await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { content: 'vale pra empresa toda' },
    })

    const asLenda = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(lenda.token) })
    expect(asLenda.statusCode).toBe(200)
    expect(asLenda.json().items.map((p: { content: string }) => p.content)).toContain('vale pra empresa toda')
    expect(asLenda.json().canPublish).toBe(true)
    expect(asLenda.json().canPublishDirectly).toBe(false)

    const asAdmin = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(admin.token) })
    expect(asAdmin.json().canPublishDirectly).toBe(true)
    await app.close()
  })

  it('lenda comenta e reage; autor recebe notificação', async () => {
    const app = buildApp()
    await app.ready()
    const head = await makeUser(app, 'ADMIN')
    const lenda = await makeUser(app, 'LEGEND')
    const created = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(head.token),
      payload: { content: 'reunião geral' },
    })
    const postId = created.json().post.id as string

    const comment = await app.inject({
      method: 'POST',
      url: `/corporate-posts/${postId}/comments`,
      headers: auth(lenda.token),
      payload: { content: 'estarei lá' },
    })
    expect(comment.statusCode).toBe(201)

    const reaction = await app.inject({
      method: 'POST',
      url: `/corporate-posts/${postId}/reactions/toggle`,
      headers: auth(lenda.token),
      payload: { emoji: '🎉' },
    })
    expect(reaction.statusCode).toBe(200)
    expect(reaction.json().post.reactions[0]).toMatchObject({ emoji: '🎉', count: 1 })

    const comentario = await prisma.notification.findFirst({
      where: { userId: head.user.id, type: 'CORPORATE_POST_COMMENT' },
    })
    expect(comentario?.link).toBe(`/mural-corporativo#${postId}`)
    const reagiu = await prisma.notification.findFirst({
      where: { userId: head.user.id, type: 'CORPORATE_POST_REACTION' },
    })
    expect(reagiu).not.toBeNull()

    const list = await app.inject({
      method: 'GET',
      url: `/corporate-posts/${postId}/comments`,
      headers: auth(lenda.token),
    })
    expect(list.json().items).toHaveLength(1)
    expect(list.json().hasMore).toBe(false)
    await app.close()
  })

  it('exclui a própria publicação (204) e bloqueia a de outro (403)', async () => {
    const app = buildApp()
    await app.ready()
    const head = await makeUser(app, 'ADMIN')
    const lider = await makeUser(app, 'LEAD')
    const created = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(head.token),
      payload: { content: 'apagável' },
    })
    const postId = created.json().post.id as string

    const alheio = await app.inject({
      method: 'DELETE',
      url: `/corporate-posts/${postId}`,
      headers: auth(lider.token),
    })
    expect(alheio.statusCode).toBe(403)

    const proprio = await app.inject({
      method: 'DELETE',
      url: `/corporate-posts/${postId}`,
      headers: auth(head.token),
    })
    expect(proprio.statusCode).toBe(204)
    await app.close()
  })

  // O mural é da empresa toda: quem é do time lê mesmo sem a feature no setor
  // (a Home reserva a coluna principal para ele). Só o terceirizado depende da
  // allowlist individual.
  it('libera lenda sem a feature no setor (200)', async () => {
    const app = buildApp()
    await app.ready()
    const user = await prisma.user.create({
      data: { name: 'sem-feature', email: `sem-feature-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({
      sub: user.id,
      role: 'LEGEND',
      sectorId: 'sector-dev-produto',
      companyId: 'company-emr',
      features: [],
    })
    const res = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('bloqueia terceirizado sem a feature na allowlist (403)', async () => {
    const app = buildApp()
    await app.ready()
    const user = await prisma.user.create({
      data: {
        name: 'terceirizado',
        email: `terceirizado-${Math.random()}@x.com`,
        passwordHash: 'x',
        role: 'THIRD_PARTY',
      },
    })
    const token = app.jwt.sign({
      sub: user.id,
      role: 'THIRD_PARTY',
      sectorId: 'sector-dev-produto',
      companyId: 'company-emr',
      features: [],
    })
    const res = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(token) })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('rotas de fixar, ler e alcance', () => {
  it('admin fixa e desfixa; o post fixado vem primeiro no feed', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const antigo = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload: { content: 'antigo' },
    })
    await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload: { content: 'novo' },
    })
    const antigoId = antigo.json().post.id

    const pinned = await app.inject({
      method: 'POST', url: `/corporate-posts/${antigoId}/pin`, headers: auth(admin.token),
    })
    expect(pinned.statusCode).toBe(200)
    expect(pinned.json().post.pinnedAt).toEqual(expect.any(String))

    const feed = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(admin.token) })
    expect(feed.json().items[0].id).toBe(antigoId)

    const unpinned = await app.inject({
      method: 'DELETE', url: `/corporate-posts/${antigoId}/pin`, headers: auth(admin.token),
    })
    expect(unpinned.statusCode).toBe(200)
    expect(unpinned.json().post.pinnedAt).toBeNull()
    await app.close()
  })

  it('subadmin fixa; lenda e liderança recebem 403', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const sub = await makeUser(app, 'SUBADMIN')
    const head = await makeUser(app, 'HEAD')
    const lenda = await makeUser(app, 'LEGEND')
    const post = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload: { content: 'aviso' },
    })
    const id = post.json().post.id

    expect((await app.inject({ method: 'POST', url: `/corporate-posts/${id}/pin`, headers: auth(sub.token) })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `/corporate-posts/${id}/pin`, headers: auth(head.token) })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: `/corporate-posts/${id}/pin`, headers: auth(lenda.token) })).statusCode).toBe(403)
    await app.close()
  })

  it('marcar leitura responde 204 e é idempotente', async () => {
    const app = buildApp()
    await app.ready()
    const head = await makeUser(app, 'ADMIN')
    const lenda = await makeUser(app, 'LEGEND')
    const post = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(head.token), payload: { content: 'aviso' },
    })
    const id = post.json().post.id

    const first = await app.inject({ method: 'POST', url: `/corporate-posts/${id}/read`, headers: auth(lenda.token) })
    const second = await app.inject({ method: 'POST', url: `/corporate-posts/${id}/read`, headers: auth(lenda.token) })
    expect(first.statusCode).toBe(204)
    expect(second.statusCode).toBe(204)
    expect(await prisma.corporatePostRead.count({ where: { postId: id } })).toBe(1)

    const missing = await app.inject({
      method: 'POST', url: '/corporate-posts/nao-existe/read', headers: auth(lenda.token),
    })
    expect(missing.statusCode).toBe(404)
    await app.close()
  })

  it('o painel de alcance é 200 para admin e 403 para lenda', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const lenda = await makeUser(app, 'LEGEND')
    await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload: { content: 'aviso medido' },
    })

    const ok = await app.inject({ method: 'GET', url: '/admin/corporate-posts/reach', headers: auth(admin.token) })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().items[0]).toMatchObject({ excerpt: 'aviso medido', readers: 0 })
    expect(ok.json().audience).toBeGreaterThan(0)

    const blocked = await app.inject({ method: 'GET', url: '/admin/corporate-posts/reach', headers: auth(lenda.token) })
    expect(blocked.statusCode).toBe(403)
    await app.close()
  })

  it('a lista de quem reagiu é aberta a quem enxerga o comunicado', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const lenda = await makeUser(app, 'LEGEND')
    const created = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload: { content: 'aviso com reação' },
    })
    const postId = created.json().post.id as string
    await app.inject({
      method: 'POST',
      url: `/corporate-posts/${postId}/reactions/toggle`,
      headers: auth(lenda.token),
      payload: { emoji: '💚' },
    })

    const ok = await app.inject({
      method: 'GET', url: `/corporate-posts/${postId}/reactions`, headers: auth(admin.token),
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().total).toBe(1)
    expect(ok.json().items[0]).toMatchObject({ emoji: '💚', user: { id: lenda.user.id } })

    // Colega comum vê a mesma lista: reagir é público para o público-alvo do
    // comunicado. Só a lista de quem LEU continua fora do contrato.
    const comum = await app.inject({
      method: 'GET', url: `/corporate-posts/${postId}/reactions`, headers: auth(lenda.token),
    })
    expect(comum.statusCode).toBe(200)
    expect(comum.json().items[0]).toMatchObject({ user: { id: lenda.user.id } })

    const missing = await app.inject({
      method: 'GET', url: '/corporate-posts/nao-existe/reactions', headers: auth(admin.token),
    })
    expect(missing.statusCode).toBe(404)
    await app.close()
  })
})

describe('rotas de aprovação, público-alvo e XP', () => {
  /** Regra de XP ativa da empresa — sem ela, `awardXp` devolve NO_RULE. */
  async function makeXpRule(event: 'CORPORATE_POST_REACTION' | 'CORPORATE_POST_COMMENT' | 'CORPORATE_POST_READ_FULL', amount: number) {
    return prisma.xpRule.create({
      data: { event, amount, active: true, companyId: 'company-emr' },
    })
  }

  it('admin aprova o comunicado da lenda; lenda não aprova (403)', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const lenda = await makeUser(app, 'LEGEND')
    const criado = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(lenda.token), payload: { content: 'da lenda' },
    })
    const id = criado.json().post.id

    // Antes de aprovar: fora do feed, dentro da fila.
    const feedAntes = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(lenda.token) })
    expect(feedAntes.json().items).toHaveLength(0)
    const fila = await app.inject({ method: 'GET', url: '/corporate-posts/pending', headers: auth(admin.token) })
    expect(fila.json().items.map((p: { id: string }) => p.id)).toEqual([id])

    const semPermissao = await app.inject({
      method: 'POST', url: `/corporate-posts/${id}/approve`, headers: auth(lenda.token),
    })
    expect(semPermissao.statusCode).toBe(403)

    const aprovado = await app.inject({
      method: 'POST', url: `/corporate-posts/${id}/approve`, headers: auth(admin.token),
    })
    expect(aprovado.statusCode).toBe(200)
    expect(aprovado.json().post.status).toBe('PUBLISHED')

    const feedDepois = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(lenda.token) })
    expect(feedDepois.json().items.map((p: { id: string }) => p.id)).toEqual([id])

    // Autor avisado no sininho, e a empresa também.
    expect(
      await prisma.notification.count({ where: { userId: lenda.user.id, type: 'CORPORATE_POST_APPROVED' } }),
    ).toBe(1)
    await app.close()
  })

  it('recusar avisa o autor com o motivo e aprovar depois é 409', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const lenda = await makeUser(app, 'LEGEND')
    const criado = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(lenda.token), payload: { content: 'texto ruim' },
    })
    const id = criado.json().post.id

    const recusado = await app.inject({
      method: 'POST',
      url: `/corporate-posts/${id}/reject`,
      headers: auth(admin.token),
      payload: { reason: 'Fora do tom da casa' },
    })
    expect(recusado.statusCode).toBe(200)
    expect(recusado.json().post.rejectionReason).toBe('Fora do tom da casa')

    const aviso = await prisma.notification.findFirst({
      where: { userId: lenda.user.id, type: 'CORPORATE_POST_REJECTED' },
    })
    expect(aviso?.title).toContain('Fora do tom da casa')

    const tardio = await app.inject({
      method: 'POST', url: `/corporate-posts/${id}/approve`, headers: auth(admin.token),
    })
    expect(tardio.statusCode).toBe(409)
    await app.close()
  })

  it('quem está fora do público-alvo recebe 404 no deep-link e nos comentários', async () => {
    const app = buildApp()
    await app.ready()
    const outroSetor = await prisma.sector.create({
      data: { name: 'Setor Fora', slug: `setor-fora-${Math.random()}`, enabledFeatures: [] },
    })
    const admin = await makeUser(app, 'ADMIN')
    const deFora = await makeUser(app, 'LEGEND', outroSetor.id)

    const criado = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { content: 'só produto', audience: 'SECTORS', audienceSectorIds: ['sector-dev-produto'] },
    })
    const id = criado.json().post.id

    expect((await app.inject({ method: 'GET', url: `/corporate-posts/${id}`, headers: auth(deFora.token) })).statusCode).toBe(404)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/corporate-posts/${id}/comments`,
          headers: auth(deFora.token),
          payload: { content: 'oi' },
        })
      ).statusCode,
    ).toBe(404)
    // O admin, que segmentou, continua enxergando para poder moderar.
    expect((await app.inject({ method: 'GET', url: `/corporate-posts/${id}`, headers: auth(admin.token) })).statusCode).toBe(200)
    await app.close()
  })

  it('reagir credita XP uma vez e desfazer estorna', async () => {
    const app = buildApp()
    await app.ready()
    await makeXpRule('CORPORATE_POST_REACTION', 1)
    const admin = await makeUser(app, 'ADMIN')
    const lenda = await makeUser(app, 'LEGEND')
    const post = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload: { content: 'reaja' },
    })
    const id = post.json().post.id
    const toggle = (emoji: string) =>
      app.inject({
        method: 'POST',
        url: `/corporate-posts/${id}/reactions/toggle`,
        headers: auth(lenda.token),
        payload: { emoji },
      })

    await toggle('💚')
    await toggle('🎉')
    // Duas reações, um crédito só: a regra vale por publicação.
    expect(await prisma.xpTransaction.count({ where: { userId: lenda.user.id } })).toBe(1)

    await toggle('🎉')
    // Ainda resta o 💚, então o crédito continua de pé.
    expect(await prisma.xpTransaction.count({ where: { userId: lenda.user.id } })).toBe(1)

    await toggle('💚')
    // Caiu a última: o lançamento SAI do extrato (não vira valor negativo).
    expect(await prisma.xpTransaction.count({ where: { userId: lenda.user.id } })).toBe(0)

    // E reagir de novo volta a pagar — a unique deixa recreditar.
    await toggle('💚')
    expect(await prisma.xpTransaction.count({ where: { userId: lenda.user.id } })).toBe(1)
    await app.close()
  })

  it('`full: true` em post curto não credita; em post longo credita', async () => {
    const app = buildApp()
    await app.ready()
    await makeXpRule('CORPORATE_POST_READ_FULL', 3)
    const admin = await makeUser(app, 'ADMIN')
    const lenda = await makeUser(app, 'LEGEND')

    const curto = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload: { content: 'uma linha' },
    })
    const longo = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: {
        body: {
          blocks: ['l1', 'l2', 'l3', 'l4', 'l5'].map((text) => ({ type: 'paragraph', spans: [{ text }] })),
        },
      },
    })

    await app.inject({
      method: 'POST',
      url: `/corporate-posts/${curto.json().post.id}/read`,
      headers: auth(lenda.token),
      payload: { full: true },
    })
    expect(await prisma.xpTransaction.count({ where: { userId: lenda.user.id } })).toBe(0)

    await app.inject({
      method: 'POST',
      url: `/corporate-posts/${longo.json().post.id}/read`,
      headers: auth(lenda.token),
      payload: { full: true },
    })
    expect(await prisma.xpTransaction.count({ where: { userId: lenda.user.id } })).toBe(1)
    await app.close()
  })

  it('primeiro comentário paga XP; apagar o último estorna', async () => {
    const app = buildApp()
    await app.ready()
    await makeXpRule('CORPORATE_POST_COMMENT', 2)
    const admin = await makeUser(app, 'ADMIN')
    const lenda = await makeUser(app, 'LEGEND')
    const post = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload: { content: 'comente' },
    })
    const id = post.json().post.id

    const um = await app.inject({
      method: 'POST', url: `/corporate-posts/${id}/comments`, headers: auth(lenda.token), payload: { content: 'a' },
    })
    await app.inject({
      method: 'POST', url: `/corporate-posts/${id}/comments`, headers: auth(lenda.token), payload: { content: 'b' },
    })
    expect(await prisma.xpTransaction.count({ where: { userId: lenda.user.id } })).toBe(1)

    await app.inject({
      method: 'DELETE',
      url: `/corporate-posts/comments/${um.json().comment.id}`,
      headers: auth(lenda.token),
    })
    // Ainda tem o segundo comentário: nada muda.
    expect(await prisma.xpTransaction.count({ where: { userId: lenda.user.id } })).toBe(1)
    await app.close()
  })
})
