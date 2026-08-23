import type { Prisma } from '@prisma/client'
import type {
  GlassAggregateAlertDTO,
  GlassBreakdownRowDTO,
  GlassCrossTabCellDTO,
  GlassDimension,
  GlassOverviewDTO,
  GlassSentiment,
  GlassThemeCountDTO,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { aggregateAlerts } from '../lib/glass-alerts'
import { averageOf, monthlyTrend, roundRating } from '../lib/glass-trend'
import type { GlassActor } from './glass-review-service'

/**
 * Relatórios do GlassAgent. **Todo número desta tela nasce aqui**, em agregação
 * no Postgres sob `scopedPrisma` — nunca no modelo. É a correção central em
 * relação ao portal de origem, onde a "média por setor" saía do que coubesse na
 * janela de contexto da conversa.
 *
 * Nada de `$queryRaw`: SQL literal escapa da extensão de isolamento e passaria a
 * somar avaliações de outra empresa sem nenhum sinal.
 */

export interface GlassOverviewFilters {
  from?: Date
  to?: Date
  sector?: string
}

/** Nome da dimensão (o que o usuário digita) → coluna do banco. */
export const DIMENSION_COLUMN: Record<GlassDimension, 'sector' | 'role' | 'tenure' | 'status'> = {
  setor: 'sector',
  cargo: 'role',
  tempo: 'tenure',
  status: 'status',
}

function whereFrom(filters: GlassOverviewFilters): Prisma.GlassReviewWhereInput {
  const where: Prisma.GlassReviewWhereInput = {}
  if (filters.sector) where.sector = filters.sector
  if (filters.from || filters.to) {
    where.reviewDate = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    }
  }
  return where
}

/**
 * Recorte por coluna (setor/cargo/tempo/status), calculado **em memória** a
 * partir das linhas já carregadas — não é `groupBy`. As linhas já estão em mãos
 * para tendência/temas/alertas; reaproveitá-las aqui custa menos que uma ida
 * extra ao banco por recorte. `count` conta toda linha do grupo, com ou sem
 * nota; `averageRating` é `null` só quando nenhuma linha do grupo tem nota.
 */
function breakdown(entries: { key: string | null; rating: number | null }[]): GlassBreakdownRowDTO[] {
  const groups = new Map<string, { count: number; ratings: number[] }>()
  for (const entry of entries) {
    if (entry.key === null) continue
    const group = groups.get(entry.key) ?? { count: 0, ratings: [] }
    group.count += 1
    if (entry.rating !== null) group.ratings.push(entry.rating)
    groups.set(entry.key, group)
  }

  return [...groups]
    .map(([key, group]) => ({
      key,
      count: group.count,
      averageRating: averageOf(group.ratings),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

function countThemes(lists: string[][]): GlassThemeCountDTO[] {
  const counts = new Map<string, number>()
  for (const list of lists) {
    for (const theme of list) counts.set(theme, (counts.get(theme) ?? 0) + 1)
  }
  return [...counts]
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme))
}

/** Proporção sobre quem **respondeu**: quem não respondeu não é "não". */
function rateOf(values: (boolean | null)[]): number | null {
  const answered = values.filter((value): value is boolean => value !== null)
  if (answered.length === 0) return null
  return answered.filter(Boolean).length / answered.length
}

export async function getGlassOverview(
  actor: GlassActor,
  filters: GlassOverviewFilters,
): Promise<GlassOverviewDTO> {
  const db = scopedPrisma(actor.companyId)
  const where = whereFrom(filters)

  // Uma única ida ao banco: as linhas cruas já servem à tendência, aos temas,
  // às taxas, aos alertas agregados e agora também aos quatro recortes
  // (bySector/byRole/byTenure/byStatus), calculados em memória logo abaixo.
  // Três colunas a mais no `select` custam menos que quatro `groupBy` extras.
  const rows = await db.glassReview.findMany({
    where,
    select: {
      reviewDate: true,
      rating: true,
      sector: true,
      role: true,
      tenure: true,
      status: true,
      sentiment: true,
      recommends: true,
      leadershipApproval: true,
      themesPositive: true,
      themesNegative: true,
    },
  })

  const ratings = rows.map((row) => (row.rating === null ? null : Number(row.rating)))
  const sentimentCounts: Record<GlassSentiment, number> = { POSITIVO: 0, NEUTRO: 0, NEGATIVO: 0 }
  for (const row of rows) {
    if (row.sentiment) sentimentCounts[row.sentiment] += 1
  }

  const alerts: GlassAggregateAlertDTO[] = aggregateAlerts(
    rows.map((row, index) => ({ rating: ratings[index], sector: row.sector, reviewDate: row.reviewDate })),
  )

  return {
    totalReviews: rows.length,
    averageRating: averageOf(ratings.filter((value): value is number => value !== null)),
    recommendRate: rateOf(rows.map((row) => row.recommends)),
    leadershipApprovalRate: rateOf(rows.map((row) => row.leadershipApproval)),
    sentimentCounts,
    trend: monthlyTrend(rows.map((row, index) => ({ reviewDate: row.reviewDate, rating: ratings[index] }))),
    bySector: breakdown(rows.map((row, index) => ({ key: row.sector, rating: ratings[index] }))),
    byRole: breakdown(rows.map((row, index) => ({ key: row.role, rating: ratings[index] }))),
    byTenure: breakdown(rows.map((row, index) => ({ key: row.tenure, rating: ratings[index] }))),
    byStatus: breakdown(rows.map((row, index) => ({ key: row.status, rating: ratings[index] }))),
    topThemesPositive: countThemes(rows.map((row) => row.themesPositive)),
    topThemesNegative: countThemes(rows.map((row) => row.themesNegative)),
    alerts,
  }
}

export async function getGlassCrossTab(
  actor: GlassActor,
  rowDim: GlassDimension,
  columnDim: GlassDimension,
): Promise<GlassCrossTabCellDTO[]> {
  const rowColumn = DIMENSION_COLUMN[rowDim]
  const columnColumn = DIMENSION_COLUMN[columnDim]

  const rows = await scopedPrisma(actor.companyId).glassReview.groupBy({
    by: [rowColumn, columnColumn],
    _count: { _all: true },
    _avg: { rating: true },
  })

  return rows
    .filter((row) => row[rowColumn] !== null && row[columnColumn] !== null)
    .map((row) => ({
      rowKey: row[rowColumn] as string,
      columnKey: row[columnColumn] as string,
      count: row._count._all,
      averageRating: row._avg.rating === null ? null : roundRating(Number(row._avg.rating)),
    }))
    .sort((a, b) => a.rowKey.localeCompare(b.rowKey) || a.columnKey.localeCompare(b.columnKey))
}
