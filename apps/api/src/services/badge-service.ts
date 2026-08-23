import { Prisma, type Badge, type BadgeKind, type UserBadge } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import type { BadgeProgress } from '@legends/shared'
import { getStreakSummary } from './streak-service'
import { recordAuditLog, toSafeUserRef } from './audit-log-service'

/** Anos completos entre joinedAt e now — o aniversário (mês/dia) precisa já ter passado. */
export function completedYears(joinedAt: Date, now: Date): number {
  let years = now.getFullYear() - joinedAt.getFullYear()
  const monthDiff = now.getMonth() - joinedAt.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < joinedAt.getDate())) {
    years -= 1
  }
  return Math.max(0, years)
}

// As três contagens abaixo alimentam CATEGORY, IMPACT e RECURRENCE. Depois da
// unificação elas contam **feedback recebido**, não voto
// (`specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`).
//
// O voto entra nessas contagens **na hora**, e não mais na publicação do
// destaque: `createVote` grava voto e feedback na mesma transação, e a rota
// avalia os selos de quem recebeu logo em seguida. O embargo acabou junto com a
// ideia de que aquilo era "reconhecimento do mês" — o que continua guardado até
// a publicação é **quem foi o Destaque**, que é outro dado.
// `materializeVoteFeedbacks` só alcança os votos anteriores a essa mudança.
//
// `FeedbackRecipient`, e não `Feedback.targetId`: no feedback grupal o
// destinatário secundário também recebeu.
function countFeedbacksInCategory(userId: string, categorySlug: string): Promise<number> {
  return prisma.feedbackRecipient.count({
    where: {
      userId,
      feedback: { recognitionCategories: { some: { category: { slug: categorySlug } } } },
    },
  })
}

function countFeedbacksReceived(userId: string): Promise<number> {
  return prisma.feedbackRecipient.count({ where: { userId } })
}

/**
 * Meses distintos em que a pessoa recebeu feedback. Por `createdAt`, e não por
 * período de votação: feedback do dia a dia não tem período, e depois da
 * unificação ele conta igual.
 */
async function countDistinctMonths(userId: string): Promise<number> {
  const rows = await prisma.feedbackRecipient.findMany({
    where: { userId },
    select: { feedback: { select: { createdAt: true } } },
  })
  const months = new Set(rows.map((row) => row.feedback.createdAt.toISOString().slice(0, 7)))
  return months.size
}

async function countFeedbacksAuthored(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
  if (!user) return 0
  return scopedPrisma(user.companyId).feedback.count({ where: { authorId: userId } })
}

/** Cursos concluídos (inscrição COMPLETED) — base dos selos de Aprendizado. */
async function countCoursesCompleted(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
  if (!user) return 0
  return scopedPrisma(user.companyId).courseEnrollment.count({ where: { userId, status: 'COMPLETED' } })
}

/**
 * Ações de PDI concluídas — base dos selos de PDI. Conta só o que está em DONE:
 * com validação do líder ligada, a ação só chega em DONE depois de aprovada, então
 * o selo nunca sai de uma conclusão que ainda está na fila.
 */
async function countPdiActionsDone(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
  if (!user) return 0
  return scopedPrisma(user.companyId).pdiAction.count({ where: { status: 'DONE', plan: { userId } } })
}

async function qualifies(userId: string, badge: Badge): Promise<boolean> {
  if (badge.kind === 'CATEGORY') {
    if (!badge.categorySlug) return false
    return (await countFeedbacksInCategory(userId, badge.categorySlug)) >= badge.threshold
  }
  if (badge.kind === 'IMPACT') {
    return (await countFeedbacksReceived(userId)) >= badge.threshold
  }
  if (badge.kind === 'RECURRENCE') {
    return (await countDistinctMonths(userId)) >= badge.threshold
  }
  if (badge.kind === 'FEEDBACK') {
    return (await countFeedbacksAuthored(userId)) >= badge.threshold
  }
  if (badge.kind === 'COURSE') {
    return (await countCoursesCompleted(userId)) >= badge.threshold
  }
  if (badge.kind === 'PDI') {
    return (await countPdiActionsDone(userId)) >= badge.threshold
  }
  return false
}

/** Kinds cuja concessão é sincronizada (concede e revoga) por função própria. */
const SYNCED_BADGE_KINDS: BadgeKind[] = ['FEEDBACK', 'COURSE', 'PDI']

