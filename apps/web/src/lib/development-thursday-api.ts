import type {
  CreateDevelopmentThursdayEventRequest,
  CreateFeedbackRequest,
  DevelopmentThursdayEventDTO,
  DevelopmentThursdayEventsResponse,
  DevelopmentThursdayFeedbacksResponse,
  DevelopmentThursdaySettingsDTO,
  FeedbackDTO,
  UpdateDevelopmentThursdayEventRequest,
} from '@legends/shared'
import { apiFetch } from './api'

export function listDevelopmentThursdayEvents(from: string, to: string) {
  return apiFetch<DevelopmentThursdayEventsResponse>(`/development-thursday/events?from=${from}&to=${to}`)
}

export function createDevelopmentThursdayEvent(body: CreateDevelopmentThursdayEventRequest) {
  return apiFetch<{ event: DevelopmentThursdayEventDTO }>('/development-thursday/events', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateDevelopmentThursdayEvent(id: string, body: UpdateDevelopmentThursdayEventRequest) {
  return apiFetch<{ event: DevelopmentThursdayEventDTO }>(`/development-thursday/events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteDevelopmentThursdayEvent(id: string) {
  return apiFetch<void>(`/development-thursday/events/${id}`, { method: 'DELETE' })
}

export function listDevelopmentThursdayEventFeedbacks(id: string, offset = 0, limit = 20) {
  return apiFetch<DevelopmentThursdayFeedbacksResponse>(
    `/development-thursday/events/${id}/feedbacks?offset=${offset}&limit=${limit}`,
  )
}

export function createDevelopmentThursdayEventFeedback(id: string, body: CreateFeedbackRequest) {
  return apiFetch<{ feedback: FeedbackDTO }>(`/development-thursday/events/${id}/feedbacks`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getDevelopmentThursdaySettings() {
  return apiFetch<{ settings: DevelopmentThursdaySettingsDTO }>('/admin/development-thursday/settings')
}

export function updateDevelopmentThursdaySettings(body: DevelopmentThursdaySettingsDTO) {
  return apiFetch<{ settings: DevelopmentThursdaySettingsDTO }>('/admin/development-thursday/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
