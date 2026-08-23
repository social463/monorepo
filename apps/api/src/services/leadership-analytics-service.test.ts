import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getLeadershipOverview } from './leadership-analytics-service'

// Relógio fixo: 2026-06-25 às 16:00 em São Paulo. Toda a semeadura é posicionada
// em relação a este instante, nunca ao relógio da máquina.
const NOW = new Date('2026-06-25T19:00:00.000Z')

/** Instante UTC das 12:00 (horário de São Paulo) do dia civil informado. */
function noonAt(ymd: string) {
  return new Date(`${ymd}T15:00:00.000Z`)
}

function dayOf(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`)
}

async function mkUser(name: string, overrides: Partial<{ role: string; companyId: string }> = {}) {
  return prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase().replace(/\s/g, '-')}-${Math.round(performance.now() * 1000)}@x.com`,
      passwordHash: 'x',
      role: (overrides.role ?? 'LEGEND') as 'LEGEND',
      sectorId: DEFAULT_SECTOR_ID,
      companyId: overrides.companyId ?? DEFAULT_COMPANY_ID,
    },
  })
}

/**
 * "Meu time" é quem tem a pessoa como **líder direto** — a mesma cadeia do
 * organograma. Squad e área não recortam mais os indicadores.
 */
async function mkTeam(leaderId: string, memberIds: string[]) {
  await prisma.user.updateMany({ where: { id: { in: memberIds } }, data: { managerId: leaderId } })
}

async function mkMood(userId: string, ymd: string, mood: 'GREAT' | 'GOOD' | 'NEUTRAL' | 'LOW' | 'HARD') {
  return prisma.moodEntry.create({ data: { userId, mood, day: dayOf(ymd), companyId: DEFAULT_COMPANY_ID } })
}

async function mkAccess(userId: string, path: string, at: Date) {
  return prisma.accessLog.create({ data: { userId, path, companyId: DEFAULT_COMPANY_ID, createdAt: at } })
}