export async function evaluateBadgesForUser(userId: string): Promise<UserBadge[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sectorId: true, companyId: true } })
  if (!user) return []
  const [badges, owned] = await Promise.all([
    scopedPrisma(user.companyId).badge.findMany({ where: { OR: [{ global: true }, { sectors: { some: { sectorId: user.sectorId } } }] } }),
    prisma.userBadge.findMany({ where: { userId, periodId: null }, select: { badgeId: true } }),
  ])
  const ownedIds = new Set(owned.map((entry) => entry.badgeId))

  const newlyAwarded: UserBadge[] = []
  for (const badge of badges) {
    if (SYNCED_BADGE_KINDS.includes(badge.kind)) continue
    if (ownedIds.has(badge.id)) continue
    if (await qualifies(userId, badge)) {
      // catch P2002: handles concurrent-award race (two evaluateBadgesForUser calls can
      // both pass the ownedIds check before either inserts; the second insert will violate
      // the unique constraint — skip silently instead of crashing)
      try {
        newlyAwarded.push(await prisma.userBadge.create({ data: { userId, badgeId: badge.id } }))
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // concurrent duplicate — badge already awarded, skip
        } else {
          throw err
        }
      }
    }
  }
  return newlyAwarded
}

/**
 * Concede os selos de tempo de casa (kind TENURE) que o usuário já atingiu.
 * Somente aditivo — nunca revoga. `now` é injetável para testes.
 */
export async function evaluateTenureBadgesForUser(
  userId: string,
  now: Date = new Date(),
): Promise<UserBadge[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { joinedAt: true, sectorId: true, companyId: true } })
  if (!user) return []
  const [tenureBadges, owned] = await Promise.all([
    scopedPrisma(user.companyId).badge.findMany({ where: { kind: 'TENURE', OR: [{ global: true }, { sectors: { some: { sectorId: user.sectorId } } }] } }),
    prisma.userBadge.findMany({ where: { userId, periodId: null }, select: { badgeId: true } }),
  ])
  const ownedIds = new Set(owned.map((entry) => entry.badgeId))
  const years = completedYears(user.joinedAt, now)

  const newlyAwarded: UserBadge[] = []
  for (const badge of tenureBadges) {
    if (ownedIds.has(badge.id)) continue
    if (years < badge.threshold) continue
    try {
      newlyAwarded.push(await prisma.userBadge.create({ data: { userId, badgeId: badge.id } }))
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // concorrência: já concedido, ignora
      } else {
        throw err
      }
    }
  }
  return newlyAwarded
}

/**
 * Concede os selos de ofensiva (kind STREAK) que o usuário já atingiu pelo recorde
 * (`bestStreak`, em dias úteis). Somente aditivo — nunca revoga. `todayYmd` é
 * repassado a getStreakSummary para testes determinísticos.
 */
export async function evaluateStreakBadgesForUser(
  userId: string,
  todayYmd?: string,
): Promise<UserBadge[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sectorId: true, companyId: true } })
  if (!user) return []
  const [streakBadges, owned] = await Promise.all([
    scopedPrisma(user.companyId).badge.findMany({ where: { kind: 'STREAK', OR: [{ global: true }, { sectors: { some: { sectorId: user.sectorId } } }] } }),
    prisma.userBadge.findMany({ where: { userId, periodId: null }, select: { badgeId: true } }),
  ])
  if (streakBadges.length === 0) return []
  const ownedIds = new Set(owned.map((entry) => entry.badgeId))
  const { bestStreak } = await getStreakSummary(userId, user.companyId, todayYmd)

  const newlyAwarded: UserBadge[] = []
  for (const badge of streakBadges) {
    if (ownedIds.has(badge.id)) continue
    if (bestStreak < badge.threshold) continue
    try {
      newlyAwarded.push(await prisma.userBadge.create({ data: { userId, badgeId: badge.id } }))
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // concorrência: já concedido, ignora
      } else {
        throw err
      }
    }
  }
  return newlyAwarded
}

/**
 * Avalia os selos de tempo de casa (kind TENURE) de TODOS os usuários ativos DE UMA EMPRESA
 * de uma vez. Best-effort e aditivo — concede os níveis já atingidos e nunca revoga.
 * Idempotente: `createMany` com `skipDuplicates` ignora selos já concedidos. Retorna quantos
 * foram criados. Usado para manter a galeria de Lendas correta sem depender de visita a perfil.
 */
