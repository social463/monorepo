import { PUBLIC_FEEDBACK_CATEGORIES, type MuralItemDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { feedbackInclude } from './feedback-service'
import { reviewInclude } from './review-service'
import { toMuralFeedbackItem, toMuralBadgeItem, toMuralMoodItem, toMuralReviewItem } from '../lib/serialize'
import { todayInSaoPaulo } from '../lib/sao-paulo-date'

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export async function getMuralItems(
  viewerId: string,
  viewerSectorId: string,
  now: Date = new Date(),
): Promise<MuralItemDTO[]> {
  const since = new Date(now.getTime() - WINDOW_MS)
  // Avisos de humor têm vida útil de um dia: filtramos pela data civil de hoje (America/Sao_Paulo),
  // então na virada do dia eles somem sozinhos e reaparecem se a pessoa responder de novo.
  const { day: today } = todayInSaoPaulo()
  // viewerId vem sempre de request.user.sub (JWT já validado) — sempre existe.
  const viewer = await prisma.user.findUniqueOrThrow({ where: { id: viewerId }, select: { companyId: true } })

  const [feedbacks, badges, moods, reviewShares] = await Promise.all([
    scopedPrisma(viewer.companyId).feedback.findMany({
      where: {
        sharedAt: { gte: since },
        category: { in: [...PUBLIC_FEEDBACK_CATEGORIES] },
        target: { active: true, sectorId: viewerSectorId },
      },
      include: { ...feedbackInclude, target: true },
      orderBy: { sharedAt: 'desc' },
    }),
    scopedPrisma(viewer.companyId).userBadge.findMany({
      where: { awardedAt: { gte: since }, user: { active: true, sectorId: viewerSectorId } },
      include: { user: true, badge: true },
      orderBy: { awardedAt: 'desc' },
    }),
    scopedPrisma(viewer.companyId).moodEntry.findMany({
      where: { day: today, user: { active: true, sectorId: viewerSectorId } },
      select: { id: true, createdAt: true, user: true },
      orderBy: { createdAt: 'desc' },
    }),
    // Shares (mais recentes primeiro) das resenhas de autores ativos do mesmo setor, na janela.
    scopedPrisma(viewer.companyId).reviewShare.findMany({
      where: { createdAt: { gte: since }, review: { author: { active: true, sectorId: viewerSectorId } } },
      include: { user: true, review: { include: reviewInclude(viewerId) } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // Dedup por resenha: a 1ª ocorrência (ordem desc) é o share mais recente; agrega os sharers.
  const byReview = new Map<
    string,
    { review: (typeof reviewShares)[number]['review']; sharers: (typeof reviewShares)[number]['user'][]; latestShareAt: Date }
  >()
  for (const share of reviewShares) {
    const entry = byReview.get(share.reviewId)
    if (entry) {
      entry.sharers.push(share.user)
    } else {
      byReview.set(share.reviewId, { review: share.review, sharers: [share.user], latestShareAt: share.createdAt })
    }
  }

  const items: MuralItemDTO[] = [
    ...feedbacks.map((f) => toMuralFeedbackItem(f, viewerId)),
    ...badges.map((b) => toMuralBadgeItem(b)),
    ...moods.map((m) => toMuralMoodItem(m)),
    ...[...byReview.values()].map((r) => toMuralReviewItem(r)),
  ]
  return items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
}
