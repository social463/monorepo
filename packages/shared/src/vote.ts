import type { VotingPeriodState, VotingPeriodStatus } from './enums'

export const MIN_JUSTIFICATION_LENGTH = 10

export const MIN_VOTE_CATEGORIES = 1
export const MAX_VOTE_CATEGORIES = 3

export interface VotingPeriodDTO {
  id: string
  sectorId: string
  monthRef: string
  startsAt: string
  endsAt: string
  status: VotingPeriodStatus
  state: VotingPeriodState
  // Mês atual ou futuro pode ser editado; meses passados não.
  editable: boolean
}

export interface VoteUserRef {
  id: string
  name: string
}

export interface VoteCategoryRef {
  id: string
  name: string
  slug: string
}

export interface VoteDTO {
  id: string
  voter: VoteUserRef
  voted: VoteUserRef
  categories: VoteCategoryRef[]
  justification: string
  createdAt: string
  periodId: string
  monthRef: string
}

export interface CreateVoteRequest {
  votedId: string
  categoryIds: string[]
  justification: string
}
