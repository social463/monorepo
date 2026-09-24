import type {
  AgentConversationListResponse,
  InovaAdminChatAskRequest,
  AskAgentResponse,
  InovaProjectDetailResponse,
  InovaProjectDTO,
  InovaProjectInput,
  InovaProjectListResponse,
  InovaProjectPhase,
  InovaDiaryEntryDTO,
  InovaGuiaVideoDTO,
  InovaGuiaVideoListResponse,
  InovaProjectTaskDTO,
  InovaTaskStatus,
} from '@legends/shared'
import { apiFetch } from './api'

export function listInovaProjects(options: { archived?: boolean } = {}) {
  const query = options.archived ? '?archived=true' : ''
  return apiFetch<InovaProjectListResponse>(`/inova/projects${query}`)
}

export function getInovaProjectDetail(id: string) {
  return apiFetch<InovaProjectDetailResponse>(`/inova/projects/${id}`)
}

export function createInovaProject(body: InovaProjectInput) {
  return apiFetch<{ project: InovaProjectDTO }>('/inova/projects', { method: 'POST', body: JSON.stringify(body) })
}

export function updateInovaProject(id: string, body: Partial<InovaProjectInput> & { archived?: boolean }) {
  return apiFetch<{ project: InovaProjectDTO }>(`/inova/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteInovaProject(id: string) {
  return apiFetch<void>(`/inova/projects/${id}`, { method: 'DELETE' })
}

export function deleteInovaDiaryEntry(entryId: string) {
  return apiFetch<void>(`/inova/diary/${entryId}`, { method: 'DELETE' })
}

export function deleteInovaProjectTask(taskId: string) {
  return apiFetch<void>(`/inova/tasks/${taskId}`, { method: 'DELETE' })
}

export function changeInovaProjectPhase(id: string, body: { phase: InovaProjectPhase; note?: string }) {
  return apiFetch<{ project: InovaProjectDTO }>(`/inova/projects/${id}/phase`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function addInovaDiaryEntry(
  projectId: string,
  body: { title: string; description?: string; learnings?: string; tools?: string; imageUrls?: string[]; videoLinks?: string[]; externalLinks?: string[] },
) {
  return apiFetch<{ entry: InovaDiaryEntryDTO }>(`/inova/projects/${projectId}/diary`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function createInovaProjectTask(
  projectId: string,
  body: { title: string; description?: string; responsible?: string; dueDate?: string; status?: InovaTaskStatus },
) {
  return apiFetch<{ task: InovaProjectTaskDTO }>(`/inova/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateInovaProjectTask(
  taskId: string,
  body: { title?: string; description?: string | null; responsible?: string | null; dueDate?: string | null },
) {
  return apiFetch<{ task: InovaProjectTaskDTO }>(`/inova/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function updateInovaProjectTaskStatus(taskId: string, status: InovaTaskStatus) {
  return apiFetch<{ task: InovaProjectTaskDTO }>(`/inova/tasks/${taskId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function presignInovaDiaryUpload(contentType: string, size: number) {
  return apiFetch<{ uploadUrl: string; publicUrl: string; key: string; kind: string }>('/uploads/inova-diary/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType, size }),
  })
}

/** Sobe o arquivo direto no storage pela URL assinada e devolve a URL pública. */
export async function uploadInovaDiaryEvidence(file: File): Promise<string> {
  const { uploadUrl, publicUrl } = await presignInovaDiaryUpload(file.type, file.size)
  const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
  if (!res.ok) throw new Error('Não foi possível enviar o arquivo.')
  return publicUrl
}

export function askInovaAdminChat(body: InovaAdminChatAskRequest) {
  return apiFetch<AskAgentResponse>('/inova/admin/chat/ask', { method: 'POST', body: JSON.stringify(body) })
}

export function listInovaAdminChatConversations() {
  return apiFetch<AgentConversationListResponse>('/inova/admin/chat/conversations')
}

export function getInovaAdminChatConversation(id: string) {
  return apiFetch<AskAgentResponse>(`/inova/admin/chat/conversations/${id}`)
}

/** Setores ativos da empresa — usado pelo painel para apontar setores sem projeto. */
export function listSectors() {
  return apiFetch<{ sectors: { id: string; name: string }[] }>('/sectors')
}

// ---------------------------------------------------------------------------
// Biblioteca de vídeos do Guia AI First
// ---------------------------------------------------------------------------

export function listInovaGuiaVideos() {
  return apiFetch<InovaGuiaVideoListResponse>('/inova/guia/videos')
}

export function createInovaGuiaVideoCard() {
  return apiFetch<{ video: InovaGuiaVideoDTO }>('/inova/guia/videos', { method: 'POST' })
}

export interface InovaGuiaVideoPatch {
  title?: string | null
  description?: string | null
  category?: string | null
  duration?: string | null
  behavior?: string | null
  videoUrl?: string | null
  storagePath?: string | null
}

export function patchInovaGuiaVideo(videoId: string, patch: InovaGuiaVideoPatch) {
  return apiFetch<{ video: InovaGuiaVideoDTO }>(`/inova/guia/videos/${videoId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deleteInovaGuiaVideo(videoId: string) {
  return apiFetch<void>(`/inova/guia/videos/${videoId}`, { method: 'DELETE' })
}

function presignInovaGuiaVideoUpload(contentType: string, size: number) {
  return apiFetch<{ uploadUrl: string; publicUrl: string; storagePath: string }>('/uploads/inova-guia-video/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType, size }),
  })
}

/** Sobe o vídeo direto no storage pela URL assinada e devolve a chave gravada (`storagePath`). */
export async function uploadInovaGuiaVideo(file: File): Promise<string> {
  const { uploadUrl, storagePath } = await presignInovaGuiaVideoUpload(file.type, file.size)
  const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
  if (!res.ok) throw new Error('Não foi possível enviar o vídeo.')
  return storagePath
}
