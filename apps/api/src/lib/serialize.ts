import type { RecognitionCategory } from '@prisma/client'
import type { AgentConversation, AgentKind, AgentMessage, AgentMessageRole as PrismaAgentMessageRole, Badge, BenchmarkPractice, CalendarConnection, CalendarEvent, CalendarEventSector, CalendarEventType, Challenge, CharacterFavorite, CoinRule, CultureBenefit, CultureManual, CulturePage, CulturePersonalAsset, CultureVisualAsset, DevelopmentThursdayEvent, EventAlbum, EventPhoto, EventPhotoComment, EventPhotoReaction, GlassReview, Prisma, RetroCard, Squad, StoreProduct, User, Vacation, VotingPeriod, XpRule, XpTransaction } from '@prisma/client'
import {
  FEEDBACK_REACTIONS,
  LPC_AVATAR_STYLE,
  isCollapsibleCorporatePost,
  isRichDoc,
  migrateCharacterOptions,
  REVIEW_REACTIONS,
  CORPORATE_POST_REACTIONS,
  RETRO_REACTION_EMOJIS,
  RETRO_SHAPES,
  RETRO_SHAPE_STYLES,
  SHAPE_HEIGHT,
  SHAPE_WIDTH,
  retroRoomTitle,
  type AdminUserDTO,
  type AssistantSourceDTO,
  type CalendarEventDTO,
  type CalendarEventTypeDTO,
  type AvatarStyleKey,
  type AuditLogEntryDTO,
  type AwardedBadgeDTO,
  type BadgeCatalogEntryDTO,
  type BadgeDTO,
  type CalendarConnectionDTO,
  type CalendarProviderKey,
  type ChallengeCategory,
  type ChallengeDTO,
  type CoinRuleDTO,
  type CoinRulePublicDTO,
  type CoinTransactionDTO,
  type XpRuleDTO,
  type XpRulePublicDTO,
  type XpTransactionDTO,
  type CompanyAdminDTO,
  type ChallengeSubmissionDTO,
  type CharacterFavoriteDTO,
  type CharacterOptions,
  type CultureBenefitDTO,
  type CultureVisualAssetDTO,
  type CulturePersonalAssetDTO,
  type CulturePersonalAssetAdminDTO,
  type CultureManualDTO,
  type CulturePageDTO,
  type DevelopmentThursdayEventDTO,
  EVENT_PHOTO_REACTIONS,
  type EventAlbumDTO,
  type EventPhotoCommentDTO,
  type EventPhotoDTO,
  type FeedbackCommentDTO,
  type FeedbackDTO,
  type MonthlyHighlightDTO,
  type MonthlyHighlightGroupDTO,
  type MyFeedbackDTO,
  type RecognitionCategoryDTO,
  type RecognitionCategoryRef,
  type SharedFeedbackDTO,
  type GlassReviewDTO,
  type HighlightDTO,
  type HrDashboardDTO,
  type AgentConversationDTO,
  type AgentConversationSummaryDTO,
  type AgentKey,
  type AgentMessageDTO,
  type AgentMessageRole,
  type BenchmarkPracticeDTO,
  type CampaignPostDTO,
  type KnowledgeEntryDTO,
  type MoodLevel,
  type MoodReason,
  type MuralBadgeItem,
  type MuralFeedbackItem,
  type MuralMoodItem,
  type MuralReviewItem,
  type NotificationDTO,
  type OfficeMeetingDTO,
  type OfficeRoomDTO,
  type OfficeRoomOptionDTO,
  type PublicUser,
  type ReactionSummary,
  type RetroActionItemDTO,
  type RetroCarryoverItemDTO,
  type RetroCardDTO,
  type RetroEditDTO,
  type RetroReactionSummary,
  type RetroRoomDTO,
  type RetroRoomRole,
  type RetroRoomSummaryDTO,
  type RetroTimerDTO,
  type RetroTimerMode,
  type RetroTimerStatus,
  type RetroShape,
  type RetroShapeStyle,
  type ReviewCommentDTO,
  type ReviewDTO,
  type CorporatePostCommentDTO,
  type CorporatePostDTO,
  type PendingCorporatePostDTO,
  type SectorDTO,
  type SquadDTO,
  type SquadWithMembersDTO,
  type StoreOrderAdminDTO,
  type StoreOrderDTO,
  type StoreProductCategory,
  type StoreProductDTO,
  type FeatureKey,
  type TodayMoodDTO,
  type VacationDTO,
  type VoteDTO,
  type VotingPeriodDTO,
  type ReactorRef,
} from '@legends/shared'
import type { StoreOrderWithProduct } from '../services/store-service'
import type { StoreOrderWithRefs } from '../services/store-admin-service'
import type { VoteWithRelations } from '../services/voting-service'
import type { SubmissionWithRefs } from '../services/challenge-service'
import { presignDocumentDownload, publicUrlFor, s3Config } from './s3-client'
import type {
  FeedbackCommentWithAuthor,
  FeedbackWithAuthor,
  SharedFeedbackRow,
} from '../services/feedback-service'
import type { MonthlyHighlightRow } from '../services/monthly-highlight-service'
import type { PublishedHighlight } from '../services/highlight-service'
import type { BadgeCatalogEntry } from '../services/badge-service'
import type { CoinTransactionWithActor } from '../services/coin-service'
import { ymdOf } from './sao-paulo-date'
import type { NotificationWithActor } from '../services/notification-service'
import type { RetroCardWithRelations, RetroRoomWithRelations } from '../services/retro-service'
import type { ReviewCommentWithRelations, ReviewWithRelations } from '../services/review-service'
import type {
  CorporatePostCommentWithRelations,
  CorporatePostWithRelations,
} from '../services/corporate-mural-service'
import type { SectorWithRoles } from '../services/sector-service'
import type { HrDashboardWithSector } from '../services/hr-dashboard-service'
import type { KnowledgeEntryWithSector } from '../services/assistant-service'
import type { AuditLogWithActor } from '../services/audit-log-service'
import type { CampaignPostWithRelations } from '../services/campaign-service'
import { derivePeriodState, isPeriodEditable } from './period-state'
import { buildGoogleCalendarUrl, buildOutlookCalendarUrl, type CalendarMeeting } from './calendar-export'

/**
 * Sanitiza `avatarStyle` vindo do banco: só o valor atual ('lpc') é aceito.
 * Registros legados (ex. 'open-peeps', de antes da migração para o personagem
 * LPC) viram `null` — o cliente deriva um personagem padrão da seed.
 */
export function sanitizeAvatarStyle(value: unknown): AvatarStyleKey | null {
  return value === LPC_AVATAR_STYLE ? LPC_AVATAR_STYLE : null
}

/**
 * Sanitiza `avatarOptions` vindo do banco: v2 é validado/sanitizado; o shape
 * v1 da curadoria antiga persiste no banco e é convertido aqui na borda de
 * leitura; open-peeps legado (ou qualquer outro lixo) vira `null`.
 */
export function sanitizeAvatarOptions(value: unknown): CharacterOptions | null {
  return migrateCharacterOptions(value)
}

export function toCharacterFavoriteDTO(favorite: CharacterFavorite): CharacterFavoriteDTO {
  const options = sanitizeAvatarOptions(favorite.options)
  if (!options) {
    throw new Error(`CharacterFavorite ${favorite.id} has invalid options`)
  }
  return {
    id: favorite.id,
    slot: favorite.slot as CharacterFavoriteDTO['slot'],
    seed: favorite.seed,
    options,
    signature: favorite.signature,
    createdAt: favorite.createdAt.toISOString(),
    updatedAt: favorite.updatedAt.toISOString(),
  }
}

