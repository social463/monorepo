import type {
  CreateOkrCheckInRequest,
  CreateOkrCycleRequest,
  CreateOkrKeyResultRequest,
  CreateOkrObjectiveRequest,
  OkrCheckInResponse,
  OkrCheckInsResponse,
  OkrCycleResponse,
  OkrCyclesResponse,
  OkrObjectiveResponse,
  OkrObjectivesResponse,
  OkrPersonResultsResponse,
  UpdateOkrCycleRequest,
  UpdateOkrKeyResultRequest,
  UpdateOkrObjectiveRequest,
} from '@legends/shared'
import { apiFetch } from './api'

export function listOkrCycles() {
  return apiFetch<OkrCyclesResponse>('/okr/cycles')
}

export function listOkrObjectives(cycleId: string, filters: { parentId?: string } = {}) {
  const query = filters.parentId ? `?parent_id=${encodeURIComponent(filters.parentId)}` : ''
  return apiFetch<OkrObjectivesResponse>(`/okr/cycles/${cycleId}/objectives${query}`)
}

export function getOkrObjective(objectiveId: string) {
  return apiFetch<OkrObjectiveResponse>(`/okr/objectives/${objectiveId}`)
}

export function getOkrPersonResults(personId: string, cycleId: string) {
  return apiFetch<OkrPersonResultsResponse>(`/okr/people/${personId}/results?cycle_id=${encodeURIComponent(cycleId)}`)
}

export function listOkrCheckIns(keyResultId: string) {
  return apiFetch<OkrCheckInsResponse>(`/okr/key-results/${keyResultId}/check-ins`)
}

export function createOkrCheckIn(keyResultId: string, body: CreateOkrCheckInRequest) {
  return apiFetch<OkrCheckInResponse>(`/okr/key-results/${keyResultId}/check-ins`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------- escrita

export function createOkrCycle(body: CreateOkrCycleRequest) {
  return apiFetch<OkrCycleResponse>('/okr/cycles', { method: 'POST', body: JSON.stringify(body) })
}

export function updateOkrCycle(cycleId: string, body: UpdateOkrCycleRequest) {
  return apiFetch<OkrCycleResponse>(`/okr/cycles/${cycleId}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function createOkrObjective(body: CreateOkrObjectiveRequest) {
  return apiFetch<OkrObjectiveResponse>('/okr/objectives', { method: 'POST', body: JSON.stringify(body) })
}

export function updateOkrObjective(objectiveId: string, body: UpdateOkrObjectiveRequest) {
  return apiFetch<OkrObjectiveResponse>(`/okr/objectives/${objectiveId}`, { method: 'PATCH', body: JSON.stringify(body) })
}

/** Soft delete da subárvore: a meta e as filhas dela saem juntas. */
export function deleteOkrObjective(objectiveId: string) {
  return apiFetch<void>(`/okr/objectives/${objectiveId}`, { method: 'DELETE' })
}

export function createOkrKeyResult(objectiveId: string, body: CreateOkrKeyResultRequest) {
  return apiFetch<OkrObjectiveResponse>(`/okr/objectives/${objectiveId}/key-results`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateOkrKeyResult(keyResultId: string, body: UpdateOkrKeyResultRequest) {
  return apiFetch<OkrObjectiveResponse>(`/okr/key-results/${keyResultId}`, { method: 'PATCH', body: JSON.stringify(body) })
}
