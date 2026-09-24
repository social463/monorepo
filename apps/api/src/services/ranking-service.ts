import {
  RANKING_IDLE_LIMIT,
  RANKING_MAX_ENTRIES,
  computeLevel,
  type RankingEntryDTO,
  type RankingEventRowDTO,
  type RankingOverviewDTO,
  type RankingResponse,
  type RankingSectorRowDTO,
  type StreakRankingEntryDTO,
  type StreakRankingResponse,
  type XpEvent,
} from '@legends/shared'
import { Prisma, type User } from '@prisma/client'
import { scopedPrisma } from '../lib/tenant-scope'
import { toPublicUser } from '../lib/serialize'
import { sectorNamesFor } from '../lib/sector-features'
import {
  isBusinessDay,
  monthBounds,
  monthRefOf,
  nextBusinessDay,
  prevBusinessDay,
  ymdInSaoPaulo,
  ymdOf,
} from '../lib/sao-paulo-date'
import { onlineUserIds } from './presence-service'
import { companyHolidays } from './vacation-planning-service'

/**
 * Ranking de engajamento.
 *
 * A pontuação NÃO é materializada: é a mesma soma de `XpTransaction` que o card
 * de perfil usa (`getXpPointsForUsers`). Uma coluna `totalPoints` seria mais
 * rápida e seria uma segunda verdade — e a primeira vez que ela divergisse do
 * livro-razão, ninguém saberia qual das duas está certa.
 */

/**
 * Quem disputa o ranking.
 *
 * Mesmo recorte dos aniversariantes (`celebration-service`) de propósito: são as
 * duas listas da Home que atravessam setores, e "o time" precisa significar a
 * mesma coisa nas duas. Contas de administração ficam de fora porque não jogam
 * — não votam, não recebem feedback, não teriam como pontuar — e apareceriam
 * eternamente com zero no fim da tabela.
 */
const RANKING_AUDIENCE: Prisma.UserWhereInput = {
  active: true,
  leftAt: null,
  role: { notIn: ['ADMIN', 'SUBADMIN', 'THIRD_PARTY'] },
}

interface RankedUser {
  user: User
  points: number
}

/** Ordena por pontos (desc) e desempata por nome (asc), como no protótipo. */
function byPointsThenName(a: RankedUser, b: RankedUser): number {
  if (b.points !== a.points) return b.points - a.points
  return a.user.name.localeCompare(b.user.name, 'pt-BR')
}

/**
 * Todo mundo do recorte, já pontuado e ordenado. Duas queries fixas
 * (usuários + agregação de XP), independentemente do tamanho do time.
 */
async function rankedUsers(companyId: string): Promise<RankedUser[]> {
  const db = scopedPrisma(companyId)
  const users = await db.user.findMany({ where: RANKING_AUDIENCE, orderBy: { name: 'asc' } })
  if (users.length === 0) return []

  const rows = await db.xpTransaction.groupBy({
    by: ['userId'],
    where: { userId: { in: users.map((u) => u.id) } },
    _sum: { amount: true },
  })
  const points = new Map(rows.map((row) => [row.userId, row._sum.amount ?? 0]))

  return users.map((user) => ({ user, points: points.get(user.id) ?? 0 })).sort(byPointsThenName)
}

/** Monta os DTOs de uma fatia já ordenada, resolvendo setor e presença em lote. */
async function toEntries(
  ranked: RankedUser[],
  companyId: string,
  online: Set<string>,
  offset = 0,
): Promise<RankingEntryDTO[]> {
  const sectorNames = await sectorNamesFor(ranked.map((r) => r.user.sectorId))
  return ranked.map((row, index) => ({
    position: offset + index + 1,
    user: toPublicUser(row.user, [], { sectorName: sectorNames.get(row.user.sectorId) ?? '' }),
    points: row.points,
    level: computeLevel(row.points),
    online: online.has(row.user.id),
  }))
}

/**
 * Ranking geral. `limit` corta a lista devolvida (o bloco da Home pede 5), mas
 * `total` e a posição de quem pediu continuam sendo do ranking INTEIRO — senão
 * "você é o 3º" mudaria de significado conforme a tela.
 */
export async function getRanking(
  viewerId: string,
  companyId: string,
  options: { limit?: number; now?: Date } = {},
): Promise<RankingResponse> {
  const ranked = await rankedUsers(companyId)
  const online = await onlineUserIds(companyId, options.now)

  const limit = Math.min(options.limit ?? RANKING_MAX_ENTRIES, RANKING_MAX_ENTRIES)
  const entries = await toEntries(ranked.slice(0, limit), companyId, online)

  const meIndex = ranked.findIndex((row) => row.user.id === viewerId)
  const me =
    meIndex >= 0 ? { position: meIndex + 1, points: ranked[meIndex]!.points } : null

  return { entries, total: ranked.length, me }
}

