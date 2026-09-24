import { Prisma } from '@prisma/client'
import type {
  AccessHeatmapCellDTO,
  AccessHeatmapDTO,
  AccessSeriesPointDTO,
  AnalyticsWindowRequest,
  DistributionSliceDTO,
  EngagementOverviewDTO,
  EngagementSeriesPointDTO,
  InovaAccessLogRowDTO,
  InovaAnalyticsDTO,
  MoodLevel,
  MoodSummaryDTO,
  MuralPostReachDTO,
  MuralReachDTO,
  PeopleOverviewDTO,
  ScreenAccessDTO,
} from '@legends/shared'
import {
  ANALYTICS_WINDOW_MAX_DAYS,
  INOVA_ACCESS_LOG_LIMIT,
  MOOD_OPTIONS,
  MOOD_SCORES,
  PEOPLE_ANALYTICS_RANGE_DAYS,
  SESSION_GAP_MINUTES,
  USER_ROLE_LABELS,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { addDays, saoPauloMidnightUtc, ymdInSaoPaulo, ymdOf } from '../lib/sao-paulo-date'

/** Quantos posts do Mural o bloco de alcance devolve (os mais recentes). */
const MURAL_REACH_POST_LIMIT = 10

/** Quantas telas o ranking de páginas mais acessadas devolve. */
const TOP_SCREENS_LIMIT = 10

export interface AnalyticsScope {
  companyId: string
  /** Null = empresa inteira (ADMIN sem filtro). */
  sectorId: string | null
  window: AnalyticsWindowRequest
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

export class AnalyticsWindowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnalyticsWindowError'
  }
}

/** Monta a janela a partir das duas pontas civis, inclusivas nos dois lados. */
function windowBetween(startYmd: string, endYmd: string): Window {
  const days: string[] = []
  for (let ymd = startYmd; ymd <= endYmd; ymd = addDays(ymd, 1)) days.push(ymd)
  return {
    since: saoPauloMidnightUtc(startYmd),
    until: saoPauloMidnightUtc(addDays(endYmd, 1)),
    days,
  }
}

/**
 * A janela é sempre em **dias civis de São Paulo, hoje incluso** — não N*24h
 * para trás. Isso mantém a série alinhada com o calendário que o usuário vê, em
 * vez de cortar o dia atual pela metade.
 *
 * `custom` recebe as duas pontas da tela; os atalhos derivam de hoje. `ano` é
 * "este ano" (1º de janeiro até hoje), então o tamanho dele muda com a data —
 * é por isso que ele não tem entrada em `PEOPLE_ANALYTICS_RANGE_DAYS`.
 */
