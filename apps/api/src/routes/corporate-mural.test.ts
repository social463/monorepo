import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
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

  it('viewerRead é de QUEM PEDE: o mesmo post é lido para um e não lido para outro', async () => {
    const app = buildApp()
    await app.ready()
    const head = await makeUser(app, 'ADMIN')
    const leu = await makeUser(app, 'LEGEND')
    const naoLeu = await makeUser(app, 'LEGEND')
    const post = await app.inject({
      method: 'POST', url: '/corporate-posts', headers: auth(head.token), payload: { content: 'aviso' },
    })
    const id = post.json().post.id
    await app.inject({ method: 'POST', url: `/corporate-posts/${id}/read`, headers: auth(leu.token) })

    const feedDeQuemLeu = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(leu.token) })
    const feedDeQuemNao = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(naoLeu.token) })

    const acha = (res: { json: () => { items: { id: string; viewerRead: boolean }[] } }) =>
      res.json().items.find((p) => p.id === id)!
    expect(acha(feedDeQuemLeu).viewerRead).toBe(true)
    // Sem isso a marcação "Novo" da Home sumiria para todo mundo assim que uma
    // pessoa qualquer abrisse o comunicado.
    expect(acha(feedDeQuemNao).viewerRead).toBe(false)
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

describe('tipos de comunicação do Feed (Documento 3, seção 13)', () => {
  /**
   * Cria as categorias do teste. O `setup.ts` limpa o catálogo entre testes, e
   * a provisão de verdade acontece no onboarding da empresa — aqui a gente
   * monta o que cada caso precisa, sem depender do seed da migration.
   */
  async function criarTags(app: FastifyInstance, token: string, ...nomes: string[]) {
    const criadas = []
    for (const name of nomes) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/corporate-post-tags',
        headers: auth(token),
        payload: { name },
      })
      criadas.push(res.json().tag as { id: string; name: string; slug: string })
    }
    return criadas
  }

  it('lista só as categorias ativas no catálogo público', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const [institucional, treinamento] = await criarTags(app, admin.token, 'Institucional', 'Treinamento')
    await app.inject({
      method: 'PATCH',
      url: `/admin/corporate-post-tags/${treinamento.id}`,
      headers: auth(admin.token),
      payload: { active: false },
    })

    const res = await app.inject({ method: 'GET', url: '/corporate-post-tags', headers: auth(admin.token) })

    expect(res.json().tags.map((t: { id: string }) => t.id)).toEqual([institucional.id])
    await app.close()
  })

  it('publica com categoria e a devolve no DTO', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const [tag] = await criarTags(app, admin.token, 'Institucional')

    const criado = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { content: 'aviso com tipo', tagId: tag.id },
    })

    expect(criado.statusCode).toBe(201)
    expect(criado.json().post.tag).toMatchObject({ id: tag.id, name: tag.name })
    await app.close()
  })

  it('o filtro do feed é do SERVIDOR: só volta o que tem a categoria pedida', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const tags = await criarTags(app, admin.token, 'Institucional', 'Endomarketing')
    const criar = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/corporate-posts', headers: auth(admin.token), payload })
    await criar({ content: 'institucional', tagId: tags[0].id })
    await criar({ content: 'endomarketing', tagId: tags[1].id })
    await criar({ content: 'sem categoria' })

    const filtrado = await app.inject({
      method: 'GET',
      url: `/corporate-posts?tagId=${tags[0].id}`,
      headers: auth(admin.token),
    })

    const textos = filtrado.json().items.map((p: { content: string }) => p.content)
    expect(textos).toEqual(['institucional'])
    await app.close()
  })

  it('recusa categoria inativa em comunicado novo', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const [tag] = await criarTags(app, admin.token, 'Institucional')
    await app.inject({
      method: 'PATCH',
      url: `/admin/corporate-post-tags/${tag.id}`,
      headers: auth(admin.token),
      payload: { active: false },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { content: 'aviso', tagId: tag.id },
    })

    // Desativar existe para tirar a categoria de circulação; aceitá-la pelo
    // corpo da request seria a porta dos fundos disso.
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/inativa/i)
    await app.close()
  })

  it('a categoria desativada some do catálogo público, mas não dos posts que já a usam', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const [tag] = await criarTags(app, admin.token, 'Institucional')
    await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { content: 'aviso antigo', tagId: tag.id },
    })
    await app.inject({
      method: 'PATCH',
      url: `/admin/corporate-post-tags/${tag.id}`,
      headers: auth(admin.token),
      payload: { active: false },
    })

    const catalogo = await app.inject({ method: 'GET', url: '/corporate-post-tags', headers: auth(admin.token) })
    expect(catalogo.json().tags.map((t: { id: string }) => t.id)).not.toContain(tag.id)

    const feed = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(admin.token) })
    // Post já publicado continua classificado — é história, não escolha nova.
    expect(feed.json().items[0].tag).toMatchObject({ id: tag.id })
    await app.close()
  })

  it('criar categoria com nome repetido é 409, com dica de reativar quando está inativa', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const [tag] = await criarTags(app, admin.token, 'Institucional')

    const repetida = await app.inject({
      method: 'POST',
      url: '/admin/corporate-post-tags',
      headers: auth(admin.token),
      payload: { name: 'Institucional' },
    })
    expect(repetida.statusCode).toBe(409)

    await app.inject({
      method: 'PATCH',
      url: `/admin/corporate-post-tags/${tag.id}`,
      headers: auth(admin.token),
      payload: { active: false },
    })
    const depois = await app.inject({
      method: 'POST',
      url: '/admin/corporate-post-tags',
      headers: auth(admin.token),
      payload: { name: tag.name },
    })
    expect(depois.json().message).toMatch(/Reative-a/i)
    await app.close()
  })
})

