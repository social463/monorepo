import {
  DEFAULT_ADOPTION_WINDOW,
  type AdoptionOverviewDTO,
  type AdoptionWindow,
  type CompanyAdoptionDTO,
  type EventCountDTO,
  type SectorAdoptionDTO,
} from '@legends/shared'
import { prisma } from '../lib/prisma'

/** Quantos eventos distintos listar por empresa. */
const TOP_EVENTS_LIMIT = 5

/**
 * Painel de adoção do super-admin.
 *
 * **Cross-tenant de propósito**, e por isso usa `prisma` cru em vez de
 * `scopedPrisma` — mesma escolha do resto de `routes/super-admin.ts`. A rota
 * está atrás de `requireSuperAdmin`; é ela que garante que ninguém de uma
 * empresa veja a de outra.
 *
 * Agregação em SQL, no padrão do `people-analytics-service`: `COUNT(DISTINCT)`
 * não sai do `groupBy` do Prisma, e trazer as linhas para contar em JS não
 * escala com o volume que a tabela ganha ao longo dos meses.
 */
async function loadCompanyTotals(since: Date): Promise<Map<string, { activeUsers: number; totalEvents: number; lastEventAt: Date | null }>> {
  const rows = await prisma.$queryRaw<
    { companyId: string; activeUsers: number; totalEvents: number; lastEventAt: Date | null }[]
  >`
    SELECT "companyId",
           COUNT(DISTINCT "userId")::int AS "activeUsers",
           COUNT(*)::int                 AS "totalEvents",
           MAX("occurredAt")             AS "lastEventAt"
    FROM "AnalyticsEvent"
    WHERE "occurredAt" >= ${since}
    GROUP BY 1
  `
  return new Map(rows.map((row) => [row.companyId, row]))
}

async function loadSectorTotals(since: Date): Promise<Map<string, SectorAdoptionDTO[]>> {
  // `LEFT JOIN` no setor: o `sectorId` do evento é um snapshot histórico e pode
  // apontar para um setor já removido. Perder a linha inteira nesse caso
  // esconderia uso real do painel, então o setor sumido vira um rótulo.
  const rows = await prisma.$queryRaw<
    { companyId: string; sectorId: string | null; sectorName: string | null; activeUsers: number; totalEvents: number }[]
  >`
    SELECT ae."companyId",
           ae."sectorId",
           s."name" AS "sectorName",
           COUNT(DISTINCT ae."userId")::int AS "activeUsers",
           COUNT(*)::int                    AS "totalEvents"
    FROM "AnalyticsEvent" ae
    LEFT JOIN "Sector" s ON s."id" = ae."sectorId"
    WHERE ae."occurredAt" >= ${since}
      AND ae."sectorId" IS NOT NULL
    GROUP BY 1, 2, 3
    ORDER BY "totalEvents" DESC
  `

  const bySector = new Map<string, SectorAdoptionDTO[]>()
  for (const row of rows) {
    const list = bySector.get(row.companyId) ?? []
    list.push({
      sectorId: row.sectorId ?? '',
      sectorName: row.sectorName ?? 'Setor removido',
      activeUsers: row.activeUsers,
      totalEvents: row.totalEvents,
    })
    bySector.set(row.companyId, list)
  }
  return bySector
}

async function loadTopEvents(since: Date): Promise<Map<string, EventCountDTO[]>> {
  const rows = await prisma.$queryRaw<{ companyId: string; name: string; count: number }[]>`
    SELECT "companyId", "name", COUNT(*)::int AS "count"
    FROM "AnalyticsEvent"
    WHERE "occurredAt" >= ${since}
    GROUP BY 1, 2
    ORDER BY "count" DESC
  `

  const byCompany = new Map<string, EventCountDTO[]>()
  for (const row of rows) {
    const list = byCompany.get(row.companyId) ?? []
    if (list.length < TOP_EVENTS_LIMIT) {
      list.push({ name: row.name, count: row.count })
    }
    byCompany.set(row.companyId, list)
  }
  return byCompany
}

export async function getAdoptionOverview(
  windowDays: AdoptionWindow = DEFAULT_ADOPTION_WINDOW,
  now: Date = new Date(),
): Promise<AdoptionOverviewDTO> {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)

  const [companies, totals, sectors, topEvents, userCounts] = await Promise.all([
    prisma.company.findMany({ select: { id: true, name: true, active: true }, orderBy: { name: 'asc' } }),
    loadCompanyTotals(since),
    loadSectorTotals(since),
    loadTopEvents(since),
    prisma.user.groupBy({ by: ['companyId'], where: { active: true }, _count: { _all: true } }),
  ])

  const usersByCompany = new Map(userCounts.map((row) => [row.companyId, row._count._all]))

  // Toda empresa aparece, inclusive a que não gerou evento nenhum. Empresa com
  // zero é exatamente o que o painel precisa mostrar — some da lista quem
  // parou de usar, que é o caso mais importante de detectar.
  const rows: CompanyAdoptionDTO[] = companies.map((company) => {
    const total = totals.get(company.id)
    return {
      companyId: company.id,
      companyName: company.name,
      active: company.active,
      activeUsers: total?.activeUsers ?? 0,
      totalUsers: usersByCompany.get(company.id) ?? 0,
      totalEvents: total?.totalEvents ?? 0,
      lastEventAt: total?.lastEventAt ? new Date(total.lastEventAt).toISOString() : null,
      sectors: sectors.get(company.id) ?? [],
      topEvents: topEvents.get(company.id) ?? [],
    }
  })

  rows.sort((a, b) => b.totalEvents - a.totalEvents || a.companyName.localeCompare(b.companyName, 'pt-BR'))

  return { windowDays, since: since.toISOString(), companies: rows }
}
