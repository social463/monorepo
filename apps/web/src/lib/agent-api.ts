import type {
  AgentConversationListResponse,
  AgentKey,
  AskAgentRequest,
  AskAgentResponse,
  AskAssistantChatResponse,
  AssistantPersonaDTO,
  BenchmarkPracticeDTO,
  BenchmarkPracticeListResponse,
  CreateBenchmarkPracticeRequest,
  UpdateAssistantPersonaRequest,
  UpdateBenchmarkPracticeRequest,
} from '@legends/shared'
import { apiFetch } from './api'

export function askAgent(agent: AgentKey, body: AskAgentRequest) {
  return apiFetch<AskAgentResponse>(`/admin/agents/${agent}/ask`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listAgentConversations(agent: AgentKey) {
  return apiFetch<AgentConversationListResponse>(`/admin/agents/${agent}/conversations`)
}

export function getAgentConversation(agent: AgentKey, id: string) {
  return apiFetch<AskAgentResponse>(`/admin/agents/${agent}/conversations/${id}`)
}

export function listBenchmarkPractices() {
  return apiFetch<BenchmarkPracticeListResponse>('/admin/benchmark-practices')
}

export function createBenchmarkPractice(body: CreateBenchmarkPracticeRequest) {
  return apiFetch<{ practice: BenchmarkPracticeDTO }>('/admin/benchmark-practices', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateBenchmarkPractice(id: string, body: UpdateBenchmarkPracticeRequest) {
  return apiFetch<{ practice: BenchmarkPracticeDTO }>(`/admin/benchmark-practices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteBenchmarkPractice(id: string) {
  return apiFetch<void>(`/admin/benchmark-practices/${id}`, { method: 'DELETE' })
}

/** Chat multi-turno da assistente de RH (agente `assistant`). */
export function askAssistantChat(body: AskAgentRequest) {
  return apiFetch<AskAssistantChatResponse>('/assistant/chat', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listAssistantChatConversations() {
  return apiFetch<AgentConversationListResponse>('/assistant/chat/conversations')
}

export function getAssistantChatConversation(id: string) {
  return apiFetch<AskAgentResponse>(`/assistant/chat/conversations/${id}`)
}

export function getAssistantPersona() {
  return apiFetch<AssistantPersonaDTO>('/assistant/persona')
}

export function updateAssistantPersona(body: UpdateAssistantPersonaRequest) {
  return apiFetch<AssistantPersonaDTO>('/admin/assistant/persona', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