export function toPublicUser(
  user: User,
  sectorFeatures: string[] = [],
  opts: { sectorName?: string; companyName?: string | null } = {},
): PublicUser {
  return {
    id: user.id,
    name: user.name,
    // E-mail é ocultado para ex-lendas (quem já saiu do time).
    email: user.leftAt ? null : user.email,
    role: user.role,
    area: user.area,
    position: user.position,
    squad: user.squad,
    photoUrl: user.photoUrl,
    avatarStyle: sanitizeAvatarStyle(user.avatarStyle),
    avatarSeed: user.avatarSeed,
    avatarOptions: sanitizeAvatarOptions(user.avatarOptions),
    active: user.active,
    joinedAt: user.joinedAt.toISOString(),
    leftAt: user.leftAt ? user.leftAt.toISOString() : null,
    sectorId: user.sectorId,
    sectorName: opts.sectorName,
    companyId: user.companyId,
    companyName: opts.companyName ?? null,
    enabledFeatures: Array.isArray(user.enabledFeatures) ? (user.enabledFeatures as FeatureKey[]) : [],
    sectorFeatures: sectorFeatures as FeatureKey[],
    adminAccess: user.adminAccess === true,
  }
}

export function toAdminUser(user: User): AdminUserDTO {
  // Admin sempre enxerga o e-mail real, mesmo de ex-lenda.
  return {
    ...toPublicUser(user),
    email: user.email,
    teamsWebhookUrl: user.teamsWebhookUrl,
    managerId: user.managerId,
    // `@db.Date` volta como Date à meia-noite UTC: o ISO já é o YYYY-MM-DD civil correto.
    birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : null,
  }
}

export function toTodayMoodDTO(
  ymd: string,
  mood: MoodLevel | null,
  note: string | null = null,
  reason: MoodReason | null = null,
): TodayMoodDTO {
  return { day: ymd, mood, note, reason }
}

export function toPeriodDTO(period: VotingPeriod, now: Date = new Date()): VotingPeriodDTO {
  return {
    id: period.id,
    sectorId: period.sectorId,
    monthRef: period.monthRef,
    startsAt: period.startsAt.toISOString(),
    endsAt: period.endsAt.toISOString(),
    status: period.status,
    state: derivePeriodState(period, now),
    editable: isPeriodEditable(period.monthRef, now),
  }
}

export function toDevelopmentThursdayEventDTO(
  event: DevelopmentThursdayEvent & { presenter: User },
): DevelopmentThursdayEventDTO {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    sprintStart: event.sprintStart.toISOString().slice(0, 10),
    sprintEnd: event.sprintEnd.toISOString().slice(0, 10),
    eventDate: event.eventDate.toISOString().slice(0, 10),
    startTime: event.startTime,
    endTime: event.endTime,
    presenter: {
      id: event.presenter.id,
      name: event.presenter.name,
      photoUrl: event.presenter.photoUrl,
    },
    createdAt: event.createdAt.toISOString(),
  }
}

export function toVoteDTO(vote: VoteWithRelations): VoteDTO {
  return {
    id: vote.id,
    voter: { id: vote.voter.id, name: vote.voter.name },
    voted: { id: vote.voted.id, name: vote.voted.name },
    categories: vote.categories.map((vc) => ({
      id: vc.category.id,
      name: vc.category.name,
      slug: vc.category.slug,
    })),
    justification: vote.justification,
    createdAt: vote.createdAt.toISOString(),
    periodId: vote.periodId,
    monthRef: vote.period.monthRef,
  }
}

export function toBadgeDTO(badge: Badge & { sectors?: { sectorId: string }[] }): BadgeDTO {
  return {
    id: badge.id,
    slug: badge.slug,
    name: badge.name,
    description: badge.description,
    kind: badge.kind,
    iconKey: badge.iconKey,
    threshold: badge.threshold,
    categorySlug: badge.categorySlug,
    global: badge.global,
    sectorIds: badge.sectors?.map((s) => s.sectorId) ?? [],
  }
}

export function toBadgeCatalogEntryDTO(entry: BadgeCatalogEntry): BadgeCatalogEntryDTO {
  return { ...toBadgeDTO(entry.badge), requirement: entry.requirement, progress: entry.progress }
}

type AwardedBadgePayload = Prisma.UserBadgeGetPayload<{ include: { badge: true; awardedBy: true } }>

export function toAwardedBadgeDTO(awarded: AwardedBadgePayload): AwardedBadgeDTO {
  return {
    id: awarded.id,
    badge: toBadgeDTO(awarded.badge),
    awardedAt: awarded.awardedAt.toISOString(),
    source: awarded.source,
    awardedBy: awarded.awardedBy ? { id: awarded.awardedBy.id, name: awarded.awardedBy.name } : null,
    featured: awarded.featured,
  }
}

export function toCoinRuleDTO(rule: CoinRule): CoinRuleDTO {
  return {
    id: rule.id,
    event: rule.event,
    amount: rule.amount,
    capWindow: rule.capWindow,
    capAmount: rule.capAmount,
    active: rule.active,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }
}

export function toCoinRulePublicDTO(rule: CoinRule): CoinRulePublicDTO {
  return { event: rule.event, amount: rule.amount, capWindow: rule.capWindow, capAmount: rule.capAmount }
}

export function toCoinTransactionDTO(tx: CoinTransactionWithActor): CoinTransactionDTO {
  return {
    id: tx.id,
    kind: tx.kind,
    event: tx.event,
    amount: tx.amount,
    reason: tx.reason,
    actor: tx.actor ? { id: tx.actor.id, name: tx.actor.name } : null,
    // `day` é dia civil (meia-noite UTC): ymdOf, nunca toISOString completo.
    day: ymdOf(tx.day),
    createdAt: tx.createdAt.toISOString(),
  }
}

export function toXpRuleDTO(rule: XpRule): XpRuleDTO {
  return {
    id: rule.id,
    event: rule.event,
    amount: rule.amount,
    capWindow: rule.capWindow,
    capAmount: rule.capAmount,
    active: rule.active,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }
}

export function toXpRulePublicDTO(rule: XpRule): XpRulePublicDTO {
  return { event: rule.event, amount: rule.amount, capWindow: rule.capWindow, capAmount: rule.capAmount }
}

export function toXpTransactionDTO(tx: XpTransaction): XpTransactionDTO {
  return {
    id: tx.id,
    event: tx.event,
    amount: tx.amount,
    // `day` é dia civil (meia-noite UTC): ymdOf, nunca toISOString completo.
    day: ymdOf(tx.day),
    createdAt: tx.createdAt.toISOString(),
  }
}

export function toHighlightDTO(entry: PublishedHighlight): HighlightDTO {
  const { period, winner } = entry
  return {
    periodId: period.id,
    monthRef: period.monthRef,
    highlightMonthRef: period.highlightMonthRef ?? period.monthRef,
    status: period.highlightStatus,
    winner: winner ? toPublicUser(winner) : null,
    winnerVotes: period.winnerVotes,
    text: period.highlightText,
    // Registros antigos guardam um path relativo local (`/highlights/<mês>.png`, servido
    // via nginx sob /api); a partir da migração para S3, o campo passou a guardar a URL
    // pública absoluta do objeto já pronta para uso.
    imageUrl: period.highlightImagePath
      ? period.highlightImagePath.startsWith('/')
        ? `/api${period.highlightImagePath}`
        : period.highlightImagePath
      : null,
  }
}

