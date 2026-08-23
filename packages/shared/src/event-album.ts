import type { PublicUser } from './auth'
import type { ReactionSummary } from './feedback'
import { REVIEW_REACTIONS } from './review'

/** Máximo de fotos por lote de upload. Não limita o tamanho do álbum — só a leva. */
export const EVENT_PHOTO_MAX_BATCH = 20
export const EVENT_ALBUM_TITLE_MAX_LENGTH = 120
export const EVENT_ALBUM_DESCRIPTION_MAX_LENGTH = 2000
export const EVENT_PHOTO_COMMENT_MAX_LENGTH = 500

/** Mesmo conjunto do mural corporativo e da resenha — sem emoji exclusivo da galeria. */
export const EVENT_PHOTO_REACTIONS = REVIEW_REACTIONS
export type EventPhotoReactionEmoji = (typeof EVENT_PHOTO_REACTIONS)[number]

/**
 * Como a capa preenche o quadro do card.
 *
 * `COVER` corta o que sobra para preencher; `CONTAIN` cabe inteira, com sobra
 * ao redor. As duas existem porque foto de evento e arte de divulgação não se
 * comportam igual: a foto quer preencher, o banner com texto não pode ter as
 * bordas cortadas.
 */
export const EVENT_ALBUM_COVER_FITS = ['COVER', 'CONTAIN'] as const
export type EventAlbumCoverFit = (typeof EVENT_ALBUM_COVER_FITS)[number]

export const EVENT_ALBUM_COVER_SCALE_MIN = 100
export const EVENT_ALBUM_COVER_SCALE_MAX = 250
export const EVENT_ALBUM_COVER_POSITION_MIN = 0
export const EVENT_ALBUM_COVER_POSITION_MAX = 100

/** Enquadramento da capa, aplicado igual no editor e na grade. */
export interface EventAlbumCover {
  fit: EventAlbumCoverFit
  /** Posição vertical do recorte, 0 (topo) a 100 (base). */
  positionY: number
  /** Zoom em porcentagem; 100 é a imagem sem ampliação. */
  scale: number
}

export const DEFAULT_EVENT_ALBUM_COVER: EventAlbumCover = { fit: 'COVER', positionY: 50, scale: 100 }

/** Álbum como aparece na grade. `coverUrl` já vem resolvida — o front não monta URL. */
export interface EventAlbumDTO {
  id: string
  title: string
  description: string | null
  /** ISO-8601, ou null quando o álbum não tem data de evento. */
  eventDate: string | null
  coverUrl: string | null
  /** Enquadramento gravado; vem com o padrão quando ninguém ajustou. */
  cover: EventAlbumCover
  photoCount: number
  createdAt: string
}

export interface EventPhotoDTO {
  id: string
  albumId: string
  url: string
  width: number | null
  height: number | null
  createdAt: string
  reactions: ReactionSummary[]
  commentCount: number
}

export interface EventPhotoCommentDTO {
  id: string
  photoId: string
  author: PublicUser
  body: string
  createdAt: string
  /** O visitante pode apagar este comentário? (autor, ou quem administra G&G) */
  canDelete: boolean
}

export interface EventAlbumListResponse {
  albums: EventAlbumDTO[]
}

export interface EventAlbumDetailResponse {
  album: EventAlbumDTO
  photos: EventPhotoDTO[]
}

export interface EventPhotoCommentListResponse {
  comments: EventPhotoCommentDTO[]
}

export interface CreateEventAlbumRequest {
  title: string
  description?: string | null
  eventDate?: string | null
  /** Chave da capa já enviada ao storage. Sem ela, o álbum nasce sem capa. */
  coverStorageKey?: string | null
  cover?: EventAlbumCover
}

export interface UpdateEventAlbumRequest {
  title?: string
  description?: string | null
  eventDate?: string | null
  /** `null` remove a capa enviada e volta para a foto marcada como capa, se houver. */
  coverStorageKey?: string | null
  cover?: EventAlbumCover
}

/** Uma foto já enviada ao storage, confirmada para o álbum. */
export interface EventPhotoInput {
  storageKey: string
  width?: number | null
  height?: number | null
}

export interface AddEventPhotosRequest {
  photos: EventPhotoInput[]
}

export interface SetEventAlbumCoverRequest {
  photoId: string
}

export interface CreateEventPhotoCommentRequest {
  body: string
}

export interface ToggleEventPhotoReactionRequest {
  emoji: EventPhotoReactionEmoji
}