export function resolveWindow(request: AnalyticsWindowRequest, now: Date): Window {
  const todayYmd = ymdInSaoPaulo(now)

  if (request.range === 'custom') {
    const { from, to } = request
    if (!from || !to) throw new AnalyticsWindowError('Informe a data inicial e a final do período.')
    if (from > to) throw new AnalyticsWindowError('A data inicial não pode ser depois da final.')
    const window = windowBetween(from, to)
    if (window.days.length > ANALYTICS_WINDOW_MAX_DAYS) {
      throw new AnalyticsWindowError(
        `O período personalizado é de no máximo ${ANALYTICS_WINDOW_MAX_DAYS} dias.`,
      )
    }
    return window
  }

  if (request.range === 'ano') return windowBetween(`${todayYmd.slice(0, 4)}-01-01`, todayYmd)

  const totalDays = PEOPLE_ANALYTICS_RANGE_DAYS[request.range]
  return windowBetween(addDays(todayYmd, -(totalDays - 1)), todayYmd)
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

/**
 * Distintos e total na mesma passada — são os cards "Únicos no período" e
 * "Acessos no período", e ler a mesma faixa de `AccessLog` duas vezes para
 * responder os dois seria desperdício.
 */
async function loadAccessTotals(
  companyId: string,
  audience: AnalyticsAudience,
  window: Window,
): Promise<{ uniqueUsers: number; accesses: number }> {
  const rows = await prisma.$queryRaw<{ uniqueUsers: number; accesses: number }[]>`
    SELECT COUNT(DISTINCT al."userId")::int AS "uniqueUsers",
           COUNT(*)::int AS accesses
    FROM "AccessLog" al
    JOIN "User" u ON u."id" = al."userId"
    WHERE al."companyId" = ${companyId}
      AND al."createdAt" >= ${window.since}
      AND al."createdAt" < ${window.until}
      ${audienceFilter(audience)}
  `
  return { uniqueUsers: rows[0]?.uniqueUsers ?? 0, accesses: rows[0]?.accesses ?? 0 }
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

/**
 * Série diária do gráfico de engajamento do Dashboard: feedbacks escritos,
 * reações e comentários por dia.
 *
 * Três consultas Prisma agrupadas em JS, e não SQL cru: as três tabelas são
 * independentes, e um `UNION ALL` de três selects com fuso de São Paulo em cada
 * um seria mais difícil de ler do que três `groupBy` óbvios. O volume é de
 * dias, não de linhas — a janela tem teto de `ANALYTICS_WINDOW_MAX_DAYS`.
 */
async function loadEngagementSeries(
  companyId: string,
  sectorId: string | null,
  window: Window,
): Promise<EngagementSeriesPointDTO[]> {
  const [feedbacks, reactions, comments] = await Promise.all([
    prisma.$queryRaw<{ day: string; total: number }[]>`
      SELECT to_char((f."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS total
      FROM "Feedback" f JOIN "User" u ON u."id" = f."authorId"
      WHERE f."companyId" = ${companyId} AND f."createdAt" >= ${window.since} AND f."createdAt" < ${window.until}
        ${sectorId ? Prisma.sql`AND u."sectorId" = ${sectorId}` : Prisma.empty}
      GROUP BY 1
    `,
    prisma.$queryRaw<{ day: string; total: number }[]>`
      SELECT to_char((r."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS total
      FROM "FeedbackReaction" r JOIN "User" u ON u."id" = r."userId"
      WHERE r."companyId" = ${companyId} AND r."createdAt" >= ${window.since} AND r."createdAt" < ${window.until}
        ${sectorId ? Prisma.sql`AND u."sectorId" = ${sectorId}` : Prisma.empty}
      GROUP BY 1
    `,
    prisma.$queryRaw<{ day: string; total: number }[]>`
      SELECT to_char((c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS total
      FROM "FeedbackComment" c JOIN "User" u ON u."id" = c."authorId"
      WHERE c."companyId" = ${companyId} AND c."createdAt" >= ${window.since} AND c."createdAt" < ${window.until}
        ${sectorId ? Prisma.sql`AND u."sectorId" = ${sectorId}` : Prisma.empty}
      GROUP BY 1
    `,
  ])
  const map = (rows: { day: string; total: number }[]) => new Map(rows.map((r) => [r.day, r.total]))
  const [f, r, c] = [map(feedbacks), map(reactions), map(comments)]
  return window.days.map((day) => ({
    day,
    feedbacks: f.get(day) ?? 0,
    reactions: r.get(day) ?? 0,
    comments: c.get(day) ?? 0,
  }))
}

/**
 * Feedbacks por **competência** do catálogo da empresa, na janela.
 *
 * Conta VÍNCULOS (`FeedbackRecognitionCategory`), não feedbacks: um feedback com
 * três competências entra nas três. A soma passar do total de feedbacks é
 * esperado, e a tela diz isso.
 */
async function loadFeedbackCategoryDistribution(
  companyId: string,
  sectorId: string | null,
  window: Window,
): Promise<DistributionSliceDTO[]> {
  const rows = await scopedPrisma(companyId).feedbackRecognitionCategory.findMany({
    where: {
      feedback: {
        createdAt: { gte: window.since, lt: window.until },
        ...(sectorId ? { author: { sectorId } } : {}),
      },
    },
    select: { categoryId: true, category: { select: { name: true } } },
  })
  const counts = new Map<string, { label: string; count: number }>()
  for (const row of rows) {
    const current = counts.get(row.categoryId)
    if (current) current.count += 1
    else counts.set(row.categoryId, { label: row.category.name, count: 1 })
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, label: value.label, count: value.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
}

/**
 * Feedbacks por **tag**: a `customCategory`, texto livre digitado por quem
 * escreve quando a competência não estava no catálogo.
 *
 * Agrupa sem caixa e sem acento — "Proatividade" e "proatividade" são a mesma
 * tag para quem lê o painel, e separá-las só produziria duas barras de 1.
 */
async function loadFeedbackTagDistribution(
  companyId: string,
  sectorId: string | null,
  window: Window,
): Promise<DistributionSliceDTO[]> {
  const rows = await scopedPrisma(companyId).feedback.findMany({
    where: {
      createdAt: { gte: window.since, lt: window.until },
      customCategory: { not: null },
      ...(sectorId ? { author: { sectorId } } : {}),
    },
    select: { customCategory: true },
  })
  const counts = new Map<string, { label: string; count: number }>()
  for (const row of rows) {
    const raw = row.customCategory?.trim()
    if (!raw) continue
    const key = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
    const current = counts.get(key)
    if (current) current.count += 1
    else counts.set(key, { label: raw, count: 1 })
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, label: value.label, count: value.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
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
  '/comunidade-inova/guia': 'Guia: Início',
  '/comunidade-inova/guia/bussola': 'Guia: Bússola',
  '/comunidade-inova/guia/situacoes': 'Guia: Situações',
  '/comunidade-inova/guia/na-pratica': 'Guia: Na prática',
  '/comunidade-inova/guia/videos': 'Guia: Vídeos',
  '/comunidade-inova/guia/prompts': 'Guia: Prompts',
  '/comunidade-inova/guia/maturidade': 'Guia: Maturidade',
  '/comunidade-inova/guia/lideranca': 'Guia: Liderança',
  '/comunidade-inova/guia/seguranca': 'Guia: Segurança',
  '/comunidade-inova/guia/cases': 'Guia: Casos',
  '/comunidade-inova/guia/completo': 'Guia: Guia completo',
}

/** Prefixo de path das 11 páginas do Guia AI First (Comunidade INOVA). */
const INOVA_GUIA_PATH_PREFIX = '/comunidade-inova/guia'

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

export async function getPeopleOverview(scope: AnalyticsScope): Promise<PeopleOverviewDTO> {
  const now = scope.now ?? new Date()
  const { companyId, sectorId } = scope
  const window = resolveWindow(scope.window, now)
  const db = scopedPrisma(companyId)
  const sectorWhere = sectorId ? { sectorId } : {}
  const inWindow = { gte: window.since, lt: window.until }
  const audience = sectorAudience(sectorId)
  // O recorte de setor do feedback é pelo AUTOR: "feedbacks do setor" é o que o
  // setor escreveu. Pelo destinatário, o número mudaria de significado no meio
  // da mesma tela — a distribuição por competência usa o mesmo critério.
  const authorWhere = sectorId ? { author: { sectorId } } : {}

  const [
    activePeople,
    accessTotals,
    accessSeries,
    engagementSeries,
    feedbacksCount,
    feedbackReactionsCount,
    postsPublished,
    feedbacksByCategory,
    feedbacksByTag,
    byRole,
    bySquad,
  ] = await Promise.all([
    db.user.count({ where: { active: true, ...sectorWhere } }),
    // Uma passada só devolve os dois cards: distintos e total. Duas queries
    // separadas leriam a mesma faixa de `AccessLog` duas vezes.
    loadAccessTotals(companyId, audience, window),
    loadAccessSeries(companyId, audience, window),
    loadEngagementSeries(companyId, sectorId, window),
    db.feedback.count({ where: { createdAt: inWindow, ...authorWhere } }),
    db.feedbackReaction.count({
      where: { createdAt: inWindow, ...(sectorId ? { user: { sectorId } } : {}) },
    }),
    db.corporatePost.count({ where: { status: 'PUBLISHED', createdAt: inWindow } }),
    loadFeedbackCategoryDistribution(companyId, sectorId, window),
    loadFeedbackTagDistribution(companyId, sectorId, window),
    loadRoleDistribution(companyId, sectorId),
    loadSquadDistribution(companyId, sectorId),
  ])

  return {
    range: scope.window.range,
    from: window.days[0]!,
    to: window.days[window.days.length - 1]!,
    days: window.days.length,
    sectorId,
    activePeople,
    uniqueUsersInRange: accessTotals.uniqueUsers,
    accessesInRange: accessTotals.accesses,
    adoptionRate: activePeople > 0 ? Math.round((accessTotals.uniqueUsers / activePeople) * 100) : 0,
    accessSeries,
    engagementSeries,
    feedbacksCount,
    feedbackReactionsCount,
    postsPublished,
    feedbacksByCategory,
    feedbacksByTag,
    byRole,
    bySquad,
  }
}

/**
 * Tempo médio de sessão, **derivado** do `AccessLog`.
 *
 * O portal não captura duração: `AccessLog` guarda (usuário, tela, instante) e
 * nada mais. A sessão é reconstruída aqui — acessos consecutivos da mesma pessoa
 * pertencem à mesma sessão enquanto o intervalo entre eles for menor que
 * `SESSION_GAP_MINUTES`; a duração vai do primeiro ao último acesso.
 *
 * Derivar em vez de instrumentar foi escolha do recorte: o painel tem filtro de
 * período, e um heartbeat só mediria daqui para frente — a G&G ficaria sem
 * número para qualquer mês passado. O histórico que já existe responde hoje.
 *
 * O número é **piso**, não média exata: a última tela da sessão não tem acesso
 * seguinte que a feche, então uma sessão de um acesso só vale zero. É o mesmo
 * limite de qualquer analytics baseado em pageview, e a tela diz isso.
 */
async function computeSessionStats(
  companyId: string,
  audience: AnalyticsAudience,
  window: Window,
): Promise<{ avgSessionMinutes: number | null; sessions: number }> {
  const rows = await prisma.$queryRaw<{ userId: string; at: Date }[]>`
    SELECT al."userId" AS "userId", al."createdAt" AS at
    FROM "AccessLog" al
    JOIN "User" u ON u."id" = al."userId"
    WHERE al."companyId" = ${companyId}
      AND al."createdAt" >= ${window.since}
      AND al."createdAt" < ${window.until}
      ${audienceFilter(audience)}
    ORDER BY al."userId", al."createdAt"
  `
  const gapMs = SESSION_GAP_MINUTES * 60_000
  let sessions = 0
  let totalMs = 0
  let currentUser: string | null = null
  let sessionStart = 0
  let lastAt = 0

  const closeSession = () => {
    if (currentUser === null) return
    sessions += 1
    totalMs += lastAt - sessionStart
  }

  for (const row of rows) {
    const at = row.at.getTime()
    if (row.userId !== currentUser) {
      closeSession()
      currentUser = row.userId
      sessionStart = at
    } else if (at - lastAt > gapMs) {
      closeSession()
      sessionStart = at
    }
    lastAt = at
  }
  closeSession()

  if (sessions === 0) return { avgSessionMinutes: null, sessions: 0 }
  return { avgSessionMinutes: Math.round((totalMs / sessions / 60_000) * 10) / 10, sessions }
}

export async function getAccessHeatmap(scope: AnalyticsScope): Promise<AccessHeatmapDTO> {
  const window = resolveWindow(scope.window, scope.now ?? new Date())
  const audience = sectorAudience(scope.sectorId)
  const [cells, sessionStats] = await Promise.all([
    loadAccessHeatmap(scope.companyId, audience, window),
    computeSessionStats(scope.companyId, audience, window),
  ])
  return {
    from: window.days[0]!,
    to: window.days[window.days.length - 1]!,
    days: window.days.length,
    sectorId: scope.sectorId,
    cells,
    ...sessionStats,
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
  const { companyId, sectorId } = scope
  const window = resolveWindow(scope.window, now)

  const audience = sectorAudience(sectorId)
  const [mood, muralReach, topScreens] = await Promise.all([
    loadMoodSummary(companyId, audience, window),
    loadMuralReach(companyId, audience, window),
    loadTopScreens(companyId, audience, window),
  ])

  return {
    range: scope.window.range,
    from: window.days[0]!,
    to: window.days[window.days.length - 1]!,
    days: window.days.length,
    sectorId,
    mood,
    muralReach,
    topScreens,
  }
}

// ---------------------------------------------------------------------------
// Comunidade INOVA — sub-aba de Desenvolvimento (Guia AI First)
// ---------------------------------------------------------------------------

/** Acessos por página do Guia no recorte — mesma forma de `loadTopScreens`, filtrado ao prefixo. */
async function loadInovaByPage(
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
      AND al."path" LIKE ${`${INOVA_GUIA_PATH_PREFIX}%`}
      ${audienceFilter(audience)}
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
  `
  return rows.map((row) => ({
    path: row.path,
    label: screenLabel(row.path),
    accesses: row.accesses,
    uniqueUsers: row.uniqueUsers,
  }))
}

/** Total de acessos e usuários únicos no recorte — só páginas do Guia. */
async function loadInovaTotals(
  companyId: string,
  audience: AnalyticsAudience,
  window: Window,
): Promise<{ totalAccesses: number; uniqueUsers: number }> {
  const rows = await prisma.$queryRaw<{ totalAccesses: number; uniqueUsers: number }[]>`
    SELECT COUNT(*)::int AS "totalAccesses",
           COUNT(DISTINCT al."userId")::int AS "uniqueUsers"
    FROM "AccessLog" al
    JOIN "User" u ON u."id" = al."userId"
    WHERE al."companyId" = ${companyId}
      AND al."createdAt" >= ${window.since}
      AND al."createdAt" < ${window.until}
      AND al."path" LIKE ${`${INOVA_GUIA_PATH_PREFIX}%`}
      ${audienceFilter(audience)}
  `
  return { totalAccesses: rows[0]?.totalAccesses ?? 0, uniqueUsers: rows[0]?.uniqueUsers ?? 0 }
}

/**
 * Log de acessos recentes ao Guia, com quem acessou — diferente do resto do
 * People Analytics (só agregados): aqui o pedido explícito foi listar pessoa,
 * página e horário, como "quem visitou o quê". Limitado a
 * `INOVA_ACCESS_LOG_LIMIT` linhas; `total` é o recorte inteiro, para a tela
 * poder dizer "mostrando X de Y".
 */
async function loadInovaRecentLogs(
  companyId: string,
  audience: AnalyticsAudience,
  window: Window,
): Promise<{ rows: InovaAccessLogRowDTO[]; total: number }> {
  const db = scopedPrisma(companyId)
  const where: Prisma.AccessLogWhereInput = {
    path: { startsWith: INOVA_GUIA_PATH_PREFIX },
    createdAt: { gte: window.since, lt: window.until },
    ...(audience.kind === 'users'
      ? { userId: { in: audience.userIds } }
      : audience.sectorId
        ? { user: { sectorId: audience.sectorId } }
        : {}),
  }

  const [rows, total] = await Promise.all([
    db.accessLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: INOVA_ACCESS_LOG_LIMIT,
      select: { id: true, path: true, createdAt: true, user: { select: { name: true, email: true } } },
    }),
    db.accessLog.count({ where }),
  ])

  return {
    rows: rows.map((row) => ({
      id: row.id,
      userName: row.user.name,
      userEmail: row.user.email,
      path: row.path,
      label: screenLabel(row.path),
      createdAt: row.createdAt.toISOString(),
    })),
    total,
  }
}

export async function getInovaOverview(scope: AnalyticsScope): Promise<InovaAnalyticsDTO> {
  const now = scope.now ?? new Date()
  const { companyId, sectorId } = scope
  const window = resolveWindow(scope.window, now)
  const audience = sectorAudience(sectorId)

  const [byPage, totals, { rows: recentLogs, total: recentLogsTotal }] = await Promise.all([
    loadInovaByPage(companyId, audience, window),
    loadInovaTotals(companyId, audience, window),
    loadInovaRecentLogs(companyId, audience, window),
  ])

  return {
    range: scope.window.range,
    from: window.days[0]!,
    to: window.days[window.days.length - 1]!,
    days: window.days.length,
    sectorId,
    totalAccesses: totals.totalAccesses,
    uniqueUsers: totals.uniqueUsers,
    topPage: byPage[0] ?? null,
    byPage,
    recentLogs,
    recentLogsTotal,
  }
}
