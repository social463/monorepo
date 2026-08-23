import type { Prisma, User } from '@prisma/client'
import { MAX_FEATURED_BADGES } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { evaluateTenureBadgesForAllUsers } from './badge-service'
import { voteInclude, type VoteWithRelations } from './voting-service'

type AwardedBadge = Prisma.UserBadgeGetPayload<{ include: { badge: true; awardedBy: true } }>

export interface ShowcaseRow {
  user: User
  feedbacksReceived: number
  badges: AwardedBadge[]
}

/**
 * Galeria de conquistas: todos os usuários ativos — inclusive lideranças
 * (LEAD) — entram, independente do papel. Quem aparece de fato é filtrado no
 * front por já ter selo(s) e/ou reconhecimento(s). Traz a contagem de
 * reconhecimentos e seus selos. Usa agregações em lote (groupBy + um findMany)
 * para evitar N+1, ordenando por reconhecimentos.
 *
 * Com `opts.former: true`, retorna ex-lendas (`leftAt` setado) em vez dos
 * usuários ativos.
 */
export async function listShowcase(opts: { former?: boolean; sectorId?: string; companyId?: string } = {}): Promise<ShowcaseRow[]> {
  // Avalia selos de tempo de casa de todos antes de montar a galeria, para não depender
  // de visita a perfil. Best-effort: falha aqui não derruba as Lendas (apenas loga).
  // Só roda quando o chamador informa companyId — sem ele, não há como escopar o lote.
  if (opts.companyId) {
    try {
      await evaluateTenureBadgesForAllUsers(opts.companyId)
    } catch (err) {
      console.error('Falha ao avaliar selos de tempo de casa para a galeria', err)
    }
  }

  const [users, feedbackCounts, userBadges] = await Promise.all([
    prisma.user.findMany({
      where: {
        ...(opts.former ? { leftAt: { not: null } } : { active: true }),
        ...(opts.sectorId ? { sectorId: opts.sectorId } : {}),
        ...(opts.companyId ? { companyId: opts.companyId } : {}),
      },
    }),
    // Feedback recebido, não voto: os dois viraram um só, e o texto do voto
    // entra aqui como feedback na publicação do destaque.
    prisma.feedbackRecipient.groupBy({ by: ['userId'], _count: { _all: true } }),
    prisma.userBadge.findMany({ include: { badge: true, awardedBy: true }, orderBy: [{ featured: 'desc' }, { awardedAt: 'desc' }] }),
  ])

  const countByUser = new Map(feedbackCounts.map((row) => [row.userId, row._count._all]))
  const badgesByUser = new Map<string, AwardedBadge[]>()
  for (const awarded of userBadges) {
    const list = badgesByUser.get(awarded.userId) ?? []
    list.push(awarded)
    badgesByUser.set(awarded.userId, list)
  }

  return users
    .map((user) => ({
      user,
      feedbacksReceived: countByUser.get(user.id) ?? 0,
      badges: badgesByUser.get(user.id) ?? [],
    }))
    .sort((a, b) => b.feedbacksReceived - a.feedbacksReceived || a.user.name.localeCompare(b.user.name))
}

export interface CategoryCount {
  categorySlug: string
  categoryName: string
  count: number
}

export interface UserProfile {
  user: User
  totalFeedbacksReceived: number
  monthsWithFeedback: number
  months: string[]
  categoryBreakdown: CategoryCount[]
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return null
  const db = scopedPrisma(user.companyId)

  // Tudo daqui para baixo conta **feedback recebido**, não voto: os dois viraram
  // um só (`specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`), e
  // o texto do voto entra aqui como feedback quando o destaque do mês publica.
  // `FeedbackRecipient` em vez de `Feedback.targetId` por causa do feedback
  // grupal, onde o destinatário secundário também recebeu.
  const received = await db.feedbackRecipient.findMany({
    where: { userId },
    select: { feedback: { select: { id: true, createdAt: true } } },
  })
  const totalFeedbacksReceived = received.length
  const months = [...new Set(received.map((row) => row.feedback.createdAt.toISOString().slice(0, 7)))].sort((a, b) =>
    b.localeCompare(a),
  )