export async function evaluateTenureBadgesForAllUsers(companyId: string, now: Date = new Date()): Promise<number> {
  const db = scopedPrisma(companyId)
  const [users, tenureBadges, owned] = await Promise.all([
    db.user.findMany({ where: { active: true }, select: { id: true, joinedAt: true, sectorId: true } }),
    db.badge.findMany({ where: { kind: 'TENURE' }, include: { sectors: true } }),
    prisma.userBadge.findMany({
      where: { periodId: null, badge: { kind: 'TENURE' } },
      select: { userId: true, badgeId: true },
    }),
  ])
  if (tenureBadges.length === 0) return 0

  const ownedByUser = new Map<string, Set<string>>()
  for (const entry of owned) {
    const set = ownedByUser.get(entry.userId) ?? new Set<string>()
    set.add(entry.badgeId)
    ownedByUser.set(entry.userId, set)
  }

  const toCreate: { userId: string; badgeId: string }[] = []
  for (const user of users) {
    const years = completedYears(user.joinedAt, now)
    const ownedIds = ownedByUser.get(user.id)
    for (const badge of tenureBadges) {
      if (years < badge.threshold) continue
      if (ownedIds?.has(badge.id)) continue
      const inScope = badge.global || badge.sectors.some((s) => s.sectorId === user.sectorId)
      if (!inScope) continue
      toCreate.push({ userId: user.id, badgeId: badge.id })
    }
  }
  if (toCreate.length === 0) return 0
  // skipDuplicates cobre corridas concorrentes contra evaluateTenureBadgesForUser.
  const { count } = await prisma.userBadge.createMany({ data: toCreate, skipDuplicates: true })
  return count
}

/**
 * Sincroniza os selos de um `kind` acumulativo (AUTO, periodId null) com a contagem
 * atual: concede os que passaram a qualificar e revoga os que não qualificam mais.
 * Nunca mexe em concessões MANUAL.
 *
 * A revogação existe porque a contagem pode cair — feedback apagado, aula
 * desmarcada, ação de PDI devolvida pelo líder. O selo reflete o estado atual,
 * não um troféu permanente.
 */
async function syncThresholdBadges(
  userId: string,
  kind: BadgeKind,
  countFor: (userId: string) => Promise<number>,
): Promise<{ awarded: UserBadge[]; revoked: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sectorId: true, companyId: true } })
  if (!user) return { awarded: [], revoked: 0 }
  const [badges, autoOwned, count] = await Promise.all([
    scopedPrisma(user.companyId).badge.findMany({ where: { kind, OR: [{ global: true }, { sectors: { some: { sectorId: user.sectorId } } }] } }),
    prisma.userBadge.findMany({
      where: { userId, periodId: null, source: 'AUTO', badge: { kind } },
      select: { id: true, badgeId: true },
    }),
    countFor(userId),
  ])
  const ownedByBadgeId = new Map(autoOwned.map((entry) => [entry.badgeId, entry.id]))

  const awarded: UserBadge[] = []
  const toRevoke: string[] = []
  for (const badge of badges) {
    const qualifies = count >= badge.threshold
    const ownedUserBadgeId = ownedByBadgeId.get(badge.id)
    if (qualifies && !ownedUserBadgeId) {
      try {
        awarded.push(await prisma.userBadge.create({ data: { userId, badgeId: badge.id } }))
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // concorrência: já concedido, ignora
        } else {
          throw err
        }
      }
    } else if (!qualifies && ownedUserBadgeId) {
      toRevoke.push(ownedUserBadgeId)
    }
  }

  let revoked = 0
  if (toRevoke.length > 0) {
    revoked = (await prisma.userBadge.deleteMany({ where: { id: { in: toRevoke } } })).count
  }
  return { awarded, revoked }
}

/** Selos FEEDBACK: total de feedbacks escritos. */
export function syncFeedbackBadgesForUser(userId: string): Promise<{ awarded: UserBadge[]; revoked: number }> {
  return syncThresholdBadges(userId, 'FEEDBACK', countFeedbacksAuthored)
}

/** Selos COURSE: cursos concluídos na área de Aprendizado. */
export function syncCourseBadgesForUser(userId: string): Promise<{ awarded: UserBadge[]; revoked: number }> {
  return syncThresholdBadges(userId, 'COURSE', countCoursesCompleted)
}

/** Selos PDI: ações de desenvolvimento concluídas. */
export function syncPdiBadgesForUser(userId: string): Promise<{ awarded: UserBadge[]; revoked: number }> {
  return syncThresholdBadges(userId, 'PDI', countPdiActionsDone)
}

export function listBadgesForUser(userId: string) {
  return prisma.userBadge.findMany({
    where: { userId },
    include: { badge: true, awardedBy: true },
    orderBy: { awardedAt: 'desc' },
  })
}

export class BadgeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'BadgeError'
  }
}

/** Concede um selo manualmente. Sem período (periodId null) e marcado como MANUAL. */
export async function grantBadgeManually(userId: string, badgeId: string, awardedById: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
  if (!user) throw new BadgeError('Usuário não encontrado.', 404)
  const badge = await scopedPrisma(user.companyId).badge.findUnique({ where: { id: badgeId } })
  if (!badge) throw new BadgeError('Selo não encontrado.', 404)

  const awarded = await prisma.userBadge.create({
    data: { userId, badgeId, source: 'MANUAL', awardedById, periodId: null },
    include: { badge: true, awardedBy: true },
  })
  // `awarded.awardedBy` é um User completo (senha, e-mail, webhook) — nunca vai cru pro log.
  const auditPayload = { ...awarded, awardedBy: toSafeUserRef(awarded.awardedBy) }
  await recordAuditLog({ actorId: awardedById, entityType: 'UserBadge', entityId: awarded.id, action: 'CREATE', after: auditPayload, companyId: user.companyId })
  return awarded
}

