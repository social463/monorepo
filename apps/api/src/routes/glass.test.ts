import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCompletionInput } from '../lib/agent-client'

// Mesmo padrão de `routes/agents.test.ts`: o client do provedor é trocado no
// nível do módulo, porque a rota não aceita injeção — quem injeta `complete` é
// o service, e aqui o teste entra pela porta HTTP.
const completion = vi.fn<(input: AgentCompletionInput) => Promise<string>>()
vi.mock('../lib/agent-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/agent-client')>()),
  requestAgentCompletion: (input: AgentCompletionInput) => completion(input),
}))

import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'
import { updateAiSettings } from '../services/ai-settings-service'

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
})

const REVISADO = {
  reviewDate: '2026-03-12',
  rating: 2,
  role: 'Analista de Suporte',
  level: 'Pleno',
  sector: 'Atendimento',
  tenure: 'DE_1_A_3_ANOS',
  status: 'ATIVO',
  recommends: false,
  leadershipApproval: false,
  title: 'Muita cobrança',
  positives: 'Time unido',
  negatives: 'Jornada puxada',
  advice: 'Ouçam a base',
  sentiment: 'NEGATIVO',
  themesPositive: ['AMBIENTE_EQUIPE'],
  themesNegative: ['SOBRECARGA'],
  aiSummary: 'Time bom, jornada pesada.',
}

let setorSeq = 0

async function criarSetor(companyId: string, features: string[]) {
  setorSeq += 1
  return prisma.sector.create({
    data: {
      name: `Setor ${features.join('-') || 'sem'}`,
      slug: `setor-glass-${setorSeq}`,
      companyId,
      enabledFeatures: features,
    },
  })
}

async function criarUsuario(role: string, email: string, extra: { companyId?: string; sectorId?: string } = {}) {
  return prisma.user.create({
    data: { name: 'Pessoa', email, passwordHash: 'x', role: role as never, ...extra },
  })
}

