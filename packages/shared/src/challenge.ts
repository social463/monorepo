/**
 * Categorias canônicas de desafio, em pt-BR e na ordem em que aparecem nas abas.
 * Categoria fora desta lista é recusada com 400 pela rota de admin.
 */
export const CHALLENGE_CATEGORIES = [
  'Cultura',
  'Bem-estar',
  'Inovação',
  'Sustentabilidade',
  'Conhecimento',
  'Engajamento',
  'Especial',
] as const
export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number]

export function isChallengeCategory(value: string): value is ChallengeCategory {
  return (CHALLENGE_CATEGORIES as readonly string[]).includes(value)
}

/** Corpo em Markdown do detalhe. Mesma ordem de grandeza do manifesto de cultura. */
export const CHALLENGE_DETAILS_MAX_LENGTH = 20_000

export const CHALLENGE_SUBMISSION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type ChallengeSubmissionStatus = (typeof CHALLENGE_SUBMISSION_STATUSES)[number]

export const CHALLENGE_TITLE_MAX_LENGTH = 120
export const CHALLENGE_DESCRIPTION_MAX_LENGTH = 2000
export const CHALLENGE_NOTE_MAX_LENGTH = 500
export const REJECTION_REASON_MIN_LENGTH = 10
export const REJECTION_REASON_MAX_LENGTH = 500
export const CHALLENGE_SUBMISSION_PAGE_SIZE = 20
export const CHALLENGE_EXPORT_MAX_ROWS = 5000
export const CHALLENGE_BATCH_MAX_ITEMS = 100

export interface ChallengeDTO {
  id: string
  title: string
  description: string
  category: ChallengeCategory
  /** Corpo longo em Markdown; o front renderiza com components/Markdown.tsx. */
  detailsMarkdown: string | null
  /** URL pública derivada da chave do S3; null quando não há capa. */
  imageUrl: string | null
  rewardCoins: number
  isActive: boolean
  position: number
  requiresReview: boolean
  isPrivate: boolean
  isFeatured: boolean
  startsAt: string | null
  endsAt: string | null
  /** null = desafio da empresa inteira. */
  sectorId: string | null
  sectorName: string | null
  submissionCount: number
}

export interface ChallengeSubmissionDTO {
  id: string
  status: ChallengeSubmissionStatus
  note: string | null
  /** URL assinada da evidência, ou null. Nunca a chave crua do S3. */
  evidenceUrl: string | null
  submittedAt: string
  reviewedAt: string | null
  rejectionReason: string | null
  /** Pessoa e desafio já resolvidos: a tabela da fila não faz N+1. */
  user: { id: string; name: string; email: string; photoUrl: string | null }
  challenge: { id: string; title: string; rewardCoins: number }
  reviewedBy: { id: string; name: string } | null
}

export interface ChallengeSubmissionPage {
  items: ChallengeSubmissionDTO[]
  nextCursor: string | null
}

/** Desafio na visão do colaborador, com o estado da própria submissão. */
export interface MyChallengeDTO extends ChallengeDTO {
  mySubmission: ChallengeSubmissionDTO | null
}

export type ChallengeBatchDecision = 'APPROVE' | 'REJECT'

export interface ChallengeBatchResult {
  succeeded: string[]
  failed: { id: string; message: string }[]
}

export interface CreateChallengeSubmissionRequest {
  note?: string
  evidenceKey?: string
}

export interface CreateChallengeRequest {
  title: string
  description: string
  category: ChallengeCategory
  detailsMarkdown?: string | null
  imageKey?: string | null
  rewardCoins: number
  isActive?: boolean
  position?: number
  requiresReview?: boolean
  isPrivate?: boolean
  isFeatured?: boolean
  startsAt?: string | null
  endsAt?: string | null
  sectorId?: string | null
}

export type UpdateChallengeRequest = Partial<CreateChallengeRequest>

/** Ordem nova, na sequência desejada. Ids fora do escopo do ator dão 403. */
export interface ReorderChallengesRequest {
  ids: string[]
}

export interface ChallengeListResponse {
  challenges: ChallengeDTO[]
}
