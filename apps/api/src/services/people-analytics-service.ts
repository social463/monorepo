import { Prisma } from '@prisma/client'
import type {
  AccessHeatmapCellDTO,
  AccessSeriesPointDTO,
  DistributionSliceDTO,
  EngagementOverviewDTO,
  MoodLevel,
  MoodSummaryDTO,
  MuralPostReachDTO,
  MuralReachDTO,
  PeopleAnalyticsRange,
  PeopleOverviewDTO,
  ScreenAccessDTO,
  VotingAdoptionDTO,
} from '@legends/shared'
import {
  MOOD_OPTIONS,
  MOOD_SCORES,
  PEOPLE_ANALYTICS_RANGE_DAYS,
  USER_ROLE_LABELS,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { addDays, saoPauloMidnightUtc, ymdInSaoPaulo, ymdOf } from '../lib/sao-paulo-date'
import { derivePeriodState } from '../lib/period-state'

/** Papéis que não votam nem aparecem como base de adesão da votação. */
const NON_VOTING_ROLES = ['ADMIN', 'SUBADMIN', 'SUPER_ADMIN'] as const

/** Quantos posts do Mural o bloco de alcance devolve (os mais recentes). */
const MURAL_REACH_POST_LIMIT = 10

/** Quantas telas o ranking de páginas mais acessadas devolve. */
const TOP_SCREENS_LIMIT = 10

export interface AnalyticsScope {
  companyId: string
  /** Null = empresa inteira (ADMIN sem filtro). */
  sectorId: string | null
  range: PeopleAnalyticsRange
  now?: Date
}

/**
 * De quem são os dados agregados. O People Analytics recorta por **setor**; a
 * página de Liderança recorta por **lista de liderados**. As agregações são as
 * mesmas — só o filtro muda —, então elas recebem a audiência em vez de um
 * `sectorId`, e as duas telas não podem divergir na definição de cada número.
 */
export type AnalyticsAudience =
  | { kind: 'sector'; sectorId: string | null }
  | { kind: 'users'; userIds: string[] }

export function sectorAudience(sectorId: string | null): AnalyticsAudience {
  return { kind: 'sector', sectorId }
}

export interface AnalyticsWindow {
  /** Primeiro instante (UTC) do primeiro dia civil da janela. */
  since: Date
  /** Primeiro instante (UTC) do dia seguinte ao último — limite exclusivo. */
  until: Date
  /** Dias civis da janela, em ordem crescente (YYYY-MM-DD). */
  days: string[]
}

type Window = AnalyticsWindow

/**
 * A janela é sempre "os últimos N dias civis em São Paulo, incluindo hoje" —
 * não N*24h para trás. Isso mantém a série alinhada com o calendário que o
 * usuário vê, em vez de cortar o dia atual pela metade.
 */
export function resolveWindow(range: PeopleAnalyticsRange, now: Date): Window {
  const totalDays = PEOPLE_ANALYTICS_RANGE_DAYS[range]
  const endYmd = ymdInSaoPaulo(now)
  const startYmd = addDays(endYmd, -(totalDays - 1))
  const days: string[] = []
  for (let i = 0; i < totalDays; i += 1) days.push(addDays(startYmd, i))
  return {
    since: saoPauloMidnightUtc(startYmd),
    until: saoPauloMidnightUtc(addDays(endYmd, 1)),
    days,
  }
}

/** Janela dos últimos `days` dias civis terminando hoje (para os KPIs 7d/30d). */
function trailingSince(days: number, now: Date): Date {
  return saoPauloMidnightUtc(addDays(ymdInSaoPaulo(now), -(days - 1)))
}

const ID_SEGMENT = /^(?:[a-z0-9]{20,}|\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/**
 * Reduz um path de navegação à *rota*: tira query string e hash, e troca
 * segmentos que são identificador (cuid, uuid ou número) por `:id`.
 *
 * Sem isso "telas mais acessadas" viraria uma lista de milhares de caminhos
 * com contagem 1 — a pergunta real é qual tela é usada, não qual recurso.
 * Devolve null quando o path não é utilizável (vazio, ou não começa com "/").
 */
export function normalizeAccessPath(rawPath: string): string | null {
  const withoutQuery = rawPath.split(/[?#]/)[0].trim()
  if (!withoutQuery.startsWith('/')) return null
  const segments = withoutQuery
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => (ID_SEGMENT.test(segment) ? ':id' : segment.toLowerCase()))
  return segments.length === 0 ? '/' : `/${segments.join('/')}`
}

/**
 * Grava uma navegação autenticada. Chamada em best-effort pela rota: um erro
 * aqui nunca pode afetar a navegação de quem está usando o produto.
 */
export async function recordAccess(input: { userId: string; companyId: string; path: string }): Promise<void> {
  const path = normalizeAccessPath(input.path)
  if (!path) return
  await scopedPrisma(input.companyId).accessLog.create({
    data: { userId: input.userId, path },
  })
}

// ---------------------------------------------------------------------------
// Agregações de acesso (SQL cru)
//
// As consultas abaixo são os únicos `$queryRaw` do repo. Existem porque o
// `groupBy` do Prisma não faz COUNT(DISTINCT) nem conversão de fuso — e o
// PBI é explícito em não puxar a tabela para o Node.
//
// ATENÇÃO: raw query NÃO passa pela extensão `scopedPrisma`. Todo WHERE aqui
// repete `"companyId" = ...` à mão; o teste de isolamento entre empresas cobre
// exatamente esse ponto.
// ---------------------------------------------------------------------------

/**
 * A data civil em São Paulo de `AccessLog.createdAt`.
 *
 * O `AT TIME ZONE 'UTC'` do meio NÃO é decorativo: a coluna é
 * `timestamp WITHOUT time zone` (é assim que o Prisma mapeia `DateTime`) e o
 * Postgres, num valor sem fuso, *interpreta* o `AT TIME ZONE` em vez de
 * converter. Sem o passo de UTC, um acesso às 02:00Z do dia 25 — que é 23:00
 * do dia 24 em São Paulo — cairia no dia 25, deslocando a série em 3h.
 */
const SP_LOCAL_TIMESTAMP = Prisma.sql`(al."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')`
const SP_CIVIL_DATE = Prisma.sql`${SP_LOCAL_TIMESTAMP}::date`

/**
 * Filtro da audiência aplicado ao autor do acesso (o AccessLog não tem setor
 * próprio). Audiência de usuários vazia vira `FALSE`: sem isso, um `IN ()`
 * quebraria o SQL, e "ninguém" não pode virar "todo mundo".
 */
function audienceFilter(audience: AnalyticsAudience): Prisma.Sql {
  if (audience.kind === 'users') {
    if (audience.userIds.length === 0) return Prisma.sql`AND FALSE`
    return Prisma.sql`AND al."userId" IN (${Prisma.join(audience.userIds)})`
  }
  return audience.sectorId ? Prisma.sql`AND u."sectorId" = ${audience.sectorId}` : Prisma.empty
}

/** O mesmo recorte, no formato de `where` do Prisma (tabelas com `userId`). */
function audienceWhere(audience: AnalyticsAudience): Prisma.MoodEntryWhereInput {
  if (audience.kind === 'users') return { userId: { in: audience.userIds } }
  return audience.sectorId ? { user: { sectorId: audience.sectorId } } : {}
}

async function countUniqueAccessUsers(
  companyId: string,
  audience: AnalyticsAudience,
  since: Date,
  until: Date,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COUNT(DISTINCT al."userId")::int AS total
    FROM "AccessLog" al
    JOIN "User" u ON u."id" = al."userId"
    WHERE al."companyId" = ${companyId}
      AND al."createdAt" >= ${since}
      AND al."createdAt" < ${until}
      ${audienceFilter(audience)}
  `
  return rows[0]?.total ?? 0
}

async function loadAccessSeries(
  companyId: string,
  audience: AnalyticsAudience,
  window: Window,
): Promise<AccessSeriesPointDTO[]> {
  const rows = await prisma.$queryRaw<{ day: string; accesses: number; uniqueUsers: number }[]>`
    SELECT to_char(${SP_CIVIL_DATE}, 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS accesses,
           COUNT(DISTINCT al."userId")::int AS "uniqueUsers"
    FROM "AccessLog" al
    JOIN "User" u ON u."id" = al."userId"
    WHERE al."companyId" = ${companyId}
      AND al."createdAt" >= ${window.since}
      AND al."createdAt" < ${window.until}
      ${audienceFilter(audience)}
    GROUP BY 1
    ORDER BY 1
  `
  const byDay = new Map(rows.map((row) => [row.day, row]))
  // Dias sem acesso entram zerados: uma série com buraco desenha um gráfico
  // mentiroso (o traço "pula" o dia vazio em vez de cair para zero).
  return window.days.map((day) => ({
    day,
    accesses: byDay.get(day)?.accesses ?? 0,
    uniqueUsers: byDay.get(day)?.uniqueUsers ?? 0,
  }))
}

export async function loadTopScreens(
  companyId: string,
  audience: AnalyticsAudience,
  window: Window,
): Promise<ScreenAccessDTO[]> {
  const rows = await prisma.$queryRaw<{ path: string; accesses: number; uniqueUsers: number }[]>`
    SELECT al."path" AS path,
           COUNT(*)::int AS accesses,
           COUNT(DISTINCT al."userId")::int AS "uniqueUsers"
    FROM "AccessLog" al
    JOIN "User" u ON u."id" = al."userId"
    WHERE al."companyId" = ${companyId}
      AND al."createdAt" >= ${window.since}
      AND al."createdAt" < ${window.until}
      ${audienceFilter(audience)}
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
    LIMIT ${TOP_SCREENS_LIMIT}
  `
  return rows.map((row) => ({
    path: row.path,
    label: screenLabel(row.path),
    accesses: row.accesses,
    uniqueUsers: row.uniqueUsers,
  }))
}

/**
 * Mapa de calor dia-da-semana × hora, na hora civil de São Paulo. Devolve só
 * as células com acesso (no máximo 168, quase sempre muito menos) — mandar a
 * grade inteira zerada seria payload morto.
 */
async function loadAccessHeatmap(
  companyId: string,
  audience: AnalyticsAudience,
  window: Window,
): Promise<AccessHeatmapCellDTO[]> {
  return prisma.$queryRaw<AccessHeatmapCellDTO[]>`
    SELECT EXTRACT(DOW FROM ${SP_LOCAL_TIMESTAMP})::int AS weekday,
           EXTRACT(HOUR FROM ${SP_LOCAL_TIMESTAMP})::int AS hour,
           COUNT(*)::int AS accesses
    FROM "AccessLog" al
    JOIN "User" u ON u."id" = al."userId"
    WHERE al."companyId" = ${companyId}
      AND al."createdAt" >= ${window.since}
      AND al."createdAt" < ${window.until}
      ${audienceFilter(audience)}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `
}

/** Rótulo legível das telas conhecidas; cai no próprio path quando não mapeada. */
const SCREEN_LABELS: Record<string, string> = {
  '/': 'Home',
  '/mural': 'Feed Corporativo',
  '/perfil': 'Meu perfil',
  '/perfil/:id': 'Perfil de colega',
  '/votacao': 'Votação',
  '/destaque': 'Destaque do mês',
  '/escritorio': 'Escritório virtual',
  '/cultura': 'Cultura',
  '/resenha': 'Resenha',
  '/retrospectivas': 'Retrospectivas',
  '/admin': 'Admin — Dashboard',
  '/admin/pessoas': 'Admin — People Analytics',
}

function screenLabel(path: string): string {
  return SCREEN_LABELS[path] ?? path
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------

async function loadRoleDistribution(companyId: string, sectorId: string | null): Promise<DistributionSliceDTO[]> {
  const grouped = await scopedPrisma(companyId).user.groupBy({
    by: ['role'],
    where: { active: true, ...(sectorId ? { sectorId } : {}) },
    _count: { _all: true },
  })
  return grouped
    .map((row) => ({
      key: row.role,
      label: USER_ROLE_LABELS[row.role as keyof typeof USER_ROLE_LABELS] ?? row.role,
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
}

async function loadSquadDistribution(companyId: string, sectorId: string | null): Promise<DistributionSliceDTO[]> {
  const grouped = await scopedPrisma(companyId).user.groupBy({
    by: ['squad'],
    where: { active: true, ...(sectorId ? { sectorId } : {}) },
    _count: { _all: true },
  })
  return grouped
    .map((row) => ({
      key: row.squad ?? '',
      label: row.squad?.trim() ? row.squad : 'Sem squad',
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
}

/**
 * Adesão da votação: quantas das pessoas elegíveis votaram no período aberto.
 * Segue a mesma prioridade de `admin-dashboard-service` (ACTIVE vence
 * SCHEDULED). Sem período aberto no recorte, devolve null.
 */
async function loadVotingAdoption(
  companyId: string,
  sectorId: string | null,
  now: Date,
): Promise<VotingAdoptionDTO | null> {
  const db = scopedPrisma(companyId)
  const periods = await db.votingPeriod.findMany({
    where: sectorId ? { sectorId } : undefined,
    orderBy: { startsAt: 'desc' },
  })
  const active = periods.find((period) => derivePeriodState(period, now) === 'ACTIVE')
  const period = active ?? periods.filter((p) => derivePeriodState(p, now) === 'SCHEDULED').at(-1)
  if (!period) return null

  const [eligible, voted] = await Promise.all([
    db.user.count({
      where: { active: true, sectorId: period.sectorId, role: { notIn: [...NON_VOTING_ROLES] } },
    }),
    db.vote.count({ where: { periodId: period.id } }),
  ])

  return {
    periodId: period.id,
    monthRef: period.monthRef,
    eligible,
    voted,
    rate: eligible > 0 ? Math.round((voted / eligible) * 100) : 0,
  }
}

export async function getPeopleOverview(scope: AnalyticsScope): Promise<PeopleOverviewDTO> {
  const now = scope.now ?? new Date()
  const { companyId, sectorId, range } = scope
  const window = resolveWindow(range, now)
  const db = scopedPrisma(companyId)
  const sectorWhere = sectorId ? { sectorId } : {}
  const inWindow = { gte: window.since, lt: window.until }
  const audience = sectorAudience(sectorId)

  const [
    activePeople,
    uniqueUsers7d,
    uniqueUsers30d,
    accessSeries,
    votingAdoption,
    feedbacksCount,
    feedbackReactionsCount,
    byRole,
    bySquad,
    accessHeatmap,
  ] = await Promise.all([
    db.user.count({ where: { active: true, ...sectorWhere } }),
    countUniqueAccessUsers(companyId, audience, trailingSince(7, now), window.until),
    countUniqueAccessUsers(companyId, audience, trailingSince(30, now), window.until),
    loadAccessSeries(companyId, audience, window),
    loadVotingAdoption(companyId, sectorId, now),
    db.feedback.count({
      where: { createdAt: inWindow, ...(sectorId ? { author: { sectorId } } : {}) },
    }),
    db.feedbackReaction.count({
      where: { createdAt: inWindow, ...(sectorId ? { user: { sectorId } } : {}) },
    }),
    loadRoleDistribution(companyId, sectorId),
    loadSquadDistribution(companyId, sectorId),
    loadAccessHeatmap(companyId, audience, window),
  ])

  return {
    range,
    sectorId,
    activePeople,
    uniqueUsers7d,
    uniqueUsers30d,
    adoptionRate: activePeople > 0 ? Math.round((uniqueUsers30d / activePeople) * 100) : 0,
    accessSeries,
    votingAdoption,
    feedbacksCount,
    feedbackReactionsCount,
    byRole,
    bySquad,
    accessHeatmap,
  }
}

// ---------------------------------------------------------------------------
// Clima & engajamento
// ---------------------------------------------------------------------------

export async function loadMoodSummary(
  companyId: string,
  audience: AnalyticsAudience,
  window: Window,
): Promise<MoodSummaryDTO> {
  const db = scopedPrisma(companyId)
  // MoodEntry.day é @db.Date (meia-noite UTC do dia civil) — o recorte usa os
  // próprios YMDs da janela, não os instantes UTC das outras tabelas.
  const dayWhere = {
    day: { gte: new Date(`${window.days[0]}T00:00:00.000Z`), lte: new Date(`${window.days.at(-1)}T00:00:00.000Z`) },
    ...audienceWhere(audience),
  }
  const [grouped, participants, byDay] = await Promise.all([
    db.moodEntry.groupBy({ by: ['mood'], where: dayWhere, _count: { _all: true } }),
    db.moodEntry.findMany({ where: dayWhere, distinct: ['userId'], select: { userId: true } }),
    // Contagem por (dia, humor): no máximo 90 × 5 linhas, então a média
    // ponderada de cada dia sai daqui sem puxar registro individual.
    db.moodEntry.groupBy({ by: ['day', 'mood'], where: dayWhere, _count: { _all: true } }),
  ])

  const countByMood = new Map(grouped.map((row) => [row.mood as MoodLevel, row._count._all]))
  const entries = grouped.reduce((total, row) => total + row._count._all, 0)
  const scoreSum = grouped.reduce((total, row) => total + MOOD_SCORES[row.mood as MoodLevel] * row._count._all, 0)

  // Tendência: soma de pontos e de registros por dia civil.
  const trendByDay = new Map<string, { score: number; entries: number }>()
  for (const row of byDay) {
    const ymd = ymdOf(row.day)
    const bucket = trendByDay.get(ymd) ?? { score: 0, entries: 0 }
    bucket.score += MOOD_SCORES[row.mood as MoodLevel] * row._count._all
    bucket.entries += row._count._all
    trendByDay.set(ymd, bucket)
  }

  return {
    entries,
    participants: participants.length,
    average: entries > 0 ? Math.round((scoreSum / entries) * 10) / 10 : null,
    trend: window.days.map((day) => {
      const bucket = trendByDay.get(day)
      return {
        day,
        // Dia sem registro fica null (não zero): zero não existe na escala.
        average: bucket && bucket.entries > 0 ? Math.round((bucket.score / bucket.entries) * 10) / 10 : null,
        entries: bucket?.entries ?? 0,
      }
    }),
    // Distribuição na ordem canônica da escala (pior → melhor), com os humores
    // sem registro presentes e zerados: a barra some se a fatia desaparecer.
    distribution: MOOD_OPTIONS.map((option) => ({
      key: option.value,
      label: option.label,
      count: countByMood.get(option.value) ?? 0,
    })),
  }
}

/**
 * Alcance do Mural da empresa. Não existe telemetria de visualização por post —
 * `uniqueViewers` é quem abriu a *tela* do Mural no período, e por post
 * devolvemos comentários, reações e pessoas distintas que interagiram.
 *
 * O Mural é da empresa inteira (não é recortado por setor), então o filtro de
 * setor se aplica a quem *interage*, não a quais posts aparecem.
 */
async function loadMuralReach(
  companyId: string,
  audience: AnalyticsAudience,
  window: Window,
): Promise<MuralReachDTO> {
  const db = scopedPrisma(companyId)
  const inWindow = { gte: window.since, lt: window.until }
  // O recorte vale para quem interage, e as duas tabelas nomeiam a pessoa de
  // formas diferentes (`authorId` no comentário, `userId` na reação).
  const commentWhere =
    audience.kind === 'users'
      ? { authorId: { in: audience.userIds } }
      : audience.sectorId
        ? { author: { sectorId: audience.sectorId } }
        : undefined
  const reactionWhere =
    audience.kind === 'users'
      ? { userId: { in: audience.userIds } }
      : audience.sectorId
        ? { user: { sectorId: audience.sectorId } }
        : undefined

  const [postCount, posts, uniqueViewers] = await Promise.all([
    db.corporatePost.count({ where: { createdAt: inWindow } }),
    db.corporatePost.findMany({
      where: { createdAt: inWindow },
      orderBy: { createdAt: 'desc' },
      take: MURAL_REACH_POST_LIMIT,
      select: {
        id: true,
        content: true,
        createdAt: true,
        author: { select: { name: true } },
        comments: { select: { authorId: true }, where: commentWhere },
        reactions: { select: { userId: true }, where: reactionWhere },
      },
    }),
    countUniqueMuralViewers(companyId, audience, window),
  ])

  const postDTOs: MuralPostReachDTO[] = posts.map((post) => ({
    postId: post.id,
    authorName: post.author.name,
    excerpt: post.content.length > 120 ? `${post.content.slice(0, 117)}…` : post.content,
    createdAt: post.createdAt.toISOString(),
    comments: post.comments.length,
    reactions: post.reactions.length,
    engagedUsers: new Set([
      ...post.comments.map((comment) => comment.authorId),
      ...post.reactions.map((reaction) => reaction.userId),
    ]).size,
  }))

  return { postCount, uniqueViewers, posts: postDTOs }
}

async function countUniqueMuralViewers(companyId: string, audience: AnalyticsAudience, window: Window): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COUNT(DISTINCT al."userId")::int AS total
    FROM "AccessLog" al
    JOIN "User" u ON u."id" = al."userId"
    WHERE al."companyId" = ${companyId}
      AND al."createdAt" >= ${window.since}
      AND al."createdAt" < ${window.until}
      AND al."path" = '/mural'
      ${audienceFilter(audience)}
  `
  return rows[0]?.total ?? 0
}

export async function getEngagementOverview(scope: AnalyticsScope): Promise<EngagementOverviewDTO> {
  const now = scope.now ?? new Date()
  const { companyId, sectorId, range } = scope
  const window = resolveWindow(range, now)

  const audience = sectorAudience(sectorId)
  const [mood, muralReach, topScreens] = await Promise.all([
    loadMoodSummary(companyId, audience, window),
    loadMuralReach(companyId, audience, window),
    loadTopScreens(companyId, audience, window),
  ])

  return { range, sectorId, mood, muralReach, topScreens }
}
