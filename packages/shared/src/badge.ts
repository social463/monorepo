import type { BadgeKind } from './enums'
import type { CorporatePostAttachmentKind } from './corporate-mural'

export interface BadgeDTO {
  id: string
  slug: string
  name: string
  description: string
  kind: BadgeKind
  iconKey: string
  threshold: number
  /**
   * ATENÇÃO: **não** é o tema do selo. É o `slug` de uma `RecognitionCategory`
   * — a categoria do FEEDBACK — e é o que um selo `CATEGORY` conta. O tema do
   * catálogo é `badgeCategoryId`, logo abaixo, e são coisas diferentes.
   */
  categorySlug: string | null
  /** Tema do catálogo (Documento 4, seção 11.4); null = "Sem categoria". */
  badgeCategoryId: string | null
  /** Nome do tema, para a tela não precisar cruzar a lista. */
  badgeCategoryName: string | null
  /** Recompensa ao conquistar. `null` = não concede — não é o mesmo que zero. */
  rewardPoints: number | null
  rewardCoins: number | null
  global: boolean
  sectorIds: string[]
}

/**
 * Tema do selo: a prateleira do catálogo no Painel de Emblemas.
 *
 * Não confundir com `RecognitionCategoryDTO`, que é a categoria do feedback.
 * As duas listas existem ao mesmo tempo e não se cruzam.
 */
export interface BadgeCategoryDTO {
  id: string
  name: string
  slug: string
  order: number
  active: boolean
  /** Quantos selos estão nesta gaveta — é o contador que o painel mostra. */
  badgeCount: number
}

export const BADGE_CATEGORY_NAME_MAX_LENGTH = 40

export const BADGE_CLAIM_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type BadgeClaimStatus = (typeof BADGE_CLAIM_STATUSES)[number]

export const BADGE_CLAIM_STATUS_LABELS: Record<BadgeClaimStatus, string> = {
  PENDING: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Recusada',
}

/** Teto do relato da conquista, como o documento pede. */
export const BADGE_CLAIM_STORY_MAX_LENGTH = 1000
export const BADGE_CLAIM_REJECTION_REASON_MAX_LENGTH = 500

/** Reivindicação de selo (Documento 4, seção 11.2). */
export interface BadgeClaimDTO {
  id: string
  badge: BadgeDTO
  user: { id: string; name: string }
  story: string
  /**
   * URL **assinada** da comprovação, de curta duração — nunca a chave do S3.
   * Comprovação é material de uma pessoa, e o bucket é público inteiro.
   * `null` quando não houve anexo ou quando o storage não está configurado.
   */
  attachmentUrl: string | null
  attachmentKind: CorporatePostAttachmentKind | null
  link: string | null
  status: BadgeClaimStatus
  rejectionReason: string | null
  reviewedBy: { id: string; name: string } | null
  reviewedAt: string | null
  createdAt: string
}

export interface CreateBadgeClaimRequest {
  story: string
  /** Chave devolvida pelo presign. Nunca uma URL. */
  attachmentKey?: string | null
  attachmentKind?: CorporatePostAttachmentKind | null
  link?: string | null
}

export type BadgeAwardSource = 'AUTO' | 'MANUAL'

export interface AwardedBadgeDTO {
  id: string
  badge: BadgeDTO
  awardedAt: string
  source: BadgeAwardSource
  awardedBy: { id: string; name: string } | null
  /** Selo escolhido pelo usuário para destacar no card da galeria de Lendas. */
  featured: boolean
}

export interface BadgeProgress {
  current: number
  target: number
}

export interface BadgeCatalogEntryDTO extends BadgeDTO {
  requirement: string
  progress: BadgeProgress | null
}

/** Máximo de selos que um usuário pode destacar no card da galeria de Lendas. */
export const MAX_FEATURED_BADGES = 3

/** Corpo de PUT /me/featured-badges — ids de UserBadge a destacar (= AwardedBadgeDTO.id). */
export interface UpdateFeaturedBadgesPayload {
  badgeIds: string[]
}
