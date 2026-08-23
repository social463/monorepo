import type {
  CreateRetroCardRequest,
  CreateRetroRoomRequest,
  PublicUser,
  RetroActionItemDTO,
  RetroCarryoverItemDTO,
  RetroCardDTO,
  RetroEditDTO,
  RetroReactionEmoji,
  RetroReactionSummary,
  RetroRoomDTO,
  RetroRoomSummaryDTO,
  RetroTimerCommand,
  RetroTimerDTO,
  SquadWithMembersDTO,
  UpdateRetroCardRequest,
  UpdateRetroRoomAdminRequest,
} from '@legends/shared'
import { apiFetch } from './api'

export function listRetroRooms() {
  return apiFetch<{ rooms: RetroRoomSummaryDTO[] }>('/retro/rooms')
}
export function listRetroSquads() {
  return apiFetch<{ squads: SquadWithMembersDTO[] }>('/retro/squads')
}
export function getRetroRoom(id: string) {
  return apiFetch<{ room: RetroRoomDTO }>(`/retro/rooms/${id}`)
}
export function createRetroRoom(body: CreateRetroRoomRequest) {
  return apiFetch<{ room: RetroRoomDTO }>('/retro/rooms', { method: 'POST', body: JSON.stringify(body) })
}
export function setRetroParticipants(id: string, participantIds: string[]) {
  return apiFetch<{ room: RetroRoomDTO }>(`/retro/rooms/${id}/participants`, { method: 'PATCH', body: JSON.stringify({ participantIds }) })
}
export function advanceRetroPhase(id: string, action: 'conclude' = 'conclude') {
  return apiFetch<{ room: RetroRoomDTO }>(`/retro/rooms/${id}/phase`, { method: 'POST', body: JSON.stringify({ action }) })
}
export function toggleRetroAnonymous(id: string, anonymous: boolean) {
  return apiFetch<{ room: RetroRoomDTO }>(`/retro/rooms/${id}/anonymous`, { method: 'POST', body: JSON.stringify({ anonymous }) })
}
export function updateRetroTimer(id: string, command: RetroTimerCommand) {
  return apiFetch<{ timer: RetroTimerDTO; room: RetroRoomDTO }>(`/retro/rooms/${id}/timer`, { method: 'POST', body: JSON.stringify(command) })
}
export function createRetroCard(roomId: string, body: CreateRetroCardRequest) {
  return apiFetch<{ card: RetroCardDTO }>(`/retro/rooms/${roomId}/cards`, { method: 'POST', body: JSON.stringify(body) })
}
export function updateRetroCard(roomId: string, cardId: string, body: UpdateRetroCardRequest) {
  return apiFetch<{ card: RetroCardDTO; actionCard?: RetroCardDTO | null }>(`/retro/rooms/${roomId}/cards/${cardId}`, { method: 'PATCH', body: JSON.stringify(body) })
}
export function updateRetroCardPosition(roomId: string, cardId: string, x: number, y: number) {
  return apiFetch<{ x: number; y: number }>(`/retro/rooms/${roomId}/cards/${cardId}/position`, { method: 'PATCH', body: JSON.stringify({ x, y }) })
}
export function deleteRetroCard(roomId: string, cardId: string) {
  return apiFetch<void>(`/retro/rooms/${roomId}/cards/${cardId}`, { method: 'DELETE' })
}
export function deleteRetroRoom(roomId: string) {
  return apiFetch<void>(`/retro/rooms/${roomId}`, { method: 'DELETE' })
}
export function addRetroVote(roomId: string, cardId: string) {
  return apiFetch<{ voteCount: number; myRemainingVotes: number }>(`/retro/rooms/${roomId}/cards/${cardId}/votes`, { method: 'POST' })
}
export function removeRetroVote(roomId: string, cardId: string) {
  return apiFetch<{ voteCount: number; myRemainingVotes: number }>(`/retro/rooms/${roomId}/cards/${cardId}/votes`, { method: 'DELETE' })
}
export function toggleRetroReaction(roomId: string, cardId: string, emoji: RetroReactionEmoji) {
  return apiFetch<{ reactions: RetroReactionSummary[] }>(`/retro/rooms/${roomId}/cards/${cardId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) })
}
export function listInvitableUsers() {
  return apiFetch<{ users: PublicUser[] }>('/users')
}
export function toggleRetroAction(cardId: string, done: boolean) {
  return apiFetch<{ action: RetroActionItemDTO }>(`/retro/actions/${cardId}`, { method: 'PATCH', body: JSON.stringify({ done }) })
}
export function updateRetroActionNote(cardId: string, note: string) {
  return apiFetch<{ action: RetroActionItemDTO }>(`/retro/actions/${cardId}`, { method: 'PATCH', body: JSON.stringify({ note }) })
}
export function archiveRetroAction(cardId: string, archived: boolean) {
  return apiFetch<{ action: RetroActionItemDTO }>(`/retro/actions/${cardId}`, { method: 'PATCH', body: JSON.stringify({ archived }) })
}
export function listArchivedRetroActions() {
  return apiFetch<{ actions: RetroActionItemDTO[] }>('/retro/actions/archived')
}
export function getRetroCarryover(roomId: string) {
  return apiFetch<{ toValidate: RetroCarryoverItemDTO[]; overdue: RetroCarryoverItemDTO[] }>(`/retro/rooms/${roomId}/carryover`)
}
export function setRetroCarryover(roomId: string, cardId: string, action: 'validate' | 'reject' | 'reschedule' | 'done', dueDate?: string) {
  return apiFetch<{ item: RetroCarryoverItemDTO }>(`/retro/rooms/${roomId}/carryover/${cardId}`, {
    method: 'POST',
    body: JSON.stringify(dueDate ? { action, dueDate } : { action }),
  })
}
export function getRetroEdits(roomId: string) {
  return apiFetch<{ edits: RetroEditDTO[] }>(`/retro/rooms/${roomId}/edits`)
}
export function listAdminRetroRooms() {
  return apiFetch<{ rooms: RetroRoomSummaryDTO[] }>('/admin/retro/rooms')
}
export function updateAdminRetroRoom(roomId: string, body: UpdateRetroRoomAdminRequest) {
  return apiFetch<{ room: RetroRoomSummaryDTO }>(`/admin/retro/rooms/${roomId}`, { method: 'PATCH', body: JSON.stringify(body) })
}
export function hardDeleteAdminRetroRoom(roomId: string) {
  return apiFetch<void>(`/admin/retro/rooms/${roomId}`, { method: 'DELETE' })
}
