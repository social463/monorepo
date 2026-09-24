import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { computeBestSendTime, getCommunicationOverview } from './communication-analytics-service'

const NOW = new Date('2026-06-25T12:00:00.000Z')

const scope = {
  companyId: DEFAULT_COMPANY_ID,
  sectorId: null,
  window: { range: '30d' } as const,
  now: NOW,
}

let seq = 0
async function mkUser(name: string, sectorId = DEFAULT_SECTOR_ID) {
  seq += 1
  return prisma.user.create({
    data: { name, email: `${name}-${seq}@x.com`, passwordHash: 'x', sectorId },
  })
}

async function mkSector(name: string) {
  seq += 1
  return prisma.sector.create({
    data: { name, slug: `${name.toLowerCase()}-${seq}`, enabledFeatures: ['escritorio'] },
  })
}

/** Comunicado publicado, opcionalmente dirigido a setores. */
async function mkPost(
  authorId: string,
  opts: { at?: Date; content?: string; sectorIds?: string[] } = {},
) {
  return prisma.corporatePost.create({
    data: {
      authorId,
      content: opts.content ?? 'aviso',
      status: 'PUBLISHED',
      createdAt: opts.at ?? new Date('2026-06-20T15:00:00.000Z'),
      ...(opts.sectorIds?.length
        ? {
            audienceScope: 'SECTORS',
            sectors: { create: opts.sectorIds.map((sectorId) => ({ sectorId, companyId: DEFAULT_COMPANY_ID })) },
          }
        : {}),
    },
  })
}

async function mkRead(postId: string, userId: string, at = new Date('2026-06-20T16:00:00.000Z')) {
  return prisma.corporatePostRead.create({ data: { postId, userId, readAt: at } })
}

describe('getCommunicationOverview — taxa de leitura', () => {
  it('o denominador é o PÚBLICO DO POST, não a empresa inteira', async () => {
    const dados = await mkSector('Dados')
    const autor = await mkUser('Autor')
    const daDados = await mkUser('Gina', dados.id)
    await mkUser('Fora1')
    await mkUser('Fora2')
    // Post dirigido só a Dados: o público são as pessoas de Dados, não as 5.
    const post = await mkPost(autor.id, { sectorIds: [dados.id] })
    await mkRead(post.id, daDados.id)

    const overview = await getCommunicationOverview(scope)

    // 1 leitura de 1 pessoa elegível = 100%. Sobre a empresa toda seria 20%.
    expect(overview.averageReadPct).toBe(100)
    expect(overview.mostRead?.readPct).toBe(100)
  })

  it('média é das taxas dos comunicados, não da soma das leituras', async () => {
    const autor = await mkUser('Autor')
    const ana = await mkUser('Ana')
    await mkUser('Bruno')
    const lido = await mkPost(autor.id, { content: 'lido' })
    await mkPost(autor.id, { content: 'ignorado' })
    await mkRead(lido.id, ana.id)

    const overview = await getCommunicationOverview(scope)

    // Um post a 33.3% (1 de 3) e um a 0% → média 16.7, não 16.65 nem 33.3.
    expect(overview.postsPublished).toBe(2)
    expect(overview.averageReadPct).toBeCloseTo(16.7, 1)
  })

  it('sem comunicado no período, os KPIs são zero e o mais lido é null', async () => {
    await mkUser('Ana')
    const overview = await getCommunicationOverview(scope)
    expect(overview.postsPublished).toBe(0)
    expect(overview.averageReadPct).toBe(0)
    expect(overview.mostRead).toBeNull()
    expect(overview.bestSendTime).toBeNull()
  })
})

describe('getCommunicationOverview — alcance por setor', () => {
  it('conta PESSOAS distintas que leram, não leituras', async () => {
    const dados = await mkSector('Dados')
    const autor = await mkUser('Autor')
    const ana = await mkUser('Ana', dados.id)
    await mkUser('Bruno', dados.id)
    const p1 = await mkPost(autor.id, { content: 'um' })
    const p2 = await mkPost(autor.id, { content: 'dois' })
    // Ana lê os dois; Bruno, nenhum. O setor tem 2 pessoas.
    await mkRead(p1.id, ana.id)
    await mkRead(p2.id, ana.id)

    const overview = await getCommunicationOverview(scope)
    const setor = overview.bySector.find((s) => s.sectorId === dados.id)!

    // 1 de 2 pessoas = 50%. Contando leituras daria 100% (2 leituras / 2 pessoas).
    expect(setor.readers).toBe(1)
    expect(setor.people).toBe(2)
    expect(setor.reachPct).toBe(50)
  })
})

