import { Prisma, type AdminAuditAction } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'

export interface RecordAuditLogInput {
  actorId: string
  entityType: string
  entityId: string
  action: AdminAuditAction
  companyId: string
  before?: unknown
  after?: unknown
  tx?: Prisma.TransactionClient
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined) return Prisma.DbNull
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

/**
 * Reduz uma relação `User` aninhada (ex.: `awardedBy`, `creator`, `author`) a `{ id, name }`
 * antes de entrar num payload de auditoria — nunca deixe `passwordHash`/`email`/
 * `teamsWebhookUrl`/`accessTokenEnc`/`refreshTokenEnc` de um `User` completo (ou de
 * uma `CalendarConnection` incluída) vazar via include aninhado para `before`/`after`.
 * Mesma preocupação do caso top-level de `User` em `admin.ts` (que remove `passwordHash`
 * por destructuring), só que aqui a relação inteira é substituída por um resumo seguro.
 */
export function toSafeUserRef<T extends { id: string; name: string } | null | undefined>(
  user: T,
): { id: string; name: string } | null | undefined {
  if (user === null || user === undefined) return user as null | undefined
  return { id: user.id, name: user.name }
}

/**
 * Grava um evento de auditoria. Chamado explicitamente ao final de cada função
 * de serviço que muta dado sob `requireAdmin` — dentro do mesmo `$transaction`
 * quando já existir um (`tx`), para atomicidade com a mutação em si.
 */
export async function recordAuditLog(input: RecordAuditLogInput): Promise<void> {
  // `input.tx`, quando presente, é um `Prisma.TransactionClient` cru (não passa por
  // `scopedPrisma`) — companyId vai explícito no `data` pra manter o isolamento mesmo
  // dentro de uma transação alheia, igual ao padrão de nested writes já usado no resto
  // da linha (ex.: `ReviewMention`/`OfficeMapDraft`).
  const client = input.tx ?? prisma
  await client.adminAuditLog.create({
    data: {
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      companyId: input.companyId,
      before: toJson(input.before),
      after: toJson(input.after),
    },
  })
}

export interface AuditLogFilters {
  actorId?: string
  entityType?: string
  from?: Date
  to?: Date
  page: number
  pageSize: number
}

export const auditLogInclude = { actor: { select: { id: true, name: true } } } as const
export type AuditLogWithActor = Prisma.AdminAuditLogGetPayload<{ include: typeof auditLogInclude }>

/**
 * Autores distintos que já praticaram alguma ação registrada no log de auditoria
 * (não "todos os admins" — só quem de fato aparece como `actorId` em algum evento).
 * Usado para popular o filtro por autor da tela de auditoria.
 */
export async function listAuditLogActors(companyId: string): Promise<{ id: string; name: string }[]> {
  const grouped = await scopedPrisma(companyId).adminAuditLog.groupBy({ by: ['actorId'] })
  if (grouped.length === 0) return []
  const actors = await scopedPrisma(companyId).user.findMany({
    where: { id: { in: grouped.map((g) => g.actorId) } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  return actors
}

export async function listAuditLog(filters: AuditLogFilters, companyId: string): Promise<{ entries: AuditLogWithActor[]; total: number }> {
  const where: Prisma.AdminAuditLogWhereInput = {
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  }
  const db = scopedPrisma(companyId)
  const [entries, total] = await Promise.all([
    db.adminAuditLog.findMany({
      where,
      include: auditLogInclude,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.adminAuditLog.count({ where }),
  ])
  return { entries, total }
}