function summarizeReactions(
  reactions: { emoji: string; userId: string; user: { id: string; name: string } }[],
  viewerId: string,
  order: readonly string[] = FEEDBACK_REACTIONS,
): ReactionSummary[] {
  return order.flatMap((emoji) => {
    const matching = reactions.filter((r) => r.emoji === emoji)
    if (matching.length === 0) return []
    return [
      {
        emoji,
        count: matching.length,
        reactedByMe: matching.some((r) => r.userId === viewerId),
        users: matching.map((r) => ({ id: r.user.id, name: r.user.name })),
      },
    ]
  })
}

/** Competências do feedback, na ordem do catálogo — é a ordem dos chips. */
function toRecognitionRefs(feedback: FeedbackWithAuthor): RecognitionCategoryRef[] {
  return [...feedback.recognitionCategories]
    .sort((a, b) => a.category.order - b.category.order || a.category.name.localeCompare(b.category.name))
    .map((link) => ({ id: link.category.id, name: link.category.name }))
}

export function toFeedbackDTO(feedback: FeedbackWithAuthor, viewerId: string): FeedbackDTO {
  return {
    id: feedback.id,
    author: toPublicUser(feedback.author),
    message: feedback.message,
    category: feedback.category,
    categories: toRecognitionRefs(feedback),
    customCategory: feedback.customCategory,
    createdAt: feedback.createdAt.toISOString(),
    updatedAt: feedback.updatedAt.toISOString(),
    sharedAt: feedback.sharedAt ? feedback.sharedAt.toISOString() : null,
    reactions: summarizeReactions(feedback.reactions, viewerId),
    commentCount: feedback._count.comments,
  }
}

/**
 * Feedback do Mural de Feedbacks. Só chega aqui o que já passou pelo filtro de
 * `listSharedFeedbacks` (compartilhado + categoria pública), então `sharedAt`
 * nunca é nulo — o fallback para `createdAt` é só a garantia de tipo.
 */
export function toSharedFeedbackDTO(feedback: SharedFeedbackRow, viewerId: string): SharedFeedbackDTO {
  return {
    id: feedback.id,
    author: toPublicUser(feedback.author),
    target: toPublicUser(feedback.target),
    // O principal entra pela tabela de destinatários junto com os demais (o
    // backfill da migration garante isso), então não há concatenação aqui.
    targets: feedback.recipients.map((r) => toPublicUser(r.user)),
    message: feedback.message,
    category: feedback.category,
    categories: toRecognitionRefs(feedback),
    customCategory: feedback.customCategory,
    createdAt: feedback.createdAt.toISOString(),
    sharedAt: (feedback.sharedAt ?? feedback.createdAt).toISOString(),
    reactions: summarizeReactions(feedback.reactions, viewerId),
    commentCount: feedback._count.comments,
  }
}

/** Item de "Recebidos"/"Enviados": igual ao do mural, mas `sharedAt` pode ser nulo. */
export function toMyFeedbackDTO(feedback: SharedFeedbackRow, viewerId: string): MyFeedbackDTO {
  return {
    ...toSharedFeedbackDTO(feedback, viewerId),
    sharedAt: feedback.sharedAt ? feedback.sharedAt.toISOString() : null,
  }
}

export function toFeedbackCommentDTO(comment: FeedbackCommentWithAuthor): FeedbackCommentDTO {
  return {
    id: comment.id,
    author: toPublicUser(comment.author),
    message: comment.message,
    createdAt: comment.createdAt.toISOString(),
  }
}

/** Categoria do catálogo único da empresa — a mesma lista do feedback e do voto. */
export function toRecognitionCategoryDTO(category: RecognitionCategory): RecognitionCategoryDTO {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    order: category.order,
    active: category.active,
  }
}

/**
 * Destaque curado. O grupo sai do SNAPSHOT gravado na linha (`highlight.sector`),
 * não de `user.sector`: quem mudou de setor depois não reescreve o quadro do mês
 * em que foi reconhecido.
 */
export function toMonthlyHighlightDTO(highlight: MonthlyHighlightRow): MonthlyHighlightDTO {
  return {
    id: highlight.id,
    monthRef: highlight.monthRef,
    person: toPublicUser(highlight.user),
    group: { id: highlight.sector.id, name: highlight.sector.name },
    message: highlight.message,
    createdAt: highlight.createdAt.toISOString(),
  }
}

/**
 * Agrupa o quadro do mês. A ordem dos grupos e das pessoas dentro deles vem do
 * `orderBy` da consulta — este map só preserva o que chegou.
 */
export function toMonthlyHighlightGroups(rows: MonthlyHighlightRow[]): MonthlyHighlightGroupDTO[] {
  const groups = new Map<string, MonthlyHighlightGroupDTO>()
  for (const row of rows) {
    const dto = toMonthlyHighlightDTO(row)
    const existing = groups.get(dto.group.id)
    if (existing) existing.people.push(dto)
    else groups.set(dto.group.id, { group: dto.group, people: [dto] })
  }
  return [...groups.values()]
}

export function toReactorRef(user: User): ReactorRef {
  return {
    id: user.id,
    name: user.name,
    photoUrl: user.photoUrl,
    avatarStyle: sanitizeAvatarStyle(user.avatarStyle),
    avatarSeed: user.avatarSeed,
    avatarOptions: sanitizeAvatarOptions(user.avatarOptions),
  }
}

/** Usuários distintos que reagiram (preservando a ordem de chegada). */
function distinctReactors(reactions: { user: User }[]): User[] {
  const seen = new Set<string>()
  const out: User[] = []
  for (const r of reactions) {
    if (seen.has(r.user.id)) continue
    seen.add(r.user.id)
    out.push(r.user)
  }
  return out
}

const MAX_REACTOR_AVATARS = 8

export function toReviewDTO(review: ReviewWithRelations, viewerId: string, sharedByMe: boolean): ReviewDTO {
  const reactors = distinctReactors(review.reactions)
  const selectedOptionId = review.poll?.votes[0]?.optionId ?? null
  const hasVoted = selectedOptionId !== null
  const totalVotes = review.poll?.options.reduce((total, option) => total + option._count.votes, 0) ?? 0
  return {
    id: review.id,
    author: toPublicUser(review.author),
    content: review.content,
    gif: review.gifUrl ? { url: review.gifUrl, width: review.gifWidth ?? 0, height: review.gifHeight ?? 0 } : null,
    image: review.imageUrl
      ? { url: review.imageUrl, width: review.imageWidth ?? 0, height: review.imageHeight ?? 0 }
      : null,
    poll: review.poll
      ? {
          id: review.poll.id,
          question: review.poll.question,
          hasVoted,
          selectedOptionId,
          totalVotes: hasVoted ? totalVotes : null,
          options: review.poll.options.map((option) => ({
            id: option.id,
            text: option.text,
            voteCount: hasVoted ? option._count.votes : null,
            percentage: hasVoted
              ? totalVotes === 0
                ? 0
                : Math.round((option._count.votes / totalVotes) * 100)
              : null,
          })),
        }
      : null,
    createdAt: review.createdAt.toISOString(),
    reactions: summarizeReactions(review.reactions, viewerId, REVIEW_REACTIONS),
    reactors: reactors.slice(0, MAX_REACTOR_AVATARS).map(toReactorRef),
    reactorCount: reactors.length,
    commentCount: review._count.comments,
    shareCount: review._count.shares,
    sharedByMe,
    mentions: review.mentions.map((m) => ({ userId: m.userId, name: m.name })),
  }
}

