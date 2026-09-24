import { describe, it, expect } from 'vitest'
import { slugify } from '../lib/slug'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { updateAiSettings } from '../services/ai-settings-service'

/**
 * 2ª rodada da G&G no Mural de Feedbacks: reconhecimento grupal, competências
 * do catálogo, público decidido na origem, comentários e o teto semanal de XP.
 */

const MESSAGE =
  'Conduziu o incidente de produção com calma, comunicou o time a cada 15 minutos e acelerou a recuperação.'

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: `ana-${Math.random()}@empresa.com`, password: 'changeme123' },
  })
  return { app, token: reg.json().accessToken as string, authorId: reg.json().user.id as string }
}

async function makeUser(name: string, role = 'LEGEND', sectorId = 'sector-dev-produto') {
  return prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase()}-${Math.random()}@empresa.com`,
      passwordHash: 'x',
      role: role as never,
      sectorId,
    },
  })
}

function tokenFor(app: Awaited<ReturnType<typeof setup>>['app'], user: { id: string; role: string; sectorId: string }) {
  return app.jwt.sign({
    sub: user.id,
    role: user.role,
    sectorId: user.sectorId,
    companyId: DEFAULT_COMPANY_ID,
    features: [],
  })
}

async function makeCategory(name: string, order = 0) {
  return prisma.recognitionCategory.create({
    data: { name, slug: slugify(name), order, companyId: DEFAULT_COMPANY_ID },
  })
}

/** Regra de XP da empresa: +10 por feedback, teto de 30 na semana. */
async function makeXpRule(amount = 10, capAmount: number | null = 30) {
  return prisma.xpRule.create({
    data: {
      event: 'FEEDBACK_PUBLISHED',
      amount,
      capWindow: capAmount === null ? 'NONE' : 'WEEK',
      capAmount,
      active: true,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

describe('reconhecimento grupal', () => {
  it('um feedback para três pessoas cria três destinatários e uma conversa só', async () => {
    const { app, token } = await setup()
    const [bia, caio, duda] = await Promise.all([makeUser('Bia'), makeUser('Caio'), makeUser('Duda')])

    const res = await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO', targetIds: [caio.id, duda.id], isPublic: true },
    })

    expect(res.statusCode).toBe(201)
    expect(await prisma.feedbackRecipient.count({ where: { feedbackId: res.json().feedback.id } })).toBe(3)
    // Uma linha de Feedback só: é o que mantém reações e comentários juntos.
    expect(await prisma.feedback.count()).toBe(1)
    await app.close()
  })

  it('aparece em "Recebidos" de quem não é o destinatário principal', async () => {
    const { app, token } = await setup()
    const [bia, caio] = await Promise.all([makeUser('Bia'), makeUser('Caio')])
    await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO', targetIds: [caio.id] },
    })

    const recebidos = await app.inject({
      method: 'GET',
      url: '/feedbacks/received',
      headers: { authorization: `Bearer ${tokenFor(app, caio)}` },
    })

    expect(recebidos.json().feedbacks).toHaveLength(1)
    expect(recebidos.json().feedbacks[0].targets.map((t: { name: string }) => t.name).sort()).toEqual(['Bia', 'Caio'])
    await app.close()
  })

  it('avisa TODOS os destinatários, não só o principal', async () => {
    const { app, token } = await setup()
    const [bia, caio] = await Promise.all([makeUser('Bia'), makeUser('Caio')])

    await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO', targetIds: [caio.id] },
    })

    for (const pessoa of [bia, caio]) {
      expect(
        await prisma.notification.count({ where: { userId: pessoa.id, type: 'FEEDBACK_RECEIVED' } }),
      ).toBe(1)
    }
    await app.close()
  })

  it('paga XP UMA vez, não uma por destinatário', async () => {
    const { app, token, authorId } = await setup()
    await makeXpRule()
    const [bia, caio, duda] = await Promise.all([makeUser('Bia'), makeUser('Caio'), makeUser('Duda')])

    await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO', targetIds: [caio.id, duda.id] },
    })

    const lancamentos = await prisma.xpTransaction.findMany({ where: { userId: authorId } })
    expect(lancamentos).toHaveLength(1)
    expect(lancamentos[0].amount).toBe(10)
    await app.close()
  })

  it('recusa destinatário que não existe em vez de ignorar em silêncio', async () => {
    const { app, token } = await setup()
    const bia = await makeUser('Bia')

    const res = await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO', targetIds: ['nao-existe'] },
    })

    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('XP: +10 por reconhecimento, até 3 por semana', () => {
  it('o quarto da semana não credita', async () => {
    const { app, token, authorId } = await setup()
    await makeXpRule()
    const alvos = await Promise.all([makeUser('A1'), makeUser('A2'), makeUser('A3'), makeUser('A4')])

    for (const alvo of alvos) {
      await app.inject({
        method: 'POST',
        url: `/users/${alvo.id}/feedbacks`,
        headers: { authorization: `Bearer ${token}` },
        payload: { message: MESSAGE, category: 'POSITIVO' },
      })
    }

    // 3 × 10 = 30, que é o teto: o quarto reconhecimento acontece (o feedback é
    // gravado), mas não paga.
    expect(await prisma.feedback.count()).toBe(4)
    const total = await prisma.xpTransaction.aggregate({ where: { userId: authorId }, _sum: { amount: true } })
    expect(total._sum.amount).toBe(30)
    await app.close()
  })
})

describe('competências e categoria personalizada', () => {
  it('grava as competências escolhidas e devolve os chips na ordem do catálogo', async () => {
    const { app, token } = await setup()
    const bia = await makeUser('Bia')
    const inovacao = await makeCategory('Inovação', 3)
    const lideranca = await makeCategory('Liderança', 1)

    const res = await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        message: MESSAGE,
        category: 'POSITIVO',
        categoryIds: [inovacao.id, lideranca.id],
        customCategory: 'Cuidado com a pessoa',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().feedback.categories.map((c: { name: string }) => c.name)).toEqual(['Liderança', 'Inovação'])
    expect(res.json().feedback.customCategory).toBe('Cuidado com a pessoa')
    await app.close()
  })

  it('recusa competência de outra empresa ou desativada', async () => {
    const { app, token } = await setup()
    const bia = await makeUser('Bia')
    const desativada = await prisma.recognitionCategory.create({
      data: { name: 'Desativada', slug: 'desativada', active: false, companyId: DEFAULT_COMPANY_ID },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO', categoryIds: [desativada.id] },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('público na origem, busca e filtro do mural', () => {
  it('isPublic manda para o mural; sem ele o feedback fica privado', async () => {
    const { app, token } = await setup()
    const [bia, caio] = await Promise.all([makeUser('Bia'), makeUser('Caio')])

    await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: `${MESSAGE} público`, category: 'POSITIVO', isPublic: true },
    })
    await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: `${MESSAGE} privado`, category: 'POSITIVO' },
    })

    const mural = await app.inject({
      method: 'GET',
      url: '/feedbacks/mural',
      headers: { authorization: `Bearer ${tokenFor(app, caio)}` },
    })

    const mensagens = mural.json().feedbacks.map((f: { message: string }) => f.message)
    expect(mensagens.some((m: string) => m.endsWith('público'))).toBe(true)
    expect(mensagens.some((m: string) => m.endsWith('privado'))).toBe(false)
    await app.close()
  })

  it('busca por nome de colega, trecho e competência', async () => {
    const { app, token } = await setup()
    const [bia, caio] = await Promise.all([makeUser('Bia'), makeUser('Caio')])
    const gratidao = await makeCategory('Gratidão')

    await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        message: `${MESSAGE} sobre o incidente`,
        category: 'POSITIVO',
        isPublic: true,
        categoryIds: [gratidao.id],
      },
    })
    await app.inject({
      method: 'POST',
      url: `/users/${caio.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: `${MESSAGE} sobre a apresentação`, category: 'POSITIVO', isPublic: true },
    })

    const auth = { authorization: `Bearer ${token}` }
    const porNome = await app.inject({ method: 'GET', url: '/feedbacks/mural?q=Bia', headers: auth })
    expect(porNome.json().feedbacks).toHaveLength(1)

    const porTrecho = await app.inject({ method: 'GET', url: '/feedbacks/mural?q=apresenta', headers: auth })
    expect(porTrecho.json().feedbacks).toHaveLength(1)

    const porCompetencia = await app.inject({ method: 'GET', url: '/feedbacks/mural?q=gratid', headers: auth })
    expect(porCompetencia.json().feedbacks).toHaveLength(1)

    const porFiltro = await app.inject({
      method: 'GET',
      url: `/feedbacks/mural?categoryId=${gratidao.id}`,
      headers: auth,
    })
    expect(porFiltro.json().feedbacks).toHaveLength(1)
    await app.close()
  })

  it('o autor também publica depois; um terceiro não', async () => {
    const { app, token } = await setup()
    const [bia, estranho] = await Promise.all([makeUser('Bia'), makeUser('Estranho')])
    const criado = await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO' },
    })
    const id = criado.json().feedback.id

    const alheio = await app.inject({
      method: 'POST',
      url: `/feedbacks/${id}/share`,
      headers: { authorization: `Bearer ${tokenFor(app, estranho)}` },
    })
    expect(alheio.statusCode).toBe(403)

    // Duas portas para a mesma coluna: o autor (toggle do envio) e quem recebeu
    // (o caminho dos feedbacks antigos).
    const peloAutor = await app.inject({
      method: 'POST',
      url: `/feedbacks/${id}/share`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(peloAutor.statusCode).toBe(200)
    expect((await prisma.feedback.findUniqueOrThrow({ where: { id } })).sharedAt).not.toBeNull()

    const peloDestinatario = await app.inject({
      method: 'DELETE',
      url: `/feedbacks/${id}/share`,
      headers: { authorization: `Bearer ${tokenFor(app, bia)}` },
    })
    expect(peloDestinatario.statusCode).toBe(200)
    await app.close()
  })

  it('"Enviados" traz o que a pessoa escreveu, público ou privado', async () => {
    const { app, token } = await setup()
    const bia = await makeUser('Bia')
    await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO' },
    })

    const enviados = await app.inject({
      method: 'GET',
      url: '/feedbacks/sent',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(enviados.json().feedbacks).toHaveLength(1)
    expect(enviados.json().feedbacks[0].sharedAt).toBeNull()
    await app.close()
  })
})

