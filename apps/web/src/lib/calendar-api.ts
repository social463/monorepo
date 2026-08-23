import type {
  CalendarIntegrationStateDTO,
  CalendarProviderKey,
  CalendarSettingsDTO,
  UpdateCalendarSettingsRequest,
} from '@legends/shared'
import { apiFetch } from './api'

export function getCalendarIntegration() {
  return apiFetch<CalendarIntegrationStateDTO>('/calendar/connections')
}

export function startCalendarConnect(provider: CalendarProviderKey) {
  return apiFetch<{ authorizeUrl: string }>(`/calendar/connect/${provider}`, { method: 'POST' })
}

export function disconnectCalendar(provider: CalendarProviderKey) {
  return apiFetch<void>(`/calendar/connections/${provider}`, { method: 'DELETE' })
}

export function getCalendarSettings() {
  return apiFetch<CalendarSettingsDTO>('/admin/calendar-settings')
}

export function updateCalendarSettings(body: UpdateCalendarSettingsRequest) {
  return apiFetch<CalendarSettingsDTO>('/admin/calendar-settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
