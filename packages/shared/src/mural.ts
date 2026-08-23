import type { PublicUser } from './auth'
import type { BadgeKind } from './enums'
import type { FeedbackCategory, ReactionSummary } from './feedback'
import type { ReactorRef } from './review'

export interface MuralFeedbackItem {
  type: 'feedback'
  id: string
  /** ISO usado para ordenar o mural (sharedAt do feedback). */
  timestamp: string
  target: PublicUser
  author: PublicUser
  message: string
  category: FeedbackCategory
  reactions: ReactionSummary[]
}

export interface MuralBadgeItem {
  type: 'badge'
  /** id do UserBadge. */
  id: string
  /** ISO usado para ordenar o mural (awardedAt do selo). */
  timestamp: string
  user: PublicUser
  badge: { slug: string; name: string; description: string; iconKey: string; kind: BadgeKind }
}

export interface MuralMoodItem {
  type: 'mood'
  /** id do MoodEntry. */
  id: string
  /** ISO usado para ordenar o mural (createdAt do registro de humor). */
  timestamp: string
  /** Quem respondeu ao humor do dia. O humor em si nunca é exposto aqui. */
  user: PublicUser
}

export interface MuralReviewItem {
  type: 'review'
  /** id da resenha. */
  id: string
  /** ISO usado para ordenar o mural (share mais recente). */
  timestamp: string
  author: PublicUser
  content: string
  /** Total de usuários distintos que reagiram à resenha. */
  reactorCount: number
  /** Quem compartilhou a resenha no mural (cap). */
  sharers: ReactorRef[]
}

export type MuralItemDTO = MuralFeedbackItem | MuralBadgeItem | MuralMoodItem | MuralReviewItem

export interface MuralResponse {
  items: MuralItemDTO[]
}