/** Revoga uma concessão MANUAL do membro. Recusa selos automáticos. */
export async function revokeManualBadge(userId: string, userBadgeId: string, actorId: string, companyId: string): Promise<void> {
  const user = await scopedPrisma(companyId).user.findUnique({ where: { id: userId } })
  if (!user) throw new BadgeError('Concessão não encontrada.', 404)
  const award = await prisma.userBadge.findUnique({ where: { id: userBadgeId } })
  if (!award || award.userId !== userId) {
    throw new BadgeError('Concessão não encontrada.', 404)
  }
  if (award.source !== 'MANUAL') {
    throw new BadgeError('Selos automáticos não podem ser revogados manualmente.', 409)
  }
  await prisma.userBadge.delete({ where: { id: userBadgeId } })
  await recordAuditLog({ actorId, entityType: 'UserBadge', entityId: userBadgeId, action: 'DELETE', before: award, companyId })
}

export interface BadgeCatalogEntry {
  badge: Badge
  requirement: string
  progress: BadgeProgress | null
}

function buildRequirement(badge: Badge, categoryName: string | null): string {
  switch (badge.kind) {
    case 'FEEDBACK':
      return `Faça ${badge.threshold} feedbacks`
    case 'IMPACT':
      return `Receba ${badge.threshold} feedbacks no total`
    case 'RECURRENCE':
      return `Receba feedbacks em ${badge.threshold} meses diferentes`
    case 'CATEGORY':
      return `Receba ${badge.threshold} feedbacks em ${categoryName ?? badge.categorySlug ?? 'uma categoria'}`
    case 'TENURE':
      return `Complete ${badge.threshold} ${badge.threshold === 1 ? 'ano' : 'anos'} na equipe`
    case 'STREAK':
      return `Mantenha uma ofensiva de ${badge.threshold} ${badge.threshold === 1 ? 'dia útil' : 'dias úteis'}`
    case 'COURSE':
      return `Conclua ${badge.threshold} ${badge.threshold === 1 ? 'curso' : 'cursos'}`
    case 'PDI':
      return `Conclua ${badge.threshold} ${badge.threshold === 1 ? 'ação' : 'ações'} do seu PDI`
    case 'HIGHLIGHT':
      return 'Seja o destaque do mês'
    default:
      return ''
  }
}

async function computeProgress(userId: string, companyId: string, badge: Badge): Promise<BadgeProgress | null> {
  const target = badge.threshold
  switch (badge.kind) {
    case 'FEEDBACK':
      return { current: await countFeedbacksAuthored(userId), target }
    case 'IMPACT':
      return { current: await countFeedbacksReceived(userId), target }
    case 'RECURRENCE':
      return { current: await countDistinctMonths(userId), target }
    case 'CATEGORY':
      return { current: badge.categorySlug ? await countFeedbacksInCategory(userId, badge.categorySlug) : 0, target }
    case 'TENURE': {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { joinedAt: true } })
      return { current: user ? completedYears(user.joinedAt, new Date()) : 0, target }
    }
    case 'STREAK': {
      const { bestStreak } = await getStreakSummary(userId, companyId)
      return { current: bestStreak, target }
    }
    case 'COURSE':
      return { current: await countCoursesCompleted(userId), target }
    case 'PDI':
      return { current: await countPdiActionsDone(userId), target }
    case 'HIGHLIGHT':
    default:
      return null
  }
}

/** Catálogo completo de selos com requisito legível e progresso do usuário. */
export async function getBadgeCatalog(userId: string): Promise<BadgeCatalogEntry[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sectorId: true, companyId: true } })
  if (!user) return []
  const db = scopedPrisma(user.companyId)
  const [badges, categories] = await Promise.all([
    db.badge.findMany({
      where: { OR: [{ global: true }, { sectors: { some: { sectorId: user.sectorId } } }] },
      orderBy: { name: 'asc' },
    }),
    db.recognitionCategory.findMany({ select: { slug: true, name: true } }),
  ])
  const categoryNameBySlug = new Map(categories.map((c) => [c.slug, c.name]))

  const entries: BadgeCatalogEntry[] = []
  for (const badge of badges) {
    const categoryName = badge.categorySlug ? categoryNameBySlug.get(badge.categorySlug) ?? null : null
    const requirement = buildRequirement(badge, categoryName)
    const progress = await computeProgress(userId, user.companyId, badge)
    entries.push({ badge, requirement, progress })
  }
  return entries
}
