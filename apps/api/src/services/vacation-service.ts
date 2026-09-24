/**
 * Férias dos colaboradores. Quem lança é o gestor direto (regra em
 * team-scope-service) ou um admin da empresa; quem enxerga é todo o setor —
 * mesma regra de visibilidade dos aniversários.
 *
 * Datas são civis (YYYY-MM-DD) do começo ao fim: entram como string, viram
 * `Date` à meia-noite UTC no banco (`@db.Date`) e voltam a string na saída.
 */
import { canAdminister, overlaps, type TeamVacationsResponse, type VacationDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { dayFromYmd, todayInSaoPaulo, ymdOf } from '../lib/sao-paulo-date'
import { toPublicUser, toVacationDTO } from '../lib/serialize'
import { listManagedGroups, managesUser } from './team-scope-service'

export class VacationError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'VacationError'
  }
}

const WITH_USER = { user: true } as const

/** Papéis fora do time (não recebem nem aparecem em férias), igual ao /celebrations. */
const SECTOR_ROLES_EXCLUDED = ['ADMIN', 'SUBADMIN', 'THIRD_PARTY'] as const

/**
 * Só o gestor direto do alvo — ou um admin da mesma empresa — mexe nas férias
 * de alguém. Quem administra não passa pelo team-scope: não gerencia ninguém no
 * sentido de squad, mas administra a empresa inteira.
 *
 * A pergunta aqui é "pode administrar?", então quem responde é `canAdminister`
 * e não `role` cru: o acesso administrativo delegado vale (ver
 * `@legends/shared/permissions`). Sem isso, a conta delegada de Gente e Gestão
 * abre a tela e leva 403 ao lançar as férias de quem não é liderado dela.
 */
async function assertCanManage(actorId: string, targetUserId: string): Promise<void> {
  const [actor, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { role: true, companyId: true, adminAccess: true } }),
    prisma.user.findUnique({ where: { id: targetUserId }, select: { companyId: true } }),
  ])
  if (!actor || !target) throw new VacationError('Usuário não encontrado.', 404)
  if (actor.companyId !== target.companyId) {
    throw new VacationError('Sem permissão para lançar férias desta pessoa.', 403)
  }
  if (canAdminister(actor)) return
  if (await managesUser(actorId, targetUserId)) return
  throw new VacationError('Sem permissão para lançar férias desta pessoa.', 403)
}

/** Valida a janela e recusa sobreposição com outro período da mesma pessoa. */
async function assertValidRange(
  userId: string,
  startDate: string,
  endDate: string,
  ignoreId: string | null,
): Promise<void> {
  if (endDate < startDate) {
    throw new VacationError('A data de fim não pode ser anterior à de início.')
  }
  const existing = await prisma.vacation.findMany({
    where: { userId, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
    orderBy: { startDate: 'asc' },
  })
  const clash = existing.find((v) => overlaps(startDate, endDate, ymdOf(v.startDate), ymdOf(v.endDate)))
  if (clash) {
    throw new VacationError(
      `Já existe um período de ${ymdOf(clash.startDate)} a ${ymdOf(clash.endDate)} para esta pessoa.`,
    )
  }
}

export interface CreateVacationInput {
  userId: string
  startDate: string
  endDate: string
  note: string | null
}

export async function createVacation(actorId: string, input: CreateVacationInput): Promise<VacationDTO> {
  await assertCanManage(actorId, input.userId)
  await assertValidRange(input.userId, input.startDate, input.endDate, null)
  const target = await prisma.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { companyId: true },
  })
  const created = await prisma.vacation.create({
    data: {
      userId: input.userId,
      startDate: dayFromYmd(input.startDate),
      endDate: dayFromYmd(input.endDate),
      note: input.note,
      createdById: actorId,
      companyId: target.companyId,
    },
    include: WITH_USER,
  })
  return toVacationDTO(created)
}

export interface UpdateVacationPatch {
  startDate?: string
  endDate?: string
  note?: string | null
}

