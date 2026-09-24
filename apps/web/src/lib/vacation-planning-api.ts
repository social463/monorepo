import type {
  ConfirmVacationPlansRequest,
  MyVacationPlanningResponse,
  SaveVacationRequestRequest,
  CorrectVacationEntitlementRequest,
  SaveVacationPlanRequest,
  UpsertVacationCampaignRequest,
  VacationCampaignDTO,
  VacationCampaignOverviewResponse,
  VacationPlanDTO,
  VacationPlanningResponse,
} from '@legends/shared'
import { apiFetch, apiFetchBlob } from './api'

export function fetchTeamPlanning(): Promise<VacationPlanningResponse> {
  return apiFetch('/vacation-planning/team')
}

export function saveVacationPlan(body: SaveVacationPlanRequest): Promise<{ plan: VacationPlanDTO }> {
  return apiFetch('/vacation-planning/plans', { method: 'PUT', body: JSON.stringify(body) })
}

export function confirmVacationPlans(body: ConfirmVacationPlansRequest): Promise<{ confirmed: number }> {
  return apiFetch('/vacation-planning/confirm', { method: 'POST', body: JSON.stringify(body) })
}

export function fetchVacationCampaignOverview(): Promise<VacationCampaignOverviewResponse> {
  return apiFetch('/admin/vacation-planning/overview')
}

export function upsertVacationCampaign(
  body: UpsertVacationCampaignRequest,
): Promise<{ campaign: VacationCampaignDTO; entitlementsCreated: number }> {
  return apiFetch('/admin/vacation-planning/campaign', { method: 'PUT', body: JSON.stringify(body) })
}

export function validateVacationPlans(body: ConfirmVacationPlansRequest): Promise<{ validated: number }> {
  return apiFetch('/admin/vacation-planning/validate', { method: 'POST', body: JSON.stringify(body) })
}

export function correctVacationEntitlement(
  id: string,
  body: CorrectVacationEntitlementRequest,
): Promise<{ ok: true }> {
  return apiFetch(`/admin/vacation-planning/entitlements/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

/** Data-base de férias: só a tela grava, nunca a importação por planilha. */
export function setVacationAnchorDate(userId: string, anchorDate: string | null): Promise<{ ok: true }> {
  return apiFetch(`/admin/vacation-planning/users/${userId}/anchor`, {
    method: 'PATCH',
    body: JSON.stringify({ anchorDate }),
  })
}

export function unlockVacationPlan(entitlementId: string, until: string): Promise<{ ok: true }> {
  return apiFetch('/admin/vacation-planning/unlock', {
    method: 'POST',
    body: JSON.stringify({ entitlementId, until }),
  })
}

/** O que a própria pessoa vê das férias dela. */
export function fetchMyVacationPlanning(): Promise<MyVacationPlanningResponse> {
  return apiFetch('/me/vacation-planning')
}

export function saveMyVacationRequest(body: SaveVacationRequestRequest): Promise<{ ok: true }> {
  return apiFetch('/me/vacation-planning/request', { method: 'PUT', body: JSON.stringify(body) })
}

/**
 * Planilha da campanha. O recorte é do servidor, pelo caminho: o gestor leva a
 * própria estrutura, a G&G leva a empresa inteira.
 */
export function downloadMyTeamVacationCsv(): Promise<{ blob: Blob; filename: string | null }> {
  return apiFetchBlob('/vacation-planning/export')
}

export function downloadVacationCampaignCsv(): Promise<{ blob: Blob; filename: string | null }> {
  return apiFetchBlob('/admin/vacation-planning/export')
}
