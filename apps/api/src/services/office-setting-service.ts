import type { OfficeConfigDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { recordAuditLog } from './audit-log-service'

/**
 * Config do escritório — 1 linha por empresa (`companyId` é a PK do model), criada
 * on-demand. `broadcastEnabled` é o interruptor de custo do alto-falante.
 *
 * `OfficeSetting` NÃO está em `TENANT_SCOPED_MODELS` (ver tenant-scope.ts): a extensão não
 * suporta `upsert`, que este service usa o tempo todo, e como `companyId` já É a PK, o
 * isolamento aqui é feito manualmente via `where`/`create` explícitos — não precisa da
 * injeção automática da extensão.
 */
export async function getOfficeSettings(companyId: string): Promise<OfficeConfigDTO> {
  const row = await prisma.officeSetting.findUnique({ where: { companyId } })
  return {
    broadcastEnabled: row?.broadcastEnabled ?? false,
    activeMapPublicationId: row?.activeMapPublicationId ?? null,
  }
}

export async function setBroadcastEnabled(
  broadcastEnabled: boolean,
  actorId: string,
  companyId: string,
): Promise<OfficeConfigDTO> {
  const before = await prisma.officeSetting.findUnique({ where: { companyId } })
  const row = await prisma.officeSetting.upsert({
    where: { companyId },
    create: { companyId, broadcastEnabled },
    update: { broadcastEnabled },
  })
  await recordAuditLog({
    actorId,
    entityType: 'OfficeSetting',
    entityId: companyId,
    action: before ? 'UPDATE' : 'CREATE',
    before,
    after: row,
    companyId,
  })
  return {
    broadcastEnabled: row.broadcastEnabled,
    activeMapPublicationId: row.activeMapPublicationId,
  }
}
