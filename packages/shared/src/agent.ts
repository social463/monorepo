/**
 * Contrato dos agentes de IA. As conversas são genéricas de propósito: o mesmo
 * par conversa/mensagem serve o agente de Benchmarking e o GlassAgent, que
 * diferem no system prompt e na fonte de contexto, não no armazenamento.
 *
 * A conversa é sempre **da pessoa** — não existe conversa compartilhada entre
 * dois admins da mesma empresa.
 */

export type AgentKey = 'benchmark' | 'glass' | 'assistant'

export const AGENT_KEYS: readonly AgentKey[] = ['benchmark', 'glass', 'assistant']

export function isAgentKey(value: unknown): value is AgentKey {
  return typeof value === 'string' && (AGENT_KEYS as readonly string[]).includes(value)
}

export const AGENT_LABELS: Record<AgentKey, string> = {
  benchmark: 'Agente de Benchmarking',
  glass: 'GlassAgent',
  assistant: 'Assistente de RH',
}

export type AgentMessageRole = 'user' | 'assistant'

/** Tamanho máximo de uma pergunta. É pergunta de análise, não colagem de documento. */
export const AGENT_MESSAGE_MAX_LENGTH = 4000

/**
 * Teto de mensagens por conversa. A conversa inteira vai no request a cada
 * turno, então o teto é de custo e de latência, não de banco.
 */
export const AGENT_CONVERSATION_MAX_MESSAGES = 40

export const AGENT_CONVERSATION_TITLE_MAX_LENGTH = 120

/** Teto de espera pela IA, espelhado no client do provedor. */
export const AGENT_TIMEOUT_MS = 55_000

export interface AgentMessageDTO {
  id: string
  role: AgentMessageRole
  content: string
  createdAt: string
}

/** Resumo de conversa usado na lista lateral — sem as mensagens. */
export interface AgentConversationSummaryDTO {
  id: string
  agent: AgentKey
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface AgentConversationDTO extends AgentConversationSummaryDTO {
  messages: AgentMessageDTO[]
}

export interface AskAgentRequest {
  /** Ausente = abre uma conversa nova. */
  conversationId?: string
  message: string
}

export interface AskAgentResponse {
  /** A conversa completa depois do turno — pergunta e resposta já incluídas. */
  conversation: AgentConversationDTO
}

export interface AgentConversationListResponse {
  conversations: AgentConversationSummaryDTO[]
}
