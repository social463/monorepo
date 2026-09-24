import { Prisma, type BadgeKind } from '@prisma/client'
import { scopedPrisma } from '../lib/tenant-scope'
import { slugify } from '../lib/slug'
import { recordAuditLog } from './audit-log-service'

export class BadgeAdminError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'BadgeAdminError' }
}

// `badgeCategory` entra no include porque o DTO do admin mostra o NOME do tema
// na gaveta; sem ele a tela teria de cruzar a lista de temas por conta própria.
export const badgeInclude = { sectors: true, badgeCategory: { select: { name: true } } } as const
export type BadgeWithSectors = Prisma.BadgeGetPayload<{ include: typeof badgeInclude }>

async function assertSectorsBelongToCompany(
  db: ReturnType<typeof scopedPrisma>,
  sectorIds: string[],
): Promise<void> {
  if (sectorIds.length === 0) return
  // `Sector` é tenant-scoped, então `db.sector.findMany` já filtra por companyId — se algum
  // sectorId pertencer a outra empresa (ou não existir), ele simplesmente não volta na lista.
  const found = await db.sector.findMany({ where: { id: { in: sectorIds } } })
  if (found.length !== sectorIds.length) {
    throw new BadgeAdminError('Um ou mais setores informados são inválidos ou pertencem a outra empresa.', 400)
  }
}

export function listBadgesAdmin(companyId: string, opts?: { sectorId?: string }): Promise<BadgeWithSectors[]> {
  return scopedPrisma(companyId).badge.findMany({
    where: opts?.sectorId ? { OR: [{ global: true }, { sectors: { some: { sectorId: opts.sectorId } } }] } : undefined,
    include: badgeInclude,
    orderBy: { name: 'asc' },
  })
}

export function getBadgeAdmin(id: string, companyId: string): Promise<BadgeWithSectors | null> {
  return scopedPrisma(companyId).badge.findUnique({ where: { id }, include: badgeInclude })
}

interface CreateBadgeInput {
  name: string
  description: string
  kind: BadgeKind
  iconKey: string
  threshold?: number
  /** `slug` da RecognitionCategory — só para selos de tipo CATEGORY. */
  categorySlug?: string | null
  /** Tema do catálogo (Documento 4, 11.4). Outro conceito, outro campo. */
  badgeCategoryId?: string | null
  /** Recompensa ao conquistar; `null` não concede. */
  rewardPoints?: number | null
  rewardCoins?: number | null
  global: boolean
  sectorIds: string[]
}

export async function createBadgeAdmin(input: CreateBadgeInput, actorId: string, companyId: string): Promise<BadgeWithSectors> {
  const db = scopedPrisma(companyId)
  await assertSectorsBelongToCompany(db, input.sectorIds)
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.badge.create({
        data: {
          name: input.name,
          slug: slugify(input.name),
          description: input.description,
          kind: input.kind,
          iconKey: input.iconKey,
          threshold: input.threshold ?? 0,
          categorySlug: input.categorySlug ?? null,
          badgeCategoryId: input.badgeCategoryId ?? null,
          rewardPoints: input.rewardPoints ?? null,
          rewardCoins: input.rewardCoins ?? null,
          global: input.global,
          sectors: input.sectorIds.length > 0 ? { create: input.sectorIds.map((sectorId) => ({ sectorId })) } : undefined,
        },
        include: badgeInclude,
      })
      // `tx` aqui é o client estendido por `scopedPrisma`, mas `recordAuditLog` passa `companyId`
      // explícito no `data` do create — o cast só reconcilia com a assinatura de
      // `recordAuditLog`, que prevê `Prisma.TransactionClient`.
      await recordAuditLog({
        actorId, entityType: 'Badge', entityId: created.id, action: 'CREATE',
        after: { ...created, sectorIds: created.sectors.map((s) => s.sectorId) }, companyId, tx: tx as unknown as Prisma.TransactionClient,
      })
      return created
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BadgeAdminError('Já existe um selo com esse nome.', 409)
    }
    throw err
  }
}

interface UpdateBadgeInput {
  name?: string
  description?: string
  kind?: BadgeKind
  iconKey?: string
  threshold?: number
  categorySlug?: string | null
  badgeCategoryId?: string | null
  rewardPoints?: number | null
  rewardCoins?: number | null
  global?: boolean
  sectorIds?: string[]
}

export async function updateBadgeAdmin(id: string, input: UpdateBadgeInput, actorId: string, companyId: string): Promise<BadgeWithSectors> {
  const db = scopedPrisma(companyId)
  const before = await db.badge.findUnique({ where: { id }, include: badgeInclude })
  if (!before) throw new BadgeAdminError('Selo não encontrado.', 404)
  const { sectorIds, ...rest } = input
  const data = rest.name ? { ...rest, slug: slugify(rest.name) } : rest
  const effectiveGlobal = data.global ?? before.global
  if (sectorIds !== undefined) await assertSectorsBelongToCompany(db, sectorIds)
  try {
    return await db.$transaction(async (tx) => {
      await tx.badge.update({ where: { id }, data })
      if (effectiveGlobal) {
        await tx.badgeSector.deleteMany({ where: { badgeId: id } })
      } else if (sectorIds !== undefined) {
        await tx.badgeSector.deleteMany({ where: { badgeId: id } })
        if (sectorIds.length > 0) {
          await tx.badgeSector.createMany({ data: sectorIds.map((sectorId) => ({ badgeId: id, sectorId })) })
        }
      }
      const withSectors = await tx.badge.findUniqueOrThrow({ where: { id }, include: badgeInclude })
      // Mesmo motivo do cast no CREATE acima.
      await recordAuditLog({
        actorId, entityType: 'Badge', entityId: id, action: 'UPDATE',
        before: { ...before, sectorIds: before.sectors.map((s) => s.sectorId) },
        after: { ...withSectors, sectorIds: withSectors.sectors.map((s) => s.sectorId) },
        companyId,
        tx: tx as unknown as Prisma.TransactionClient,
      })
      return withSectors
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new BadgeAdminError('Selo não encontrado.', 404)
      if (err.code === 'P2002') throw new BadgeAdminError('Já existe um selo com esse nome.', 409)
    }
    throw err
  }
}
