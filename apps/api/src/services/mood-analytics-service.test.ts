import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID, MOOD_ANONYMITY_MIN, type MoodLevel } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getMoodOverview, MoodOverviewError } from './mood-analytics-service'

// "Hoje" fixo em todos os testes: 31/07/2026 às 10h de São Paulo.
const NOW = new Date('2026-07-31T13:00:00.000Z')
const TODAY = '2026-07-31'

let seq = 0

async function mkUser(sectorId = DEFAULT_SECTOR_ID) {
  seq += 1
  return prisma.user.create({
    data: { name: `Pessoa ${seq}`, email: `clima-${seq}@x.com`, passwordHash: 'x', sectorId },
  })
}

async function mkSector(name: string) {
  seq += 1
  return prisma.sector.create({ data: { name, slug: `setor-clima-${seq}` } })
}

/** Cria um registro por humor da lista, cada um de uma pessoa diferente do setor. */
async function seedDay(ymd: string, moods: MoodLevel[], sectorId = DEFAULT_SECTOR_ID, note?: string) {
  for (const mood of moods) {
    const user = await mkUser(sectorId)
    await prisma.moodEntry.create({
      data: { userId: user.id, day: new Date(ymd), mood, note: note ?? null },
    })
  }
}

function overview(params: Partial<Parameters<typeof getMoodOverview>[0]> = {}) {
  return getMoodOverview({
    companyId: DEFAULT_COMPANY_ID,
    viewerRole: 'ADMIN',
    viewerSectorId: DEFAULT_SECTOR_ID,
    days: 30,
    now: NOW,
    ...params,
  })
}