describe('responder a um feedback avisa quem está na conversa', () => {
  /** Notificações de resposta de um usuário, mais novas primeiro. */
  async function respostas(userId: string) {
    return prisma.notification.findMany({
      where: { userId, type: 'FEEDBACK_COMMENT' },
      orderBy: { createdAt: 'desc' },
    })
  }

  it('avisa quem escreveu e quem recebeu — nunca quem respondeu', async () => {
    const { app, token, authorId } = await setup()
    const bia = await makeUser('Bia')
    const criado = await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO' },
    })
    const id = criado.json().feedback.id

    await app.inject({
      method: 'POST',
      url: `/feedbacks/${id}/comments`,
      headers: { authorization: `Bearer ${tokenFor(app, bia)}` },
      payload: { message: 'Obrigada, isso me ajudou muito!' },
    })

    const daAna = await respostas(authorId)
    expect(daAna).toHaveLength(1)
    expect(daAna[0].title).toBe('Bia respondeu a um feedback seu')
    // O link é o deep-link do perfil de quem recebeu: é lá que a conversa abre.
    expect(daAna[0].link).toBe(`/perfil/${bia.id}?feedback=${id}`)
    expect(await respostas(bia.id)).toHaveLength(0)
    await app.close()
  })

  it('quem já tinha respondido fica sabendo que a conversa continuou, com outro texto', async () => {
    const { app, token, authorId } = await setup()
    const [bia, carla, dani] = await Promise.all([makeUser('Bia'), makeUser('Carla'), makeUser('Dani')])
    const criado = await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO', isPublic: true },
    })
    const id = criado.json().feedback.id

    for (const quem of [carla, dani]) {
      await app.inject({
        method: 'POST',
        url: `/feedbacks/${id}/comments`,
        headers: { authorization: `Bearer ${tokenFor(app, quem)}` },
        payload: { message: `Concordo, assinado ${quem.name}.` },
      })
    }

    // Carla não é dona do feedback — só respondeu antes.
    const daCarla = await respostas(carla.id)
    expect(daCarla).toHaveLength(1)
    expect(daCarla[0].title).toBe('Dani também respondeu a um feedback que você respondeu')
    // Ana escreveu e Bia recebeu: para as duas é "um feedback seu", nas duas respostas.
    expect((await respostas(authorId)).map((n) => n.title)).toEqual([
      'Dani respondeu a um feedback seu',
      'Carla respondeu a um feedback seu',
    ])
    expect(await respostas(bia.id)).toHaveLength(2)
    expect(await respostas(dani.id)).toHaveLength(0)
    await app.close()
  })

  it('quem é dono E já respondeu recebe um aviso só, o de dono', async () => {
    const { app, token, authorId } = await setup()
    const bia = await makeUser('Bia')
    const criado = await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO' },
    })
    const id = criado.json().feedback.id

    // Bia responde, e depois Ana — que escreveu o feedback — responde de volta.
    await app.inject({
      method: 'POST',
      url: `/feedbacks/${id}/comments`,
      headers: { authorization: `Bearer ${tokenFor(app, bia)}` },
      payload: { message: 'Obrigada!' },
    })
    await app.inject({
      method: 'POST',
      url: `/feedbacks/${id}/comments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'Merecido, de verdade.' },
    })

    const daBia = await respostas(bia.id)
    expect(daBia).toHaveLength(1)
    expect(daBia[0].title).toBe('Ana respondeu a um feedback seu')
    // Ana só foi avisada da resposta da Bia, não da própria.
    expect(await respostas(authorId)).toHaveLength(1)
    await app.close()
  })
})

describe('comentários herdam a visibilidade do feedback', () => {
  it('destinatário comenta; terceiro não enxerga feedback privado (404)', async () => {
    const { app, token } = await setup()
    const [bia, estranho] = await Promise.all([makeUser('Bia'), makeUser('Estranho')])
    const criado = await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO' },
    })
    const id = criado.json().feedback.id

    const comentario = await app.inject({
      method: 'POST',
      url: `/feedbacks/${id}/comments`,
      headers: { authorization: `Bearer ${tokenFor(app, bia)}` },
      payload: { message: 'Obrigada!' },
    })
    expect(comentario.statusCode).toBe(201)

    const deFora = await app.inject({
      method: 'GET',
      url: `/feedbacks/${id}/comments`,
      headers: { authorization: `Bearer ${tokenFor(app, estranho)}` },
    })
    expect(deFora.statusCode).toBe(404)

    const listado = await app.inject({
      method: 'GET',
      url: `/feedbacks/${id}/comments`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(listado.json().comments).toHaveLength(1)
    await app.close()
  })

  it('só o autor do comentário (ou a G&G) apaga', async () => {
    const { app, token } = await setup()
    const bia = await makeUser('Bia')
    const criado = await app.inject({
      method: 'POST',
      url: `/users/${bia.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MESSAGE, category: 'POSITIVO', isPublic: true },
    })
    const id = criado.json().feedback.id
    const comentario = await app.inject({
      method: 'POST',
      url: `/feedbacks/${id}/comments`,
      headers: { authorization: `Bearer ${tokenFor(app, bia)}` },
      payload: { message: 'Obrigada!' },
    })
    const commentId = comentario.json().comment.id

    const alheio = await app.inject({
      method: 'DELETE',
      url: `/feedbacks/comments/${commentId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(alheio.statusCode).toBe(403)

    const proprio = await app.inject({
      method: 'DELETE',
      url: `/feedbacks/comments/${commentId}`,
      headers: { authorization: `Bearer ${tokenFor(app, bia)}` },
    })
    expect(proprio.statusCode).toBe(204)
    await app.close()
  })
})

describe('catálogo de categorias (Administração › Categorias)', () => {
  async function adminToken(app: Awaited<ReturnType<typeof setup>>['app']) {
    const admin = await prisma.user.create({
      data: {
        name: 'Admin',
        email: `admin-${Math.random()}@empresa.com`,
        passwordHash: 'x',
        role: 'ADMIN',
      },
    })
    return app.jwt.sign({
      sub: admin.id,
      role: 'ADMIN',
      sectorId: admin.sectorId,
      companyId: DEFAULT_COMPANY_ID,
      features: [],
    })
  }

  it('a G&G cria, renomeia e desativa — com auditoria', async () => {
    const { app } = await setup()
    const token = await adminToken(app)
    const auth = { authorization: `Bearer ${token}` }

    const criada = await app.inject({
      method: 'POST',
      url: '/admin/categories',
      headers: auth,
      payload: { name: 'Cuidado com o cliente', order: 2 },
    })
    expect(criada.statusCode).toBe(201)
    const id = criada.json().category.id

    const renomeada = await app.inject({
      method: 'PATCH',
      url: `/admin/categories/${id}`,
      headers: auth,
      payload: { name: 'Foco no Cliente', active: false },
    })
    expect(renomeada.json().category).toMatchObject({ name: 'Foco no Cliente', active: false })

    // Desativada some do catálogo que o composer usa, mas continua na tela da G&G.
    const publica = await app.inject({ method: 'GET', url: '/categories', headers: auth })
    expect(publica.json().categories).toHaveLength(0)
    const adminList = await app.inject({ method: 'GET', url: '/admin/categories', headers: auth })
    expect(adminList.json().categories).toHaveLength(1)

    expect(await prisma.adminAuditLog.count({ where: { entityType: 'RecognitionCategory' } })).toBe(2)
    await app.close()
  })

  it('nome repetido na mesma empresa é 409', async () => {
    const { app } = await setup()
    const token = await adminToken(app)
    const auth = { authorization: `Bearer ${token}` }
    await app.inject({
      method: 'POST',
      url: '/admin/categories',
      headers: auth,
      payload: { name: 'Liderança' },
    })

    const repetida = await app.inject({
      method: 'POST',
      url: '/admin/categories',
      headers: auth,
      payload: { name: 'Liderança' },
    })

    expect(repetida.statusCode).toBe(409)
    await app.close()
  })

  it('GET /ai/status diz se a empresa tem agente, sem vazar a chave', async () => {
    const { app, token } = await setup()
    const auth = { authorization: `Bearer ${token}` }

    const semChave = await app.inject({ method: 'GET', url: '/ai/status', headers: auth })
    expect(semChave.statusCode).toBe(200)
    expect(semChave.json()).toEqual({ configured: false })

    await updateAiSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId: (await prisma.user.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })).id,
      body: { apiKey: 'chave-secreta-da-empresa' },
    })

    const comChave = await app.inject({ method: 'GET', url: '/ai/status', headers: auth })
    // Só o booleano: provedor, modelo e chave são assunto de administração.
    expect(comChave.json()).toEqual({ configured: true })
    expect(comChave.body).not.toContain('chave-secreta')
    await app.close()
  })

  it('colaborador não administra o catálogo (403)', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Tentativa' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
