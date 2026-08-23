import type {
  CreateVacationRequest,
  TeamVacationsResponse,
  UpdateVacationRequest,
  VacationDTO,
  VacationsResponse,
} from '@legends/shared'
import { apiFetch } from './api'

/** Férias da empresa no mês (`AAAA-MM`; sem argumento, o mês corrente). */
export function fetchMonthVacations(month?: string): Promise<VacationsResponse> {
  return apiFetch(`/vacations/month${month ? `?month=${month}` : ''}`)
}

export function fetchTeamVacations(): Promise<TeamVacationsResponse> {
  return apiFetch('/me/team/vacations')
}

export function createVacation(body: CreateVacationRequest): Promise<{ vacation: VacationDTO }> {
  return apiFetch('/vacations', { method: 'POST', body: JSON.stringify(body) })
}

export function updateVacation(id: string, body: UpdateVacationRequest): Promise<{ vacation: VacationDTO }> {
  return apiFetch(`/vacations/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteVacation(id: string): Promise<void> {
  return apiFetch(`/vacations/${id}`, { method: 'DELETE' })
}
