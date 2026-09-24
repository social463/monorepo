import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAMPAIGN_BODY_MAX_LENGTH } from '@legends/shared'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'

vi.mock('../services/campaign-service', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/campaign-service')>()
  return {
    ...real,
    // Só o preview é dublado: é o único caminho que sairia para a rede.
    generateCampaignPreview: vi.fn(),
  }
})
const { generateCampaignPreview } = await import('../services/campaign-service')

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
  vi.mocked(generateCampaignPreview).mockReset()
})

async function criarUsuario(role: string, email: string) {
  return prisma.user.create({
    data: { name: `Usuário ${role}`, email, passwordHash: 'x', role: role as never },
  })
}

const pedido = {
  theme: 'Semana da segurança',
  startsAt: '2026-09-01T03:00:00.000Z',
  endsAt: '2026-09-10T03:00:00.000Z',
  audience: 'ALL',
  channel: 'MURAL',
  quantity: 2,
}

describe('rotas de campanhas', () => {
  it('barra colaborador comum', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-camp@empresa.com')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/campaigns/posts?from=2026-09-01&to=2026-09-30',
      headers: { authorization: `Bearer ${signAccessToken(app, legend)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  // Um LEGEND sem features falha em qualquer guarda (requireAdminOrSubadmin,
  // requireFeature ou requireSectorFeature) — não discrimina qual guarda está
  // de fato em uso. Quem discrimina é o SUBADMIN de outro setor: ele passa em
  // requireAdminOrSubadmin e em requireFeature, e só é barrado pela guarda
  // certa (requireSectorFeature('gente-gestao')). Mesma forma do teste em
  // benchmark-practices.test.ts ("só o SUBADMIN do setor com a feature...").
  it('só o SUBADMIN do setor com a feature gente-gestao acessa o calendário', async () => {
    const subadminGG = await criarUsuario('SUBADMIN', 'subadmin-gg-camp@empresa.com')
    const subadminOutro = await criarUsuario('SUBADMIN', 'subadmin-outro-camp@empresa.com')

    const criarPost = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/admin/campaigns/posts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'A',
          body: 'Corpo A',
          scheduledFor: '2026-09-01T12:00:00.000Z',
          channel: 'MURAL',
          audience: 'ALL',
        },
      })
    const listar = (token: string) =>
      app.inject({
        method: 'GET',
        url: '/admin/campaigns/posts?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.000Z',
        headers: { authorization: `Bearer ${token}` },
      })

    expect((await criarPost(signAccessToken(app, subadminGG, ['gente-gestao']))).statusCode).toBe(201)
    expect((await listar(signAccessToken(app, subadminGG, ['gente-gestao']))).statusCode).toBe(200)

    expect((await criarPost(signAccessToken(app, subadminOutro, ['desenvolvimento-produto']))).statusCode).toBe(403)
    expect((await listar(signAccessToken(app, subadminOutro, ['desenvolvimento-produto']))).statusCode).toBe(403)
  })

  it('recusa data final anterior à inicial com mensagem em português', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-janela@empresa.com')
    const res = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/preview',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: { ...pedido, startsAt: pedido.endsAt, endsAt: pedido.startsAt },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/data final/i)
    expect(generateCampaignPreview).not.toHaveBeenCalled()
  })

  it('recusa quantidade fora de 1..20', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-qtd@empresa.com')
    const res = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/preview',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: { ...pedido, quantity: 21 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('preview devolve rascunhos e não grava nada', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-preview@empresa.com')
    vi.mocked(generateCampaignPreview).mockResolvedValue([
      { title: 'A', body: 'Corpo A', visualHint: null, scheduledFor: '2026-09-01T12:00:00.000Z' },
      { title: 'B', body: 'Corpo B', visualHint: null, scheduledFor: '2026-09-03T12:00:00.000Z' },
    ])

    const res = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/preview',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: pedido,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().drafts).toHaveLength(2)
    expect(await prisma.campaign.count()).toBe(0)
    expect(await prisma.campaignPost.count()).toBe(0)
  })

  it('propaga o 503 de empresa sem chave de IA', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-503@empresa.com')
    const { AgentError } = await import('../lib/agent-error')
    vi.mocked(generateCampaignPreview).mockRejectedValue(new AgentError('Agente de IA não configurado.', 503))

    const res = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/preview',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: pedido,
    })

    expect(res.statusCode).toBe(503)
    expect(res.json().message).toContain('não configurado')
  })

  it('confirma, lista, edita, publica e cancela', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-fluxo@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const confirmada = await app.inject({
      method: 'POST',
      url: '/admin/campaigns',
      headers: auth,
      payload: {
        theme: 'Semana da segurança',
        startsAt: pedido.startsAt,
        endsAt: pedido.endsAt,
        audience: 'ALL',
        posts: [
          { title: 'A', body: 'Corpo A', scheduledFor: '2026-09-01T12:00:00.000Z', channel: 'MURAL' },
          { title: 'B', body: 'Corpo B', scheduledFor: '2026-09-03T12:00:00.000Z', channel: 'MURAL' },
        ],
      },
    })
    expect(confirmada.statusCode).toBe(201)
    expect(confirmada.json().posts).toHaveLength(2)

    const lista = await app.inject({
      method: 'GET',
      url: '/admin/campaigns/posts?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.000Z',
      headers: auth,
    })
    expect(lista.json().posts).toHaveLength(2)

    const alvo = lista.json().posts[0]
    const editado = await app.inject({
      method: 'PATCH',
      url: `/admin/campaigns/posts/${alvo.id}`,
      headers: auth,
      payload: { body: 'Corpo A editado' },
    })
    expect(editado.json().post.body).toBe('Corpo A editado')

    const publicado = await app.inject({
      method: 'POST',
      url: `/admin/campaigns/posts/${alvo.id}/publish`,
      headers: auth,
    })
    expect(publicado.statusCode).toBe(200)
    expect(publicado.json().post.status).toBe('PUBLISHED')
    expect(await prisma.corporatePost.count()).toBe(1)

    const outro = lista.json().posts[1]
    const cancelado = await app.inject({
      method: 'DELETE',
      url: `/admin/campaigns/posts/${outro.id}`,
      headers: auth,
    })
    expect(cancelado.json().post.status).toBe('CANCELLED')
    expect(await prisma.corporatePost.count()).toBe(1)
  })

  it('recusa corpo acima do limite do mural', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-limite@empresa.com')
    const res = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/posts',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: {
        title: 'A',
        body: 'x'.repeat(CAMPAIGN_BODY_MAX_LENGTH + 1),
        scheduledFor: '2026-09-01T12:00:00.000Z',
        channel: 'MURAL',
        audience: 'ALL',
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('lista os agendados do Feed da janela, de qualquer autor', async () => {
    // O problema que isto resolve: agendado do Feed não aparecia para a G&G em
    // lugar nenhum — "Meus envios" lista só os do próprio autor, e a fila de
    // moderação só olha PENDING.
    const admin = await criarUsuario('ADMIN', 'admin-grade@empresa.com')
    const colega = await criarUsuario('LEGEND', 'colega-grade@empresa.com')
    await prisma.corporatePost.create({
      data: {
        authorId: colega.id,
        content: 'Agendado direto no feed',
        title: 'Aviso do time',
        status: 'SCHEDULED',
        publishAt: new Date('2026-09-15T12:00:00.000Z'),
        companyId: admin.companyId,
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/admin/campaigns/feed-posts?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.000Z',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().posts).toHaveLength(1)
    expect(res.json().posts[0]).toMatchObject({
      title: 'Aviso do time',
      authorName: colega.name,
      publishAt: '2026-09-15T12:00:00.000Z',
    })
  })

  it('não traz para a grade o que está fora da janela, publicado ou pendente', async () => {
    // Pendente não tem data marcada (`createPost` ignora `publishAt` de quem cai
    // na fila), então não teria onde cair na grade.
    const admin = await criarUsuario('ADMIN', 'admin-grade-filtro@empresa.com')
    const base = { authorId: admin.id, companyId: admin.companyId, content: 'x' }
    await prisma.corporatePost.createMany({
      data: [
        { ...base, status: 'SCHEDULED', publishAt: new Date('2026-10-15T12:00:00.000Z') },
        { ...base, status: 'PUBLISHED', publishAt: new Date('2026-09-15T12:00:00.000Z') },
        { ...base, status: 'PENDING' },
      ],
    })

    const res = await app.inject({
      method: 'GET',
      url: '/admin/campaigns/feed-posts?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.000Z',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
    })

    expect(res.json().posts).toHaveLength(0)
  })

  it('barra colaborador comum na grade do Feed', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-grade@empresa.com')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/campaigns/feed-posts?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.000Z',
      headers: { authorization: `Bearer ${signAccessToken(app, legend)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('exclui de vez pela rota própria, sem tocar no cancelamento', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-exclui@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    const criado = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/posts',
      headers: auth,
      payload: {
        title: 'A',
        body: 'Corpo A',
        scheduledFor: '2026-09-01T12:00:00.000Z',
        channel: 'MURAL',
        audience: 'ALL',
      },
    })
    const id = criado.json().post.id

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/campaigns/posts/${id}/permanently`,
      headers: auth,
    })

    expect(res.statusCode).toBe(204)
    expect(await prisma.campaignPost.findUnique({ where: { id } })).toBeNull()
  })

  it('o DELETE simples continua sendo o cancelamento', async () => {
    // Não trocar o significado da rota existente é o que evita uma aba aberta
    // antes do deploy apagar a linha ao clicar em "Cancelar comunicado".
    const admin = await criarUsuario('ADMIN', 'admin-cancela-ainda@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    const criado = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/posts',
      headers: auth,
      payload: {
        title: 'A',
        body: 'Corpo A',
        scheduledFor: '2026-09-01T12:00:00.000Z',
        channel: 'MURAL',
        audience: 'ALL',
      },
    })
    const id = criado.json().post.id

    const res = await app.inject({ method: 'DELETE', url: `/admin/campaigns/posts/${id}`, headers: auth })

    expect(res.json().post.status).toBe('CANCELLED')
    expect(await prisma.campaignPost.findUnique({ where: { id } })).not.toBeNull()
  })

  it('aceita a arte no item e a devolve no DTO', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-arte@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const criado = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/posts',
      headers: auth,
      payload: {
        title: 'A',
        body: 'Corpo A',
        visualHint: 'Imagem do MKT.',
        image: { url: 'https://cdn.exemplo.com/images/arte.png', width: 1200, height: 630 },
        scheduledFor: '2026-09-01T12:00:00.000Z',
        channel: 'MURAL',
        audience: 'ALL',
      },
    })

    expect(criado.statusCode).toBe(201)
    expect(criado.json().post.image).toEqual({
      url: 'https://cdn.exemplo.com/images/arte.png',
      width: 1200,
      height: 630,
    })
    // O briefing em texto continua existindo ao lado da peça pronta.
    expect(criado.json().post.visualHint).toBe('Imagem do MKT.')
  })

  it('recusa arte sem URL válida', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-arte-invalida@empresa.com')
    const res = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/posts',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: {
        title: 'A',
        body: 'Corpo A',
        image: { url: 'nao-e-url', width: 10, height: 10 },
        scheduledFor: '2026-09-01T12:00:00.000Z',
        channel: 'MURAL',
        audience: 'ALL',
      },
    })
    expect(res.statusCode).toBe(400)
  })

  // Achado da revisão da Task 8: `publishCampaignPost` chama `createPost` do
  // corporate-mural-service, que valida autor ativo e papel com permissão de
  // publicar e lança `CorporateMuralError` — não `CampaignError`. Sem tratar
  // essa classe também, o erro escaparia como 500 em vez de resposta tratada.
  // Aqui o ator perde `active` depois do token emitido (o JWT não é
  // revalidado contra o banco a cada request), então `createPost` recusa o
  // autor no meio da publicação.
  it('não deixa CorporateMuralError do publish escapar como 500', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-mural-erro@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const criado = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/posts',
      headers: auth,
      payload: {
        title: 'A',
        body: 'Corpo A',
        scheduledFor: '2026-09-01T12:00:00.000Z',
        channel: 'MURAL',
        audience: 'ALL',
      },
    })
    expect(criado.statusCode).toBe(201)
    const id = criado.json().post.id

    await prisma.user.update({ where: { id: admin.id }, data: { active: false } })

    const res = await app.inject({
      method: 'POST',
      url: `/admin/campaigns/posts/${id}/publish`,
      headers: auth,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/autor/i)
  })

  describe('GET /admin/campaigns/calendar-context', () => {
    it('barra quem não tem gente-gestao', async () => {
      const legend = await criarUsuario('LEGEND', 'legend-ctx@empresa.com')
      const res = await app.inject({
        method: 'GET',
        url: '/admin/campaigns/calendar-context?from=2026-09-01&to=2026-09-30',
        headers: { authorization: `Bearer ${signAccessToken(app, legend)}` },
      })
      expect(res.statusCode).toBe(403)
    })

    it('traz eventos do calendário organizacional e aniversários/tempo de casa do mês', async () => {
      const admin = await criarUsuario('ADMIN', 'admin-ctx@empresa.com')
      const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

      const colega = await criarUsuario('LEGEND', 'colega-ctx@empresa.com')
      await prisma.user.update({
        where: { id: colega.id },
        data: {
          birthDate: new Date('1990-09-15T00:00:00.000Z'),
          joinedAt: new Date('2024-09-15T00:00:00.000Z'),
        },
      })

      const tipo = await prisma.calendarEventType.create({
        data: { name: 'Feriado', slug: 'feriado-ctx', icon: 'event', companyId: admin.companyId },
      })
      await prisma.calendarEvent.create({
        data: {
          title: 'Feriado municipal',
          date: new Date('2026-09-10'),
          typeId: tipo.id,
          createdById: admin.id,
          companyId: admin.companyId,
        },
      })

      const res = await app.inject({
        method: 'GET',
        url: '/admin/campaigns/calendar-context?from=2026-09-01&to=2026-09-30',
        headers: auth,
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.occurrences).toHaveLength(1)
      expect(body.occurrences[0].title).toBe('Feriado municipal')
      expect(body.birthdays).toHaveLength(1)
      expect(body.birthdays[0].user.id).toBe(colega.id)
      expect(body.birthdays[0].day).toBe(15)
      expect(body.workAnniversaries).toHaveLength(1)
      expect(body.workAnniversaries[0].user.id).toBe(colega.id)
      expect(body.workAnniversaries[0].years).toBe(2)
    })

    it('recusa período fora do formato AAAA-MM-DD', async () => {
      const admin = await criarUsuario('ADMIN', 'admin-ctx-invalido@empresa.com')
      const res = await app.inject({
        method: 'GET',
        url: '/admin/campaigns/calendar-context?from=2026-09-01T00:00:00.000Z&to=2026-09-30',
        headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      })
      expect(res.statusCode).toBe(400)
    })
  })
})