  const grouped = await prisma.feedbackRecognitionCategory.groupBy({
    by: ['categoryId'],
    where: { companyId: user.companyId, feedback: { recipients: { some: { userId } } } },
    _count: { _all: true },
  })
  const categories = await db.recognitionCategory.findMany({
    where: { id: { in: grouped.map((g) => g.categoryId) } },
  })
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const categoryBreakdown: CategoryCount[] = grouped
    .map((g) => {
      const category = categoryById.get(g.categoryId)
      return {
        categorySlug: category?.slug ?? g.categoryId,
        categoryName: category?.name ?? g.categoryId,
        count: g._count._all,
      }
    })
    .sort((a, b) => b.count - a.count || a.categoryName.localeCompare(b.categoryName))

  return {
    user,
    totalFeedbacksReceived,
    monthsWithFeedback: months.length,
    months,
    categoryBreakdown,
  }
}

async function actionsWhere(userId: string, arquivadas: boolean) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { companyId: true } })
  return {
    actionResponsible: userId,
    actionPlan: { not: null },
    actionDueDate: { not: null },
    actionArchivedAt: arquivadas ? { not: null } : null,
    room: {
      status: 'CONCLUDED' as const,
      archivedAt: null,
      squads: { some: { squad: { companyId: user.companyId } } },
    },
  }
}

async function actionsOf(userId: string, arquivadas: boolean) {
  return prisma.retroCard.findMany({
    where: await actionsWhere(userId, arquivadas),
    include: { room: { select: { id: true, sprint: true, squads: { select: { squad: { select: { name: true } } } } } } },
    orderBy: arquivadas
      ? [{ actionArchivedAt: 'desc' }]
      : [{ actionDone: 'asc' }, { actionDueDate: 'asc' }, { actionDoneAt: 'desc' }],
  })
}

/**
 * Ações (cards com responsável) de salas concluídas atribuídas ao usuário.
 * Pendentes primeiro. Sem as arquivadas: a lista não tem paginação e cresce a
 * cada sprint — arquivar o que já foi concluído é o que segura o tamanho dela.
 */
export function listUserActions(userId: string) {
  return actionsOf(userId, false)
}

/** As que o responsável arquivou, mais recentes primeiro. */
export function listUserArchivedActions(userId: string) {
  return actionsOf(userId, true)
}

/** Só o tamanho do arquivo — o perfil não precisa carregar a lista para saber que ela existe. */
export async function countUserArchivedActions(userId: string) {
  return prisma.retroCard.count({ where: await actionsWhere(userId, true) })
}

export class ProfileError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ProfileError'
  }
}

/**
 * Substitui o conjunto de selos destacados do usuário na galeria de Lendas.
 * Valida que todos os ids pertencem a ele e respeita MAX_FEATURED_BADGES.
 * Idempotente: zera os destaques atuais e marca apenas os escolhidos.
 */
export async function setFeaturedBadges(userId: string, badgeIds: string[]): Promise<AwardedBadge[]> {
  const unique = [...new Set(badgeIds)]
  if (unique.length > MAX_FEATURED_BADGES) {
    throw new ProfileError(`Você pode destacar no máximo ${MAX_FEATURED_BADGES} selos.`, 400)
  }
  if (unique.length > 0) {
    const owned = await prisma.userBadge.findMany({
      where: { id: { in: unique }, userId },
      select: { id: true },
    })
    if (owned.length !== unique.length) {
      throw new ProfileError('Selo não encontrado entre os seus.', 400)
    }
  }

  return prisma.$transaction(async (tx) => {
    await tx.userBadge.updateMany({ where: { userId, featured: true }, data: { featured: false } })
    if (unique.length > 0) {
      await tx.userBadge.updateMany({ where: { userId, id: { in: unique } }, data: { featured: true } })
    }
    return tx.userBadge.findMany({
      where: { userId },
      include: { badge: true, awardedBy: true },
      orderBy: [{ featured: 'desc' }, { awardedAt: 'desc' }],
    })
  })
}