describe('getCommunicationOverview — filtros', () => {
  it('recorta por categoria de comunicado', async () => {
    const autor = await mkUser('Autor')
    const tag = await prisma.corporatePostTag.create({
      data: { name: 'Institucional', slug: 'institucional', companyId: DEFAULT_COMPANY_ID },
    })
    const comTag = await mkPost(autor.id, { content: 'institucional' })
    await prisma.corporatePost.update({ where: { id: comTag.id }, data: { tagId: tag.id } })
    await mkPost(autor.id, { content: 'sem categoria' })

    const todos = await getCommunicationOverview(scope)
    const filtrado = await getCommunicationOverview({ ...scope, tagId: tag.id })

    expect(todos.postsPublished).toBe(2)
    expect(filtrado.postsPublished).toBe(1)
    expect(filtrado.tagId).toBe(tag.id)
  })

  it('comunicado fora da janela não entra', async () => {
    const autor = await mkUser('Autor')
    await mkPost(autor.id, { at: new Date('2026-01-10T12:00:00.000Z'), content: 'antigo' })

    const overview = await getCommunicationOverview(scope)

    expect(overview.postsPublished).toBe(0)
  })
})

describe('getCommunicationOverview — pontos, não coins', () => {
  it('soma o XP creditado por interação no Feed', async () => {
    const ana = await mkUser('Ana')
    await prisma.xpTransaction.createMany({
      data: [
        {
          userId: ana.id,
          event: 'CORPORATE_POST_REACTION',
          amount: 5,
          dedupeKey: 'r1',
          day: new Date('2026-06-20'),
          createdAt: new Date('2026-06-20T12:00:00.000Z'),
        },
        {
          userId: ana.id,
          event: 'CORPORATE_POST_READ_FULL',
          amount: 3,
          dedupeKey: 'r2',
          day: new Date('2026-06-20'),
          createdAt: new Date('2026-06-20T12:00:00.000Z'),
        },
        // Evento de outro fluxo: não é comunicação, não entra no KPI.
        {
          userId: ana.id,
          event: 'VOTE_CAST',
          amount: 99,
          dedupeKey: 'r3',
          day: new Date('2026-06-20'),
          createdAt: new Date('2026-06-20T12:00:00.000Z'),
        },
      ],
    })

    const overview = await getCommunicationOverview(scope)

    expect(overview.pointsAwarded).toBe(8)
  })
})

describe('getCommunicationOverview — alerta de baixo alcance', () => {
  it('setor sem interação nenhuma entra no alerta', async () => {
    const parado = await mkSector('Parado')
    await mkUser('Sozinho', parado.id)

    const overview = await getCommunicationOverview(scope)

    const alerta = overview.lowReachSectors.find((s) => s.sectorId === parado.id)
    // `null` (nunca interagiu) é o caso mais grave, e precisa aparecer.
    expect(alerta?.daysSince).toBeNull()
  })

  it('setor que interagiu ontem fica fora do alerta', async () => {
    const ativo = await mkSector('Ativo')
    const autor = await mkUser('Autor')
    const gina = await mkUser('Gina', ativo.id)
    const post = await mkPost(autor.id)
    await mkRead(post.id, gina.id, new Date('2026-06-24T12:00:00.000Z'))

    const overview = await getCommunicationOverview(scope)

    expect(overview.lowReachSectors.map((s) => s.sectorId)).not.toContain(ativo.id)
  })
})

describe('computeBestSendTime', () => {
  const at = (iso: string) => new Date(iso)

  it('escolhe a combinação de maior taxa média entre as elegíveis', () => {
    const posts = [
      // Quarta 12h SP (15h UTC): três posts, média 60.
      { at: at('2026-06-03T15:00:00.000Z'), readPct: 50 },
      { at: at('2026-06-10T15:00:00.000Z'), readPct: 60 },
      { at: at('2026-06-17T15:00:00.000Z'), readPct: 70 },
      // Segunda 12h SP: três posts, média 20.
      { at: at('2026-06-01T15:00:00.000Z'), readPct: 20 },
      { at: at('2026-06-08T15:00:00.000Z'), readPct: 20 },
      { at: at('2026-06-15T15:00:00.000Z'), readPct: 20 },
    ]

    const melhor = computeBestSendTime(posts)

    expect(melhor).toEqual({ weekday: 3, hour: 12, readPct: 60, posts: 3 })
  })

  it('cala quando nenhuma combinação atinge o mínimo — não aponta vencedor de ruído', () => {
    const posts = [
      { at: at('2026-06-03T15:00:00.000Z'), readPct: 99 },
      { at: at('2026-06-10T15:00:00.000Z'), readPct: 98 },
    ]

    expect(computeBestSendTime(posts)).toBeNull()
  })

  it('o dia da semana é o de São Paulo, não o do UTC', () => {
    // 01:00Z de quinta é 22h de QUARTA em São Paulo.
    const posts = Array.from({ length: 3 }, (_, i) => ({
      at: at(`2026-06-${String(4 + i * 7).padStart(2, '0')}T01:00:00.000Z`),
      readPct: 40,
    }))

    const melhor = computeBestSendTime(posts)

    expect(melhor?.weekday).toBe(3)
    expect(melhor?.hour).toBe(22)
  })
})
