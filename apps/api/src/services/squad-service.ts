import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { slugify } from '../lib/slug'
import { recordAuditLog } from './audit-log-service'

export class SquadError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'SquadError'
  }
}

export const squadInclude = {
  leader: true,
  members: {
    where: { user: { active: true, leftAt: null } },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  },
} as const
export type SquadWithMembers = Prisma.SquadGetPayload<{ include: typeof squadInclude }>

async function loadSquad(id: string, companyId: string): Promise<SquadWithMembers> {
  const squad = await scopedPrisma(companyId).squad.findUnique({ where: { id }, include: squadInclude })
  if (!squad) throw new SquadError('Squad não encontrada.', 404)
  return squad
}

export async function listSquads(companyId: string, opts?: { activeOnly?: boolean }): Promise<SquadWithMembers[]> {
  return scopedPrisma(companyId).squad.findMany({
    where: opts?.activeOnly ? { active: true } : {},
    include: squadInclude,
    orderBy: { name: 'asc' },
  })
}

export async function createSquad(input: { name: string; sectorId?: string }, actorId: string, companyId: string): Promise<SquadWithMembers> {
  const name = input.name.trim()
  if (!name) throw new SquadError('O nome da squad é obrigatório.', 400)
  if (!input.sectorId) throw new SquadError('Informe o setor da squad.', 400)
  const sector = await prisma.sector.findUnique({ where: { id: input.sectorId } })
  if (!sector || sector.companyId !== companyId) throw new SquadError('Setor inválido.', 400)
  const db = scopedPrisma(companyId)
  try {
    const squad = await db.squad.create({ data: { name, slug: slugify(name), sectorId: input.sectorId } })
    await recordAuditLog({ actorId, entityType: 'Squad', entityId: squad.id, action: 'CREATE', after: squad, companyId })
    return loadSquad(squad.id, companyId)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SquadError('Já existe uma squad com esse nome.', 409)
    }
    throw err
  }
}

export async function updateSquad(
  id: string,
  input: { name?: string; active?: boolean; leaderId?: string | null; sectorId?: string },
  actorId: string,
  companyId: string,
): Promise<SquadWithMembers> {
  const before = await scopedPrisma(companyId).squad.findUnique({ where: { id } })
  if (!before) throw new SquadError('Squad não encontrada.', 404)
  const db = scopedPrisma(companyId)
  const data: Prisma.SquadUpdateInput = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new SquadError('O nome da squad é obrigatório.', 400)
    data.name = name
    data.slug = slugify(name)
  }
  if (input.active !== undefined) data.active = input.active
  if (input.leaderId !== undefined) {
    if (input.leaderId === null) {
      data.leader = { disconnect: true }
    } else {
      const leader = await prisma.user.findUnique({ where: { id: input.leaderId } })
      if (!leader || !leader.active || leader.leftAt) throw new SquadError('Líder inválido.', 400)
      const targetSectorId = input.sectorId ?? before.sectorId
      if (leader.sectorId !== targetSectorId) throw new SquadError('Integrante inválido.', 400)
      data.leader = { connect: { id: input.leaderId } }
    }
  }
  if (input.sectorId !== undefined) {
    const sector = await prisma.sector.findUnique({ where: { id: input.sectorId } })
    if (!sector) throw new SquadError('Setor inválido.', 400)
    if (sector.companyId !== before.companyId) throw new SquadError('Não é possível mover a squad para outra empresa.', 400)
    data.sector = { connect: { id: input.sectorId } }
  }
  try {
    const updated = await db.squad.update({ where: { id }, data })
    await recordAuditLog({ actorId, entityType: 'Squad', entityId: id, action: 'UPDATE', before, after: updated, companyId: before.companyId })
    return loadSquad(id, before.companyId)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new SquadError('Squad não encontrada.', 404)
      if (err.code === 'P2002') throw new SquadError('Já existe uma squad com esse nome.', 409)
    }
    throw err
  }
}

export async function addMember(squadId: string, userId: string, actorId: string, companyId: string): Promise<SquadWithMembers> {
  const squad = await scopedPrisma(companyId).squad.findUnique({ where: { id: squadId } })
  if (!squad) throw new SquadError('Squad não encontrada.', 404)
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !user.active || user.leftAt) throw new SquadError('Integrante inválido.', 400)
  if (user.role === 'ADMIN' || user.role === 'SUBADMIN') throw new SquadError('Administradores não entram em squads.', 400)
  if (user.sectorId !== squad.sectorId) throw new SquadError('Integrante inválido.', 400)
  // Sem limite de squads por integrante: o admin distribui livremente. A única
  // restrição é não duplicar o mesmo integrante na mesma squad (P2002 abaixo).
  try {
    const member = await prisma.squadMember.create({ data: { squadId, userId } })
    await recordAuditLog({ actorId, entityType: 'SquadMember', entityId: member.id, action: 'CREATE', after: member, companyId: squad.companyId })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SquadError('Já é integrante desta squad.', 409)
    }
    throw err
  }
  return loadSquad(squadId, squad.companyId)
}

export async function removeMember(squadId: string, userId: string, actorId: string, companyId: string): Promise<void> {
  const squad = await scopedPrisma(companyId).squad.findUnique({ where: { id: squadId } })
  if (!squad) return
  const before = await prisma.squadMember.findFirst({ where: { squadId, userId } })
  await prisma.squadMember.deleteMany({ where: { squadId, userId } })
  if (before) {
    await recordAuditLog({ actorId, entityType: 'SquadMember', entityId: before.id, action: 'DELETE', before, companyId: squad.companyId })
  }
}
