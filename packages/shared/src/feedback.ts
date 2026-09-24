import type { PublicUser } from './auth'
import type { RecognitionCategoryRef } from './recognition'

export const MIN_FEEDBACK_FIELD_LENGTH = 10

export const FEEDBACK_CATEGORIES = ['POSITIVO', 'ORIENTACAO', 'ELOGIO', 'MELHORIA'] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  POSITIVO: 'Positivo',
  ORIENTACAO: 'Orientação',
  ELOGIO: 'Elogio',
  MELHORIA: 'Melhoria',
}

/** Categorias visíveis para todos os usuários autenticados. As demais são restritas a autor, alvo e ADMIN. */
export const PUBLIC_FEEDBACK_CATEGORIES = ['POSITIVO', 'ELOGIO'] as const satisfies readonly FeedbackCategory[]

export const FEEDBACK_REACTIONS = ['👏', '❤️', '🎯', '💡', '🚀', '👍', '🎉', '🙌', '🔥', '💪', '🧠', '🙏'] as const
export type FeedbackReactionEmoji = (typeof FEEDBACK_REACTIONS)[number]

export interface ReactionSummary {
  /** Emoji da reação — de FEEDBACK_REACTIONS (feedback) ou REVIEW_REACTIONS (resenha). */
  emoji: string
  count: number
  /** Se o usuário que fez a requisição já reagiu com este emoji. */
  reactedByMe: boolean
  /** Quem reagiu com este emoji — usado para o tooltip de nomes. */
  users: { id: string; name: string }[]
}

export interface ToggleReactionRequest {
  emoji: FeedbackReactionEmoji
}

export interface FeedbackDTO {
  id: string
  author: PublicUser
  message: string
  category: FeedbackCategory
  /** Competências do catálogo da G&G. Vazio nos feedbacks anteriores à 2ª rodada. */
  categories: RecognitionCategoryRef[]
  /** Competência escrita à mão, quando o catálogo não cobria. */
  customCategory: string | null
  createdAt: string
  updatedAt: string
  /** ISO do momento em que o feedback foi para o mural; null = privado. */
  sharedAt: string | null
  reactions: ReactionSummary[]
  commentCount: number
}

/**
 * Item do Mural de Feedbacks: feedback público que o destinatário compartilhou,
 * visível para toda a empresa. Diferente de FeedbackDTO, expõe o `target` —
 * fora do perfil de alguém, quem recebeu não é dedutível do contexto.
 */
export interface SharedFeedbackDTO {
  id: string
  author: PublicUser
  /**
   * Destinatário principal. Continua aqui porque `Feedback.targetId` continua
   * existindo (perfil, Quinta de Dev, selos) — para exibir "para Ana, Bruno e
   * mais 2", use `targets`, que inclui este.
   */
  target: PublicUser
  /** Todos os destinatários, o principal incluído. Um só no feedback individual. */
  targets: PublicUser[]
  message: string
  category: FeedbackCategory
  categories: RecognitionCategoryRef[]
  customCategory: string | null
  createdAt: string
  /** ISO do compartilhamento — é por ele que o mural ordena (mais recente primeiro). */
  sharedAt: string
  reactions: ReactionSummary[]
  commentCount: number
}

export interface FeedbackWallResponse {
  feedbacks: SharedFeedbackDTO[]
  hasMore: boolean
  /**
   * Última vez que quem está olhando abriu o Mural de Feedbacks — null se nunca
   * abriu. É novo o feedback cujo `sharedAt` é posterior a este instante.
   *
   * Vem na RESPOSTA, e não como `isNew` em cada item, porque "novo" é relação
   * entre o feedback e o leitor, não propriedade do feedback: o mesmo item é
   * novo para quem não abriu a aba e velho para quem abriu. Com um campo por
   * item, `toSharedFeedbackDTO` — que também serve Recebidos e Enviados, onde a
   * marcação não existe — teria de mentir um `false`.
   */
  wallSeenAt: string | null
}

/**
 * Página de feedbacks do perfil. Diferente do mural, que é rolagem infinita,
 * esta é numerada: por isso `total` (para dizer "página X de Y") e `offset` (que
 * volta calculado do servidor quando se pede uma âncora — ver `anchor` na rota).
 */
export interface ProfileFeedbacksResponse {
  feedbacks: FeedbackDTO[]
  hasMore: boolean
  total: number
  /** Offset efetivamente usado — o pedido, ou o da página que contém a âncora. */
  offset: number
}

/**
 * Item das abas **Recebidos** e **Enviados**: o mesmo card do mural, mais o
 * estado de publicação — é o que deixa a pessoa ver que aquele reconhecimento
 * ainda está privado. `sharedAt` nulo = privado.
 */
export interface MyFeedbackDTO extends Omit<SharedFeedbackDTO, 'sharedAt'> {
  sharedAt: string | null
}

export interface MyFeedbacksResponse {
  feedbacks: MyFeedbackDTO[]
  hasMore: boolean
}

export interface FeedbackCommentDTO {
  id: string
  author: PublicUser
  message: string
  createdAt: string
}

export interface FeedbackCommentsResponse {
  comments: FeedbackCommentDTO[]
}

export interface CreateFeedbackCommentRequest {
  message: string
}

export interface GenerateFeedbackRequest {
  /** Para quem é — o nome ajuda o modelo a escolher a pessoa do texto. */
  targetNames: string[]
  /** Competências escolhidas, pelo nome. */
  categoryNames: string[]
  /** O que a pessoa quer dizer, do jeito dela. Opcional. */
  notes?: string
}

export interface GenerateFeedbackResponse {
  message: string
}

/** Quantos feedbacks a página do mural carrega por vez. */
export const FEEDBACK_WALL_PAGE_SIZE = 10

/**
 * Quantos feedbacks cabem numa página do perfil.
 *
 * Cinco, e não dez: ali a lista é paginada por página (‹ Anterior · X de Y ·
 * Próxima ›) justamente para o card ter **altura previsível** — com dez o bloco
 * passa de duas telas no desktop e o perfil volta a esticar conforme a pessoa
 * recebe feedback.
 */
export const PROFILE_FEEDBACK_PAGE_SIZE = 5

/** Quantos feedbacks a prévia do mural na home mostra. */
export const FEEDBACK_WALL_PREVIEW_SIZE = 3

export interface CreateFeedbackRequest {
  message: string
  category: FeedbackCategory
  /**
   * Destinatários adicionais do reconhecimento grupal. O da URL
   * (`POST /users/:id/feedbacks`) é sempre o principal e **não** precisa vir
   * repetido aqui.
   */
  targetIds?: string[]
  /** Ids das competências do catálogo da G&G. */
  categoryIds?: string[]
  customCategory?: string
  /**
   * "Tornar público no mural", decidido por **quem escreve**. Antes da 2ª
   * rodada quem publicava era quem recebia; a rota de compartilhar continua
   * existindo para os feedbacks antigos.
   */
  isPublic?: boolean
}

// Edição altera apenas a mensagem; a categoria não é editável no PATCH.
export interface UpdateFeedbackRequest {
  message: string
}