export async function updateVacation(
  actorId: string,
  id: string,
  patch: UpdateVacationPatch,
): Promise<VacationDTO> {
  const current = await prisma.vacation.findUnique({ where: { id } })
  if (!current) throw new VacationError('Período não encontrado.', 404)
  await assertCanManage(actorId, current.userId)

  const startDate = patch.startDate ?? ymdOf(current.startDate)
  const endDate = patch.endDate ?? ymdOf(current.endDate)
  await assertValidRange(current.userId, startDate, endDate, id)

  const updated = await prisma.vacation.update({
    where: { id },
    data: {
      startDate: dayFromYmd(startDate),
      endDate: dayFromYmd(endDate),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
    },
    include: WITH_USER,
  })
  return toVacationDTO(updated)
}

export async function deleteVacation(actorId: string, id: string): Promise<void> {
  const current = await prisma.vacation.findUnique({ where: { id } })
  if (!current) throw new VacationError('Período não encontrado.', 404)
  await assertCanManage(actorId, current.userId)
  await prisma.vacation.delete({ where: { id } })
}

/**
 * Férias visíveis para quem está olhando: dos colegas ativos do mesmo setor e
 * da mesma empresa, que intersectem a janela pedida (inclusiva nas pontas).
 */
export async function listSectorVacations(
  viewerId: string,
  sectorId: string,
  from: string,
  to: string,
): Promise<VacationDTO[]> {
  const viewer = await prisma.user.findUniqueOrThrow({ where: { id: viewerId }, select: { companyId: true } })
  const rows = await scopedPrisma(viewer.companyId).vacation.findMany({
    where: {
      startDate: { lte: dayFromYmd(to) },
      endDate: { gte: dayFromYmd(from) },
      user: { active: true, leftAt: null, sectorId, role: { notIn: [...SECTOR_ROLES_EXCLUDED] } },
    },
    include: WITH_USER,
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
  })
  return rows.map(toVacationDTO)
}

/**
 * Férias da EMPRESA inteira que intersectam a janela pedida.
 *
 * Vizinha de `listSectorVacations` e com escopo de propósito maior: aquela serve
 * ao calendário, que é a agenda do time de quem olha; esta serve ao bloco de
 * "Férias do Mês", que é comunicação — mora ao lado dos aniversariantes, que
 * também são da empresa toda. Terceirizado continua de fora, como no calendário.
 */
export async function listCompanyVacations(
  companyId: string,
  from: string,
  to: string,
): Promise<VacationDTO[]> {
  const rows = await scopedPrisma(companyId).vacation.findMany({
    where: {
      startDate: { lte: dayFromYmd(to) },
      endDate: { gte: dayFromYmd(from) },
      user: { active: true, leftAt: null, role: { notIn: [...SECTOR_ROLES_EXCLUDED] } },
    },
    include: WITH_USER,
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
  })
  return rows.map(toVacationDTO)
}

/**
 * O painel do gestor: cada liderado com seus períodos futuros, isto é, que
 * ainda não terminaram (`endDate >= hoje`) — períodos já encerrados não
 * interessam ao gestor e não têm paginação neste caminho.
 */
export async function listTeamVacations(viewerId: string): Promise<TeamVacationsResponse> {
  const groups = await listManagedGroups(viewerId)
  const memberIds = groups.flatMap((group) => group.members.map((m) => m.id))
  if (memberIds.length === 0) return { groups: [] }

  const rows = await prisma.vacation.findMany({
    where: { userId: { in: memberIds }, endDate: { gte: dayFromYmd(todayInSaoPaulo().ymd) } },
    include: WITH_USER,
    orderBy: { startDate: 'asc' },
  })
  const byUser = new Map<string, VacationDTO[]>()
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? []
    list.push(toVacationDTO(row))
    byUser.set(row.userId, list)
  }

  return {
    groups: groups.map((group) => ({
      groupId: group.groupId,
      groupName: group.groupName,
      members: group.members.map((member) => ({
        user: toPublicUser(member),
        vacations: byUser.get(member.id) ?? [],
      })),
    })),
  }
}
