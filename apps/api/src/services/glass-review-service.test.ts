import { describe, expect, it, vi } from 'vitest'
import { AgentError } from '../lib/agent-error'
import { prisma } from '../lib/prisma'
import { updateAiSettings } from './ai-settings-service'
import {
  createGlassReview,
  listGlassReviews,
  listGlassReviewsPage,
  parseGlassReview,
} from './glass-review-service'

const EXTRACAO = {
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
  negatives: 'Jornada puxada e esgotamento',
  advice: 'Ouçam a base',
  sentiment: 'NEGATIVO',
  themesPositive: ['AMBIENTE_EQUIPE'],
  themesNegative: ['SOBRECARGA'],
  aiSummary: 'Time bom, jornada pesada.',
}

async function cenario(companyId = 'empresa-glass') {
  const company = await prisma.company.create({
    data: { id: companyId, name: 'Empresa', slug: companyId },
  })
  const user = await prisma.user.create({
    data: { name: 'Gestora', email: `g-${companyId}@empresa.com`, passwordHash: 'x', role: 'ADMIN', companyId: company.id },
  })
  // O agente exige chave da empresa — sem ela o parse responde 503. Semeada
  // pelo service real, que cifra de verdade: um valor cifrado falso estoura em
  // `decryptSecret`.
  await updateAiSettings({ companyId: company.id, actorId: user.id, body: { apiKey: 'chave-de-teste' } })
  return { company, actor: { id: user.id, companyId: company.id } }
}

const completeCom = (payload: unknown) =>
  vi.fn().mockResolvedValue(typeof payload === 'string' ? payload : JSON.stringify(payload))

describe('parseGlassReview', () => {
  it('devolve o rascunho sem gravar nada', async () => {
    const { actor } = await cenario()

    const resposta = await parseGlassReview(actor, 'texto colado', { complete: completeCom(EXTRACAO) })

    expect(resposta.draft.sector).toBe('Atendimento')
    expect(resposta.missingFields).toEqual([])
    expect(await prisma.glassReview.count()).toBe(0)
  })

  it('aponta os campos que faltam em vez de gravar incompleto', async () => {
    const { actor } = await cenario()

    const resposta = await parseGlassReview(actor, 'texto', {
      complete: completeCom({ ...EXTRACAO, sector: null, role: null, tenure: null }),
    })

    expect(resposta.missingFields.sort()).toEqual(['role', 'sector', 'tenure'])
    expect(await prisma.glassReview.count()).toBe(0)
  })

  it('extração fora do schema não grava nada', async () => {
    const { actor } = await cenario()

    await expect(
      parseGlassReview(actor, 'texto', { complete: completeCom({ ...EXTRACAO, themesNegative: ['CAFE_RUIM'] }) }),
    ).rejects.toBeInstanceOf(AgentError)
    expect(await prisma.glassReview.count()).toBe(0)
  })

  it('sem chave da empresa responde 503 e não grava', async () => {
    const company = await prisma.company.create({ data: { id: 'sem-chave', name: 'X', slug: 'sem-chave' } })
    const user = await prisma.user.create({
      data: { name: 'A', email: 'a@sem-chave.com', passwordHash: 'x', role: 'ADMIN', companyId: company.id },
    })

    const erro = await parseGlassReview({ id: user.id, companyId: company.id }, 'texto', {
      complete: completeCom(EXTRACAO),
    }).catch((e) => e)

    expect(erro).toBeInstanceOf(AgentError)
    expect(erro.status).toBe(503)
    expect(await prisma.glassReview.count()).toBe(0)
  })
})

