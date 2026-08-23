import type { OfficeDeskDTO } from '@legends/shared'
import { apiFetch } from './api'

export function claimOfficeDesk(id: string) {
  return apiFetch<{ desk: OfficeDeskDTO }>(`/office/desks/${id}/claim`, { method: 'POST' })
}

export function releaseOfficeDesk(id: string) {
  return apiFetch<{ desk: OfficeDeskDTO }>(`/office/desks/${id}/release`, { method: 'POST' })
}

export function listAdminOfficeDesks() {
  return apiFetch<{ desks: OfficeDeskDTO[] }>('/admin/office-desks')
}

export function adminReleaseOfficeDesk(id: string) {
  return apiFetch<{ desk: OfficeDeskDTO }>(`/admin/office-desks/${id}/claim`, { method: 'DELETE' })
}
