import type { BadgeKind } from './enums'

export interface BadgeDTO {
  id: string
  slug: string
  name: string
  description: string
  kind: BadgeKind
  iconKey: string
  threshold: number
  categorySlug: string | null
  global: boolean
  sectorIds: string[]
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