describe('createGlassReview', () => {
  const revisado = {
    ...EXTRACAO,
    sector: 'Atendimento',
    role: 'Analista de Suporte',
    tenure: 'DE_1_A_3_ANOS',
  } as never

  it('grava calculando os alertas por avaliação', async () => {
    const { actor } = await cenario()

    const criada = await createGlassReview(actor, revisado)

    // nota 2 + ATIVO, e "esgotamento" no texto dos contras
    expect(criada.alerts.sort()).toEqual(['NOTA_BAIXA_ATIVO', 'PALAVRA_CRITICA_BURNOUT'])
    expect(Number(criada.rating)).toBe(2)
    expect(criada.companyId).toBe(actor.companyId)
  })

  it('não confia em alerta vindo do cliente', async () => {
    const { actor } = await cenario()
    const criada = await createGlassReview(actor, { ...(revisado as object), alerts: ['SETOR_CRITICO'] } as never)
    expect(criada.alerts).not.toContain('SETOR_CRITICO')
  })

  it('registra auditoria da gravação', async () => {
    const { actor } = await cenario()
    const criada = await createGlassReview(actor, revisado)

    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'GlassReview', entityId: criada.id } })
    expect(log).toMatchObject({ action: 'CREATE', actorId: actor.id, companyId: actor.companyId })
  })

  it('guarda a data como data, sem hora', async () => {
    const { actor } = await cenario()
    const criada = await createGlassReview(actor, revisado)
    expect(criada.reviewDate?.toISOString()).toBe('2026-03-12T00:00:00.000Z')
  })
})

describe('listGlassReviews', () => {
  it('não devolve avaliação de outra empresa', async () => {
    const a = await cenario('empresa-1')
    const b = await cenario('empresa-2')
    await createGlassReview(a.actor, { ...EXTRACAO, sector: 'Suporte' } as never)
    await createGlassReview(b.actor, { ...EXTRACAO, sector: 'Vendas' } as never)

    const lista = await listGlassReviews(a.actor, {})
    expect(lista).toHaveLength(1)
    expect(lista[0].sector).toBe('Suporte')
  })

  it('filtra por setor e por alerta', async () => {
    const { actor } = await cenario()
    await createGlassReview(actor, { ...EXTRACAO, sector: 'Suporte', rating: 5, status: 'EX_FUNCIONARIO', negatives: 'nada' } as never)
    await createGlassReview(actor, { ...EXTRACAO, sector: 'Vendas' } as never)

    expect(await listGlassReviews(actor, { sector: 'Vendas' })).toHaveLength(1)
    expect(await listGlassReviews(actor, { withAlerts: true })).toHaveLength(1)
  })

  it('ordena da mais recente para a mais antiga', async () => {
    const { actor } = await cenario()
    await createGlassReview(actor, { ...EXTRACAO, reviewDate: '2026-01-10' } as never)
    await createGlassReview(actor, { ...EXTRACAO, reviewDate: '2026-05-10' } as never)

    const lista = await listGlassReviews(actor, {})
    expect(lista[0].reviewDate?.toISOString().slice(0, 10)).toBe('2026-05-10')
  })
})

describe('listGlassReviewsPage', () => {
  it('conta o filtro inteiro, não a página cortada pelo limit', async () => {
    const { actor } = await cenario()
    for (let i = 0; i < 5; i += 1) {
      await createGlassReview(actor, { ...EXTRACAO, sector: 'Suporte' } as never)
    }

    const pagina = await listGlassReviewsPage(actor, { limit: 2 })
    expect(pagina.reviews).toHaveLength(2)
    // O painel de alertas mostra este número no cabeçalho: "(2)" com 5
    // alertando seria um painel de risco mentindo para menos.
    expect(pagina.total).toBe(5)
  })

  it('conta com o mesmo filtro da lista', async () => {
    const { actor } = await cenario()
    await createGlassReview(actor, { ...EXTRACAO, sector: 'Suporte' } as never)
    await createGlassReview(actor, { ...EXTRACAO, sector: 'Vendas' } as never)

    expect((await listGlassReviewsPage(actor, { sector: 'Vendas' })).total).toBe(1)
  })

  it('não conta avaliação de outra empresa', async () => {
    const a = await cenario('empresa-total-1')
    const b = await cenario('empresa-total-2')
    await createGlassReview(a.actor, EXTRACAO as never)
    await createGlassReview(b.actor, EXTRACAO as never)

    expect((await listGlassReviewsPage(a.actor, {})).total).toBe(1)
  })
})
