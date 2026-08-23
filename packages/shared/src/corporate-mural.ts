import type { PublicUser } from './auth'
import type { ReactionSummary } from './feedback'
import type { AttachedGif } from './gif'
import type { AttachedImage } from './image'
import { isFullAdmin } from './permissions'
import { richDocLineCount, type RichDoc } from './rich-text'
import type { MentionDTO, ReactorRef } from './review'

/**
 * Feed Corporativo: o feed da empresa. Mesma mecânica da resenha (reações,
 * comentários, menções), com as diferenças que a G&G pediu na 2ª rodada:
 *  - **todo mundo escreve**; quem não publica direto cai na fila de aprovação;
 *  - o post tem público-alvo (empresa toda ou N setores);
 *  - o corpo é texto rico (ver `rich-text.ts`), com título opcional e anexos.
 */

/** Limite do CORPO do post, medido no **texto puro** do documento rico. */
export const CORPORATE_POST_BODY_MAX_LENGTH = 5_000

/** Limite do título (opcional). */
export const CORPORATE_POST_TITLE_MAX_LENGTH = 120

/**
 * Limite do comentário. Era `CORPORATE_POST_MAX_LENGTH`, quando post e
 * comentário dividiam o mesmo teto de 280 — o post cresceu, o comentário não.
 */
export const CORPORATE_COMMENT_MAX_LENGTH = 280

/** Máximo de menções (@) por post ou comentário. */
export const MAX_CORPORATE_POST_MENTIONS = 10

/** Máximo de anexos (foto/vídeo/documento) por post. */
export const MAX_CORPORATE_POST_ATTACHMENTS = 5

/**
 * Reações do feed. `💚` na frente porque a G&G pediu o coração da casa em
 * verde; `❤️` **continua na lista** — tirá-lo travaria a remoção das reações
 * que já existem no banco (o toggle valida o emoji contra esta lista).
 */
export const CORPORATE_POST_REACTIONS = [
  '💚', '👍', '❤️', '😂', '😮', '😢', '😡',
  '👏', '🎯', '💡', '🚀', '🎉', '🙌', '🔥', '💪', '🧠', '🙏',
] as const
export type CorporatePostReactionEmoji = (typeof CORPORATE_POST_REACTIONS)[number]

/** Ciclo de vida do post. `PENDING` é o que a fila de aprovação enxerga. */
export const CORPORATE_POST_STATUSES = ['PENDING', 'PUBLISHED', 'REJECTED'] as const
export type CorporatePostStatus = (typeof CORPORATE_POST_STATUSES)[number]

export const CORPORATE_POST_STATUS_LABELS: Record<CorporatePostStatus, string> = {
  PENDING: 'Aguardando aprovação',
  PUBLISHED: 'Publicado',
  REJECTED: 'Recusado',
}

/**
 * Destino do comunicado. Escopo em coluna, e não "lista de setores vazia =
 * todos": o `ALL` explícito sobrevive a alguém apagar o último setor da lista.
 */
export const CORPORATE_POST_AUDIENCES = ['ALL', 'SECTORS'] as const
export type CorporatePostAudience = (typeof CORPORATE_POST_AUDIENCES)[number]

export const CORPORATE_POST_AUDIENCE_LABELS: Record<CorporatePostAudience, string> = {
  ALL: 'Toda a empresa',
  SECTORS: 'Setores específicos',
}

export const CORPORATE_POST_ATTACHMENT_KINDS = ['IMAGE', 'VIDEO', 'DOCUMENT'] as const
export type CorporatePostAttachmentKind = (typeof CORPORATE_POST_ATTACHMENT_KINDS)[number]

/**
 * A partir de quantas linhas o corpo é cortado com "Ver conteúdo completo" —
 * e, portanto, a partir de quando ler o post inteiro paga XP.
 */
export const CORPORATE_POST_COLLAPSE_LINES = 3

/** Texto puro comprido também corta, mesmo em bloco único (parágrafo longo). */
export const CORPORATE_POST_COLLAPSE_CHARS = 240

/**
 * Post "longo": o que ganha o botão "Ver conteúdo completo". Fonte única — a
 * web decide se corta e a API decide se o `read: full` paga XP. Se dependesse
 * só do cliente, qualquer um mandaria `full: true` num post de uma linha.
 */
export function isCollapsibleCorporatePost(post: { content: string; body?: RichDoc | null }): boolean {
  if (post.body && richDocLineCount(post.body) > CORPORATE_POST_COLLAPSE_LINES) return true
  const lines = post.content.split('\n').filter((line) => line.trim().length > 0).length
  return lines > CORPORATE_POST_COLLAPSE_LINES || post.content.length > CORPORATE_POST_COLLAPSE_CHARS
}

