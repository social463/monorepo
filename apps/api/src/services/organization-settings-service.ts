import type { UserRole } from '@prisma/client'
import type { OrganizationSettingsDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

const RESPONSIBLE_ROLES = ['HEAD', 'MANAGER', 'LEAD', 'LEGEND'] as const satisfies readonly UserRole[]

export class OrganizationSettingsError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'OrganizationSettingsError'
  }
}

export async function getOrganizationSettings(companyId: string): Promise<OrganizationSettingsDTO> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } })
  if (!company) throw new OrganizationSettingsError('Empresa não encontrada.', 404)
  const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT cr."userId"
    FROM "CompanyResponsible" cr
    INNER JOIN "User" u ON u."id" = cr."userId"
    WHERE cr."companyId" = ${companyId}
    ORDER BY u."name" ASC
  `
  return { companyResponsibleIds: rows.map((row) => row.userId) }
}

export async function updateOrganizationSettings(
  companyResponsibleIds: string[],
  actorId: string,
  companyId: string,
): Promise<OrganizationSettingsDTO> {
  const uniqueIds = Array.from(new Set(companyResponsibleIds))
  if (uniqueIds.length > 20) {
    throw new OrganizationSettingsError('Selecione no máximo 20 responsáveis pela empresa.', 400)
  }
  if (uniqueIds.length > 0) {
    const responsibles = await scopedPrisma(companyId).user.findMany({
      where: {
        id: { in: uniqueIds },
        active: true,
        leftAt: null,
        role: { in: [...RESPONSIBLE_ROLES] },
        sector: { active: true },
      },
      select: { id: true },
    })
    if (responsibles.length !== uniqueIds.length) {
      throw new OrganizationSettingsError('Todos os responsáveis devem ser colaboradores ativos da empresa.', 400)
    }
  }

  const before = await getOrganizationSettings(companyId)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM "CompanyResponsible" WHERE "companyId" = ${companyId}`
    for (const userId of uniqueIds) {
      await tx.$executeRaw`
        INSERT INTO "CompanyResponsible" ("companyId", "userId")
        VALUES (${companyId}, ${userId})
      `
    }
  })
  const after = { companyResponsibleIds: uniqueIds }
  await recordAuditLog({
    actorId,
    entityType: 'Company',
    entityId: companyId,
    action: 'UPDATE',
    before,
    after,
    companyId,
  })
  return after
}
