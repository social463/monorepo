import type { OfficeDeskReminderDetailDTO, OfficeDeskReminderSummaryDTO } from '@legends/shared'
import { apiFetch } from './api'

export function createOfficeDeskReminder(deskId: string, message: string, giftPosition: { x: number; y: number }) {
  return apiFetch<{ reminder: OfficeDeskReminderSummaryDTO }>(`/office/desks/${deskId}/reminders`, {
    method: 'POST',
    body: JSON.stringify({ message, giftPosition }),
  })
}

export function getOfficeDeskReminder(id: string) {
  return apiFetch<{ reminder: OfficeDeskReminderDetailDTO }>(`/office/desk-reminders/${id}`)
}

export function markOfficeDeskReminderRead(id: string) {
  return apiFetch<{ reminder: OfficeDeskReminderSummaryDTO }>(`/office/desk-reminders/${id}/read`, {
    method: 'POST',
  })
}
