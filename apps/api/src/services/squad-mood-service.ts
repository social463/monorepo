import type {
  AvatarStyleKey,
  CharacterOptions,
  LedSquadMoodsDTO,
  MoodHistoryPageDTO,
  MoodLevel,
  SquadMemberMoodDTO,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { ymdOf } from '../lib/sao-paulo-date'
import { scopedPrisma } from '../lib/tenant-scope'
import { listManagedGroups, managesUser } from './team-scope-service'

export class MoodAccessError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'MoodAccessError'
  }
}

type MoodMember = {
  id: string
  name: string
  photoUrl: string | null
  avatarStyle: string | null
  avatarSeed: string | null
  avatarOptions: unknown
}

/** Mapeia um conjunto de usuários para DTOs com o humor mais recente de cada um. */
async function buildMemberMoodDTOs(members: MoodMember[], companyId: string): Promise<SquadMemberMoodDTO[]> {
  const memberIds = members.map((m) => m.id)
  // Uma query só (evita N+1): pega todos os registros e reduz ao mais recente por usuário.
  const moodRows = await scopedPrisma(companyId).moodEntry.findMany({
    where: { userId: { in: memberIds } },
    orderBy: { day: 'desc' },
  })
  const latestByUser = new Map<string, (typeof moodRows)[number]>()
  for (const row of moodRows) {
    if (!latestByUser.has(row.userId)) latestByUser.set(row.userId, row)
  }

  return members.map((m) => {
    const latest = latestByUser.get(m.id) ?? null
    return {
      id: m.id,
      name: m.name,
      photoUrl: m.photoUrl,
      avatarStyle: m.avatarStyle as AvatarStyleKey | null,
      avatarSeed: m.avatarSeed,
      avatarOptions: (m.avatarOptions as CharacterOptions | null) ?? null,
      currentMood: latest
        ? { day: ymdOf(latest.day), mood: latest.mood as MoodLevel, note: latest.note }
        : null,
    }
  })
}

/**
 * Grupos de humor que o visualizador pode acompanhar — uma entrada por squad liderada, ou uma
 * entrada com a área toda no caso do manager. A regra de quem gerencia quem vive em
 * team-scope-service (listManagedGroups); aqui só formatamos o humor de cada membro do grupo.
 */
export async function getTeamMoodGroups(viewerId: string): Promise<LedSquadMoodsDTO[]> {
  const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { companyId: true } })
  if (!viewer) return []
  const groups = await listManagedGroups(viewerId)
  const result: LedSquadMoodsDTO[] = []
  for (const group of groups) {
    result.push({
      squadId: group.groupId,
      squadName: group.groupName,
      members: await buildMemberMoodDTOs(group.members, viewer.companyId),
    })
  }
  return result
}

export async function getMemberMoodHistory(
  viewerId: string,
  memberId: string,
  cursor: string | null,
  limit: number,
): Promise<MoodHistoryPageDTO> {
  if (!(await managesUser(viewerId, memberId))) {
    throw new MoodAccessError('Sem acesso ao histórico deste integrante.', 403)
  }
  const viewer = await prisma.user.findUniqueOrThrow({ where: { id: viewerId }, select: { companyId: true } })

  const where: { userId: string; day?: { lt: Date } } = { userId: memberId }
  if (cursor) where.day = { lt: new Date(cursor) }

  const rows = await scopedPrisma(viewer.companyId).moodEntry.findMany({
    where,
    orderBy: { day: 'desc' },
    take: limit + 1,
  })
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const entries = page.map((r) => ({ day: ymdOf(r.day), mood: r.mood as MoodLevel, note: r.note }))
  const nextCursor = hasMore ? entries[entries.length - 1].day : null
  return { entries, nextCursor }
}
