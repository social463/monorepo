import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  getAccessHeatmap,
  getEngagementOverview,
  getInovaOverview,
  getPeopleOverview,
  normalizeAccessPath,
  recordAccess,
  resolveWindow,
} from './people-analytics-service'

// Relógio fixo: 2026-06-25 às 16:00 em São Paulo. Toda a semeadura abaixo é
// posicionada em relação a este instante, e nunca ao relógio da máquina.
const NOW = new Date('2026-06-25T19:00:00.000Z')

/** Instante UTC das 12:00 (horário de São Paulo) do dia civil informado. */
function noonAt(ymd: string) {
  return new Date(`${ymd}T15:00:00.000Z`)
}

async function mkSector(id: string, name: string, companyId = DEFAULT_COMPANY_ID) {
  return prisma.sector.create({ data: { id, name, slug: id, companyId } })
}

async function mkCompany(id: string) {
  return prisma.company.create({ data: { id, name: id, slug: id } })
}

async function mkUser(
  name: string,
  overrides: Partial<{ role: string; sectorId: string; companyId: string; squad: string | null; active: boolean }> = {},
) {
  return prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase().replace(/\s/g, '-')}-${Math.round(performance.now() * 1000)}@x.com`,
      passwordHash: 'x',
      role: (overrides.role ?? 'LEGEND') as 'LEGEND',
      sectorId: overrides.sectorId ?? DEFAULT_SECTOR_ID,
      companyId: overrides.companyId ?? DEFAULT_COMPANY_ID,
      squad: overrides.squad ?? null,
      active: overrides.active ?? true,
    },
  })
}

async function mkAccess(userId: string, path: string, at: Date, companyId = DEFAULT_COMPANY_ID) {
  return prisma.accessLog.create({ data: { userId, path, companyId, createdAt: at } })
}

const scope = { companyId: DEFAULT_COMPANY_ID, sectorId: null, window: { range: '30d' } as const, now: NOW }

describe('normalizeAccessPath', () => {
  it('descarta query string e hash', () => {
    expect(normalizeAccessPath('/mural?filtro=todos#topo')).toBe('/mural')
  })

  it('troca segmentos que são identificador por :id', () => {
    expect(normalizeAccessPath('/perfil/ckv1234567890abcdefghij')).toBe('/perfil/:id')
    expect(normalizeAccessPath('/retrospectivas/42')).toBe('/retrospectivas/:id')
    expect(normalizeAccessPath('/mapas/3fa85f64-5717-4562-b3fc-2c963f66afa6/editar')).toBe('/mapas/:id/editar')
  })

  it('normaliza a raiz e barras sobrando', () => {
    expect(normalizeAccessPath('/')).toBe('/')
    expect(normalizeAccessPath('/Mural//')).toBe('/mural')
  })

  it('rejeita path que não é caminho de navegação', () => {
    expect(normalizeAccessPath('')).toBeNull()
    expect(normalizeAccessPath('https://evil.com/x')).toBeNull()
  })
})

describe('recordAccess', () => {
  it('grava o path normalizado com o companyId do escopo', async () => {
    const user = await mkUser('Ana')
    await recordAccess({ userId: user.id, companyId: DEFAULT_COMPANY_ID, path: '/perfil/ckv1234567890abcdefghij?tab=selos' })

    const logs = await prisma.accessLog.findMany()
    expect(logs).toHaveLength(1)
    expect(logs[0].path).toBe('/perfil/:id')
    expect(logs[0].companyId).toBe(DEFAULT_COMPANY_ID)
    expect(logs[0].userId).toBe(user.id)
  })

  it('ignora path inutilizável em vez de gravar lixo', async () => {
    const user = await mkUser('Bia')
    await recordAccess({ userId: user.id, companyId: DEFAULT_COMPANY_ID, path: 'javascript:void(0)' })
    expect(await prisma.accessLog.count()).toBe(0)
  })
})

describe('getPeopleOverview', () => {
  it('conta pessoas ativas e únicos de 7/30 dias, com taxa de adesão', async () => {
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    const carla = await mkUser('Carla')
    await mkUser('Desligado', { active: false })

    await mkAccess(ana.id, '/', noonAt('2026-06-24')) // dentro de 7d
    await mkAccess(ana.id, '/mural', noonAt('2026-06-24')) // mesmo usuário, 2 acessos
    await mkAccess(bruno.id, '/', noonAt('2026-06-10')) // dentro de 30d, fora de 7d
    await mkAccess(carla.id, '/', noonAt('2026-04-01')) // fora da janela

    const overview = await getPeopleOverview(scope)

    expect(overview.activePeople).toBe(3)
    // Os cards agora seguem a JANELA: 30 dias pegam Ana e Bruno, não Carla.
    expect(overview.uniqueUsersInRange).toBe(2)
    expect(overview.accessesInRange).toBe(3)
    // 2 de 3 pessoas ativas acessaram na janela.
    expect(overview.adoptionRate).toBe(67)
  })

  it('devolve a série diária completa, com dias sem acesso zerados', async () => {
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    await mkAccess(ana.id, '/', noonAt('2026-06-24'))
    await mkAccess(ana.id, '/mural', noonAt('2026-06-24'))
    await mkAccess(bruno.id, '/', noonAt('2026-06-24'))

    const overview = await getPeopleOverview({ ...scope, window: { range: '7d' } })

    expect(overview.accessSeries).toHaveLength(7)
    expect(overview.accessSeries.at(0)?.day).toBe('2026-06-19')
    expect(overview.accessSeries.at(-1)?.day).toBe('2026-06-25')

    const dia24 = overview.accessSeries.find((p) => p.day === '2026-06-24')!
    expect(dia24).toEqual({ day: '2026-06-24', accesses: 3, uniqueUsers: 2 })
    // Hoje ninguém acessou: entra zerado, não some da série.
    expect(overview.accessSeries.find((p) => p.day === '2026-06-25')).toEqual({
      day: '2026-06-25',
      accesses: 0,
      uniqueUsers: 0,
    })
  })

  it('agrupa o acesso pelo dia civil de São Paulo, não pelo dia UTC', async () => {
    const ana = await mkUser('Ana')
    // 02:00Z do dia 25 ainda é 23:00 do dia 24 em São Paulo.
    await mkAccess(ana.id, '/', new Date('2026-06-25T02:00:00.000Z'))

    const overview = await getPeopleOverview({ ...scope, window: { range: '7d' } })
    expect(overview.accessSeries.find((p) => p.day === '2026-06-24')?.accesses).toBe(1)
    expect(overview.accessSeries.find((p) => p.day === '2026-06-25')?.accesses).toBe(0)
  })

  it('conta feedbacks e reações apenas dentro da janela', async () => {
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    const dentro = await prisma.feedback.create({
      data: { authorId: ana.id, targetId: bruno.id, message: 'boa!', category: 'ELOGIO', createdAt: noonAt('2026-06-20') },
    })
    await prisma.feedback.create({
      data: { authorId: ana.id, targetId: bruno.id, message: 'antigo', category: 'ELOGIO', createdAt: noonAt('2026-01-10') },
    })
    await prisma.feedbackReaction.create({
      data: { feedbackId: dentro.id, userId: bruno.id, emoji: '🔥', createdAt: noonAt('2026-06-21') },
    })

    const overview = await getPeopleOverview(scope)
    expect(overview.feedbacksCount).toBe(1)
    expect(overview.feedbackReactionsCount).toBe(1)
  })

  it('distribui por papel e por squad (sem squad vira "Sem squad")', async () => {
    await mkUser('Ana', { squad: 'Alpha' })
    await mkUser('Bruno', { squad: 'Alpha' })
    await mkUser('Carla', { role: 'LEAD' })

    const overview = await getPeopleOverview(scope)

    expect(overview.byRole).toEqual([
      { key: 'LEGEND', label: 'Lenda', count: 2 },
      { key: 'LEAD', label: 'Líder', count: 1 },
    ])
    expect(overview.bySquad).toEqual([
      { key: 'Alpha', label: 'Alpha', count: 2 },
      { key: '', label: 'Sem squad', count: 1 },
    ])
  })

  it('recorta tudo pelo setor quando sectorId é informado', async () => {
    const outro = await mkSector('sector-gente', 'Gente e Gestão')
    const daGente = await mkUser('Gina', { sectorId: outro.id, squad: 'RH' })
    const doDev = await mkUser('Dev', { squad: 'Alpha' })
    await mkAccess(daGente.id, '/', noonAt('2026-06-24'))
    await mkAccess(doDev.id, '/', noonAt('2026-06-24'))

    const overview = await getPeopleOverview({ ...scope, sectorId: outro.id })

    expect(overview.sectorId).toBe(outro.id)
    expect(overview.activePeople).toBe(1)
    expect(overview.uniqueUsersInRange).toBe(1)
    expect(overview.bySquad).toEqual([{ key: 'RH', label: 'RH', count: 1 }])
  })

  it('nunca mistura dados de outra empresa', async () => {
    const outraEmpresa = await mkCompany('company-outra')
    const outroSetor = await mkSector('sector-outro', 'Outro', outraEmpresa.id)
    const forasteiro = await mkUser('Forasteiro', { companyId: outraEmpresa.id, sectorId: outroSetor.id })
    const nosso = await mkUser('Nosso')
    await mkAccess(forasteiro.id, '/', noonAt('2026-06-24'), outraEmpresa.id)
    await mkAccess(nosso.id, '/', noonAt('2026-06-24'))

    const overview = await getPeopleOverview(scope)
    expect(overview.activePeople).toBe(1)
    expect(overview.uniqueUsersInRange).toBe(1)

    const outro = await getPeopleOverview({ ...scope, companyId: outraEmpresa.id })
    expect(outro.activePeople).toBe(1)
    expect(outro.uniqueUsersInRange).toBe(1)
  })

  it('monta o mapa de calor por dia da semana e hora civil de São Paulo', async () => {
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    // 2026-06-22 é segunda (DOW 1); 2026-06-24, quarta (DOW 3).
    await mkAccess(ana.id, '/', new Date('2026-06-22T12:00:00.000Z')) // seg, 09h SP
    await mkAccess(ana.id, '/', new Date('2026-06-24T15:00:00.000Z')) // qua, 12h SP
    await mkAccess(bruno.id, '/', new Date('2026-06-24T15:30:00.000Z')) // qua, 12h SP
    await mkAccess(ana.id, '/', new Date('2026-06-24T18:00:00.000Z')) // qua, 15h SP
    // 02:00Z do dia 25 ainda é 23:00 do dia 24 em São Paulo: continua QUARTA
    // (DOW 3), não quinta. É o caso que pega conversão de fuso trocada.
    await mkAccess(ana.id, '/', new Date('2026-06-25T02:00:00.000Z'))

    const { cells } = await getAccessHeatmap({ ...scope, window: { range: '7d' } })

    expect(cells).toEqual([
      { weekday: 1, hour: 9, accesses: 1 },
      { weekday: 3, hour: 12, accesses: 2 },
      { weekday: 3, hour: 15, accesses: 1 },
      { weekday: 3, hour: 23, accesses: 1 },
    ])
  })

  it('mapa de calor devolve vazio (não a grade zerada) sem acessos', async () => {
    await mkUser('Ana')
    expect((await getAccessHeatmap(scope)).cells).toEqual([])
  })

  it('não quebra nem devolve NaN com base vazia', async () => {
    const overview = await getPeopleOverview(scope)
    expect(overview.activePeople).toBe(0)
    expect(overview.adoptionRate).toBe(0)
    expect(overview.uniqueUsersInRange).toBe(0)
    expect(overview.byRole).toEqual([])
    expect(overview.accessSeries.every((p) => p.accesses === 0)).toBe(true)
  })
})

describe('getEngagementOverview', () => {
  it('resume o clima do período: participantes, média e distribuição', async () => {
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    await prisma.moodEntry.createMany({
      data: [
        { userId: ana.id, day: new Date('2026-06-20T00:00:00.000Z'), mood: 'GREAT' }, // 5
        { userId: ana.id, day: new Date('2026-06-21T00:00:00.000Z'), mood: 'GOOD' }, // 4
        { userId: bruno.id, day: new Date('2026-06-21T00:00:00.000Z'), mood: 'NEUTRAL' }, // 3
        { userId: bruno.id, day: new Date('2026-01-05T00:00:00.000Z'), mood: 'HARD' }, // fora da janela
      ],
    })

    const { mood } = await getEngagementOverview(scope)

    expect(mood.entries).toBe(3)
    expect(mood.participants).toBe(2)
    expect(mood.average).toBe(4)
    expect(mood.distribution).toEqual([
      { key: 'HARD', label: 'Estressado(a)', count: 0 },
      { key: 'LOW', label: 'Desanimado(a)', count: 0 },
      { key: 'NEUTRAL', label: 'Neutro(a)', count: 1 },
      { key: 'GOOD', label: 'Bem', count: 1 },
      { key: 'GREAT', label: 'Excelente', count: 1 },
    ])
  })

  it('clima com base vazia devolve média null, não NaN', async () => {
    const { mood } = await getEngagementOverview(scope)
    expect(mood.entries).toBe(0)
    expect(mood.average).toBeNull()
    expect(mood.distribution.every((slice) => slice.count === 0)).toBe(true)
    // A tendência tem um ponto por dia da janela, todos sem média.
    expect(mood.trend).toHaveLength(30)
    expect(mood.trend.every((point) => point.average === null && point.entries === 0)).toBe(true)
  })

  it('tendência do clima traz média ponderada por dia e null onde ninguém registrou', async () => {
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    await prisma.moodEntry.createMany({
      data: [
        { userId: ana.id, day: new Date('2026-06-23T00:00:00.000Z'), mood: 'GREAT' }, // 5
        { userId: bruno.id, day: new Date('2026-06-23T00:00:00.000Z'), mood: 'GOOD' }, // 4
        { userId: ana.id, day: new Date('2026-06-25T00:00:00.000Z'), mood: 'LOW' }, // 2
      ],
    })

    const { mood } = await getEngagementOverview({ ...scope, window: { range: '7d' } })

    expect(mood.trend).toHaveLength(7)
    expect(mood.trend.find((p) => p.day === '2026-06-23')).toEqual({
      day: '2026-06-23',
      average: 4.5,
      entries: 2,
    })
    // 24 não teve registro: média null (a linha interrompe), não zero.
    expect(mood.trend.find((p) => p.day === '2026-06-24')).toEqual({
      day: '2026-06-24',
      average: null,
      entries: 0,
    })
    expect(mood.trend.find((p) => p.day === '2026-06-25')?.average).toBe(2)
  })

  it('mede alcance do Mural por post e visitantes únicos da tela', async () => {
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    const post = await prisma.corporatePost.create({
      data: { authorId: ana.id, content: 'Comunicado importante', createdAt: noonAt('2026-06-20') },
    })
    await prisma.corporatePostComment.create({
      data: { postId: post.id, authorId: bruno.id, content: 'top', createdAt: noonAt('2026-06-20') },
    })
    await prisma.corporatePostReaction.createMany({
      data: [
        { postId: post.id, userId: bruno.id, emoji: '🔥' }, // já contou como engajado
        { postId: post.id, userId: ana.id, emoji: '👏' },
      ],
    })
    await mkAccess(ana.id, '/mural', noonAt('2026-06-22'))
    await mkAccess(ana.id, '/mural', noonAt('2026-06-23'))
    await mkAccess(bruno.id, '/mural', noonAt('2026-06-23'))
    await mkAccess(bruno.id, '/', noonAt('2026-06-23')) // outra tela, não conta

    const { muralReach } = await getEngagementOverview(scope)

    expect(muralReach.postCount).toBe(1)
    expect(muralReach.uniqueViewers).toBe(2)
    expect(muralReach.posts).toHaveLength(1)
    expect(muralReach.posts[0]).toMatchObject({
      postId: post.id,
      authorName: 'Ana',
      excerpt: 'Comunicado importante',
      comments: 1,
      reactions: 2,
      engagedUsers: 2,
    })
  })

  it('ranqueia as telas mais acessadas, com rótulo em português', async () => {
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    await mkAccess(ana.id, '/mural', noonAt('2026-06-22'))
    await mkAccess(bruno.id, '/mural', noonAt('2026-06-22'))
    await mkAccess(bruno.id, '/mural', noonAt('2026-06-23'))
    await mkAccess(ana.id, '/perfil/:id', noonAt('2026-06-23'))

    const { topScreens } = await getEngagementOverview(scope)

    expect(topScreens).toEqual([
      { path: '/mural', label: 'Feed Corporativo', accesses: 3, uniqueUsers: 2 },
      { path: '/perfil/:id', label: 'Perfil de colega', accesses: 1, uniqueUsers: 1 },
    ])
  })

  it('recorta telas e clima pelo setor informado', async () => {
    const gente = await mkSector('sector-gente', 'Gente e Gestão')
    const gina = await mkUser('Gina', { sectorId: gente.id })
    const dev = await mkUser('Dev')
    await mkAccess(gina.id, '/mural', noonAt('2026-06-22'))
    await mkAccess(dev.id, '/mural', noonAt('2026-06-22'))
    await prisma.moodEntry.createMany({
      data: [
        { userId: gina.id, day: new Date('2026-06-22T00:00:00.000Z'), mood: 'GREAT' },
        { userId: dev.id, day: new Date('2026-06-22T00:00:00.000Z'), mood: 'HARD' },
      ],
    })

    const engagement = await getEngagementOverview({ ...scope, sectorId: gente.id })

    expect(engagement.mood.entries).toBe(1)
    expect(engagement.mood.average).toBe(5)
    expect(engagement.topScreens).toEqual([
      { path: '/mural', label: 'Feed Corporativo', accesses: 1, uniqueUsers: 1 },
    ])
    expect(engagement.muralReach.uniqueViewers).toBe(1)
  })
})

describe('getInovaOverview — acessos ao Guia AI First (Comunidade INOVA)', () => {
  it('conta acessos e únicos só das páginas do Guia, ignorando o resto do produto', async () => {
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    await mkAccess(ana.id, '/comunidade-inova/guia', noonAt('2026-06-22'))
    await mkAccess(bruno.id, '/comunidade-inova/guia', noonAt('2026-06-22'))
    await mkAccess(bruno.id, '/comunidade-inova/guia/prompts', noonAt('2026-06-23'))
    // Fora do Guia: hub da Comunidade INOVA e mural — não deve contar aqui.
    await mkAccess(ana.id, '/comunidade-inova/projetos', noonAt('2026-06-23'))
    await mkAccess(ana.id, '/mural', noonAt('2026-06-23'))

    const inova = await getInovaOverview(scope)

    expect(inova.totalAccesses).toBe(3)
    expect(inova.uniqueUsers).toBe(2)
    expect(inova.topPage).toEqual({
      path: '/comunidade-inova/guia',
      label: 'Guia: Início',
      accesses: 2,
      uniqueUsers: 2,
    })
    expect(inova.byPage).toEqual([
      { path: '/comunidade-inova/guia', label: 'Guia: Início', accesses: 2, uniqueUsers: 2 },
      { path: '/comunidade-inova/guia/prompts', label: 'Guia: Prompts', accesses: 1, uniqueUsers: 1 },
    ])
  })

  it('lista o log recente com quem acessou, mais recente primeiro', async () => {
    const ana = await mkUser('Ana')
    await mkAccess(ana.id, '/comunidade-inova/guia/situacoes', noonAt('2026-06-22'))
    await mkAccess(ana.id, '/comunidade-inova/guia/maturidade', noonAt('2026-06-23'))

    const inova = await getInovaOverview(scope)

    expect(inova.recentLogsTotal).toBe(2)
    expect(inova.recentLogs).toHaveLength(2)
    expect(inova.recentLogs[0]).toMatchObject({
      userName: 'Ana',
      path: '/comunidade-inova/guia/maturidade',
      label: 'Guia: Maturidade',
    })
    expect(inova.recentLogs[1]).toMatchObject({
      userName: 'Ana',
      path: '/comunidade-inova/guia/situacoes',
      label: 'Guia: Situações',
    })
    expect(inova.recentLogs[0].userEmail).toBe(ana.email)
  })

  it('recorta pelo setor informado, como as demais abas', async () => {
    const gente = await mkSector('sector-gente', 'Gente e Gestão')
    const gina = await mkUser('Gina', { sectorId: gente.id })
    const dev = await mkUser('Dev')
    await mkAccess(gina.id, '/comunidade-inova/guia', noonAt('2026-06-22'))
    await mkAccess(dev.id, '/comunidade-inova/guia', noonAt('2026-06-22'))

    const inova = await getInovaOverview({ ...scope, sectorId: gente.id })

    expect(inova.totalAccesses).toBe(1)
    expect(inova.uniqueUsers).toBe(1)
    expect(inova.recentLogs.map((row) => row.userName)).toEqual(['Gina'])
  })

  it('sem nenhum acesso no recorte, devolve zeros e topPage nulo', async () => {
    const inova = await getInovaOverview(scope)

    expect(inova.totalAccesses).toBe(0)
    expect(inova.uniqueUsers).toBe(0)
    expect(inova.topPage).toBeNull()
    expect(inova.byPage).toEqual([])
    expect(inova.recentLogs).toEqual([])
    expect(inova.recentLogsTotal).toBe(0)
  })
})

describe('getAccessHeatmap — tempo médio derivado (Documento 3, seção 4.2)', () => {
  it('agrupa acessos consecutivos em sessão e mede do primeiro ao último', async () => {
    const ana = await mkUser('Ana')
    // Uma sessão de 20 minutos: os saltos são de 10 min, abaixo do corte de 30.
    await mkAccess(ana.id, '/', new Date('2026-06-24T12:00:00.000Z'))
    await mkAccess(ana.id, '/mural', new Date('2026-06-24T12:10:00.000Z'))
    await mkAccess(ana.id, '/perfil', new Date('2026-06-24T12:20:00.000Z'))

    const heatmap = await getAccessHeatmap({ ...scope, window: { range: '7d' } })

    expect(heatmap.sessions).toBe(1)
    expect(heatmap.avgSessionMinutes).toBe(20)
  })

  it('intervalo maior que 30 minutos abre sessão nova', async () => {
    const ana = await mkUser('Ana')
    await mkAccess(ana.id, '/', new Date('2026-06-24T12:00:00.000Z'))
    await mkAccess(ana.id, '/mural', new Date('2026-06-24T12:10:00.000Z'))
    // 45 min depois: sessão nova, de 10 minutos.
    await mkAccess(ana.id, '/', new Date('2026-06-24T12:55:00.000Z'))
    await mkAccess(ana.id, '/perfil', new Date('2026-06-24T13:05:00.000Z'))

    const heatmap = await getAccessHeatmap({ ...scope, window: { range: '7d' } })

    expect(heatmap.sessions).toBe(2)
    expect(heatmap.avgSessionMinutes).toBe(10)
  })

  it('sessões de pessoas diferentes nunca se fundem', async () => {
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    await mkAccess(ana.id, '/', new Date('2026-06-24T12:00:00.000Z'))
    await mkAccess(bruno.id, '/', new Date('2026-06-24T12:05:00.000Z'))
    await mkAccess(ana.id, '/mural', new Date('2026-06-24T12:10:00.000Z'))

    const heatmap = await getAccessHeatmap({ ...scope, window: { range: '7d' } })

    expect(heatmap.sessions).toBe(2)
  })

  it('acesso único vale zero — é o piso conhecido da estimativa', async () => {
    const ana = await mkUser('Ana')
    await mkAccess(ana.id, '/', new Date('2026-06-24T12:00:00.000Z'))

    const heatmap = await getAccessHeatmap({ ...scope, window: { range: '7d' } })

    expect(heatmap.sessions).toBe(1)
    expect(heatmap.avgSessionMinutes).toBe(0)
  })

  it('sem acesso nenhum devolve null, e não zero', async () => {
    await mkUser('Ana')
    const heatmap = await getAccessHeatmap(scope)
    // Null diz "não há o que medir"; zero diria "as pessoas ficam 0 minuto".
    expect(heatmap.avgSessionMinutes).toBeNull()
    expect(heatmap.sessions).toBe(0)
  })
})

describe('resolveWindow — janela personalizável (Documento 3, seção 4.1)', () => {
  const now = new Date('2026-06-25T12:00:00.000Z')

  it('atalho "hoje" é um dia só, e "ano" vai de 1º de janeiro até hoje', () => {
    expect(resolveWindow({ range: 'hoje' }, now).days).toEqual(['2026-06-25'])
    const ano = resolveWindow({ range: 'ano' }, now).days
    expect(ano[0]).toBe('2026-01-01')
    expect(ano.at(-1)).toBe('2026-06-25')
  })

  it('janela personalizada usa as duas pontas informadas, inclusivas', () => {
    const window = resolveWindow({ range: 'custom', from: '2026-06-20', to: '2026-06-22' }, now)
    expect(window.days).toEqual(['2026-06-20', '2026-06-21', '2026-06-22'])
  })

  it('recusa intervalo invertido e janela acima do teto', () => {
    expect(() => resolveWindow({ range: 'custom', from: '2026-06-22', to: '2026-06-20' }, now)).toThrow(
      /data inicial não pode ser depois/i,
    )
    // Sem teto, um `from` antigo montaria milhares de pontos de série.
    expect(() => resolveWindow({ range: 'custom', from: '2020-01-01', to: '2026-06-25' }, now)).toThrow(
      /no máximo 366 dias/i,
    )
  })

  it('custom sem as duas pontas é erro tratado, não janela silenciosa', () => {
    expect(() => resolveWindow({ range: 'custom', from: '2026-06-20' }, now)).toThrow(/data inicial e a final/i)
  })
})
