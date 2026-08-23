import { Prisma, type UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { slugify } from '../lib/slug'
import { recordAuditLog } from './audit-log-service'

export class SectorError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'SectorError'
  }
}

export const sectorInclude = { roles: true } as const
export type SectorWithRoles = Prisma.SectorGetPayload<{ include: typeof sectorInclude }> & {
  responsibleId: string | null
}

async function loadSector(id: string, companyId: string): Promise<SectorWithRoles> {
  const [sector, responsibleRows] = await Promise.all([
    scopedPrisma(companyId).sector.findUnique({ where: { id }, include: sectorInclude }),
    prisma.$queryRaw<Array<{ responsibleId: string | null }>>`
      SELECT "responsibleId" FROM "Sector" WHERE "id" = ${id} AND "companyId" = ${companyId}
    `,
  ])
  if (!sector) throw new SectorError('Setor não encontrado.', 404)
  return { ...sector, responsibleId: responsibleRows[0]?.responsibleId ?? null }
}

export async function listSectors(companyId: string): Promise<SectorWithRoles[]> {
  const [sectors, responsibleRows] = await Promise.all([
    scopedPrisma(companyId).sector.findMany({ include: sectorInclude, orderBy: { name: 'asc' } }),
    prisma.$queryRaw<Array<{ id: string; responsibleId: string | null }>>`
      SELECT "id", "responsibleId" FROM "Sector" WHERE "companyId" = ${companyId}
    `,
  ])
  const responsibleBySector = new Map(responsibleRows.map((row) => [row.id, row.responsibleId]))
  return sectors.map((sector) => ({
    ...sector,
    responsibleId: responsibleBySector.get(sector.id) ?? null,
  }))
}

/** Todo setor novo nasce com "escritorio" habilitado (funcionalidade conjunta). */
export function withEscritorioForced(enabledFeatures: string[]): string[] {
  return Array.from(new Set([...enabledFeatures, 'escritorio']))
}

export async function createSector(
  input: { name: string; enabledFeatures: string[]; roles: UserRole[] },
  actorId: string,
  companyId: string,
): Promise<SectorWithRoles> {
  const name = input.name.trim()
  if (!name) throw new SectorError('O nome do setor é obrigatório.', 400)
  const db = scopedPrisma(companyId)
  try {
    const sector = await db.sector.create({
      data: {
        name,
        slug: slugify(name),
        enabledFeatures: withEscritorioForced(input.enabledFeatures),
        roles: { create: input.roles.map((role) => ({ role })) },
      },
    })
    const loaded = await loadSector(sector.id, companyId)
    await recordAuditLog({ actorId, entityType: 'Sector', entityId: sector.id, action: 'CREATE', after: loaded, companyId })
    return loaded
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SectorError('Já existe um setor com esse nome.', 409)
    }
    throw err
  }
}

export async function updateSector(
  id: string,
  input: { name?: string; active?: boolean; responsibleId?: string | null; enabledFeatures?: string[]; roles?: UserRole[] },
  actorId: string,
  companyId: string,
): Promise<SectorWithRoles> {
  const before = await loadSector(id, companyId)
  const db = scopedPrisma(companyId)
  const data: Prisma.SectorUpdateInput = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new SectorError('O nome do setor é obrigatório.', 400)
    data.name = name
    data.slug = slugify(name)
  }
  if (input.active !== undefined) data.active = input.active
  if (input.enabledFeatures !== undefined) data.enabledFeatures = input.enabledFeatures
  if (input.responsibleId !== undefined) {
    if (input.responsibleId) {
      const responsible = await db.user.findFirst({
        where: {
          id: input.responsibleId,
          sectorId: id,
          active: true,
          leftAt: null,
          role: { in: ['HEAD', 'MANAGER', 'LEAD', 'LEGEND'] },
        },
        select: { id: true },
      })
      if (!responsible) {
        throw new SectorError('O responsável deve ser um colaborador ativo deste setor.', 400)
      }
    }
  }
  try {
    await db.$transaction(async (tx) => {
      await tx.sector.update({ where: { id }, data })
      if (input.responsibleId !== undefined) {
        await tx.$executeRaw`
          UPDATE "Sector"
          SET "responsibleId" = ${input.responsibleId}, "updatedAt" = NOW()
          WHERE "id" = ${id} AND "companyId" = ${companyId}
        `
      }
      if (input.roles !== undefined) {
        await tx.sectorRole.deleteMany({ where: { sectorId: id } })
        if (input.roles.length > 0) {
          await tx.sectorRole.createMany({ data: input.roles.map((role) => ({ sectorId: id, role })) })
        }
      }
      const afterBase = await tx.sector.findUniqueOrThrow({ where: { id }, include: sectorInclude })
      const after = {
        ...afterBase,
        responsibleId: input.responsibleId !== undefined ? input.responsibleId : before.responsibleId,
      }
      // `tx` aqui é o client estendido por `scopedPrisma`, mas `recordAuditLog` passa `companyId`
      // explícito no `data` do create — o cast só reconcilia com a assinatura de
      // `recordAuditLog`, que prevê `Prisma.TransactionClient`.
      await recordAuditLog({ actorId, entityType: 'Sector', entityId: id, action: 'UPDATE', before, after, companyId, tx: tx as unknown as Prisma.TransactionClient })
    })
    return loadSector(id, companyId)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new SectorError('Setor não encontrado.', 404)
      if (err.code === 'P2002') throw new SectorError('Já existe um setor com esse nome.', 409)
    }
    throw err
  }
}