describe('comunicado dirigido à liderança', () => {
  async function publicar(app: FastifyInstance, token: string, audience: string, extra = {}) {
    return app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(token),
      payload: { content: 'aviso da liderança', audience, ...extra },
    })
  }

  it('o líder vê; o colaborador não', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const lead = await makeUser(app, 'LEAD')
    const legend = await makeUser(app, 'LEGEND')
    await publicar(app, admin.token, 'LEADERS')

    const doLider = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(lead.token) })
    const doColega = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(legend.token) })

    expect(doLider.json().items).toHaveLength(1)
    expect(doColega.json().items).toHaveLength(0)
    await app.close()
  })

  it('MANAGER e HEAD também alcançam — é o LEADER_ROLES inteiro', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const manager = await makeUser(app, 'MANAGER')
    const head = await makeUser(app, 'HEAD')
    await publicar(app, admin.token, 'LEADERS')

    for (const quem of [manager, head]) {
      const res = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(quem.token) })
      expect(res.json().items).toHaveLength(1)
    }
    await app.close()
  })

  it('quem modera continua vendo, mesmo sem liderar ninguém', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    await publicar(app, admin.token, 'LEADERS')

    const res = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(admin.token) })

    expect(res.json().items).toHaveLength(1)
    await app.close()
  })

  it('avisa a liderança e não avisa o colaborador', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const lead = await makeUser(app, 'LEAD')
    const legend = await makeUser(app, 'LEGEND')

    await publicar(app, admin.token, 'LEADERS', { title: 'Alinhamento de metas' })

    // `makeUser` devolve `{ user, token }`: usar `lead.id` daria `undefined`, e
    // no Prisma `undefined` num `where` significa "sem filtro" — a contagem
    // pegaria TODAS as notificações e o teste passaria por coincidência.
    const paraLider = await prisma.notification.count({
      where: { userId: lead.user.id, type: 'CORPORATE_POST_PUBLISHED' },
    })
    const paraColega = await prisma.notification.count({
      where: { userId: legend.user.id, type: 'CORPORATE_POST_PUBLISHED' },
    })
    expect(paraLider).toBe(1)
    expect(paraColega).toBe(0)
    await app.close()
  })

  it('não exige setor, ao contrário do escopo por setores', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    // `LEADERS` recorta por papel: pedir setor seria pedir um dado sem sentido.
    expect((await publicar(app, admin.token, 'LEADERS')).statusCode).toBe(201)
    // Já `SECTORS` sem setor nenhum continua sendo 400.
    expect((await publicar(app, admin.token, 'SECTORS')).statusCode).toBe(400)
    await app.close()
  })

  it('o DTO devolve o escopo, para o card poder marcar o post como restrito', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const criado = await publicar(app, admin.token, 'LEADERS')

    expect(criado.json().post.audience).toBe('LEADERS')
    expect(criado.json().post.audienceSectors).toEqual([])
    await app.close()
  })

  it('o alcance é medido contra os líderes, não contra a empresa', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const lead = await makeUser(app, 'LEAD')
    // Colaboradores que NÃO são público deste comunicado.
    await makeUser(app, 'LEGEND')
    await makeUser(app, 'LEGEND')
    const criado = await publicar(app, admin.token, 'LEADERS')
    await app.inject({
      method: 'POST',
      url: `/corporate-posts/${criado.json().post.id}/read`,
      headers: auth(lead.token),
    })

    const reach = await app.inject({ method: 'GET', url: '/admin/corporate-posts/reach', headers: auth(admin.token) })
    const linha = reach.json().items.find((p: { postId: string }) => p.postId === criado.json().post.id)

    // 1 líder de 1 elegível = 100%. Contra a empresa inteira daria 25%.
    expect(linha.audience).toBe(1)
    expect(linha.readPct).toBe(100)
    await app.close()
  })
})

/**
 * Documento 4, seção 12: publicação era sempre imediata. Agendado fica fora do
 * feed até o tick do scheduler, que é também quem notifica.
 */