export function toReviewCommentDTO(comment: ReviewCommentWithRelations, viewerId: string): ReviewCommentDTO {
  return {
    id: comment.id,
    author: toPublicUser(comment.author),
    content: comment.content,
    gif: comment.gifUrl ? { url: comment.gifUrl, width: comment.gifWidth ?? 0, height: comment.gifHeight ?? 0 } : null,
    image: comment.imageUrl
      ? { url: comment.imageUrl, width: comment.imageWidth ?? 0, height: comment.imageHeight ?? 0 }
      : null,
    createdAt: comment.createdAt.toISOString(),
    reactions: summarizeReactions(comment.reactions, viewerId, REVIEW_REACTIONS),
    mentions: comment.mentions.map((m) => ({ userId: m.userId, name: m.name })),
  }
}

export function toCorporatePostDTO(post: CorporatePostWithRelations, viewerId: string): CorporatePostDTO {
  const reactors = distinctReactors(post.reactions)
  // `contentJson` é coluna Json: o tipo do Prisma é `JsonValue`, então a guarda
  // de runtime é obrigatória — linha gravada por versão anterior do código não
  // se prova pelo tipo (ver `rich-text.ts`).
  const body = isRichDoc(post.contentJson) ? post.contentJson : null
  const legacyImage = post.imageUrl
    ? { url: post.imageUrl, width: post.imageWidth ?? 0, height: post.imageHeight ?? 0 }
    : null
  return {
    id: post.id,
    author: toPublicUser(post.author),
    authorSectorName: post.author.sector?.name ?? null,
    title: post.title,
    content: post.content,
    body,
    gif: post.gifUrl ? { url: post.gifUrl, width: post.gifWidth ?? 0, height: post.gifHeight ?? 0 } : null,
    image: legacyImage,
    // A imagem legada entra na MESMA lista dos anexos novos: assim a web tem um
    // caminho só de render, e post antigo não precisa de backfill.
    attachments: [
      ...(legacyImage
        ? [
            {
              id: `${post.id}-legacy-image`,
              kind: 'IMAGE' as const,
              url: legacyImage.url,
              name: 'imagem',
              contentType: 'image/*',
              size: 0,
              width: legacyImage.width || null,
              height: legacyImage.height || null,
            },
          ]
        : []),
      ...post.attachments.map((att) => ({
        id: att.id,
        kind: att.kind,
        url: att.url,
        name: att.name,
        contentType: att.contentType,
        size: att.size,
        width: att.width,
        height: att.height,
      })),
    ],
    status: post.status,
    audience: post.audienceScope,
    audienceSectors: post.sectors.map((s) => ({ id: s.sector.id, name: s.sector.name })),
    createdAt: post.createdAt.toISOString(),
    editedAt: post.editedAt ? post.editedAt.toISOString() : null,
    pinnedAt: post.pinnedAt ? post.pinnedAt.toISOString() : null,
    collapsible: isCollapsibleCorporatePost({ content: post.content, body }),
    reactions: summarizeReactions(post.reactions, viewerId, CORPORATE_POST_REACTIONS),
    reactors: reactors.slice(0, MAX_REACTOR_AVATARS).map(toReactorRef),
    reactorCount: reactors.length,
    commentCount: post._count.comments,
    mentions: post.mentions.map((m) => ({ userId: m.userId, name: m.name })),
  }
}

/**
 * Item da fila de revisão: o post mais o porquê da recusa. Campo à parte do DTO
 * comum de propósito — o motivo da recusa é conversa entre o autor e a G&G, e
 * não tem por que viajar em toda resposta do feed.
 */
export function toPendingCorporatePostDTO(
  post: CorporatePostWithRelations,
  viewerId: string,
): PendingCorporatePostDTO {
  return {
    ...toCorporatePostDTO(post, viewerId),
    rejectionReason: post.rejectionReason,
    reviewedAt: post.reviewedAt ? post.reviewedAt.toISOString() : null,
  }
}

export function toCorporatePostCommentDTO(
  comment: CorporatePostCommentWithRelations,
  viewerId: string,
): CorporatePostCommentDTO {
  return {
    id: comment.id,
    author: toPublicUser(comment.author),
    content: comment.content,
    gif: comment.gifUrl ? { url: comment.gifUrl, width: comment.gifWidth ?? 0, height: comment.gifHeight ?? 0 } : null,
    image: comment.imageUrl
      ? { url: comment.imageUrl, width: comment.imageWidth ?? 0, height: comment.imageHeight ?? 0 }
      : null,
    createdAt: comment.createdAt.toISOString(),
    reactions: summarizeReactions(comment.reactions, viewerId, CORPORATE_POST_REACTIONS),
    mentions: comment.mentions.map((m) => ({ userId: m.userId, name: m.name })),
  }
}

type MuralFeedbackRow = FeedbackWithAuthor & {
  target: User
  sharedAt: Date | null
}

export function toMuralFeedbackItem(feedback: MuralFeedbackRow, viewerId: string): MuralFeedbackItem {
  return {
    type: 'feedback',
    id: feedback.id,
    timestamp: (feedback.sharedAt ?? feedback.createdAt).toISOString(),
    target: toPublicUser(feedback.target),
    author: toPublicUser(feedback.author),
    message: feedback.message,
    category: feedback.category,
    reactions: summarizeReactions(feedback.reactions, viewerId),
  }
}

type MuralBadgeRow = {
  id: string
  awardedAt: Date
  user: User
  badge: { slug: string; name: string; description: string; iconKey: string; kind: Badge['kind'] }
}

export function toMuralBadgeItem(row: MuralBadgeRow): MuralBadgeItem {
  return {
    type: 'badge',
    id: row.id,
    timestamp: row.awardedAt.toISOString(),
    user: toPublicUser(row.user),
    badge: {
      slug: row.badge.slug,
      name: row.badge.name,
      description: row.badge.description,
      iconKey: row.badge.iconKey,
      kind: row.badge.kind,
    },
  }
}

type MuralMoodRow = {
  id: string
  createdAt: Date
  user: User
}

export function toMuralMoodItem(row: MuralMoodRow): MuralMoodItem {
  return {
    type: 'mood',
    id: row.id,
    timestamp: row.createdAt.toISOString(),
    user: toPublicUser(row.user),
  }
}

export function toMuralReviewItem(row: {
  review: ReviewWithRelations
  sharers: User[]
  latestShareAt: Date
}): MuralReviewItem {
  const reactorIds = new Set(row.review.reactions.map((r) => r.user.id))
  return {
    type: 'review',
    id: row.review.id,
    timestamp: row.latestShareAt.toISOString(),
    author: toPublicUser(row.review.author),
    content: row.review.content,
    reactorCount: reactorIds.size,
    sharers: row.sharers.slice(0, MAX_REACTOR_AVATARS).map(toReactorRef),
  }
}

export function toNotificationDTO(n: NotificationWithActor): NotificationDTO {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    link: n.link,
    read: n.readAt != null,
    createdAt: n.createdAt.toISOString(),
    actor: n.actor ? { id: n.actor.id, name: n.actor.name, photoUrl: n.actor.photoUrl } : null,
  }
}

function summarizeRetroReactions(
  reactions: { emoji: string; userId: string }[],
  viewerId: string,
): RetroReactionSummary[] {
  return RETRO_REACTION_EMOJIS.flatMap((emoji) => {
    const matching = reactions.filter((r) => r.emoji === emoji)
    if (matching.length === 0) return []
    return [{ emoji, count: matching.length, reactedByMe: matching.some((r) => r.userId === viewerId) }]
  })
}

