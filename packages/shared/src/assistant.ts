/**
 * Contrato da assistente de RH: base de conhecimento curada por Gente e Gestão,
 * perguntas em linguagem natural respondidas SOMENTE com base nessa base, e o
 * histórico que alimenta o painel de lacunas.
 */

import type { AgentConversationDTO } from './agent'

export const ASSISTANT_QUESTION_MIN_LENGTH = 3
export const ASSISTANT_QUESTION_MAX_LENGTH = 500
export const ASSISTANT_ANSWER_MAX_LENGTH = 5000
export const ASSISTANT_CATEGORY_MAX_LENGTH = 60
export const ASSISTANT_KEYWORD_MAX_LENGTH = 40
export const ASSISTANT_KEYWORDS_MAX_COUNT = 20
export const ASSISTANT_COMMENT_MAX_LENGTH = 500

/** Teto de perguntas por pessoa por hora — a assistente não pode virar torneira de custo de IA. */
export const ASSISTANT_HOURLY_LIMIT = 20

/** Quantas entradas da base entram como contexto da IA (e voltam como `sources`). */
export const ASSISTANT_MAX_SOURCES = 3

/** Janela padrão, em dias, do painel de lacunas. */
export const ASSISTANT_GAPS_DEFAULT_DAYS = 30
export const ASSISTANT_GAPS_MAX_DAYS = 365
export const ASSISTANT_GAPS_DEFAULT_LIMIT = 20

export const ASSISTANT_NOT_FOUND_MESSAGE =
  'Ainda não encontrei essa informação na base de conhecimento. Sua pergunta foi registrada para o time de Gente e Gestão.'

/** Como a resposta foi produzida — a UI diferencia texto de IA de trecho cru da base. */
export const ASSISTANT_ANSWER_SOURCES = ['AI', 'KNOWLEDGE_BASE', 'NONE'] as const
export type AssistantAnswerSource = (typeof ASSISTANT_ANSWER_SOURCES)[number]

export interface KnowledgeEntryDTO {
  id: string
  category: string | null
  question: string
  answer: string
  keywords: string[]
  isActive: boolean
  /** null = entrada vale para a empresa inteira. */
  sectorId: string | null
  sectorName: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateKnowledgeEntryRequest {
  category?: string | null
  question: string
  answer: string
  keywords?: string[]
  isActive?: boolean
  sectorId?: string | null
}

export type UpdateKnowledgeEntryRequest = Partial<CreateKnowledgeEntryRequest>

export interface KnowledgeEntryListResponse {
  entries: KnowledgeEntryDTO[]
  /** Categorias já usadas na empresa, para o formulário sugerir em vez de inventar. */
  categories: string[]
}

export interface AskAssistantRequest {
  question: string
}

/** Trecho da base citado na resposta — o que a pessoa vê como "fonte". */
export interface AssistantSourceDTO {
  id: string
  category: string | null
  question: string
  answer: string
}

export interface AskAssistantResponse {
  /** Id da pergunta registrada — é ele que o botão de feedback usa. */
  queryId: string
  answer: string
  /** false quando nada casou: `answer` é o ASSISTANT_NOT_FOUND_MESSAGE. */
  answered: boolean
  source: AssistantAnswerSource
  sources: AssistantSourceDTO[]
}

export interface AssistantFeedbackRequest {
  rating: -1 | 1
  comment?: string | null
}

/** Perguntas iguais (após normalização) agrupadas numa linha só. */
export interface AssistantGapDTO {
  /** Texto normalizado — chave do agrupamento. */
  normalized: string
  /** Uma ocorrência legível, como alguém digitou. */
  sample: string
  count: number
  lastAskedAt: string
}

/** Entrada da base que está recebendo polegar para baixo. */
export interface AssistantNegativeEntryDTO {
  entry: KnowledgeEntryDTO
  negativeCount: number
  comments: string[]
}

export interface AssistantGapsResponse {
  /** Perguntas sem nenhuma entrada casada — o buraco da base. */
  unanswered: AssistantGapDTO[]
  /** Perguntas mais frequentes que tiveram resposta. */
  frequent: AssistantGapDTO[]
  negative: AssistantNegativeEntryDTO[]
}

export const ASSISTANT_PERSONA_NAME_MAX_LENGTH = 40

/** Nome exibido quando a empresa ainda não escolheu um — sem persona própria configurada. */
export const ASSISTANT_DEFAULT_PERSONA_NAME = 'Assistente de RH'

export interface AssistantPersonaDTO {
  name: string
  /**
   * Avatar fixo, hoje só para a EMR (mesmo gate do bloco de acolhimento
   * emocional em `agent-service.ts`) — ainda não é upload por empresa.
   * `null` cai para um círculo com a inicial do nome no front.
   */
  avatarUrl: string | null
}

export interface UpdateAssistantPersonaRequest {
  name: string
}

/**
 * Turno de chat multi-turno da assistente de RH (agente `assistant`, ver
 * `@legends/shared/agent`). `queryId` é o `AssistantQuery` gravado para esse
 * turno — é ele que o botão de feedback usa, o mesmo endpoint da assistente
 * de pergunta única.
 */
export interface AskAssistantChatResponse {
  conversation: AgentConversationDTO
  queryId: string
}
