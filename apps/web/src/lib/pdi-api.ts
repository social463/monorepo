import type {
  CompletePdiActionRequest,
  CompletePdiActionResponse,
  CreatePdiActionRequest,
  CreatePdiPlanRequest,
  DevelopmentSettingsDTO,
  PdiActionResponse,
  PdiDashboardResponse,
  PdiEvidencePresignResponse,
  PdiEvidenceUploadConfig,
  PdiHistoryResponse,
  PdiLeadersResponse,
  PdiPlanListResponse,
  PdiPlanResponse,
  PdiReviewQueueResponse,
  PdiShowcaseResponse,
  PdiShowcaseVisibility,
  ReviewPdiActionRequest,
  UpdatePdiActionRequest,
  UpdatePdiPlanRequest,
} from '@legends/shared'
import { apiFetch } from './api'

export function listPdiPlans() {
  return apiFetch<PdiPlanListResponse>('/pdi/plans')
}

/** Líderes que podem validar o PDI de quem está pedindo (setor + hierarquia). */
export function listEligiblePdiLeaders() {
  return apiFetch<PdiLeadersResponse>('/pdi/leaders')
}

export function getPdiPlan(id: string) {
  return apiFetch<PdiPlanResponse>(`/pdi/plans/${id}`)
}

export function createPdiPlan(body: CreatePdiPlanRequest) {
  return apiFetch<PdiPlanResponse>('/pdi/plans', { method: 'POST', body: JSON.stringify(body) })
}

export function updatePdiPlan(id: string, body: UpdatePdiPlanRequest) {
  return apiFetch<PdiPlanResponse>(`/pdi/plans/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deletePdiPlan(id: string) {
  return apiFetch<void>(`/pdi/plans/${id}`, { method: 'DELETE' })
}

export function createPdiAction(planId: string, body: CreatePdiActionRequest) {
  return apiFetch<PdiActionResponse>(`/pdi/plans/${planId}/actions`, { method: 'POST', body: JSON.stringify(body) })
}

export function updatePdiAction(id: string, body: UpdatePdiActionRequest) {
  return apiFetch<PdiActionResponse>(`/pdi/actions/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deletePdiAction(id: string) {
  return apiFetch<void>(`/pdi/actions/${id}`, { method: 'DELETE' })
}

export function completePdiAction(id: string, body: CompletePdiActionRequest) {
  return apiFetch<CompletePdiActionResponse>(`/pdi/actions/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listPdiActionHistory(id: string) {
  return apiFetch<PdiHistoryResponse>(`/pdi/actions/${id}/history`)
}

export function listPendingPdiReviews() {
  return apiFetch<PdiReviewQueueResponse>('/pdi/reviews/pending')
}

export function reviewPdiAction(id: string, body: ReviewPdiActionRequest) {
  return apiFetch<PdiActionResponse>(`/pdi/actions/${id}/review`, { method: 'POST', body: JSON.stringify(body) })
}

export function getPdiDashboard() {
  return apiFetch<PdiDashboardResponse>('/pdi/dashboard')
}

export function getPdiShowcase(userId: string) {
  return apiFetch<PdiShowcaseResponse>(`/pdi/showcase/${userId}`)
}

export function updatePdiVisibility(visibility: PdiShowcaseVisibility) {
  return apiFetch<{ visibility: PdiShowcaseVisibility }>('/pdi/showcase/visibility', {
    method: 'PUT',
    body: JSON.stringify({ visibility }),
  })
}

export function getPdiEvidenceConfig() {
  return apiFetch<PdiEvidenceUploadConfig>('/pdi/evidences/config')
}

export function presignPdiEvidence(contentType: string, size: number) {
  return apiFetch<PdiEvidencePresignResponse>('/pdi/evidences/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType, size }),
  })
}

/** Sobe o arquivo direto no storage pela URL assinada e devolve a chave guardada no banco. */
export async function uploadPdiEvidence(file: File): Promise<{ storageKey: string; fileName: string; mimeType: string }> {
  const { uploadUrl, key } = await presignPdiEvidence(file.type, file.size)
  const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
  if (!res.ok) throw new Error('Não foi possível enviar o arquivo.')
  return { storageKey: key, fileName: file.name, mimeType: file.type }
}

export function getDevelopmentSettings() {
  return apiFetch<{ settings: DevelopmentSettingsDTO }>('/development/settings')
}

export function updateDevelopmentSettings(body: Partial<DevelopmentSettingsDTO>) {
  return apiFetch<{ settings: DevelopmentSettingsDTO }>('/admin/development/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