// ---------------------------------------------------------------------------
// Ranking de consistência
// ---------------------------------------------------------------------------

interface StreakPair {
  currentStreak: number
  bestStreak: number
}

/**
 * Sequências de dias úteis por pessoa, a partir dos dias já registrados.
 *
 * Réplica fiel da regra de `streak-service.getStreakSummary` — inclusive a
 * "graça" de o dia útil de referência ainda não ter boost —, aplicada a muitas
 * pessoas de uma vez. Chamar `getStreakSummary` num laço faria uma query por
 * pessoa; aqui o banco é lido uma vez só e a conta acontece em memória.
 */
export function streaksFromDays(
  days: Set<string>,
  todayYmd: string,
  holidays?: ReadonlySet<string>,
): StreakPair {
  const lastBiz = isBusinessDay(todayYmd, holidays) ? todayYmd : prevBusinessDay(todayYmd, holidays)

  let currentStreak = 0
  let cursor = days.has(lastBiz) ? lastBiz : prevBusinessDay(lastBiz, holidays)
  while (days.has(cursor)) {
    currentStreak += 1
    cursor = prevBusinessDay(cursor, holidays)
  }

  const bizYmds = [...days].filter((ymd) => isBusinessDay(ymd, holidays)).sort()
  let bestStreak = 0
  let run = 0
  let prev: string | null = null
  for (const ymd of bizYmds) {
    run = prev !== null && nextBusinessDay(prev, holidays) === ymd ? run + 1 : 1
    if (run > bestStreak) bestStreak = run
    prev = ymd
  }

  return { currentStreak, bestStreak }
}

export async function getStreakRanking(
  viewerId: string,
  companyId: string,
  options: { limit?: number; now?: Date } = {},
): Promise<StreakRankingResponse> {
  const now = options.now ?? new Date()
  const todayYmd = ymdInSaoPaulo(now)
  const db = scopedPrisma(companyId)

  const users = await db.user.findMany({ where: RANKING_AUDIENCE, orderBy: { name: 'asc' } })
  if (users.length === 0) return { entries: [], total: 0, me: null }

  const ids = users.map((u) => u.id)
  const entries = await db.moodEntry.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, day: true },
  })

  const daysByUser = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]))
  for (const entry of entries) daysByUser.get(entry.userId)?.add(ymdOf(entry.day))

  const minDay = entries.reduce((min, e) => {
    const ymd = ymdOf(e.day)
    return ymd < min ? ymd : min
  }, todayYmd)
  const holidays = new Set((await companyHolidays(companyId, minDay, todayYmd)).keys())

  const ranked = users
    .map((user) => ({ user, ...streaksFromDays(daysByUser.get(user.id)!, todayYmd, holidays) }))
    .sort((a, b) => {
      if (b.currentStreak !== a.currentStreak) return b.currentStreak - a.currentStreak
      if (b.bestStreak !== a.bestStreak) return b.bestStreak - a.bestStreak
      return a.user.name.localeCompare(b.user.name, 'pt-BR')
    })

  const online = await onlineUserIds(companyId, now)
  const limit = Math.min(options.limit ?? RANKING_MAX_ENTRIES, RANKING_MAX_ENTRIES)
  const slice = ranked.slice(0, limit)
  const sectorNames = await sectorNamesFor(slice.map((r) => r.user.sectorId))

  const dtos: StreakRankingEntryDTO[] = slice.map((row, index) => ({
    position: index + 1,
    user: toPublicUser(row.user, [], { sectorName: sectorNames.get(row.user.sectorId) ?? '' }),
    currentStreak: row.currentStreak,
    bestStreak: row.bestStreak,
    online: online.has(row.user.id),
  }))

  const meIndex = ranked.findIndex((row) => row.user.id === viewerId)
  const me =
    meIndex >= 0
      ? { position: meIndex + 1, currentStreak: ranked[meIndex]!.currentStreak }
      : null

  return { entries: dtos, total: ranked.length, me }
}

// ---------------------------------------------------------------------------
// Visão do admin
// ---------------------------------------------------------------------------

/**
 * A economia de XP da empresa: quanto se distribuiu, por qual evento, para quem
 * e — o que o ranking sozinho não conta — **quem ficou de fora**.
 *
 * A lista de ociosos é o ponto: um ranking mostra os cinco de cima, e é
 * exatamente quem NÃO aparece nele que o admin precisa enxergar para agir.
 */
