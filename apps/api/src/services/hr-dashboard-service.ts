import { Prisma, type HrDashboard } from '@prisma/client'
import {
  HR_DASHBOARD_DEFAULT_HEIGHT,
  HR_DASHBOARD_SCOPE_ALL,
  HR_DASHBOARD_SCOPE_COMPANY,
  type CreateHrDashboardRequest,
  type UpdateHrDashboardRequest,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { resolveHrDashboardAllowedHosts } from '../lib/config'
import { assertEmbedUrlAllowed } from '../lib/embed-url'
import { HrDashboardError } from '../lib/hr-dashboard-error'
import { recordAuditLog } from './audit-log-service'

export interface HrDashboardActor {
  id: string
  role: string
  sectorId: string
  companyId: string
}

const sectorInclude = { sector: { select: { id: true, name: true } } } as const

export type HrDashboardWithSector = HrDashboard & { sector: { id: string; name: string } | null }

function validateUrl(raw: string): string {
  return assertEmbedUrlAllowed(raw, resolveHrDashboardAllowedHosts(process.env))
}

/** SUBADMIN só gerencia painel do próprio setor — nem os da empresa, nem os de outro setor. */
function assertCanManage(actor: HrDashboardActor, sectorId: string | null): void {
  if (actor.role === 'SUBADMIN' && sectorId !== actor.sectorId) {
    throw new HrDashboardError('Você só pode gerenciar painéis do seu setor.', 403)
  }
}

/**
 * Escopo de destino de uma escrita. Para o SUBADMIN, `sectorId` omitido assume o
 * setor dele; qualquer escopo explícito diferente (inclusive `null`, que é o
 * painel da empresa) é 403.
 */
function resolveSectorIdForWrite(actor: HrDashboardActor, requested: string | null | undefined): string | null {
  if (actor.role === 'SUBADMIN') {
    if (requested === undefined || requested === actor.sectorId) return actor.sectorId
    throw new HrDashboardError('Você só pode gerenciar painéis do seu setor.', 403)
  }
  return requested ?? null
}

async function assertSectorExists(companyId: string, sectorId: string | null): Promise<void> {
  if (sectorId === null) return
  // `findFirst` (e não `findUnique`) porque a extensão de isolamento acrescenta
  // companyId ao where — não existe unique composto (id, companyId).
  const sector = await scopedPrisma(companyId).sector.findFirst({ where: { id: sectorId } })
  if (!sector) throw new HrDashboardError('Setor não encontrado.', 404)
}

export function listHrDashboards(actor: HrDashboardActor, scope?: string): Promise<HrDashboardWithSector[]> {
  const db = scopedPrisma(actor.companyId)

  let where: Prisma.HrDashboardWhereInput | undefined
  if (actor.role === 'SUBADMIN') {
    where = { OR: [{ sectorId: null }, { sectorId: actor.sectorId }] }
  } else if (scope === HR_DASHBOARD_SCOPE_COMPANY) {
    where = { sectorId: null }
  } else if (scope !== undefined && scope !== HR_DASHBOARD_SCOPE_ALL) {
    where = { sectorId: scope }
  }

  return db.hrDashboard.findMany({
    where,
    include: sectorInclude,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
}

export async function createHrDashboard(
  actor: HrDashboardActor,
  input: CreateHrDashboardRequest,
): Promise<HrDashboardWithSector> {
  const db = scopedPrisma(actor.companyId)
  const embedUrl = validateUrl(input.embedUrl)
  const sectorId = resolveSectorIdForWrite(actor, input.sectorId)
  await assertSectorExists(actor.companyId, sectorId)

  return db.$transaction(async (tx) => {
    const created = await tx.hrDashboard.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        embedUrl,
        height: input.height ?? HR_DASHBOARD_DEFAULT_HEIGHT,
        sortOrder: input.sortOrder ?? 0,
        sectorId,
        createdById: actor.id,
      },
      include: sectorInclude,
    })
    // Cast igual ao dos outros services: o tx da extensão não é um
    // Prisma.TransactionClient cru, mas o companyId vai explícito no recordAuditLog.
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'HrDashboard',
      entityId: created.id,
      action: 'CREATE',
      after: created,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return created
  })
}

export async function updateHrDashboard(
  actor: HrDashboardActor,
  id: string,
  input: UpdateHrDashboardRequest,
): Promise<HrDashboardWithSector> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.hrDashboard.findFirst({ where: { id }, include: sectorInclude })
  if (!before) throw new HrDashboardError('Painel não encontrado.', 404)
  assertCanManage(actor, before.sectorId)

  const data: Prisma.HrDashboardUncheckedUpdateInput = {}
  if (input.title !== undefined) data.title = input.title
  if (input.description !== undefined) data.description = input.description ?? null
  if (input.embedUrl !== undefined) data.embedUrl = validateUrl(input.embedUrl)
  if (input.height !== undefined) data.height = input.height
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder
  if (input.sectorId !== undefined) {
    const nextSectorId = resolveSectorIdForWrite(actor, input.sectorId)
    await assertSectorExists(actor.companyId, nextSectorId)
    data.sectorId = nextSectorId
  }

  return db.$transaction(async (tx) => {
    await tx.hrDashboard.update({ where: { id }, data })
    const after = await tx.hrDashboard.findUniqueOrThrow({ where: { id }, include: sectorInclude })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'HrDashboard',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return after
  })
}

export async function deleteHrDashboard(actor: HrDashboardActor, id: string): Promise<void> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.hrDashboard.findFirst({ where: { id }, include: sectorInclude })
  if (!before) throw new HrDashboardError('Painel não encontrado.', 404)
  assertCanManage(actor, before.sectorId)

  await db.$transaction(async (tx) => {
    await tx.hrDashboard.delete({ where: { id } })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'HrDashboard',
      entityId: id,
      action: 'DELETE',
      before,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}
