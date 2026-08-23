import type {
  CreateOneOnOneRequest,
  OneOnOneActionDTO,
  OneOnOneMeetingDetailDTO,
  OneOnOneMeetingSummaryDTO,
  OneOnOneTopicDTO,
  OneOnOneTopicOrigin,
  OneOnOneTopicTemplateDTO,
  RespondToOneOnOneRequest,
} from '@legends/shared'
import { apiFetch } from './api'

export function listOneOnOnes(from: string, to: string) {
  return apiFetch<{ meetings: OneOnOneMeetingSummaryDTO[] }>(`/one-on-ones?from=${from}&to=${to}`)
}

export function getOneOnOne(id: string) {
  return apiFetch<OneOnOneMeetingDetailDTO>(`/one-on-ones/${id}`)
}

export function createOneOnOne(body: CreateOneOnOneRequest) {
  return apiFetch<{ seriesId: string; meetings: OneOnOneMeetingSummaryDTO[] }>('/one-on-ones', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function markOneOnOneDone(id: string) {
  return apiFetch<{ meeting: OneOnOneMeetingSummaryDTO }>(`/one-on-ones/${id}/done`, { method: 'POST' })
}

export function cancelOneOnOne(id: string, scope: 'this' | 'future') {
  return apiFetch<void>(`/one-on-ones/${id}?scope=${scope}`, { method: 'DELETE' })
}

export function rescheduleOneOnOne(
  id: string,
  body: { date: string; startTime: string; durationMinutes: number },
  scope: 'this' | 'future',
) {
  return apiFetch<{ meetings: OneOnOneMeetingSummaryDTO[] }>(`/one-on-ones/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function respondToOneOnOne(
  id: string,
  body: RespondToOneOnOneRequest,
  scope: 'this' | 'future',
) {
  return apiFetch<{ meeting: OneOnOneMeetingSummaryDTO }>(`/one-on-ones/${id}/response?scope=${scope}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function acceptOneOnOneProposal(id: string, scope: 'this' | 'future') {
  return apiFetch<{ meeting: OneOnOneMeetingSummaryDTO }>(`/one-on-ones/${id}/proposal/accept?scope=${scope}`, {
    method: 'POST',
  })
}

export function declineOneOnOneProposal(id: string) {
  return apiFetch<{ meeting: OneOnOneMeetingSummaryDTO }>(`/one-on-ones/${id}/proposal/decline`, {
    method: 'POST',
  })
}

export function addOneOnOneTopic(id: string, body: { text: string; origin: OneOnOneTopicOrigin }) {
  return apiFetch<{ topic: OneOnOneTopicDTO }>(`/one-on-ones/${id}/topics`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateOneOnOneTopic(topicId: string, body: { text?: string; discussed?: boolean }) {
  return apiFetch<{ topic: OneOnOneTopicDTO }>(`/one-on-ones/topics/${topicId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteOneOnOneTopic(topicId: string) {
  return apiFetch<void>(`/one-on-ones/topics/${topicId}`, { method: 'DELETE' })
}

export function saveOneOnOneNote(id: string, body: string) {
  return apiFetch<{ note: string | null }>(`/one-on-ones/${id}/note`, {
    method: 'PUT',
    body: JSON.stringify({ body }),
  })
}

export function createOneOnOneAction(
  id: string,
  body: { description: string; ownerId: string; dueDate: string | null },
) {
  return apiFetch<{ action: OneOnOneActionDTO }>(`/one-on-ones/${id}/actions`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateOneOnOneAction(
  actionId: string,
  body: { description?: string; ownerId?: string; dueDate?: string | null; status?: 'OPEN' | 'DONE' },
) {
  return apiFetch<{ action: OneOnOneActionDTO }>(`/one-on-ones/actions/${actionId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

/** Promove ao PDI. Só o dono do plano pode — a API responde 403 para o líder. */
export function promoteOneOnOneAction(actionId: string) {
  return apiFetch<{ action: OneOnOneActionDTO }>(`/one-on-ones/actions/${actionId}/promote-to-pdi`, {
    method: 'POST',
  })
}

export function listOneOnOneTopicTemplates() {
  return apiFetch<{ templates: OneOnOneTopicTemplateDTO[] }>('/one-on-ones/topic-templates')
}