export function toRetroCardDTO(
  card: RetroCardWithRelations,
  ctx: { viewerId: string; anonymous: boolean },
): RetroCardDTO {
  const masked = ctx.anonymous && card.authorId !== ctx.viewerId
  const kind = card.kind === 'shape' ? 'shape' : 'note'
  const shape = kind === 'shape' && (RETRO_SHAPES as readonly string[]).includes(card.shape ?? '') ? card.shape as RetroShape : null
  const shapeStyle = kind === 'shape' && (RETRO_SHAPE_STYLES as readonly string[]).includes(card.shapeStyle ?? '') ? card.shapeStyle as RetroShapeStyle : null
  return {
    id: card.id,
    text: masked ? '' : card.text,
    x: card.x,
    y: card.y,
    color: card.color as RetroCardDTO['color'],
    kind,
    shape,
    shapeStyle,
    width: card.width ?? (kind === 'shape' ? SHAPE_WIDTH : 180),
    height: card.height ?? (kind === 'shape' ? SHAPE_HEIGHT : 180),
    actionPlan: card.actionPlan,
    actionResponsible: card.actionResponsible,
    actionDueDate: card.actionDueDate,
    actionCardId: card.actionCardId,
    author: {
      id: card.author.id,
      name: card.author.name,
      photoUrl: card.author.photoUrl,
      avatarStyle: sanitizeAvatarStyle(card.author.avatarStyle),
      avatarSeed: card.author.avatarSeed,
      avatarOptions: sanitizeAvatarOptions(card.author.avatarOptions),
    },
    editedBy: card.editedBy ? { id: card.editedBy.id, name: card.editedBy.name } : null,
    editedAt: card.editedAt ? card.editedAt.toISOString() : null,
    mine: card.authorId === ctx.viewerId,
    masked,
    voteCount: card.votes.length,
    myVotes: card.votes.filter((v) => v.userId === ctx.viewerId).length,
    reactions: summarizeRetroReactions(card.reactions, ctx.viewerId),
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  }
}

export function squadLabel(squads: { squad: { name: string } }[]): string {
  return squads
    .map((s) => s.squad.name)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .join(', ')
}

export function toRetroActionItemDTO(
  card: Pick<
    RetroCard,
    | 'id'
    | 'roomId'
    | 'text'
    | 'actionPlan'
    | 'actionNote'
    | 'actionDueDate'
    | 'actionDone'
    | 'actionDoneAt'
    | 'actionArchivedAt'
    | 'auditStatus'
  >,
  sprint: number,
  squad: string,
): RetroActionItemDTO {
  return {
    id: card.id,
    plan: card.actionPlan ?? '',
    problem: card.text ?? '',
    note: card.actionNote ?? null,
    dueDate: card.actionDueDate ?? '',
    done: card.actionDone,
    doneAt: card.actionDoneAt ? card.actionDoneAt.toISOString() : null,
    archivedAt: card.actionArchivedAt ? card.actionArchivedAt.toISOString() : null,
    sprint,
    squad,
    roomId: card.roomId,
    auditStatus: (card.auditStatus as 'VALIDATED' | 'REJECTED' | null) ?? null,
  }
}

export function toRetroCarryoverItemDTO(
  card: Pick<RetroCard, 'id' | 'actionPlan' | 'actionNote' | 'actionDueDate' | 'auditStatus'>,
  responsible: User | null,
  type: 'validate' | 'overdue',
  sprint: number,
): RetroCarryoverItemDTO {
  return {
    id: card.id,
    plan: card.actionPlan ?? '',
    note: card.actionNote ?? null,
    dueDate: card.actionDueDate ?? '',
    responsible: responsible
      ? {
          id: responsible.id,
          name: responsible.name,
          photoUrl: responsible.photoUrl,
          avatarStyle: sanitizeAvatarStyle(responsible.avatarStyle),
          avatarSeed: responsible.avatarSeed,
          avatarOptions: sanitizeAvatarOptions(responsible.avatarOptions),
        }
      : null,
    sprint,
    type,
    auditStatus: (card.auditStatus as 'VALIDATED' | 'REJECTED' | null) ?? null,
  }
}

export function toRetroEditDTO(
  edit: { id: string; action: string; detail: string | null; createdAt: Date; editor: { id: string; name: string } },
): RetroEditDTO {
  return {
    id: edit.id,
    editor: { id: edit.editor.id, name: edit.editor.name },
    action: edit.action,
    detail: edit.detail,
    createdAt: edit.createdAt.toISOString(),
  }
}