describe('rotas do GlassAgent — acesso', () => {
  it('ADMIN entra', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-glass@empresa.com')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/glass/overview',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('SUBADMIN do setor com gente-gestao entra', async () => {
    const company = await prisma.company.findFirstOrThrow()
    const setor = await criarSetor(company.id, ['gente-gestao'])
    const sub = await criarUsuario('SUBADMIN', 'sub-gg@empresa.com', { companyId: company.id, sectorId: setor.id })

    const res = await app.inject({
      method: 'GET',
      url: '/admin/glass/overview',
      headers: { authorization: `Bearer ${signAccessToken(app, sub, ['gente-gestao'])}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('SUBADMIN de outro setor leva 403 nas quatro rotas', async () => {
    const company = await prisma.company.findFirstOrThrow()
    const setor = await criarSetor(company.id, ['retrospectivas'])
    const sub = await criarUsuario('SUBADMIN', 'sub-eng@empresa.com', { companyId: company.id, sectorId: setor.id })
    const headers = { authorization: `Bearer ${signAccessToken(app, sub, ['retrospectivas'])}` }

    for (const req of [
      { method: 'GET' as const, url: '/admin/glass/overview' },
      { method: 'GET' as const, url: '/admin/glass/reviews' },
      { method: 'POST' as const, url: '/admin/glass/reviews', payload: REVISADO },
      { method: 'POST' as const, url: '/admin/glass/reviews/parse', payload: { raw: 'x' } },
    ]) {
      expect((await app.inject({ ...req, headers })).statusCode).toBe(403)
    }
  })

  it('colaborador leva 403', async () => {
    const user = await criarUsuario('LEGEND', 'colab-glass@empresa.com')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/glass/overview',
      headers: { authorization: `Bearer ${signAccessToken(app, user)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('sem token leva 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/glass/overview' })).statusCode).toBe(401)
  })
})

describe('rotas do GlassAgent — gravação e leitura', () => {
  it('grava a avaliação revisada e devolve o DTO sem autoria', async () => {
    const admin = await criarUsuario('ADMIN', 'grava@empresa.com')
    const headers = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({ method: 'POST', url: '/admin/glass/reviews', headers, payload: REVISADO })

    expect(res.statusCode).toBe(201)
    expect(res.json().review).toMatchObject({
      sector: 'Atendimento',
      rating: 2,
      alerts: ['NOTA_BAIXA_ATIVO'],
    })
    expect(Object.keys(res.json().review)).not.toContain('createdById')
  })

  it('recusa gravação sem setor, cargo ou tempo de casa', async () => {
    const admin = await criarUsuario('ADMIN', 'incompleto@empresa.com')
    const headers = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/glass/reviews',
      headers,
      payload: { ...REVISADO, sector: '', role: '', tenure: null },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().issues).toBeDefined()
    expect(await prisma.glassReview.count()).toBe(0)
  })

  it('recusa tema fora do vocabulário', async () => {
    const admin = await criarUsuario('ADMIN', 'tema@empresa.com')
    const res = await app.inject({
      method: 'POST',
      url: '/admin/glass/reviews',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: { ...REVISADO, themesNegative: ['CAFE_RUIM'] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('overview responde com as agregações', async () => {
    const admin = await criarUsuario('ADMIN', 'ov@empresa.com')
    const headers = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    await app.inject({ method: 'POST', url: '/admin/glass/reviews', headers, payload: REVISADO })

    const res = await app.inject({ method: 'GET', url: '/admin/glass/overview', headers })

    expect(res.statusCode).toBe(200)
    expect(res.json().overview).toMatchObject({ totalReviews: 1, averageRating: 2 })
  })

  it('lista filtrando por setor', async () => {
    const admin = await criarUsuario('ADMIN', 'lista@empresa.com')
    const headers = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    await app.inject({ method: 'POST', url: '/admin/glass/reviews', headers, payload: REVISADO })
    await app.inject({
      method: 'POST',
      url: '/admin/glass/reviews',
      headers,
      payload: { ...REVISADO, sector: 'Vendas' },
    })

    const res = await app.inject({ method: 'GET', url: '/admin/glass/reviews?sector=Vendas', headers })
    expect(res.json().reviews).toHaveLength(1)
    expect(res.json().reviews[0].sector).toBe('Vendas')
    expect(res.json().total).toBe(1)
  })

  it('devolve o total do filtro mesmo com a lista cortada pelo limit', async () => {
    const admin = await criarUsuario('ADMIN', 'total@empresa.com')
    const headers = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    for (let i = 0; i < 3; i += 1) {
      await app.inject({ method: 'POST', url: '/admin/glass/reviews', headers, payload: REVISADO })
    }

    const res = await app.inject({ method: 'GET', url: '/admin/glass/reviews?limit=1', headers })
    expect(res.json().reviews).toHaveLength(1)
    expect(res.json().total).toBe(3)
  })

  it('recusa nota fora do passo de meia estrela', async () => {
    const admin = await criarUsuario('ADMIN', 'nota@empresa.com')
    const headers = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    // A coluna é Decimal(2,1): aceitar 4.27 gravaria 4.3 sem ninguém notar.
    const recusado = await app.inject({
      method: 'POST',
      url: '/admin/glass/reviews',
      headers,
      payload: { ...REVISADO, rating: 4.27 },
    })
    expect(recusado.statusCode).toBe(400)

    const aceito = await app.inject({
      method: 'POST',
      url: '/admin/glass/reviews',
      headers,
      payload: { ...REVISADO, rating: 4.5 },
    })
    expect(aceito.statusCode).toBe(201)
    expect(aceito.json().review.rating).toBe(4.5)
  })

  it('avaliação sem sentimento sai como null, não como NEUTRO', async () => {
    // Import parcial de histórico grava linha sem sentimento; o overview só
    // conta os não-nulos, então o DTO não pode dizer NEUTRO — as duas leituras
    // contariam histórias diferentes sobre a mesma linha.
    const admin = await criarUsuario('ADMIN', 'sem-sentimento@empresa.com')
    const headers = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    await prisma.glassReview.create({
      data: {
        companyId: admin.companyId,
        sector: 'Atendimento',
        rating: 3,
        themesPositive: [],
        themesNegative: [],
        alerts: [],
      },
    })

    const res = await app.inject({ method: 'GET', url: '/admin/glass/reviews', headers })
    expect(res.json().reviews[0].sentiment).toBeNull()
  })

  it('não devolve avaliação de outra empresa', async () => {
    const outra = await prisma.company.create({ data: { id: 'outra-glass', name: 'Outra', slug: 'outra-glass' } })
    await prisma.glassReview.create({
      data: { companyId: outra.id, sector: 'Vendas', rating: 1, themesPositive: [], themesNegative: [], alerts: [] },
    })

    const admin = await criarUsuario('ADMIN', 'escopo@empresa.com')
    const headers = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    expect((await app.inject({ method: 'GET', url: '/admin/glass/reviews', headers })).json().reviews).toHaveLength(0)
    expect((await app.inject({ method: 'GET', url: '/admin/glass/overview', headers })).json().overview.totalReviews).toBe(0)
  })

  it('parse devolve o rascunho sem gravar', async () => {
    const admin = await criarUsuario('ADMIN', 'parse@empresa.com')
    const headers = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    await updateAiSettings({
      companyId: admin.companyId,
      actorId: admin.id,
      body: { apiKey: 'chave-de-teste' },
    })
    completion.mockResolvedValue(JSON.stringify(REVISADO))

    const res = await app.inject({
      method: 'POST',
      url: '/admin/glass/reviews/parse',
      headers,
      payload: { raw: 'texto colado da avaliação' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().draft.sector).toBe('Atendimento')
    expect(res.json().missingFields).toEqual([])
    expect(await prisma.glassReview.count()).toBe(0)
  })

  it('parse recusa texto vazio antes de chamar a IA', async () => {
    const admin = await criarUsuario('ADMIN', 'vazio@empresa.com')
    const res = await app.inject({
      method: 'POST',
      url: '/admin/glass/reviews/parse',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: { raw: '   ' },
    })
    expect(res.statusCode).toBe(400)
  })
})