/**
 * Papéis que publicam **direto**, sem passar pela fila. Só a administração:
 * a tabela de permissões da G&G põe o Líder junto do Colaborador aqui — ele
 * escreve, mas o comunicado dele também é aprovado antes de ir ao ar.
 *
 * Note a diferença do que era antes: publicar deixou de ser privilégio de
 * liderança porque **todo mundo passou a poder escrever**. O que o papel decide
 * agora é se sai publicado ou pendente.
 */
export const CORPORATE_POST_DIRECT_PUBLISH_ROLES = ['ADMIN', 'SUBADMIN'] as const

/** True quando o post nasce publicado; false quando nasce pendente. */
export function canPublishCorporatePostDirectly(role?: string | null, adminAccess = false): boolean {
  if (isFullAdmin({ role, adminAccess })) return true
  return role != null && (CORPORATE_POST_DIRECT_PUBLISH_ROLES as readonly string[]).includes(role)
}

/**
 * Papéis que fixam post, aprovam/recusam a fila, editam, excluem de terceiro e
 * veem o painel de alcance. O feed não tem dono de setor — quem administra,
 * administra o feed inteiro, igual ao que a exclusão já fazia.
 */
export const CORPORATE_POST_PIN_ROLES = ['ADMIN', 'SUBADMIN'] as const

/** True quando pode fixar/desfixar post e abrir o painel de alcance. */
export function canPinCorporatePost(role?: string | null, adminAccess = false): boolean {
  if (isFullAdmin({ role, adminAccess })) return true
  return role != null && (CORPORATE_POST_PIN_ROLES as readonly string[]).includes(role)
}

/** True quando pode aprovar, recusar e editar comunicado de terceiro. */
export function canModerateCorporatePost(role?: string | null, adminAccess = false): boolean {
  return canPinCorporatePost(role, adminAccess)
}

/**
 * Quem enxerga o Feed Corporativo: todo mundo do time, com ou sem a feature
 * habilitada no setor — o feed é da empresa toda e ocupa a coluna principal da
 * Home. Terceirizado (THIRD_PARTY) segue na allowlist individual, para
 * comunicado interno não vazar por padrão. Fonte única: a API usa isto no guard
 * das rotas e a web para decidir se renderiza a seção/rota.
 *
 * Não confundir com o **público-alvo do post** (`audience`), que é o recorte
 * por setor de cada comunicado: este guard é o da porta, aquele é o do item.
 */
export function canSeeCorporateMural(args: {
  role?: string | null
  features?: readonly string[]
}): boolean {
  if (args.role !== 'THIRD_PARTY') return true
  return (args.features ?? []).includes('mural-corporativo')
}

/** Tamanho do trecho do post exibido na tabela de alcance. */
export const CORPORATE_POST_EXCERPT_LENGTH = 80

export interface CorporatePostAttachmentDTO {
  id: string
  kind: CorporatePostAttachmentKind
  url: string
  /** Nome do arquivo, exibido no anexo de documento. */
  name: string
  contentType: string
  size: number
  width: number | null
  height: number | null
}

/** Setor no público-alvo do post — id e nome, para a web não ter que resolver. */
export interface CorporatePostSectorRef {
  id: string
  name: string
}

export interface CorporatePostDTO {
  id: string
  author: PublicUser
  /** Setor de quem publicou, exibido junto do nome na autoria. */
  authorSectorName: string | null
  /** Título opcional; a web dá o destaque, o autor não formata na mão. */
  title: string | null
  /** Texto puro — sempre preenchido, inclusive quando há `body`. */
  content: string
  /** Documento rico; null nos posts antigos, que são texto puro. */
  body: RichDoc | null
  /** GIF anexado, ou null. */
  gif: AttachedGif | null
  /** Imagem anexada, ou null. Posts novos usam `attachments`. */
  image: AttachedImage | null
  attachments: CorporatePostAttachmentDTO[]
  status: CorporatePostStatus
  audience: CorporatePostAudience
  /** Setores do público-alvo; vazio quando `audience` é `ALL`. */
  audienceSectors: CorporatePostSectorRef[]
  createdAt: string
  /** Instante da última edição do texto, ou null. Não é `updatedAt`. */
  editedAt: string | null
  /** Instante em que o post foi fixado no topo, ou null. No máximo um por empresa. */
  pinnedAt: string | null
  /** True quando o corpo é cortado com "Ver conteúdo completo" (e paga XP de leitura). */
  collapsible: boolean
  reactions: ReactionSummary[]
  /** Usuários distintos que reagiram (cap 8), para a fileira de avatares. */
  reactors: ReactorRef[]
  /** Total de usuários distintos que reagiram (pode ser > reactors.length). */
  reactorCount: number
  commentCount: number
  mentions: MentionDTO[]
}