describe('mood-analytics-service', () => {
  it('com o piso em 1, um registro só no dia aparece na série', async () => {
    // Era o caso que o piso de 3 escondia: a G&G via o dia vazio, e não a
    // pessoa que registrou. 30/07 tem UMA resposta e sai inteiro.
    await seedDay('2026-07-30', ['HARD'])
    await seedDay(TODAY, ['GOOD', 'GOOD', 'GOOD'])

    const result = await overview()

    const solitario = result.trend.find((p) => p.day === '2026-07-30')!
    expect(solitario.suppressed).toBe(false)
    expect(solitario.count).toBe(1)
    expect(solitario.average).toBe(1)

    const shown = result.trend.find((p) => p.day === TODAY)!
    expect(shown.suppressed).toBe(false)
    expect(shown.count).toBe(3)
    expect(shown.average).toBe(4)
  })

  it('uma única pessoa Estressada hoje sai na distribuição e na participação', async () => {
    // O pedido literal da G&G: ver o humor negativo isolado, sem sigilo.
    await seedDay(TODAY, ['HARD'])

    const result = await overview()

    expect(result.totalEntries).toBe(1)
    expect(result.participationToday?.responded).toBe(1)
    expect(result.todayDistribution.find((s) => s.mood === 'HARD')).toMatchObject({
      count: 1,
      percent: 100,
    })
    expect(result.weekAverage).toBe(1)
  })

  it('recorte vazio continua não devolvendo nada', async () => {
    // Zero resposta é o único caso que ainda cai no overview vazio — abaixo de
    // 1 só existe 0.
    const result = await overview()

    expect(result.totalEntries).toBe(0)
    expect(result.weekAverage).toBeNull()
    expect(result.participationToday).toBeNull()
    expect(result.todayDistribution).toEqual([])
    expect(result.reasons).toEqual([])
    expect(result.comments).toEqual([])
    expect(result.trend.every((p) => p.average === null && p.count === 0)).toBe(true)
  })

  it('média de 7 dias é ponderada pelo nº de registros do dia, não média de médias', async () => {
    // 29/07: 3 registros GREAT (5). 31/07: 6 registros HARD (1).
    // Média de médias daria (5+1)/2 = 3. Ponderada: (3*5 + 6*1) / 9 = 2.33.
    await seedDay('2026-07-29', ['GREAT', 'GREAT', 'GREAT'])
    await seedDay(TODAY, ['HARD', 'HARD', 'HARD', 'HARD', 'HARD', 'HARD'])

    const result = await overview()

    expect(result.weekAverage).toBe(2.33)
  })

  it('dias sem registro não puxam a média para baixo', async () => {
    // Um único dia com registros na semana: a média é a dele, não diluída pelos
    // outros seis dias vazios (que dariam 4.0 * 1/7 ≈ 0.57).
    await seedDay(TODAY, ['GOOD', 'GOOD', 'GOOD', 'GOOD'])

    const result = await overview()

    expect(result.weekAverage).toBe(4)
  })

  it('registro às 23h de São Paulo cai no dia civil de São Paulo, não no dia UTC', async () => {
    // 31/07 23h30 em SP = 01/08 02h30 UTC. O "hoje" do painel tem que ser 31/07.
    const lateNight = new Date('2026-08-01T02:30:00.000Z')
    await seedDay(TODAY, ['GREAT', 'GREAT', 'GREAT'])

    const result = await overview({ now: lateNight })

    expect(result.trend[result.trend.length - 1].day).toBe(TODAY)
    expect(result.participationToday?.responded).toBe(3)
    expect(result.todayDistribution.find((s) => s.mood === 'GREAT')?.count).toBe(3)
  })

  it('SUBADMIN vê só o próprio setor', async () => {
    const outro = await mkSector('Outro Setor')
    await seedDay(TODAY, ['GREAT', 'GREAT', 'GREAT'], DEFAULT_SECTOR_ID)
    await seedDay(TODAY, ['HARD', 'HARD', 'HARD', 'HARD'], outro.id)

    const result = await overview({ viewerRole: 'SUBADMIN', viewerSectorId: DEFAULT_SECTOR_ID, sectorId: null })

    expect(result.sectorId).toBe(DEFAULT_SECTOR_ID)
    expect(result.totalEntries).toBe(3)
    expect(result.weekAverage).toBe(5)
  })

  it('SUBADMIN pedindo outro setor recebe 403', async () => {
    const outro = await mkSector('Setor Alheio')

    await expect(
      overview({ viewerRole: 'SUBADMIN', viewerSectorId: DEFAULT_SECTOR_ID, sectorId: outro.id }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      overview({ viewerRole: 'SUBADMIN', viewerSectorId: DEFAULT_SECTOR_ID, sectorId: outro.id }),
    ).rejects.toBeInstanceOf(MoodOverviewError)
  })

  it('ADMIN sem filtro soma a empresa inteira; com filtro corta pelo setor', async () => {
    const outro = await mkSector('Setor Filtrado')
    await seedDay(TODAY, ['GREAT', 'GREAT', 'GREAT'], DEFAULT_SECTOR_ID)
    await seedDay(TODAY, ['HARD', 'HARD', 'HARD'], outro.id)

    const todaCompanhia = await overview()
    expect(todaCompanhia.sectorId).toBeNull()
    expect(todaCompanhia.totalEntries).toBe(6)

    const filtrado = await overview({ sectorId: outro.id })
    expect(filtrado.sectorId).toBe(outro.id)
    expect(filtrado.totalEntries).toBe(3)
    expect(filtrado.weekAverage).toBe(1)
  })

  it('ranking de motivos agrupa os negativos e joga o motivo nulo em "não informado"', async () => {
    const users = await Promise.all([mkUser(), mkUser(), mkUser(), mkUser()])
    await prisma.moodEntry.createMany({
      data: [
        { userId: users[0].id, day: new Date(TODAY), mood: 'HARD', reason: 'WORKLOAD' },
        { userId: users[1].id, day: new Date(TODAY), mood: 'LOW', reason: 'WORKLOAD' },
        { userId: users[2].id, day: new Date(TODAY), mood: 'LOW', reason: 'LEADERSHIP' },
        // Positivo não entra no ranking de motivos.
        { userId: users[3].id, day: new Date(TODAY), mood: 'GREAT' },
      ],
    })

    const result = await overview()

    expect(result.reasons).toEqual([
      { reason: 'WORKLOAD', count: 2, percent: 67 },
      { reason: 'LEADERSHIP', count: 1, percent: 33 },
    ])
  })

  it('o piso de anonimato NÃO filtra mais o comentário — ele vem identificado', async () => {
    // 28/07 tem uma nota só. Antes ela era escondida para o autor não ser
    // deduzido; agora o comentário vem com nome, e esconder por dedução o que
    // está assinado seria incoerente (Documento 3, seção 4.6).
    await seedDay('2026-07-28', ['HARD'], DEFAULT_SECTOR_ID, 'nota do dia solitário')
    await seedDay(TODAY, ['LOW', 'LOW', 'LOW'], DEFAULT_SECTOR_ID, 'nota do dia cheio')

    const result = await overview()

    expect(result.comments.map((c) => c.note)).toContain('nota do dia solitário')
    expect(result.comments.filter((c) => c.note === 'nota do dia cheio')).toHaveLength(3)
  })

  it('todo comentário carrega o autor', async () => {
    await seedDay(TODAY, ['HARD', 'LOW', 'LOW'], DEFAULT_SECTOR_ID, 'me sinto sobrecarregado')

    const result = await overview()

    expect(result.comments.length).toBeGreaterThan(0)
    for (const comment of result.comments) {
      expect(comment.author.id).toBeTruthy()
      expect(comment.author.name).toBeTruthy()
    }
  })

  it('o comentário solitário agora vem acompanhado dos agregados do dia', async () => {
    // Enquanto o piso valia 3, o comentário saía identificado mas a média e a
    // distribuição do mesmo dia vinham vazias — a tela dizia "poucas respostas"
    // logo acima de uma nota assinada. Com o piso em 1 os dois batem.
    await seedDay(TODAY, ['HARD'], DEFAULT_SECTOR_ID, 'nota solitária')

    const result = await overview()

    expect(result.comments.map((c) => c.note)).toContain('nota solitária')
    expect(result.weekAverage).toBe(1)
    expect(result.todayDistribution.find((s) => s.mood === 'HARD')?.count).toBe(1)
  })

  it('separa as duas caixas: alerta só do negativo, comentários da escala inteira', async () => {
    await seedDay(TODAY, ['HARD', 'LOW', 'GREAT'], DEFAULT_SECTOR_ID, 'comentário')

    const result = await overview()

    expect(result.comments).toHaveLength(3)
    // Caixa 1: só Estressado(a) e Desanimado(a).
    expect(result.alertComments).toHaveLength(2)
    expect(result.alertComments.every((c) => c.mood === 'HARD' || c.mood === 'LOW')).toBe(true)
    expect(result.comments.some((c) => c.mood === 'GREAT')).toBe(true)
  })

  it('participação de hoje ignora quem nunca registra humor (admins) no denominador', async () => {
    await seedDay(TODAY, ['GOOD', 'GOOD', 'GOOD'])
    // Dois admins e um colaborador que não registrou: só o colaborador conta.
    await prisma.user.create({ data: { name: 'Adm', email: 'adm-clima@x.com', passwordHash: 'x', role: 'ADMIN' } })
    await prisma.user.create({ data: { name: 'Sub', email: 'sub-clima@x.com', passwordHash: 'x', role: 'SUBADMIN' } })
    await mkUser()

    const result = await overview()

    expect(result.participationToday).toEqual({ responded: 3, total: 4, percent: 75 })
  })

  it('MOOD_ANONYMITY_MIN é o limiar efetivo do corte — subir a constante volta a suprimir', async () => {
    await seedDay(TODAY, Array(MOOD_ANONYMITY_MIN).fill('NEUTRAL') as MoodLevel[])

    const result = await overview()

    expect(result.trend.find((p) => p.day === TODAY)?.count).toBe(MOOD_ANONYMITY_MIN)
  })
})
