import { beforeEach, describe, expect, it, vi } from 'vitest'
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
        body: 'x'.repeat(281),
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
})