/** Item da fila de aprovação: o post mais o porquê da recusa, quando houver. */
export interface PendingCorporatePostDTO extends CorporatePostDTO {
  rejectionReason: string | null
  reviewedAt: string | null
}

export interface CorporatePostCommentDTO {
  id: string
  author: PublicUser
  content: string
  gif: AttachedGif | null
  image: AttachedImage | null
  createdAt: string
  reactions: ReactionSummary[]
  mentions: MentionDTO[]
}

export interface CorporatePostFeedResponse {
  items: CorporatePostDTO[]
  nextCursor: string | null
}

export interface PendingCorporatePostsResponse {
  items: PendingCorporatePostDTO[]
}

export interface CorporatePostCommentsResponse {
  items: CorporatePostCommentDTO[]
  hasMore: boolean
}

/** Anexo enviado pelo composer — a URL já veio do presign do nosso bucket. */
export interface CorporatePostAttachmentInput {
  kind: CorporatePostAttachmentKind
  url: string
  name: string
  contentType: string
  size: number
  width?: number
  height?: number
}

export interface CreateCorporatePostRequest {
  title?: string
  /** Documento rico. O texto puro é derivado no servidor. */
  body: RichDoc
  mentionedUserIds?: string[]
  gif?: AttachedGif
  attachments?: CorporatePostAttachmentInput[]
  audience?: CorporatePostAudience
  /** Ids dos setores; obrigatório (não vazio) quando `audience` é `SECTORS`. */
  audienceSectorIds?: string[]
}

export type UpdateCorporatePostRequest = Partial<CreateCorporatePostRequest>

export interface CreateCorporatePostCommentRequest {
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
}

export interface RejectCorporatePostRequest {
  reason?: string
}

/** Limite do texto de instruções mandado para a IA gerar o comunicado. */
export const CORPORATE_POST_AI_PROMPT_MAX_LENGTH = 1_000

export interface GenerateCorporatePostRequest {
  /** O que a pessoa quer comunicar, em linguagem natural. */
  instructions: string
}

export interface GenerateCorporatePostResponse {
  title: string
  /** Corpo em texto puro; o composer transforma em documento rico. */
  body: string
}

/**
 * Alcance de um post no painel de G&G: só contagem, nunca a lista nominal de
 * quem leu. `readers` são leitores únicos (garantido pelo @@unique do model);
 * `reactions` é o total de reações, não de pessoas — é o mesmo número que o
 * card do feed exibe. `audience` é **por post**: com público-alvo por setor, o
 * denominador da empresa inteira mentiria.
 */
export interface CorporatePostReachDTO {
  postId: string
  excerpt: string
  readers: number
  readPct: number
  comments: number
  reactions: number
  /** Denominador deste post: quantas pessoas estão no público-alvo dele. */
  audience: number
  createdAt: string
}

/**
 * Uma reação nominal do painel de alcance: quem reagiu, com que emoji e quando.
 * Existe só para quem modera — o card do feed continua entregando `reactors`
 * com teto de 8 avatares, que é fileira, não lista.
 *
 * Uma pessoa aparece **uma vez por emoji** (o @@unique do model é
 * `[postId, userId, emoji]`), então quem reagiu com 💚 e 🎉 rende duas linhas —
 * é o mesmo número que a coluna "Reações" da tabela conta.
 */
export interface CorporatePostReactorDTO {
  user: ReactorRef
  /** Setor de quem reagiu, para a G&G ler o alcance por time. */
  sectorName: string | null
  emoji: string
  createdAt: string
}

export interface CorporatePostReactorsResponse {
  items: CorporatePostReactorDTO[]
  /** Total de reações do post; maior que `items.length` quando a lista trunca. */
  total: number
}

export interface CorporatePostReachResponse {
  items: CorporatePostReachDTO[]
  /** Ativos não-terceirizados da empresa — referência do topo da tabela. */
  audience: number
  /** Total de posts no recorte, para a paginação. */
  total: number
}

/**
 * Eventos de tempo real do feed (WebSocket). Magros de propósito: o hub é
 * **canal único e global, sem salas** (ver `lib/corporate-mural-hub.ts`), então
 * mandar título ou trecho do comunicado aqui vazaria conteúdo de uma empresa
 * para conexões de outra. O cliente recebe o id e busca o post pela rota
 * escopada — quem não é do público leva 404 e não vê nada.
 */
export type CorporateMuralEvent =
  | { type: 'feed:changed' }
  | { type: 'post:changed'; postId: string }
  | { type: 'post:published'; postId: string }
  | { type: 'comments:changed'; postId: string }
