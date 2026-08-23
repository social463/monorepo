/**
 * Competências do Mural de Feedbacks — o "por quê" de cada reconhecimento.
 *
 * O catálogo é **administrável pela G&G** (model `RecognitionCategory`, CRUD em
 * Administração › Reconhecimento), e não uma constante cravada aqui: a lista do
 * documento é o **seed** da empresa, e cada cliente ajusta a dele. Por isso o
 * que mora neste arquivo são os limites, os tipos e a semente — nunca a
 * verdade sobre quais competências existem numa empresa, que é dado.
 */

/** As 13 competências do documento da G&G, na ordem em que ele as lista. */
export const RECOGNITION_CATEGORY_SEED = [
  'Trabalho em Equipe e Colaboração',
  'Liderança',
  'Foco no Cliente',
  'Inovação',
  'Execução Impecável',
  'Inspiração',
  'Gratidão',
  'Comunicação',
  'Inteligência Emocional',
  'Adaptabilidade e Resiliência',
  'Proatividade e Senso de Dono',
  'Foco em Resultados',
  'Resolução de Problemas',
] as const

/**
 * Teto de destinatários por feedback. O reconhecimento grupal é para o time que
 * fez a entrega junto — acima disso vira comunicado, que é o Feed Corporativo.
 */
export const MAX_FEEDBACK_RECIPIENTS = 20

/** Teto de competências por feedback: reconhecimento com 13 marcas não diz nada. */
export const MAX_RECOGNITION_CATEGORIES_PER_FEEDBACK = 5

export const RECOGNITION_CATEGORY_NAME_MAX_LENGTH = 60

/** Categoria personalizada — a válvula para o que o catálogo não cobre. */
export const CUSTOM_CATEGORY_MAX_LENGTH = 60

/** Limite da mensagem de reconhecimento. */
export const FEEDBACK_MESSAGE_MAX_LENGTH = 800

/** Limite do comentário em um feedback (mesmo teto do comentário do feed). */
export const FEEDBACK_COMMENT_MAX_LENGTH = 280

/** Limite das instruções mandadas para a IA escrever o reconhecimento. */
export const FEEDBACK_AI_PROMPT_MAX_LENGTH = 600

/**
 * Categoria como o catálogo devolve — a mesma lista que o feedback e o voto
 * usam desde que os dois catálogos viraram um só
 * (`specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`).
 *
 * `slug` existe porque os selos de categoria apontam para ele (`Badge.categorySlug`)
 * e o front escolhe o ícone por ele — o nome é editável pela G&G, o slug não.
 */
export interface RecognitionCategoryDTO {
  id: string
  name: string
  slug: string
  description: string | null
  order: number
  active: boolean
}

/** Competência dentro de um feedback — só o necessário para o chip do card. */
export interface RecognitionCategoryRef {
  id: string
  name: string
}

export interface CreateRecognitionCategoryRequest {
  name: string
  description?: string
  order?: number
}

export interface UpdateRecognitionCategoryRequest {
  name?: string
  description?: string | null
  order?: number
  active?: boolean
}

export interface RecognitionCategoriesResponse {
  categories: RecognitionCategoryDTO[]
}