/** Nomes das squads da sala, ordenados (pt-BR). */
function retroRoomSquadDTOs(room: RetroRoomWithRelations): { id: string; name: string }[] {
  return room.squads
    .map((rs) => ({ id: rs.squad.id, name: rs.squad.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export function retroRoomDerivedTitle(room: RetroRoomWithRelations): string {
  return retroRoomTitle(room.sprint, retroRoomSquadDTOs(room).map((s) => s.name))
}

export function toRetroRoomSummaryDTO(room: RetroRoomWithRelations, role: RetroRoomRole): RetroRoomSummaryDTO {
  const squads = retroRoomSquadDTOs(room)
  return {
    id: room.id,
    title: retroRoomTitle(room.sprint, squads.map((s) => s.name)),
    sprint: room.sprint,
    squads,
    status: room.status,
    anonymous: room.anonymous,
    votesPerParticipant: room.votesPerParticipant,
    createdAt: room.createdAt.toISOString(),
    concludedAt: room.concludedAt ? room.concludedAt.toISOString() : null,
    creator: { id: room.creator.id, name: room.creator.name },
    participantCount: room.participants.length,
    myRole: role,
  }
}

function toRetroTimerMode(mode: 'ELAPSED' | 'COUNTDOWN'): RetroTimerMode {
  return mode === 'COUNTDOWN' ? 'countdown' : 'elapsed'
}

function toRetroTimerStatus(status: 'IDLE' | 'RUNNING' | 'PAUSED'): RetroTimerStatus {
  if (status === 'RUNNING') return 'running'
  if (status === 'PAUSED') return 'paused'
  return 'idle'
}

export function toRetroTimerDTO(room: RetroRoomWithRelations, now = new Date()): RetroTimerDTO {
  return {
    mode: toRetroTimerMode(room.timerMode),
    status: toRetroTimerStatus(room.timerStatus),
    durationSeconds: room.timerDurationSeconds,
    startedAt: room.timerStartedAt ? room.timerStartedAt.toISOString() : null,
    accumulatedSeconds: room.timerAccumulatedSeconds,
    updatedAt: room.timerUpdatedAt.toISOString(),
    updatedBy: room.timerUpdatedBy ? { id: room.timerUpdatedBy.id, name: room.timerUpdatedBy.name } : null,
    serverNow: now.toISOString(),
  }
}

export function toRetroRoomDTO(
  room: RetroRoomWithRelations,
  viewer: { id: string },
  role: RetroRoomRole,
): RetroRoomDTO {
  const usedVotes = room.cards.reduce(
    (acc, c) => acc + c.votes.filter((v) => v.userId === viewer.id).length,
    0,
  )
  return {
    ...toRetroRoomSummaryDTO(room, role),
    participants: room.participants.map((p) => ({
      user: toPublicUser(p.user),
      isCreator: p.userId === room.createdById,
    })),
    cards: room.cards.map((c) => toRetroCardDTO(c, { viewerId: viewer.id, anonymous: room.anonymous })),
    myRemainingVotes: Math.max(0, room.votesPerParticipant - usedVotes),
    timer: toRetroTimerDTO(room),
  }
}

type SquadWithMembers = Prisma.SquadGetPayload<{ include: { leader: true; members: { include: { user: true } } } }>

export function toSquadDTO(squad: Squad): SquadDTO {
  return { id: squad.id, name: squad.name, slug: squad.slug, active: squad.active, leaderId: squad.leaderId, sectorId: squad.sectorId }
}

export function toSquadWithMembersDTO(squad: SquadWithMembers): SquadWithMembersDTO {
  return {
    ...toSquadDTO(squad),
    leader: squad.leader ? { id: squad.leader.id, name: squad.leader.name } : null,
    members: squad.members.map((m) => ({ id: m.user.id, name: m.user.name })),
  }
}

/**
 * Conta ADMIN vista pelo super admin. Diferente de `toPublicUser`, o e-mail
 * nunca é ocultado: é a credencial de acesso da empresa e o super admin precisa
 * dela para saber quem administra o quê.
 */
export function toCompanyAdmin(user: User): CompanyAdminDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
  }
}

export function toSectorDTO(sector: SectorWithRoles): SectorDTO {
  return {
    id: sector.id,
    name: sector.name,
    slug: sector.slug,
    active: sector.active,
    responsibleId: sector.responsibleId,
    enabledFeatures: Array.isArray(sector.enabledFeatures) ? (sector.enabledFeatures as FeatureKey[]) : [],
    roles: sector.roles.map((r) => r.role),
  }
}

export function toAuditLogEntryDTO(entry: AuditLogWithActor): AuditLogEntryDTO {
  return {
    id: entry.id,
    actor: { id: entry.actor.id, name: entry.actor.name },
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    before: entry.before,
    after: entry.after,
    createdAt: entry.createdAt.toISOString(),
  }
}

/** Nunca inclui token: o DTO de @legends/shared não tem esse campo, por construção. */
export function toCalendarConnectionDTO(connection: CalendarConnection): CalendarConnectionDTO {
  return {
    provider: connection.provider.toLowerCase() as CalendarProviderKey,
    accountEmail: connection.providerAccountEmail,
    status: connection.status.toLowerCase() as CalendarConnectionDTO['status'],
    publishEnabled: connection.publishEnabled,
    lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
  }
}

/** Payload mínimo que o DTO de reunião precisa carregar do Prisma. */
export interface MeetingWithPeople {
  id: string
  roomExternalKey: string
  roomName: string
  title: string
  agenda: string | null
  startsAt: Date
  endsAt: Date
  sequence: number
  canceledAt: Date | null
  organizer: { id: string; name: string; email: string }
  participants: Array<{ user: { id: string; name: string; email: string } }>
}

/** Forma que `lib/calendar-export.ts` consome (precisa dos e-mails). */
export function toCalendarMeeting(meeting: MeetingWithPeople): CalendarMeeting {
  return {
    id: meeting.id,
    title: meeting.title,
    agenda: meeting.agenda,
    roomName: meeting.roomName,
    roomExternalKey: meeting.roomExternalKey,
    startsAt: meeting.startsAt,
    endsAt: meeting.endsAt,
    sequence: meeting.sequence,
    canceled: meeting.canceledAt !== null,
    organizer: { name: meeting.organizer.name, email: meeting.organizer.email },
    participants: meeting.participants.map((p) => ({ name: p.user.name, email: p.user.email })),
  }
}

/** Entidade Prisma → DTO público. E-mail nunca sai daqui. */
export function toOfficeMeetingDTO(meeting: MeetingWithPeople): OfficeMeetingDTO {
  const calendar = toCalendarMeeting(meeting)
  return {
    id: meeting.id,
    roomExternalKey: meeting.roomExternalKey,
    roomName: meeting.roomName,
    title: meeting.title,
    agenda: meeting.agenda,
    startsAt: meeting.startsAt.toISOString(),
    endsAt: meeting.endsAt.toISOString(),
    canceled: meeting.canceledAt !== null,
    organizer: { id: meeting.organizer.id, name: meeting.organizer.name },
    participants: meeting.participants.map((p) => ({ id: p.user.id, name: p.user.name })),
    googleCalendarUrl: buildGoogleCalendarUrl(calendar),
    outlookCalendarUrl: buildOutlookCalendarUrl(calendar),
    icsPath: `/office/meetings/${meeting.id}/ics`,
  }
}

/** A sala reduzida ao que interessa a quem só vai marcar reunião. */
export function toOfficeRoomOption(room: OfficeRoomDTO): OfficeRoomOptionDTO {
  return {
    externalKey: room.externalKey,
    name: room.name,
    capacity: room.capacity,
    status: room.status,
    voiceEnabled: room.voiceEnabled,
  }
}

/**
 * Datas civis saem como YYYY-MM-DD lidos em UTC: a coluna é `@db.Date` e
 * converter para America/Sao_Paulo jogaria todo período um dia para trás.
 */
export function toVacationDTO(vacation: Vacation & { user: User }): VacationDTO {
  return {
    id: vacation.id,
    user: toPublicUser(vacation.user),
    startDate: vacation.startDate.toISOString().slice(0, 10),
    endDate: vacation.endDate.toISOString().slice(0, 10),
    note: vacation.note,
  }
}

/** Entidade Prisma → DTO do tipo de evento (o que vira chip no calendário). */
export function toCalendarEventTypeDTO(type: CalendarEventType): CalendarEventTypeDTO {
  return { id: type.id, name: type.name, slug: type.slug, icon: type.icon, color: type.color }
}

/**
 * Entidade Prisma → DTO do evento de calendário. `sectorIds` vazio é o público
 * "empresa inteira" — a tela depende dessa convenção para marcar o formulário.
 */
export function toCalendarEventDTO(
  event: CalendarEvent & {
    type: CalendarEventType
    sectors: (CalendarEventSector & { sector: { id: string; name: string } })[]
    createdBy: { name: string }
  },
): CalendarEventDTO {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    date: event.date.toISOString().slice(0, 10),
    endDate: event.endDate ? event.endDate.toISOString().slice(0, 10) : null,
    startTime: event.startTime,
    endTime: event.endTime,
    color: event.color,
    audienceTags: event.audienceTags,
    isInternalComm: event.isInternalComm,
    type: toCalendarEventTypeDTO(event.type),
    sectorIds: event.sectors.map((s) => s.sectorId),
    sectorNames: event.sectors.map((s) => s.sector.name),
    recurrence: event.recurrence,
    recurrenceUntil: event.recurrenceUntil ? event.recurrenceUntil.toISOString().slice(0, 10) : null,
    recurrenceCount: event.recurrenceCount,
    reminderDaysBefore: event.reminderDaysBefore,
    createdById: event.createdById,
    createdByName: event.createdBy.name,
    createdAt: event.createdAt.toISOString(),
  }
}

/** Entidade Prisma → DTO da página institucional (manifesto e afins). */
export function toCulturePageDTO(page: CulturePage): CulturePageDTO {
  return {
    slug: page.slug,
    title: page.title,
    subtitle: page.subtitle,
    body: page.body,
    published: page.published,
    updatedAt: page.updatedAt.toISOString(),
  }
}

/**
 * Entidade Prisma → DTO do manual. A chave do objeto no S3 NUNCA sai daqui:
 * o front recebe só a rota autenticada de download.
 */
export function toCultureManualDTO(manual: CultureManual): CultureManualDTO {
  return {
    id: manual.id,
    title: manual.title,
    description: manual.description,
    body: manual.body,
    downloadPath: manual.fileKey ? `/culture/manuals/${manual.id}/download` : null,
    fileName: manual.fileName,
    fileSize: manual.fileSize,
    referenceLabel: manual.referenceLabel,
    order: manual.order,
    published: manual.published,
    updatedAt: manual.updatedAt.toISOString(),
  }
}

/**
 * Entidade Prisma → DTO da peça do kit visual. A URL pública é derivada da
 * chave, como em `toEventPhotoDTO` — sem storage configurado devolve string
 * vazia, e a tela mostra o card sem imagem em vez de um quadrado quebrado.
 */
export function toCultureVisualAssetDTO(asset: CultureVisualAsset): CultureVisualAssetDTO {
  const cfg = s3Config()
  return {
    id: asset.id,
    title: asset.title,
    description: asset.description,
    imageUrl: cfg ? publicUrlFor(asset.storageKey, cfg) : '',
    fileName: asset.fileName,
    fit: asset.fit,
    order: asset.order,
    published: asset.published,
    updatedAt: asset.updatedAt.toISOString(),
  }
}

/**
 * Entidade Prisma → DTO do material pessoal.
 *
 * O campo `storageKey` não é serializado, e nenhuma URL DURÁVEL sai daqui — que
 * é o oposto da peça global, cujo `imageUrl` público vale para sempre. O card
 * recebe um link assinado que expira em minutos (a chave aparece dentro dele,
 * como em toda URL pré-assinada; o que a protege é o prazo e a assinatura), e o
 * download passa pela rota autenticada, que reconfere quem está pedindo. É
 * assíncrono por causa disso: assinar é uma chamada, não uma concatenação.
 *
 * Falha ao assinar não derruba a leitura — o material aparece sem prévia, com o
 * download ainda disponível (mesma decisão de `downloadUrlsFor` no PDI).
 */
export async function toCulturePersonalAssetDTO(
  asset: CulturePersonalAsset,
): Promise<CulturePersonalAssetDTO> {
  let previewUrl: string | null = null
  if (asset.kind === 'IMAGE' && s3Config()) {
    try {
      // Sem `fileName`: com ele o S3 devolveria `attachment`, e o navegador
      // baixaria o arquivo em vez de desenhá-lo dentro do `<img>`.
      previewUrl = await presignDocumentDownload({ key: asset.storageKey })
    } catch {
      previewUrl = null
    }
  }
  return {
    id: asset.id,
    title: asset.title,
    description: asset.description,
    kind: asset.kind,
    fileName: asset.fileName,
    fileSize: asset.fileSize,
    previewUrl,
    downloadPath: `/culture/personal-assets/${asset.id}/download`,
    createdAt: asset.createdAt.toISOString(),
  }
}

/** O mesmo material, com o destinatário — a visão de quem administra. */
export async function toCulturePersonalAssetAdminDTO(
  asset: CulturePersonalAsset & { recipient: { id: string; name: string } },
): Promise<CulturePersonalAssetAdminDTO> {
  return { ...(await toCulturePersonalAssetDTO(asset)), recipient: asset.recipient }
}

/** Entidade Prisma → DTO do benefício exibido em card + modal. */
export function toCultureBenefitDTO(benefit: CultureBenefit): CultureBenefitDTO {
  return {
    id: benefit.id,
    title: benefit.title,
    summary: benefit.summary,
    icon: benefit.icon,
    body: benefit.body,
    order: benefit.order,
    published: benefit.published,
    updatedAt: benefit.updatedAt.toISOString(),
  }
}

/** Entidade Prisma (com o setor incluído) → DTO do painel de RH. */
export function toHrDashboardDTO(dashboard: HrDashboardWithSector): HrDashboardDTO {
  return {
    id: dashboard.id,
    title: dashboard.title,
    description: dashboard.description,
    embedUrl: dashboard.embedUrl,
    height: dashboard.height,
    sortOrder: dashboard.sortOrder,
    sectorId: dashboard.sectorId,
    sectorName: dashboard.sector?.name ?? null,
    createdAt: dashboard.createdAt.toISOString(),
    updatedAt: dashboard.updatedAt.toISOString(),
  }
}

export type ChallengeForDTO = Challenge & {
  sector: { id: string; name: string } | null
  _count?: { submissions: number }
}

export function toChallengeDTO(challenge: ChallengeForDTO): ChallengeDTO {
  const cfg = s3Config()
  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    category: challenge.category as ChallengeCategory,
    detailsMarkdown: challenge.detailsMarkdown,
    // A chave nunca sai daqui: o DTO expõe só a URL derivada.
    imageUrl: challenge.imageKey && cfg ? publicUrlFor(challenge.imageKey, cfg) : null,
    rewardCoins: challenge.rewardCoins,
    isActive: challenge.isActive,
    position: challenge.position,
    requiresReview: challenge.requiresReview,
    isPrivate: challenge.isPrivate,
    isFeatured: challenge.isFeatured,
    startsAt: challenge.startsAt?.toISOString() ?? null,
    endsAt: challenge.endsAt?.toISOString() ?? null,
    sectorId: challenge.sectorId,
    sectorName: challenge.sector?.name ?? null,
    submissionCount: challenge._count?.submissions ?? 0,
  }
}

