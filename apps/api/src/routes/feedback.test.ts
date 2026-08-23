import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

const MSG = {
  message: 'Conduziu o incidente de produção com calma, comunicou o time a cada 15 minutos e acelerou a recuperação.',
  category: 'POSITIVO',
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
  const authorId = reg.json().user.id as string
  const lead = await prisma.user.create({
    data: { name: 'Líder', email: 'lead@empresa.com', passwordHash: 'x', role: 'LEAD' },
  })
  return { app, token, authorId, lead }
}

describe('feedback routes', () => {
  it('cria um feedback (201)', async () => {
    const { app, lead, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: MSG,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().feedback.author.name).toBe('Ana')
    expect(res.json().feedback.message).toBe(MSG.message)
    await app.close()
  })

  it('rejeita mensagem curta (400)', async () => {
    const { app, lead, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'curto' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejeita ADMIN deixando feedback (403)', async () => {
    const { app, lead, token, authorId } = await setup()
    await prisma.user.update({ where: { id: authorId }, data: { role: 'ADMIN' } })
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: MSG,
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('rejeita feedback a si mesmo (400)', async () => {
    const { app, token, authorId } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${authorId}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: MSG,
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('404 para destinatário inexistente', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/inexistente/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: MSG,
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('lista feedbacks do alvo em ordem decrescente', async () => {
    const { app, lead, token } = await setup()
    await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const res = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().feedbacks).toHaveLength(1)
    expect(res.json().feedbacks[0].author.name).toBe('Ana')
    expect(res.json().feedbacks[0].reactions).toEqual([])
    await app.close()
  })

  it('pagina feedbacks com limit e hasMore', async () => {
    const { app, token } = await setup()
    const target = await prisma.user.create({
      data: { name: 'Alvo', email: 'alvo@empresa.com', passwordHash: 'x', role: 'LEAD' },
    })
    const a1 = await prisma.user.create({
      data: { name: 'Autor 1', email: 'autor1@empresa.com', passwordHash: 'x', role: 'LEAD' },
    })
    const a2 = await prisma.user.create({
      data: { name: 'Autor 2', email: 'autor2@empresa.com', passwordHash: 'x', role: 'LEAD' },
    })
    const a3 = await prisma.user.create({
      data: { name: 'Autor 3', email: 'autor3@empresa.com', passwordHash: 'x', role: 'LEAD' },
    })
    for (const author of [a1, a2, a3]) {
      // `recipients` acompanha: a listagem do perfil é por destinatário, e toda
      // linha real tem o principal ali (createFeedback + backfill da migration).
      await prisma.feedback.create({
        data: {
          authorId: author.id,
          targetId: target.id,
          message: 'feedback suficientemente longo para passar na validação',
          category: 'POSITIVO',
          recipients: { create: [{ userId: target.id }] },
        },
      })
    }
    const page1 = await app.inject({ method: 'GET', url: `/users/${target.id}/feedbacks?limit=2&offset=0`, headers: { authorization: `Bearer ${token}` } })
    expect(page1.statusCode).toBe(200)
    expect(page1.json().feedbacks).toHaveLength(2)
    expect(page1.json().hasMore).toBe(true)
    // `total` sustenta o "página X de Y" do perfil — sem ele não dá para saber
    // quantas páginas existem sem varrer todas.
    expect(page1.json().total).toBe(3)
    expect(page1.json().offset).toBe(0)
    const page2 = await app.inject({ method: 'GET', url: `/users/${target.id}/feedbacks?limit=2&offset=2`, headers: { authorization: `Bearer ${token}` } })
    expect(page2.json().feedbacks).toHaveLength(1)
    expect(page2.json().hasMore).toBe(false)
    expect(page2.json().total).toBe(3)
    await app.close()
  })

  /**
   * Deep-link do mural (`/perfil/:id?feedback=<id>`). Com paginação numerada o
   * front não tem como adivinhar em que página o feedback caiu, e varrer página
   * a página seria puxar o histórico inteiro.
   */
  it('anchor devolve a página que contém o feedback pedido', async () => {
    const { app, token } = await setup()
    const target = await prisma.user.create({
      data: { name: 'Alvo Ancora', email: 'alvo-ancora@empresa.com', passwordHash: 'x', role: 'LEAD' },
    })
    const criados: string[] = []
    for (let i = 0; i < 5; i += 1) {
      const author = await prisma.user.create({
        data: { name: `Autor ${i}`, email: `autor-ancora-${i}@empresa.com`, passwordHash: 'x', role: 'LEAD' },
      })
      const feedback = await prisma.feedback.create({
        data: {
          authorId: author.id,
          targetId: target.id,
          message: `feedback numero ${i}, suficientemente longo para a validação`,
          category: 'POSITIVO',
          // createdAt decrescente: o índice 0 é o mais recente.
          createdAt: new Date(Date.UTC(2026, 5, 20 - i)),
          recipients: { create: [{ userId: target.id }] },
        },
      })
      criados.push(feedback.id)
    }
    // Ordenação é do mais recente para o mais antigo, então o 4º item (índice 3)
    // cai na segunda página de duas em duas.
    const res = await app.inject({
      method: 'GET',
      url: `/users/${target.id}/feedbacks?limit=2&anchor=${criados[3]}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().offset).toBe(2)
    expect(res.json().feedbacks.map((f: { id: string }) => f.id)).toContain(criados[3])
  })

  it('anchor de feedback inexistente cai no offset pedido, sem estourar', async () => {
    const { app, token, lead } = await setup()
    const res = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks?limit=2&anchor=nao-existe`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().offset).toBe(0)
    await app.close()
  })

  it('filtra por categoria no servidor, e o total acompanha o filtro', async () => {
    const { app, token, authorId } = await setup()
    const target = await prisma.user.create({
      data: { name: 'Alvo Filtro', email: 'alvo-filtro@empresa.com', passwordHash: 'x', role: 'LEAD' },
    })
    const lideranca = await prisma.recognitionCategory.create({ data: { name: 'Liderança', slug: 'lideranca' } })
    const comunicacao = await prisma.recognitionCategory.create({ data: { name: 'Comunicação', slug: 'comunicacao' } })
    for (const categoria of [lideranca, lideranca, comunicacao]) {
      const autor = await prisma.user.create({
        data: { name: `Autor ${Math.random()}`, email: `autor-filtro-${Math.random()}@empresa.com`, passwordHash: 'x', role: 'LEAD' },
      })
      await prisma.feedback.create({
        data: {
          authorId: autor.id,
          targetId: target.id,
          message: 'feedback suficientemente longo para passar na validação',
          category: 'POSITIVO',
          recipients: { create: [{ userId: target.id }] },
          recognitionCategories: { create: [{ categoryId: categoria.id }] },
        },
      })
    }
    expect(authorId).toBeTruthy()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${target.id}/feedbacks?categoryId=${lideranca.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.json().total).toBe(2)
    expect(res.json().feedbacks).toHaveLength(2)
    await app.close()
  })

  /**
   * Feedback grupal: quem entrou como destinatário adicional recebeu igual, e é
   * o que os selos já contavam. Filtrar por `targetId` escondia esse feedback do
   * perfil da pessoa.
   */
  it('lista no perfil o feedback grupal em que a pessoa é destinatária secundária', async () => {
    const { app, token, lead } = await setup()
    const outro = await prisma.user.create({
      data: { name: 'Segundo Alvo', email: 'segundo-alvo@empresa.com', passwordHash: 'x', role: 'LEAD' },
    })
    const criado = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...MSG, targetIds: [outro.id] },
    })
    expect(criado.statusCode).toBe(201)

    for (const pessoa of [lead, outro]) {
      const res = await app.inject({
        method: 'GET',
        url: `/users/${pessoa.id}/feedbacks`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.json().feedbacks).toHaveLength(1)
      expect(res.json().total).toBe(1)
    }
    await app.close()
  })

  it('GET feedbacks exige autenticação (401)', async () => {
    const { app, lead } = await setup()
    const res = await app.inject({ method: 'GET', url: `/users/${lead.id}/feedbacks` })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('só o autor edita o feedback (403 para outro)', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const feedbackId = created.json().feedback.id as string

    const other = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Bia', email: 'bia@empresa.com', password: 'changeme123' },
    })
    const otherToken = other.json().accessToken as string

    const res = await app.inject({
      method: 'PATCH',
      url: `/feedbacks/${feedbackId}`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { message: 'Tentando editar feedback de outra pessoa, texto longo.' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('autor edita o próprio feedback (200)', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const feedbackId = created.json().feedback.id as string
    const res = await app.inject({
      method: 'PATCH',
      url: `/feedbacks/${feedbackId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'Mensagem revisada, suficientemente longa para validar.' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().feedback.message).toBe('Mensagem revisada, suficientemente longa para validar.')
    await app.close()
  })

  it('ADMIN exclui feedback de outro (204); terceiro não-admin recebe 403', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const feedbackId = created.json().feedback.id as string

    const third = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Caio', email: 'caio@empresa.com', password: 'changeme123' },
    })
    const thirdToken = third.json().accessToken as string
    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/feedbacks/${feedbackId}`,
      headers: { authorization: `Bearer ${thirdToken}` },
    })
    expect(forbidden.statusCode).toBe(403)

    const adminReg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Adm', email: 'adm@empresa.com', password: 'changeme123' },
    })
    const adminId = adminReg.json().user.id as string
    const adminToken = adminReg.json().accessToken as string
    await prisma.user.update({ where: { id: adminId }, data: { role: 'ADMIN' } })

    const res = await app.inject({
      method: 'DELETE',
      url: `/feedbacks/${feedbackId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(204)
    await app.close()
  })

  it('rejeita criação sem categoria (400)', async () => {
    const { app, lead, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejeita categoria inválida (400)', async () => {
    const { app, lead, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message, category: 'INEXISTENTE' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('persiste a categoria enviada (201)', async () => {
    const { app, lead, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message, category: 'ELOGIO' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().feedback.category).toBe('ELOGIO')
    await app.close()
  })

  it('feedback privado (ORIENTACAO) NÃO aparece para um terceiro', async () => {
    const { app, lead, token } = await setup()
    await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message, category: 'ORIENTACAO' },
    })
    const other = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Bia', email: 'bia@empresa.com', password: 'changeme123' },
    })
    const otherToken = other.json().accessToken as string
    const res = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${otherToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().feedbacks).toHaveLength(0)
    await app.close()
  })

  it('feedback público (POSITIVO) aparece para um terceiro', async () => {
    const { app, lead, token } = await setup()
    await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message, category: 'POSITIVO' },
    })
    const other = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Bia', email: 'bia@empresa.com', password: 'changeme123' },
    })
    const otherToken = other.json().accessToken as string
    const res = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${otherToken}` },
    })
    expect(res.json().feedbacks).toHaveLength(1)
    await app.close()
  })

  it('feedback privado aparece para autor, alvo e ADMIN', async () => {
    const { app, lead, token } = await setup()
    await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message, category: 'MELHORIA' },
    })

    // Autor (Ana) vê o próprio privado.
    const asAuthor = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(asAuthor.json().feedbacks).toHaveLength(1)

    // Alvo (líder) — emite token via app.jwt para o usuário criado direto no banco.
    const leadToken = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
    const asTarget = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${leadToken}` },
    })
    expect(asTarget.json().feedbacks).toHaveLength(1)

    // ADMIN vê o privado de qualquer par.
    const adminReg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Adm', email: 'adm@empresa.com', password: 'changeme123' },
    })
    const adminId = adminReg.json().user.id as string
    await prisma.user.update({ where: { id: adminId }, data: { role: 'ADMIN' } })
    const adminToken = app.jwt.sign({ sub: adminId, role: 'ADMIN', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
    const asAdmin = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(asAdmin.json().feedbacks).toHaveLength(1)

    await app.close()
  })

  it('credita EMR Coins ao autor a cada feedback publicado', async () => {
    const { app, lead, token, authorId } = await setup()
    await prisma.coinRule.create({ data: { event: 'FEEDBACK_PUBLISHED', amount: 20 } })

    await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })

    const entries = await prisma.coinTransaction.findMany({ where: { userId: authorId } })
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.event === 'FEEDBACK_PUBLISHED' && e.amount === 20)).toBe(true)
    await app.close()
  })

  it('credita EMR Coins só ao adicionar reação, e uma vez por emoji', async () => {
    const { app, lead, token, authorId } = await setup()
    await prisma.coinRule.create({ data: { event: 'FEEDBACK_REACTION', amount: 5 } })
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const feedbackId = created.json().feedback.id as string
    const react = (emoji: string) =>
      app.inject({
        method: 'POST',
        url: `/feedbacks/${feedbackId}/reactions/toggle`,
        headers: { authorization: `Bearer ${token}` },
        payload: { emoji },
      })

    await react('👏') // adiciona: credita
    await react('👏') // remove: não credita
    await react('👏') // adiciona de novo: mesma referência, não repaga
    await react('🚀') // emoji diferente: credita

    const entries = await prisma.coinTransaction.findMany({
      where: { userId: authorId, event: 'FEEDBACK_REACTION' },
    })
    expect(entries).toHaveLength(2)
    await app.close()
  })

  it('toggle de reação adiciona e remove (200), com reactedByMe', async () => {
    const { app, lead, token, authorId } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const feedbackId = created.json().feedback.id as string

    const add = await app.inject({
      method: 'POST',
      url: `/feedbacks/${feedbackId}/reactions/toggle`,
      headers: { authorization: `Bearer ${token}` },
      payload: { emoji: '👏' },
    })
    expect(add.statusCode).toBe(200)
    expect(add.json().reactions).toHaveLength(1)
    expect(add.json().reactions[0]).toMatchObject({ emoji: '👏', count: 1, reactedByMe: true })
    expect(add.json().reactions[0].users[0].id).toBe(authorId)

    const remove = await app.inject({
      method: 'POST',
      url: `/feedbacks/${feedbackId}/reactions/toggle`,
      headers: { authorization: `Bearer ${token}` },
      payload: { emoji: '👏' },
    })
    expect(remove.json().reactions).toHaveLength(0)
    await app.close()
  })

  it('rejeita emoji inválido no toggle (400)', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const feedbackId = created.json().feedback.id as string
    const res = await app.inject({
      method: 'POST',
      url: `/feedbacks/${feedbackId}/reactions/toggle`,
      headers: { authorization: `Bearer ${token}` },
      payload: { emoji: 'X' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('404 ao reagir a feedback privado não visível', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message, category: 'ORIENTACAO' },
    })
    const feedbackId = created.json().feedback.id as string
    const other = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Bia', email: 'bia@empresa.com', password: 'changeme123' },
    })
    const otherToken = other.json().accessToken as string
    const res = await app.inject({
      method: 'POST',
      url: `/feedbacks/${feedbackId}/reactions/toggle`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { emoji: '👏' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('concede selo FEEDBACK ao autor quando atinge o limiar ao criar feedback', async () => {
    const { app, token, authorId, lead } = await setup()
    const badge = await prisma.badge.create({
      data: { slug: 'feedbacker-1', name: 'Feedbacker', description: '1 feedback', kind: 'FEEDBACK', iconKey: 'chat', threshold: 1 },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: MSG,
    })
    expect(res.statusCode).toBe(201)
    expect(await prisma.userBadge.count({ where: { userId: authorId, badgeId: badge.id } })).toBe(1)
    await app.close()
  })

  it('revoga selo FEEDBACK AUTO quando apagar feedback derruba a contagem abaixo do limiar', async () => {
    const { app, token, authorId, lead } = await setup()
    const badge = await prisma.badge.create({
      data: { slug: 'feedbacker-1', name: 'Feedbacker', description: '1 feedback', kind: 'FEEDBACK', iconKey: 'chat', threshold: 1 },
    })
    const created = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: MSG,
    })
    const feedbackId = created.json().feedback.id as string
    expect(await prisma.userBadge.count({ where: { userId: authorId, badgeId: badge.id } })).toBe(1)

    const del = await app.inject({
      method: 'DELETE',
      url: `/feedbacks/${feedbackId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(del.statusCode).toBe(204)
    expect(await prisma.userBadge.count({ where: { userId: authorId, badgeId: badge.id } })).toBe(0)
    await app.close()
  })

  it('cria notificação para o alvo ao receber feedback', async () => {
    const { app, lead, token } = await setup()
    await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const rows = await prisma.notification.findMany({ where: { userId: lead.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('FEEDBACK_RECEIVED')
    await app.close()
  })

  it('notifica o autor do feedback quando alguém reage', async () => {
    const { app, lead, token, authorId } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const feedbackId = created.json().feedback.id as string
    // o líder reage ao feedback que a Ana (authorId) escreveu
    const leadToken = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
    await app.inject({ method: 'POST', url: `/feedbacks/${feedbackId}/reactions/toggle`, headers: { authorization: `Bearer ${leadToken}` }, payload: { emoji: '👏' } })

    const toAuthor = await prisma.notification.findMany({ where: { userId: authorId, type: 'FEEDBACK_REACTION' } })
    expect(toAuthor).toHaveLength(1)
    // remover a reação (segundo toggle) NÃO gera nova notificação
    await app.inject({ method: 'POST', url: `/feedbacks/${feedbackId}/reactions/toggle`, headers: { authorization: `Bearer ${leadToken}` }, payload: { emoji: '👏' } })
    expect(await prisma.notification.count({ where: { userId: authorId, type: 'FEEDBACK_REACTION' } })).toBe(1)
    await app.close()
  })

  describe('compartilhar feedback', () => {
    it('alvo compartilha feedback público (200) e sharedAt fica preenchido', async () => {
      const app = buildApp()
      await app.ready()
      // autor registra e dá feedback ao alvo
      const authorReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Autor', email: 'autor-sh@x.com', password: 'changeme123' } })
      const authorToken = authorReg.json().accessToken as string
      const targetReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Alvo', email: 'alvo-sh@x.com', password: 'changeme123' } })
      const targetToken = targetReg.json().accessToken as string
      const targetId = targetReg.json().user.id as string
      const created = await app.inject({ method: 'POST', url: `/users/${targetId}/feedbacks`, headers: { authorization: `Bearer ${authorToken}` }, payload: MSG })
      const fbId = created.json().feedback.id as string

      const res = await app.inject({ method: 'POST', url: `/feedbacks/${fbId}/share`, headers: { authorization: `Bearer ${targetToken}` } })
      expect(res.statusCode).toBe(200)
      expect(res.json().feedback.sharedAt).not.toBeNull()
      await app.close()
    })

    // Desde a 2ª rodada da G&G o AUTOR decide se o reconhecimento é público
    // (o toggle do envio), então ele também publica depois. Quem não escreveu
    // nem recebeu segue de fora.
    it('autor pode compartilhar; um terceiro recebe 403', async () => {
      const app = buildApp()
      await app.ready()
      const authorReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Autor', email: 'autor-sh2@x.com', password: 'changeme123' } })
      const authorToken = authorReg.json().accessToken as string
      const targetReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Alvo', email: 'alvo-sh2@x.com', password: 'changeme123' } })
      const targetId = targetReg.json().user.id as string
      const created = await app.inject({ method: 'POST', url: `/users/${targetId}/feedbacks`, headers: { authorization: `Bearer ${authorToken}` }, payload: MSG })
      const fbId = created.json().feedback.id as string

      const doAutor = await app.inject({ method: 'POST', url: `/feedbacks/${fbId}/share`, headers: { authorization: `Bearer ${authorToken}` } })
      expect(doAutor.statusCode).toBe(200)

      const estranhoReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Estranho', email: 'estranho-sh2@x.com', password: 'changeme123' } })
      const doEstranho = await app.inject({
        method: 'POST',
        url: `/feedbacks/${fbId}/share`,
        headers: { authorization: `Bearer ${estranhoReg.json().accessToken as string}` },
      })
      expect(doEstranho.statusCode).toBe(403)
      await app.close()
    })

    it('descompartilha via DELETE (200) e sharedAt vira null', async () => {
      const app = buildApp()
      await app.ready()
      const authorReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Autor', email: 'autor-sh3@x.com', password: 'changeme123' } })
      const authorToken = authorReg.json().accessToken as string
      const targetReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Alvo', email: 'alvo-sh3@x.com', password: 'changeme123' } })
      const targetToken = targetReg.json().accessToken as string
      const targetId = targetReg.json().user.id as string
      const created = await app.inject({ method: 'POST', url: `/users/${targetId}/feedbacks`, headers: { authorization: `Bearer ${authorToken}` }, payload: MSG })
      const fbId = created.json().feedback.id as string
      await app.inject({ method: 'POST', url: `/feedbacks/${fbId}/share`, headers: { authorization: `Bearer ${targetToken}` } })

      const res = await app.inject({ method: 'DELETE', url: `/feedbacks/${fbId}/share`, headers: { authorization: `Bearer ${targetToken}` } })
      expect(res.statusCode).toBe(200)
      expect(res.json().feedback.sharedAt).toBeNull()
      await app.close()
    })
  })

  it('retorna 404 quando o :id pertence a outra empresa (GET /users/:id/feedbacks)', async () => {
    const { app, token } = await setup()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Feedback', slug: 'outra-empresa-feedback-test' } })
    const outsider = await prisma.user.create({ data: { name: 'Fora Feedback', email: 'fora-feedback@x.com', passwordHash: 'x', companyId: otherCompany.id } })
    const res = await app.inject({ method: 'GET', url: `/users/${outsider.id}/feedbacks`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('retorna 404 ao tentar deixar feedback pra :id de outra empresa (POST /users/:id/feedbacks)', async () => {
    const { app, token } = await setup()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Feedback2', slug: 'outra-empresa-feedback2-test' } })
    const outsider = await prisma.user.create({ data: { name: 'Fora Feedback2', email: 'fora-feedback2@x.com', passwordHash: 'x', companyId: otherCompany.id } })
    const res = await app.inject({
      method: 'POST',
      url: `/users/${outsider.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: MSG,
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
