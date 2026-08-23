import type { PublicUser } from './auth'

/** Observação livre do gestor no período ("Férias coletivas", "Emendou feriado"). */
export const VACATION_NOTE_MAX_LENGTH = 200

/** Teto do intervalo aceito em `GET /vacations` — impede que a rota vire dump. */
export const MAX_VACATION_RANGE_DAYS = 366

/**
 * Um período de férias. `startDate`/`endDate` são datas civis (YYYY-MM-DD),
 * inclusivas nas duas pontas: um período de um dia só tem start === end.
 */
export interface VacationDTO {
  id: string
  user: PublicUser
  startDate: string
  endDate: string
  note: string | null
}

export interface VacationsResponse {
  vacations: VacationDTO[]
}

export interface CreateVacationRequest {
  userId: string
  startDate: string
  endDate: string
  note?: string
}

/** Só o período e a observação mudam — trocar a pessoa é apagar e lançar de novo. */
export interface UpdateVacationRequest {
  startDate?: string
  endDate?: string
  note?: string | null
}

/** Um liderado com os períodos dele, no painel do gestor. */
export interface TeamMemberVacationsDTO {
  user: PublicUser
  vacations: VacationDTO[]
}

/** Agrupado como o painel de humor: uma entrada por squad (LEAD) ou uma pela área (MANAGER). */
export interface TeamVacationGroupDTO {
  groupId: string
  groupName: string
  members: TeamMemberVacationsDTO[]
}

export interface TeamVacationsResponse {
  groups: TeamVacationGroupDTO[]
}

/**
 * Dois intervalos fechados de datas civis se sobrepõem? Comparação de strings
 * YYYY-MM-DD é ordenação cronológica — nenhum `Date` envolvido, nenhum fuso.
 */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd
}
