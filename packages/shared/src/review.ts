import type { PublicUser } from './auth'
import type { AvatarStyleKey } from './avatar'
import type { CharacterOptions } from './character'
import type { ReactionSummary } from './feedback'
import type { AttachedGif } from './gif'
import type { AttachedImage } from './image'

/** Limite de caracteres da resenha e do comentário (após trim). */
export const REVIEW_MAX_LENGTH = 280

/** Máximo de menções (@) por resenha ou comentário. */
export const MAX_REVIEW_MENTIONS = 10

/** Limites das enquetes anexadas a uma resenha. */
export const REVIEW_POLL_QUESTION_MAX_LENGTH = 140
export const REVIEW_POLL_OPTION_MAX_LENGTH = 80
export const REVIEW_POLL_MIN_OPTIONS = 2
export const REVIEW_POLL_MAX_OPTIONS = 10

export interface MentionDTO {
  userId: string
  /** Nome exibido; aparece como "@<name>" no conteúdo. */
  name: string
}

/**
 * Reações da resenha: rostos clássicos de chat (curtir, coração, riso, etc.)
 * seguidos das reações originais (mãos, símbolos). 👍/❤️ não se repetem.
 */
export const REVIEW_REACTIONS = [
  '👍', '❤️', '😂', '😮', '😢', '😡',
  '👏', '🎯', '💡', '🚀', '🎉', '🙌', '🔥', '💪', '🧠', '🙏',
] as const
export type ReviewReactionEmoji = (typeof REVIEW_REACTIONS)[number]

/** Subconjunto de PublicUser suficiente para renderizar <Avatar>. */
export interface ReactorRef {
  id: string
  name: string
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  avatarOptions: CharacterOptions | null
}

export interface ReviewPollOptionDTO {
  id: string
  text: string
  /** Oculto pela API enquanto o usuário ainda não votou. */
  voteCount: number | null
  /** Percentual inteiro (0..100), oculto enquanto o usuário ainda não votou. */
  percentage: number | null
}

export interface ReviewPollDTO {
  id: string
  question: string
  hasVoted: boolean
  selectedOptionId: string | null
  /** Oculto pela API enquanto o usuário ainda não votou. */
  totalVotes: number | null
  options: ReviewPollOptionDTO[]
}

export interface ReviewPollVotersOptionDTO {
  optionId: string
  text: string
  voters: ReactorRef[]
}

export interface ReviewPollVotesResponse {
  pollId: string
  question: string
  totalVotes: number
  options: ReviewPollVotersOptionDTO[]
}

export interface CreateReviewPollRequest {
  question: string
  options: string[]
}

export interface ReviewDTO {
  id: string
  author: PublicUser
  content: string
  /** GIF anexado, ou null. */
  gif: AttachedGif | null
  /** Imagem anexada, ou null. */
  image: AttachedImage | null
  /** Enquete anexada, ou null. Resultados só aparecem depois do voto. */
  poll: ReviewPollDTO | null
  createdAt: string
  reactions: ReactionSummary[]
  /** Usuários distintos que reagiram (cap 8), para a fileira de avatares. */
  reactors: ReactorRef[]
  /** Total de usuários distintos que reagiram (pode ser > reactors.length). */
  reactorCount: number
  commentCount: number
  shareCount: number
  sharedByMe: boolean
  mentions: MentionDTO[]
}

export interface ReviewCommentDTO {
  id: string
  author: PublicUser
  content: string
  gif: AttachedGif | null
  image: AttachedImage | null
  createdAt: string
  reactions: ReactionSummary[]
  mentions: MentionDTO[]
}

export interface ReviewFeedResponse {
  items: ReviewDTO[]
  nextCursor: string | null
}

export interface ReviewCommentsResponse {
  items: ReviewCommentDTO[]
  hasMore: boolean
}

export interface CreateReviewRequest {
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
  poll?: CreateReviewPollRequest
}

export interface CreateReviewCommentRequest {
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
}

/**
 * Eventos de tempo real da resenha empurrados pelo servidor (WebSocket).
 * São "magros": carregam só o necessário para o cliente invalidar a query certa.
 */
export type ReviewEvent =
  | { type: 'feed:changed' }
  | { type: 'review:changed'; reviewId: string }
  | { type: 'comments:changed'; reviewId: string }