async function mkFeedback(authorId: string, targetId: string, at: Date) {
  return prisma.feedback.create({
    data: {
      authorId,
      targetId,
      message: 'mandou bem',
      category: 'ELOGIO',
      createdAt: at,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

async function mkXp(userId: string, amount: number, ymd: string, reference: string) {
  return prisma.xpTransaction.create({
    data: {
      userId,
      event: 'VOTE_CAST',
      amount,
      dedupeKey: `VOTE_CAST:${reference}`,
      day: dayOf(ymd),
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

const scope = (viewerId: string, range: '7d' | '30d' | '90d' = '30d') => ({
  viewerId,
  companyId: DEFAULT_COMPANY_ID,
  range,
  now: NOW,
})

describe('getLeadershipOverview', () => {
  it('devolve payload zerado para quem não lidera ninguém', async () => {
    const admin = await mkUser('Admin', { role: 'ADMIN' })
    const outro = await mkUser('Outro')
    await mkMood(outro.id, '2026-06-24', 'GREAT')
    await mkXp(outro.id, 500, '2026-06-24', 'outro')

    const overview = await getLeadershipOverview(scope(admin.id))

    expect(overview.teamSize).toBe(0)
    expect(overview.scores.perPerson).toEqual([])
    expect(overview.scores.average).toBe(0)
    expect(overview.mood.average).toBeNull()
    expect(overview.mood.participants).toBe(0)
    expect(overview.topScreens).toEqual([])
  })

  it('agrega clima, feedbacks, telas e pontuação só dos liderados', async () => {
    const lead = await mkUser('Lider', { role: 'LEAD' })
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    const forade = await mkUser('Fora do time')
    await mkTeam(lead.id, [ana.id, bruno.id])

    // Clima: Ana ótima (5) e Bruno neutro (3) → média 4.
    await mkMood(ana.id, '2026-06-24', 'GREAT')
    await mkMood(bruno.id, '2026-06-24', 'NEUTRAL')
    // De fora do time: não pode entrar em nenhum número.
    await mkMood(forade.id, '2026-06-24', 'HARD')

    await mkAccess(ana.id, '/mural', noonAt('2026-06-24'))
    await mkAccess(bruno.id, '/mural', noonAt('2026-06-24'))
    await mkAccess(forade.id, '/votacao', noonAt('2026-06-24'))

    await mkFeedback(ana.id, forade.id, noonAt('2026-06-23'))
    await mkFeedback(forade.id, bruno.id, noonAt('2026-06-23'))
    await mkFeedback(forade.id, forade.id, noonAt('2026-06-23'))

    await mkXp(ana.id, 300, '2026-06-24', 'ana')
    await mkXp(bruno.id, 100, '2026-06-24', 'bruno')
    await mkXp(forade.id, 9000, '2026-06-24', 'fora')

    const overview = await getLeadershipOverview(scope(lead.id))

    expect(overview.teamSize).toBe(2)
    expect(overview.mood.average).toBe(4)
    expect(overview.mood.participants).toBe(2)
    // O líder não conta no próprio time, nem quem não responde a ele.
    expect(overview.feedbacks).toEqual({ written: 1, received: 1 })
    expect(overview.topScreens).toEqual([
      { path: '/mural', label: 'Feed Corporativo', accesses: 2, uniqueUsers: 2 },
    ])
    expect(overview.scores.perPerson).toEqual([
      { userId: ana.id, name: 'Ana', points: 300 },
      { userId: bruno.id, name: 'Bruno', points: 100 },
    ])
    expect(overview.scores.average).toBe(200)
  })

  it('conta só o XP ganho dentro da janela', async () => {
    const lead = await mkUser('Lider', { role: 'LEAD' })
    const ana = await mkUser('Ana')
    await mkTeam(lead.id, [ana.id])

    await mkXp(ana.id, 100, '2026-06-24', 'dentro')
    // 2026-06-10 está dentro dos 30 dias, mas fora dos 7.
    await mkXp(ana.id, 700, '2026-06-10', 'quinze-dias')

    const em30 = await getLeadershipOverview(scope(lead.id, '30d'))
    expect(em30.scores.perPerson[0].points).toBe(800)

    const em7 = await getLeadershipOverview(scope(lead.id, '7d'))
    expect(em7.scores.perPerson[0].points).toBe(100)
  })

  it('mantém quem não pontuou na lista, zerado e no fim', async () => {
    const lead = await mkUser('Lider', { role: 'LEAD' })
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    await mkTeam(lead.id, [ana.id, bruno.id])
    await mkXp(bruno.id, 50, '2026-06-24', 'bruno')

    const overview = await getLeadershipOverview(scope(lead.id))

    expect(overview.scores.perPerson).toEqual([
      { userId: bruno.id, name: 'Bruno', points: 50 },
      { userId: ana.id, name: 'Ana', points: 0 },
    ])
    // A média divide pelo time inteiro, não só por quem pontuou.
    expect(overview.scores.average).toBe(25)
  })

  it('o time são os diretos: quem está dois níveis abaixo não entra no agregado', async () => {
    const head = await mkUser('Head', { role: 'HEAD' })
    const meio = await mkUser('Meio', { role: 'MANAGER' })
    const base = await mkUser('Base')
    await mkTeam(head.id, [meio.id])
    await mkTeam(meio.id, [base.id])
    await mkXp(meio.id, 200, '2026-06-24', 'meio')
    await mkXp(base.id, 900, '2026-06-24', 'base')

    const overview = await getLeadershipOverview(scope(head.id))

    // O head enxerga o time do meio pelo organograma, mas o indicador dele é
    // sobre quem responde direto — senão a média do time viraria a da empresa
    // conforme se sobe a hierarquia.
    expect(overview.teamSize).toBe(1)
    expect(overview.scores.perPerson).toEqual([{ userId: meio.id, name: 'Meio', points: 200 }])
    expect(overview.scores.average).toBe(200)
  })

  it('área em comum não faz time: sem líder direto, o painel do MANAGER fica zerado', async () => {
    const manager = await prisma.user.create({
      data: {
        name: 'Manager',
        email: `manager-${Math.round(performance.now() * 1000)}@x.com`,
        passwordHash: 'x',
        role: 'MANAGER',
        area: 'ENGINEERING',
        sectorId: DEFAULT_SECTOR_ID,
        companyId: DEFAULT_COMPANY_ID,
      },
    })
    const daArea = await prisma.user.update({
      where: { id: (await mkUser('Da Area')).id },
      data: { area: 'ENGINEERING' },
    })
    await mkXp(daArea.id, 400, '2026-06-24', 'da-area')

    // A área inteira era o time do MANAGER na regra antiga.
    const semVinculo = await getLeadershipOverview(scope(manager.id))
    expect(semVinculo.teamSize).toBe(0)
    expect(semVinculo.scores.perPerson).toEqual([])

    await mkTeam(manager.id, [daArea.id])
    const comVinculo = await getLeadershipOverview(scope(manager.id))
    expect(comVinculo.teamSize).toBe(1)
    expect(comVinculo.scores.perPerson).toEqual([{ userId: daArea.id, name: 'Da Area', points: 400 }])
  })
})
