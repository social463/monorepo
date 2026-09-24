import type {
  CreateTrainingRecordRequest,
  MyTrainingResponse,
  TrainingDashboardDTO,
  TrainingFilterOptionsDTO,
  TrainingFilters,
  TrainingRecordDTO,
  TrainingRecordsPageDTO,
  UpdateTrainingRecordRequest,
} from '@legends/shared'
import { apiFetch, apiFetchBlob } from './api'

export interface TrainingIdentityDTO {
  userName: string
  sectorName: string | null
  squad: string | null
  leaderName: string | null
  position: string | null
  positionCategory: string | null
  employmentType: string | null
}

export function fetchTrainingIdentity() {
  return apiFetch<TrainingIdentityDTO>('/training/identity')
}

export function fetchMyTraining() {
  return apiFetch<MyTrainingResponse>('/training/me')
}

export function createTrainingRecord(body: CreateTrainingRecordRequest) {
  return apiFetch<TrainingRecordDTO>('/training/records', { method: 'POST', body: JSON.stringify(body) })
}

export function updateTrainingRecord(id: string, body: UpdateTrainingRecordRequest) {
  return apiFetch<TrainingRecordDTO>(`/training/records/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteTrainingRecord(id: string) {
  return apiFetch<void>(`/training/records/${id}`, { method: 'DELETE' })
}

/**
 * Filtros viram query string aqui, num lugar só: o painel, a Central e o CSV
 * precisam do MESMO recorte, e montar a URL em três lugares é como eles
 * passariam a discordar.
 */
export function trainingFiltersToQuery(filters: TrainingFilters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value) params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function fetchTrainingRecords(filters: TrainingFilters, page: number) {
  return apiFetch<TrainingRecordsPageDTO>(
    `/admin/training/records${trainingFiltersToQuery(filters, { page: String(page) })}`,
  )
}

export function fetchTrainingDashboard(filters: TrainingFilters) {
  return apiFetch<TrainingDashboardDTO>(`/admin/training/overview${trainingFiltersToQuery(filters)}`)
}

export function fetchTrainingFilterOptions() {
  return apiFetch<TrainingFilterOptionsDTO>('/admin/training/filters')
}

export function reviewTrainingRecord(id: string, body: { status: 'APPROVED' | 'REJECTED'; rejectionReason?: string }) {
  return apiFetch<TrainingRecordDTO>(`/admin/training/records/${id}/review`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateTrainingSla(slaDays: number) {
  return apiFetch<{ slaDays: number }>('/admin/training/settings', {
    method: 'PUT',
    body: JSON.stringify({ slaDays }),
  })
}

export function downloadTrainingCsv(filters: TrainingFilters) {
  return apiFetchBlob(`/admin/training/records.csv${trainingFiltersToQuery(filters)}`)
}
