import { prisma } from './prisma'

/** Features habilitadas para o setor (via `Sector.enabledFeatures`); [] se o setor não existir. */
export async function sectorFeaturesFor(sectorId: string): Promise<string[]> {
  const sector = await prisma.sector.findUnique({ where: { id: sectorId } })
  return Array.isArray(sector?.enabledFeatures) ? (sector.enabledFeatures as string[]) : []
}

/** Nome de cada setor, em lote (evita N+1 ao resolver vários usuários de setores diferentes). */
export async function sectorNamesFor(sectorIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(sectorIds)]
  if (unique.length === 0) return new Map()
  const sectors = await prisma.sector.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
  return new Map(sectors.map((s) => [s.id, s.name]))
}
