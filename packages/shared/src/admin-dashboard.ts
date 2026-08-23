import type { VotingPeriodState } from './enums'

export interface SectorDashboardPeriodDTO {
  id: string
  monthRef: string
  state: VotingPeriodState
  startsAt: string
  endsAt: string
  votesCast: number
}

export interface SectorDashboardCardDTO {
  sectorId: string
  sectorName: string
  activeUserCount: number
  period: SectorDashboardPeriodDTO | null
  /** true quando o último período ENCERRADO deste setor ainda não tem destaque publicado. */
  pendingHighlight: boolean
}

export interface AdminDashboardResponse {
  sectors: SectorDashboardCardDTO[]
}