describe('agendamento de comunicado', () => {
  const daquiUmaHora = () => new Date(Date.now() + 60 * 60 * 1000).toISOString()

  it('quem publica direto agenda: nasce SCHEDULED e não entra no feed', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const res = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { content: 'comunicado de amanhã', publishAt: daquiUmaHora() },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().post.status).toBe('SCHEDULED')
    expect(res.json().post.publishAt).not.toBeNull()

    const feed = await app.inject({ method: 'GET', url: '/corporate-posts', headers: auth(admin.token) })
    expect(feed.json().items).toHaveLength(0)
  })

  it('o agendado aparece em "Meus envios", com a data marcada', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { content: 'comunicado de amanhã', publishAt: daquiUmaHora() },
    })

    const envios = await app.inject({
      method: 'GET',
      url: '/corporate-posts/pending?mine=true',
      headers: auth(admin.token),
    })
    const item = envios.json().items[0]
    expect(item.status).toBe('SCHEDULED')
    expect(item.publishAt).not.toBeNull()
  })

  it('data no passado é 400 — não é agendamento, é fuso ou dedo trocado', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const res = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { content: 'ontem', publishAt: new Date(Date.now() - 60_000).toISOString() },
    })
    expect(res.statusCode).toBe(400)
  })

  it('quem passa pela aprovação não agenda: o post nasce PENDING e sem data', async () => {
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')

    const res = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(lenda.token),
      payload: { content: 'posso agendar?', publishAt: daquiUmaHora() },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().post.status).toBe('PENDING')
    expect(res.json().post.publishAt).toBeNull()
  })
})


describe('enquete no Feed', () => {
  const enquete = { question: 'Qual logo?', options: ['Azul', 'Verde'] }

  async function postPublicadoComEnquete(app: FastifyInstance) {
    const admin = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { content: 'Escolha aí', poll: enquete },
    })
    return { admin, post: res.json().post }
  }

  it('cria o post com enquete e não devolve resultado antes do voto', async () => {
    const app = buildApp()
    await app.ready()
    const { post } = await postPublicadoComEnquete(app)

    expect(post.poll.question).toBe('Qual logo?')
    expect(post.poll.hasVoted).toBe(false)
    expect(post.poll.totalVotes).toBeNull()
    expect(post.poll.options.map((o: { voteCount: number | null }) => o.voteCount)).toEqual([null, null])
    expect(post.poll.canVote).toBe(true)
    await app.close()
  })

  it('vota, revela o resultado, e o segundo voto é 409', async () => {
    const app = buildApp()
    await app.ready()
    const { post } = await postPublicadoComEnquete(app)
    const votante = await makeUser(app, 'LEGEND')

    const votou = await app.inject({
      method: 'POST',
      url: `/corporate-posts/${post.id}/poll/vote`,
      headers: auth(votante.token),
      payload: { optionId: post.poll.options[0].id },
    })
    expect(votou.statusCode).toBe(200)
    expect(votou.json().post.poll.hasVoted).toBe(true)
    expect(votou.json().post.poll.totalVotes).toBe(1)
    expect(votou.json().post.poll.options[0].percentage).toBe(100)

    const denovo = await app.inject({
      method: 'POST',
      url: `/corporate-posts/${post.id}/poll/vote`,
      headers: auth(votante.token),
      payload: { optionId: post.poll.options[1].id },
    })
    expect(denovo.statusCode).toBe(409)
    await app.close()
  })

  it('ver quem votou exige ter votado', async () => {
    const app = buildApp()
    await app.ready()
    const { post } = await postPublicadoComEnquete(app)
    const votante = await makeUser(app, 'LEGEND')

    const antes = await app.inject({
      method: 'GET',
      url: `/corporate-posts/${post.id}/poll/votes`,
      headers: auth(votante.token),
    })
    expect(antes.statusCode).toBe(403)

    await app.inject({
      method: 'POST',
      url: `/corporate-posts/${post.id}/poll/vote`,
      headers: auth(votante.token),
      payload: { optionId: post.poll.options[1].id },
    })
    const depois = await app.inject({
      method: 'GET',
      url: `/corporate-posts/${post.id}/poll/votes`,
      headers: auth(votante.token),
    })
    expect(depois.statusCode).toBe(200)
    expect(depois.json().options[1].voters).toHaveLength(1)
    await app.close()
  })

  it('recusa opções repetidas na criação', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const res = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: { content: 'x', poll: { question: 'Q', options: ['Sim', 'sim'] } },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  // A enquete não disputa vaga com anexo, ao contrário da Resenha.
  it('aceita enquete e GIF no mesmo post', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const res = await app.inject({
      method: 'POST',
      url: '/corporate-posts',
      headers: auth(admin.token),
      payload: {
        content: 'com os dois',
        gif: { url: 'https://media.giphy.com/media/x/giphy.gif', width: 1, height: 1 },
        poll: enquete,
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().post.poll).not.toBeNull()
    expect(res.json().post.gif).not.toBeNull()
    await app.close()
  })
})