export async function getRankingOverview(
  companyId: string,
  options: { now?: Date; topLimit?: number } = {},
): Promise<RankingOverviewDTO> {
  const now = options.now ?? new Date()
  const monthRef = monthRefOf(ymdInSaoPaulo(now))
  const { start, endExclusive } = monthBounds(monthRef)
  const db = scopedPrisma(companyId)

  const ranked = await rankedUsers(companyId)
  const ids = ranked.map((row) => row.user.id)

  if (ids.length === 0) {
    return {
      monthRef,
      people: 0,
      scored: 0,
      activeThisMonth: 0,
      totalPoints: 0,
      pointsThisMonth: 0,
      byEvent: [],
      bySector: [],
      idle: [],
      top: [],
    }
  }

  const [byEventRows, monthRows, lastCredits] = await Promise.all([
    db.xpTransaction.groupBy({
      by: ['event'],
      where: { userId: { in: ids } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.xpTransaction.groupBy({
      by: ['userId'],
      where: { userId: { in: ids }, day: { gte: start, lt: endExclusive } },
      _sum: { amount: true },
    }),
    // Último crédito de cada pessoa: `max(createdAt)` por usuário, numa query.
    db.xpTransaction.groupBy({
      by: ['userId'],
      where: { userId: { in: ids } },
      _max: { createdAt: true },
    }),
  ])

  // Pessoas distintas por evento: o `groupBy` acima conta linhas, não gente, e
  // "quantos usaram o mural" é outra pergunta de "quantos créditos saíram".
  const peoplePerEvent = await db.xpTransaction.groupBy({
    by: ['event', 'userId'],
    where: { userId: { in: ids } },
  })
  const distinctByEvent = new Map<XpEvent, number>()
  for (const row of peoplePerEvent) {
    const event = row.event as XpEvent
    distinctByEvent.set(event, (distinctByEvent.get(event) ?? 0) + 1)
  }

  const byEvent: RankingEventRowDTO[] = byEventRows
    .map((row) => ({
      event: row.event as XpEvent,
      points: row._sum.amount ?? 0,
      credits: row._count._all,
      people: distinctByEvent.get(row.event as XpEvent) ?? 0,
    }))
    .sort((a, b) => b.points - a.points)

  const monthPoints = new Map(monthRows.map((row) => [row.userId, row._sum.amount ?? 0]))
  const lastCreditAt = new Map(lastCredits.map((row) => [row.userId, row._max.createdAt ?? null]))

  const sectorNames = await sectorNamesFor(ranked.map((row) => row.user.sectorId))
  const sectors = new Map<string, RankingSectorRowDTO>()
  for (const row of ranked) {
    const sectorId = row.user.sectorId
    const current = sectors.get(sectorId) ?? {
      sectorId,
      sectorName: sectorNames.get(sectorId) ?? '—',
      people: 0,
      scored: 0,
      points: 0,
      averagePoints: 0,
    }
    current.people += 1
    current.points += row.points
    if (row.points > 0) current.scored += 1
    sectors.set(sectorId, current)
  }
  const bySector = [...sectors.values()]
    .map((row) => ({ ...row, averagePoints: Math.round(row.points / row.people) }))
    .sort((a, b) => b.points - a.points)

  const online = await onlineUserIds(companyId, now)
  const top = await toEntries(ranked.slice(0, options.topLimit ?? 10), companyId, online)

  // Ociosos: quem não recebeu crédito NENHUM no mês de referência. Ordenados
  // pelo acumulado (desc) para o admin ver primeiro quem já foi engajado e
  // parou — que é o caso que pede conversa, não quem nunca entrou no jogo.
  const idle = ranked
    .filter((row) => (monthPoints.get(row.user.id) ?? 0) === 0)
    .slice(0, RANKING_IDLE_LIMIT)
    .map((row) => ({
      user: toPublicUser(row.user, [], { sectorName: sectorNames.get(row.user.sectorId) ?? '' }),
      points: row.points,
      lastPointAt: lastCreditAt.get(row.user.id)?.toISOString() ?? null,
    }))

  const totalPoints = ranked.reduce((sum, row) => sum + row.points, 0)
  const pointsThisMonth = [...monthPoints.values()].reduce((sum, value) => sum + value, 0)

  return {
    monthRef,
    people: ranked.length,
    scored: ranked.filter((row) => row.points > 0).length,
    activeThisMonth: [...monthPoints.values()].filter((value) => value > 0).length,
    totalPoints,
    pointsThisMonth,
    byEvent,
    bySector,
    idle,
    top,
  }
}