/**
 * A evidência sai como URL assinada de curta duração — a chave crua do S3 nunca
 * atravessa a API. Sem S3 configurado o campo é null e a UI simplesmente não mostra.
 */
export async function toChallengeSubmissionDTO(submission: SubmissionWithRefs): Promise<ChallengeSubmissionDTO> {
  let evidenceUrl: string | null = null
  if (submission.evidenceKey && s3Config()) {
    try {
      evidenceUrl = await presignDocumentDownload({ key: submission.evidenceKey })
    } catch {
      evidenceUrl = null
    }
  }

  return {
    id: submission.id,
    status: submission.status,
    note: submission.note,
    evidenceUrl,
    submittedAt: submission.submittedAt.toISOString(),
    reviewedAt: submission.reviewedAt ? submission.reviewedAt.toISOString() : null,
    rejectionReason: submission.rejectionReason,
    user: {
      id: submission.user.id,
      name: submission.user.name,
      email: submission.user.email,
      photoUrl: submission.user.photoUrl,
    },
    challenge: {
      id: submission.challenge.id,
      title: submission.challenge.title,
      rewardCoins: submission.challenge.rewardCoins,
    },
    reviewedBy: submission.reviewedBy ? { id: submission.reviewedBy.id, name: submission.reviewedBy.name } : null,
  }
}

export function toStoreProductDTO(product: StoreProduct): StoreProductDTO {
  const cfg = s3Config()
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    category: product.category as StoreProductCategory,
    priceInCoins: product.priceInCoins,
    stock: product.stock,
    // A chave nunca sai daqui: o DTO expõe só a URL derivada.
    imageUrl: product.imageKey && cfg ? publicUrlFor(product.imageKey, cfg) : null,
    isDigital: product.isDigital,
    isActive: product.isActive,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  }
}

/** DTO do COLABORADOR. Sem `adminNotes` de propósito: a nota da G&G é interna. */
export function toStoreOrderDTO(order: StoreOrderWithProduct): StoreOrderDTO {
  const cfg = s3Config()
  const imageKey = order.product?.imageKey ?? null
  return {
    id: order.id,
    status: order.status,
    productId: order.productId,
    productTitle: order.productTitle,
    pricePaid: order.pricePaid,
    imageUrl: imageKey && cfg ? publicUrlFor(imageKey, cfg) : null,
    handledAt: order.handledAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  }
}

/** DTO da FILA: o do colaborador mais a nota interna, a pessoa e quem tratou. */
export function toStoreOrderAdminDTO(order: StoreOrderWithRefs): StoreOrderAdminDTO {
  return {
    ...toStoreOrderDTO(order),
    adminNotes: order.adminNotes,
    user: { id: order.user.id, name: order.user.name, email: order.user.email },
    handledBy: order.handledBy ? { id: order.handledBy.id, name: order.handledBy.name } : null,
  }
}

/** Prática interna com o autor incluído (pode ser null: a prática sobrevive à pessoa). */
export type BenchmarkPracticeWithCreator = BenchmarkPractice & {
  createdBy?: { id: string; name: string } | null
}

export function toBenchmarkPracticeDTO(practice: BenchmarkPracticeWithCreator): BenchmarkPracticeDTO {
  return {
    id: practice.id,
    category: practice.category,
    title: practice.title,
    description: practice.description,
    channel: practice.channel,
    tags: practice.tags,
    createdById: practice.createdById,
    createdByName: practice.createdBy?.name ?? null,
    createdAt: practice.createdAt.toISOString(),
    updatedAt: practice.updatedAt.toISOString(),
  }
}

/**
 * DTO da avaliação externa. Não expõe `createdById`: quem colou o texto não
 * interessa a quem lê o relatório, e manter o campo fora do DTO é a garantia
 * mecânica de que a tela nunca associa uma avaliação a uma pessoa.
 */
export function toGlassReviewDTO(review: GlassReview): GlassReviewDTO {
  return {
    id: review.id,
    // Só a data importa; a hora é sempre 00:00 e exibi-la sugere uma precisão
    // que a avaliação não tem.
    reviewDate: review.reviewDate ? review.reviewDate.toISOString().slice(0, 10) : null,
    rating: review.rating === null ? null : Number(review.rating),
    role: review.role,
    level: review.level,
    sector: review.sector,
    tenure: review.tenure as GlassReviewDTO['tenure'],
    status: review.status as GlassReviewDTO['status'],
    recommends: review.recommends,
    leadershipApproval: review.leadershipApproval,
    title: review.title,
    positives: review.positives,
    negatives: review.negatives,
    advice: review.advice,
    // Sem `?? 'NEUTRO'`: a coluna aceita null (import parcial de histórico) e o
    // overview só conta os não-nulos. Tapar o buraco aqui faria a lista e o
    // painel contarem histórias diferentes sobre as mesmas linhas.
    sentiment: review.sentiment,
    themesPositive: review.themesPositive as GlassReviewDTO['themesPositive'],
    themesNegative: review.themesNegative as GlassReviewDTO['themesNegative'],
    alerts: review.alerts as GlassReviewDTO['alerts'],
    aiSummary: review.aiSummary,
    createdAt: review.createdAt.toISOString(),
  }
}

const AGENT_KIND_TO_KEY: Record<AgentKind, AgentKey> = {
  BENCHMARK: 'benchmark',
  GLASS: 'glass',
  ASSISTANT: 'assistant',
}

const AGENT_ROLE_TO_KEY: Record<PrismaAgentMessageRole, AgentMessageRole> = {
  USER: 'user',
  ASSISTANT: 'assistant',
}

export function toAgentMessageDTO(message: AgentMessage): AgentMessageDTO {
  return {
    id: message.id,
    role: AGENT_ROLE_TO_KEY[message.role],
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  }
}

export function toAgentConversationSummaryDTO(
  conversation: AgentConversation & { _count?: { messages: number } },
): AgentConversationSummaryDTO {
  return {
    id: conversation.id,
    agent: AGENT_KIND_TO_KEY[conversation.agent],
    title: conversation.title,
    messageCount: conversation._count?.messages ?? 0,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  }
}

export function toAgentConversationDTO(
  conversation: AgentConversation & { messages: AgentMessage[] },
): AgentConversationDTO {
  return {
    ...toAgentConversationSummaryDTO({ ...conversation, _count: { messages: conversation.messages.length } }),
    messages: conversation.messages.map(toAgentMessageDTO),
  }
}

/** Trecho da base citado numa resposta da assistente. */
export function toAssistantSourceDTO(entry: {
  id: string
  category: string | null
  question: string
  answer: string
}): AssistantSourceDTO {
  return {
    id: entry.id,
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
  }
}

/** Item do calendário editorial de campanhas, com campanha e responsável reduzidos ao nome. */
export function toCampaignPostDTO(post: CampaignPostWithRelations): CampaignPostDTO {
  return {
    id: post.id,
    campaignId: post.campaignId,
    campaignTheme: post.campaign?.theme ?? null,
    title: post.title,
    body: post.body,
    visualHint: post.visualHint,
    scheduledFor: post.scheduledFor.toISOString(),
    channel: post.channel,
    audience: post.audience,
    status: post.status,
    responsibleId: post.responsibleId,
    responsibleName: post.responsible?.name ?? null,
    publishedPostId: post.publishedPostId,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
  }
}

/** Entrada da base de conhecimento como o admin a vê. */
export function toKnowledgeEntryDTO(entry: KnowledgeEntryWithSector): KnowledgeEntryDTO {
  return {
    id: entry.id,
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
    keywords: entry.keywords,
    isActive: entry.isActive,
    sectorId: entry.sectorId,
    sectorName: entry.sector?.name ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }
}

export type EventAlbumForDTO = {
  album: EventAlbum
  photoCount: number
  coverKey: string | null
}

/** A chave nunca sai daqui: o DTO expõe só a URL pública derivada. */
export function toEventAlbumDTO({ album, photoCount, coverKey }: EventAlbumForDTO): EventAlbumDTO {
  const cfg = s3Config()
  return {
    id: album.id,
    title: album.title,
    description: album.description,
    eventDate: album.eventDate?.toISOString() ?? null,
    coverUrl: coverKey && cfg ? publicUrlFor(coverKey, cfg) : null,
    cover: { fit: album.coverFit, positionY: album.coverPositionY, scale: album.coverScale },
    photoCount,
    createdAt: album.createdAt.toISOString(),
  }
}

export type EventPhotoWithRelations = EventPhoto & {
  reactions: (EventPhotoReaction & { user: User })[]
  _count: { comments: number }
}

export function toEventPhotoDTO(photo: EventPhotoWithRelations, viewerId: string): EventPhotoDTO {
  const cfg = s3Config()
  return {
    id: photo.id,
    albumId: photo.albumId,
    url: cfg ? publicUrlFor(photo.storageKey, cfg) : '',
    width: photo.width,
    height: photo.height,
    createdAt: photo.createdAt.toISOString(),
    reactions: summarizeReactions(photo.reactions, viewerId, EVENT_PHOTO_REACTIONS),
    commentCount: photo._count.comments,
  }
}

export function toEventPhotoCommentDTO(
  comment: EventPhotoComment & { author: User },
  ctx: { viewerId: string; canModerate: boolean },
): EventPhotoCommentDTO {
  return {
    id: comment.id,
    photoId: comment.photoId,
    author: toPublicUser(comment.author),
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    canDelete: ctx.canModerate || comment.authorId === ctx.viewerId,
  }
}
