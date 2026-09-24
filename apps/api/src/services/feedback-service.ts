import { Prisma } from '@prisma/client'
import {
  CUSTOM_CATEGORY_MAX_LENGTH,
  FEEDBACK_COMMENT_MAX_LENGTH,
  FEEDBACK_REACTIONS,
  MAX_FEEDBACK_RECIPIENTS,
  MAX_RECOGNITION_CATEGORIES_PER_FEEDBACK,
  MIN_FEEDBACK_FIELD_LENGTH,
  PUBLIC_FEEDBACK_CATEGORIES,
  isFullAdmin,
  type FeedbackCategory,
  type FeedbackReactionEmoji,
  type GenerateFeedbackResponse,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { FeedbackError } from '../lib/feedback-error'
import { buildFeedbackPrompt, parseGeneratedFeedback } from '../lib/feedback-prompt'
import { requestAgentCompletion, type AgentCompletionFn } from '../lib/agent-client'
import { resolveAiCredentials } from './ai-settings-service'
import { scopedPrisma } from '../lib/tenant-scope'

// Reexportado para os call sites (rotas e testes) não mudarem de import: a
// classe mora em `lib/` para o prompt da IA poder lançá-la sem ciclo.
export { FeedbackError } from '../lib/feedback-error'

export const feedbackInclude = {
  author: true,
  reactions: { include: { user: true }, orderBy: { createdAt: 'asc' } },
  // Destinatários e competências vêm SEMPRE: são o que o card mostra ("para
  // Ana, Bruno e mais 2" e os chips), e buscá-los à parte seria N+1 na lista.
  recipients: { include: { user: true }, orderBy: { createdAt: 'asc' } },
  recognitionCategories: { include: { category: true } },
  _count: { select: { comments: true } },
} as const
export type FeedbackWithAuthor = Prisma.FeedbackGetPayload<{ include: typeof feedbackInclude }>

/** Mural de Feedbacks: fora do perfil de alguém, o destinatário precisa vir junto. */
export const sharedFeedbackInclude = { ...feedbackInclude, target: true } as const
export type SharedFeedbackRow = Prisma.FeedbackGetPayload<{ include: typeof sharedFeedbackInclude }>

export const feedbackCommentInclude = { author: true } as const
export type FeedbackCommentWithAuthor = Prisma.FeedbackCommentGetPayload<{
  include: typeof feedbackCommentInclude
}>

function assertMessage(message: string) {
  if (message.trim().length < MIN_FEEDBACK_FIELD_LENGTH) {
    throw new FeedbackError('O feedback é obrigatório e precisa ser específico.', 400)
  }
}

export interface ProfileFeedbackFilters {
  offset?: number
  limit?: number
  /** Categoria do catálogo da empresa; filtra no servidor, não na página. */
  categoryId?: string
  /**
   * Feedback que precisa aparecer na página devolvida — é o deep-link do mural
   * (`/perfil/:id?feedback=<id>`). Com paginação numerada o front não tem como
   * adivinhar em que página o item caiu, e varrer página por página até achar
   * seria puxar o histórico inteiro. O servidor conta quantos feedbacks vêm
   * antes dele e devolve a página que o contém.
   */
  anchorId?: string
}

export interface ProfileFeedbackPage {
  feedbacks: FeedbackWithAuthor[]
  total: number
  /** Offset realmente usado: o pedido, ou o derivado da âncora. */
  offset: number
}

export async function listFeedbacksForUser(
  targetId: string,
  viewer: { id: string; role: string; adminAccess?: boolean },
  filters: ProfileFeedbackFilters = {},
): Promise<ProfileFeedbackPage> {
  const limit = filters.limit ?? 10
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { companyId: true } })
  if (!target) return { feedbacks: [], total: 0, offset: 0 }
  const db = scopedPrisma(target.companyId)
  // Autor e ADMIN veem tudo do alvo; demais só veem públicos + os privados que eles próprios escreveram.
  const canSeeAll = viewer.id === targetId || isFullAdmin(viewer)
  // Por DESTINATÁRIO, e não por `targetId`: no feedback grupal o principal é só
  // o primeiro da lista, e filtrar pela coluna esconderia do perfil o feedback
  // que a pessoa recebeu junto com o time — que os selos, esses sim, já contavam
  // (`badge-service` conta `FeedbackRecipient`). Toda linha tem o principal na
  // tabela de destinatários: `createFeedback` sempre o cria, e a migration
  // `20260817180000` fez o backfill do histórico.
  const where = {
    recipients: { some: { userId: targetId } },
    ...(filters.categoryId ? { recognitionCategories: { some: { categoryId: filters.categoryId } } } : {}),
    ...(canSeeAll
      ? {}
      : {
          OR: [
            { category: { in: [...PUBLIC_FEEDBACK_CATEGORIES] } },
            { authorId: viewer.id },
          ],
        }),
  }

  const offset = await resolveOffset(db, where, filters, limit)
  const [rows, total] = await Promise.all([
    db.feedback.findMany({
      where,
      include: feedbackInclude,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit + 1,
    }),
    db.feedback.count({ where }),
  ])
  return { feedbacks: rows, total, offset }
}

/**
 * Offset da página pedida — ou o da página que contém a âncora.
 *
 * A posição sai de um `count` do que é **mais recente** que a âncora, na mesma
 * ordenação da listagem. Âncora que não existe (ou que o filtro escondeu) cai no
 * offset pedido, em vez de estourar: o link velho abre a primeira página.
 */
async function resolveOffset(
  db: ReturnType<typeof scopedPrisma>,
  where: Prisma.FeedbackWhereInput,
  filters: ProfileFeedbackFilters,
  limit: number,
): Promise<number> {
  const pedido = Math.max(0, filters.offset ?? 0)
  if (!filters.anchorId) return pedido
  const anchor = await db.feedback.findUnique({
    where: { id: filters.anchorId },
    select: { createdAt: true },
  })
  if (!anchor) return pedido
  const anteriores = await db.feedback.count({
    where: { AND: [where, { createdAt: { gt: anchor.createdAt } }] },
  })
  return Math.floor(anteriores / limit) * limit
}

export function listFeedbacksForDevelopmentThursdayEvent(
  eventId: string,
  viewer: { id: string; role: string; adminAccess?: boolean },
  pagination: { offset?: number; limit?: number } = {},
): Promise<FeedbackWithAuthor[]> {
  const limit = pagination.limit ?? 10
  const offset = pagination.offset ?? 0
  const canSeePrivate = isFullAdmin(viewer)
  return prisma.feedback.findMany({
    where: {
      developmentThursdayEventId: eventId,
      ...(canSeePrivate
        ? {}
        : {
            OR: [
              { category: { in: [...PUBLIC_FEEDBACK_CATEGORIES] } },
              { authorId: viewer.id },
              { targetId: viewer.id },
            ],
          }),
    },
    include: feedbackInclude,
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit + 1,
  })
}

/**
 * Mural de Feedbacks — feedbacks públicos que o destinatário compartilhou, de toda
 * a empresa (o mural do time, em `mural-service`, é o recorte por setor). Ordena
 * pelo compartilhamento mais recente e pagina por offset, como as demais listagens.
 * `sectorId` restringe ao setor do destinatário (usado para terceirizados).
 */
export function listSharedFeedbacks(
  companyId: string,
  options: { sectorId?: string; offset?: number; limit?: number; q?: string; categoryId?: string } = {},
): Promise<SharedFeedbackRow[]> {
  const limit = options.limit ?? 10
  const offset = options.offset ?? 0
  const q = options.q?.trim()
  return scopedPrisma(companyId).feedback.findMany({
    where: {
      sharedAt: { not: null },
      category: { in: [...PUBLIC_FEEDBACK_CATEGORIES] },
      target: { active: true, ...(options.sectorId ? { sectorId: options.sectorId } : {}) },
      ...(options.categoryId ? { recognitionCategories: { some: { categoryId: options.categoryId } } } : {}),
      // A busca é do SERVIDOR, não filtro no cliente: o mural pagina por
      // offset, e filtrar depois esconderia o resultado que está na página 3.
      ...(q
        ? {
            OR: [
              { message: { contains: q, mode: 'insensitive' } },
              { customCategory: { contains: q, mode: 'insensitive' } },
              { author: { name: { contains: q, mode: 'insensitive' } } },
              { recipients: { some: { user: { name: { contains: q, mode: 'insensitive' } } } } },
              { recognitionCategories: { some: { category: { name: { contains: q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    },
    include: sharedFeedbackInclude,
    orderBy: { sharedAt: 'desc' },
    skip: offset,
    take: limit + 1,
  })
}

/**
 * Quando a pessoa abriu o Mural de Feedbacks pela última vez. Null = nunca — e
 * aí todo feedback compartilhado conta como novo, que é o certo para quem chega.
 */
export async function getFeedbackWallSeenAt(companyId: string, userId: string): Promise<Date | null> {
  const user = await scopedPrisma(companyId).user.findUnique({
    where: { id: userId },
    select: { feedbackWallSeenAt: true },
  })
  return user?.feedbackWallSeenAt ?? null
}

/** Registra que a pessoa abriu o mural agora. Idempotente por natureza: sobrescreve. */
export async function markFeedbackWallSeen(companyId: string, userId: string): Promise<void> {
  await scopedPrisma(companyId).user.update({
    where: { id: userId },
    data: { feedbackWallSeenAt: new Date() },
  })
}

/**
 * Aba **Recebidos**: tudo o que a pessoa recebeu, público ou privado. Lê por
 * `FeedbackRecipient` (e não por `targetId`) — é o que faz o reconhecimento
 * grupal aparecer para as N pessoas, não só para a principal.
 */
export function listFeedbacksReceivedBy(
  userId: string,
  companyId: string,
  pagination: { offset?: number; limit?: number } = {},
): Promise<SharedFeedbackRow[]> {
  const limit = pagination.limit ?? 10
  const offset = pagination.offset ?? 0
  return scopedPrisma(companyId).feedback.findMany({
    where: { recipients: { some: { userId } } },
    include: sharedFeedbackInclude,
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit + 1,
  })
}

/**
 * Aba **Enviados**: o que a pessoa escreveu, público ou privado. Existe para
 * ela acompanhar as respostas sem caçar o próprio feedback no mural.
 */
export function listFeedbacksSentBy(
  userId: string,
  companyId: string,
  pagination: { offset?: number; limit?: number } = {},
): Promise<SharedFeedbackRow[]> {
  const limit = pagination.limit ?? 10
  const offset = pagination.offset ?? 0
  return scopedPrisma(companyId).feedback.findMany({
    where: { authorId: userId },
    include: sharedFeedbackInclude,
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit + 1,
  })
}

/**
 * Cria um reconhecimento. Desde a 2ª rodada da G&G ele pode ser **grupal** (N
 * destinatários numa conversa só), carrega **competências** do catálogo da
 * empresa e nasce público ou privado por decisão de **quem escreve**.
 *
 * `targetId` continua sendo o destinatário principal — o resto do sistema
 * (perfil, Quinta de Dev, selos) lê por ele —, mas ele entra em
 * `FeedbackRecipient` junto com os demais, para "quem recebeu" ter um caminho
 * de leitura só.
 */
export async function createFeedback(
  input: {
    authorId: string
    targetId: string
    /** Destinatários além do principal (reconhecimento grupal). */
    extraTargetIds?: string[]
    message: string
    category: FeedbackCategory
    categoryIds?: string[]
    customCategory?: string
    /** "Tornar público no mural", marcado no envio. */
    isPublic?: boolean
    developmentThursdayEventId?: string
  },
): Promise<FeedbackWithAuthor> {
  if (input.authorId === input.targetId) {
    throw new FeedbackError('Você não pode dar feedback a si mesmo.', 400)
  }
  const author = await prisma.user.findUnique({ where: { id: input.authorId } })
  if (!author || !author.active) {
    throw new FeedbackError('Autor inválido.', 400)
  }
  if (author.role === 'ADMIN' || author.role === 'SUBADMIN') {
    throw new FeedbackError('Administradores não deixam feedback.', 403)
  }
  const db = scopedPrisma(author.companyId)
  const target = await db.user.findUnique({ where: { id: input.targetId } })
  if (!target || !target.active) {
    throw new FeedbackError('Destinatário inválido.', 404)
  }
  assertMessage(input.message)

  // Destinatários: o principal na frente, sem repetição e sem o próprio autor.
  const extras = [...new Set(input.extraTargetIds ?? [])].filter(
    (id) => id !== input.targetId && id !== input.authorId,
  )
  if (extras.length + 1 > MAX_FEEDBACK_RECIPIENTS) {
    throw new FeedbackError(`Um reconhecimento alcança no máximo ${MAX_FEEDBACK_RECIPIENTS} pessoas.`, 400)
  }
  const extraUsers = extras.length
    ? await db.user.findMany({ where: { id: { in: extras }, active: true }, select: { id: true } })
    : []
  // Silenciosamente ignorar quem não existe seria pior: a pessoa acha que
  // reconheceu o time inteiro e faltou alguém no card.
  if (extraUsers.length !== extras.length) {
    throw new FeedbackError('Um dos destinatários escolhidos não está disponível.', 404)
  }
  const recipientIds = [input.targetId, ...extraUsers.map((u) => u.id)]

  const categoryIds = await resolveRecognitionCategories(input.categoryIds, author.companyId)
  const customCategory = input.customCategory?.trim().slice(0, CUSTOM_CATEGORY_MAX_LENGTH) || null

  return db.feedback.create({
    data: {
      authorId: input.authorId,
      targetId: input.targetId,
      message: input.message.trim(),
      category: input.category,
      ...(customCategory ? { customCategory } : {}),
      developmentThursdayEventId: input.developmentThursdayEventId,
      // Público na origem: `sharedAt` já significa "está no mural", então não
      // há coluna nova — o que mudou foi QUEM decide.
      ...(input.isPublic ? { sharedAt: new Date() } : {}),
      recipients: {
        create: recipientIds.map((userId) => ({ userId, companyId: author.companyId })),
      },
      ...(categoryIds.length
        ? {
            recognitionCategories: {
              create: categoryIds.map((categoryId) => ({ categoryId, companyId: author.companyId })),
            },
          }
        : {}),
    },
    include: feedbackInclude,
  })
}

/** Competências válidas: só as ativas do catálogo da própria empresa. */
async function resolveRecognitionCategories(
  categoryIds: string[] | undefined,
  companyId: string,
): Promise<string[]> {
  const unique = [...new Set(categoryIds ?? [])]
  if (unique.length === 0) return []
  if (unique.length > MAX_RECOGNITION_CATEGORIES_PER_FEEDBACK) {
    throw new FeedbackError(
      `Escolha no máximo ${MAX_RECOGNITION_CATEGORIES_PER_FEEDBACK} competências.`,
      400,
    )
  }
  const rows = await scopedPrisma(companyId).recognitionCategory.findMany({
    where: { id: { in: unique }, active: true },
    select: { id: true },
  })
  if (rows.length !== unique.length) {
    throw new FeedbackError('Competência inválida.', 400)
  }
  return rows.map((r) => r.id)
}

export async function updateFeedback(
  input: { feedbackId: string; userId: string; message: string },
): Promise<FeedbackWithAuthor> {
  const actor = await prisma.user.findUnique({ where: { id: input.userId }, select: { companyId: true } })
  const existing = actor ? await scopedPrisma(actor.companyId).feedback.findUnique({ where: { id: input.feedbackId } }) : null
  if (!existing) {
    throw new FeedbackError('Feedback não encontrado.', 404)
  }
  if (existing.authorId !== input.userId) {
    throw new FeedbackError('Apenas o autor pode editar este feedback.', 403)
  }
  assertMessage(input.message)
  return scopedPrisma(actor!.companyId).feedback.update({
    where: { id: input.feedbackId },
    data: { message: input.message.trim() },
    include: feedbackInclude,
  })
}

export async function setFeedbackShared(
  input: { feedbackId: string; userId: string; shared: boolean },
): Promise<FeedbackWithAuthor> {
  const actor = await prisma.user.findUnique({ where: { id: input.userId }, select: { companyId: true } })
  const existing = actor ? await scopedPrisma(actor.companyId).feedback.findUnique({ where: { id: input.feedbackId } }) : null
  if (!existing) {
    throw new FeedbackError('Feedback não encontrado.', 404)
  }
  // Duas portas para a mesma coluna, com donos diferentes e de propósito: o
  // AUTOR decide no envio (o toggle "Tornar público no mural" da 2ª rodada), e
  // QUEM RECEBEU continua podendo publicar depois — é o caminho dos feedbacks
  // antigos, recebidos em privado antes de o toggle existir.
  const recipientIds = await scopedPrisma(actor!.companyId)
    .feedbackRecipient.findMany({ where: { feedbackId: input.feedbackId }, select: { userId: true } })
    .then((rows) => rows.map((r) => r.userId))
  const podeCompartilhar =
    existing.authorId === input.userId ||
    existing.targetId === input.userId ||
    recipientIds.includes(input.userId)
  if (!podeCompartilhar) {
    throw new FeedbackError('Apenas quem escreveu ou recebeu o feedback pode compartilhá-lo.', 403)
  }
  if (!(PUBLIC_FEEDBACK_CATEGORIES as readonly string[]).includes(existing.category)) {
    throw new FeedbackError('Só é possível compartilhar feedbacks públicos.', 403)
  }
  return scopedPrisma(actor!.companyId).feedback.update({
    where: { id: input.feedbackId },
    data: { sharedAt: input.shared ? new Date() : null },
    include: feedbackInclude,
  })
}

export async function deleteFeedback(input: { feedbackId: string; userId: string }): Promise<{ authorId: string }> {
  const actor = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { companyId: true, role: true, adminAccess: true },
  })
  const existing = actor ? await scopedPrisma(actor.companyId).feedback.findUnique({ where: { id: input.feedbackId } }) : null
  if (!existing) {
    throw new FeedbackError('Feedback não encontrado.', 404)
  }
  if (existing.authorId !== input.userId) {
    if (!isFullAdmin(actor)) {
      throw new FeedbackError('Sem permissão para excluir este feedback.', 403)
    }
  }
  try {
    await scopedPrisma(actor!.companyId).feedback.delete({ where: { id: input.feedbackId } })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new FeedbackError('Feedback não encontrado.', 404)
    }
    throw err
  }
  return { authorId: existing.authorId }
}

/**
 * Visibilidade de um único feedback (espelha a regra de listFeedbacksForUser).
 *
 * `recipientIds` é o que sustenta o reconhecimento grupal: quem está na lista
 * enxerga, mesmo não sendo o destinatário principal. Ausente, cai no
 * `targetId` — é o caminho dos call sites que só têm a linha crua.
 */
export function canViewFeedback(
  feedback: {
    authorId: string
    targetId: string
    category: FeedbackCategory
    recipientIds?: string[]
  },
  viewer: { id: string; role: string; adminAccess?: boolean },
): boolean {
  if (isFullAdmin(viewer)) return true
  if (feedback.authorId === viewer.id || feedback.targetId === viewer.id) return true
  if (feedback.recipientIds?.includes(viewer.id)) return true
  return (PUBLIC_FEEDBACK_CATEGORIES as readonly string[]).includes(feedback.category)
}

/**
 * Comentários de um feedback. A visibilidade é a MESMA do feedback
 * (`canViewFeedback`) — sem caminho paralelo, porque um caminho paralelo é o
 * que sai do ar de sincronia quando a regra do feedback muda.
 */
export async function listFeedbackComments(
  feedbackId: string,
  viewer: { id: string; role: string; adminAccess?: boolean; companyId: string },
): Promise<FeedbackCommentWithAuthor[]> {
  await requireVisibleFeedback(feedbackId, viewer)
  return scopedPrisma(viewer.companyId).feedbackComment.findMany({
    where: { feedbackId },
    include: feedbackCommentInclude,
    orderBy: { createdAt: 'asc' },
  })
}

export async function createFeedbackComment(input: {
  feedbackId: string
  message: string
  viewer: { id: string; role: string; adminAccess?: boolean; companyId: string }
}): Promise<{
  comment: FeedbackCommentWithAuthor
  feedbackAuthorId: string
  feedbackTargetId: string
  recipientIds: string[]
  /** Quem já tinha respondido antes desta resposta, sem repetir e sem o autor dela. */
  previousCommenterIds: string[]
}> {
  const message = input.message.trim()
  if (!message) throw new FeedbackError('Escreva um comentário.', 400)
  if (message.length > FEEDBACK_COMMENT_MAX_LENGTH) {
    throw new FeedbackError(`O comentário precisa ter no máximo ${FEEDBACK_COMMENT_MAX_LENGTH} caracteres.`, 400)
  }
  const feedback = await requireVisibleFeedback(input.feedbackId, input.viewer)
  const db = scopedPrisma(input.viewer.companyId)
  const comment = await db.feedbackComment.create({
    data: { feedbackId: input.feedbackId, authorId: input.viewer.id, message },
    include: feedbackCommentInclude,
  })
  // Depois de criar, e filtrando quem respondeu agora: a resposta recém-gravada
  // é do próprio autor, que nunca é avisado da própria resposta.
  const previous = await db.feedbackComment.findMany({
    where: { feedbackId: input.feedbackId, authorId: { not: input.viewer.id } },
    distinct: ['authorId'],
    select: { authorId: true },
  })
  return {
    comment,
    feedbackAuthorId: feedback.authorId,
    feedbackTargetId: feedback.targetId,
    recipientIds: feedback.recipients.map((r) => r.userId),
    previousCommenterIds: previous.map((c) => c.authorId),
  }
}

export async function deleteFeedbackComment(input: {
  commentId: string
  viewer: { id: string; role: string; adminAccess?: boolean; companyId: string }
}): Promise<{ feedbackId: string }> {
  const db = scopedPrisma(input.viewer.companyId)
  const existing = await db.feedbackComment.findUnique({
    where: { id: input.commentId },
    select: { id: true, authorId: true, feedbackId: true },
  })
  if (!existing) throw new FeedbackError('Comentário não encontrado.', 404)
  if (existing.authorId !== input.viewer.id && !isFullAdmin(input.viewer)) {
    throw new FeedbackError('Sem permissão para excluir este comentário.', 403)
  }
  await db.feedbackComment.delete({ where: { id: input.commentId } })
  return { feedbackId: existing.feedbackId }
}

/**
 * Rascunho do reconhecimento pela IA da **empresa** (`resolveAiCredentials`),
 * nunca por chave do ambiente — sem chave cadastrada, 503 tratado, como os
 * demais agentes. Nada é gravado: o texto volta para o formulário e quem envia
 * é a pessoa.
 */
export async function generateFeedbackMessage(
  input: {
    companyId: string
    authorId: string
    targetNames: string[]
    categoryNames: string[]
    notes?: string
  },
  complete: AgentCompletionFn = requestAgentCompletion,
): Promise<GenerateFeedbackResponse> {
  const credentials = await resolveAiCredentials(input.companyId)
  const [company, author] = await Promise.all([
    prisma.company.findUnique({ where: { id: input.companyId }, select: { name: true } }),
    scopedPrisma(input.companyId).user.findUnique({ where: { id: input.authorId }, select: { name: true } }),
  ])

  const raw = await complete({
    provider: credentials.provider,
    apiKey: credentials.apiKey,
    model: credentials.model,
    baseUrl: credentials.baseUrl,
    systemPrompt: buildFeedbackPrompt({
      companyName: company?.name ?? 'a empresa',
      authorName: author?.name ?? 'quem escreve',
      targetNames: input.targetNames,
      categoryNames: input.categoryNames,
      notes: input.notes,
    }),
    turns: [{ role: 'user', content: 'Escreva o reconhecimento.' }],
  })

  return parseGeneratedFeedback(raw)
}

/** Carrega o feedback conferindo que o viewer pode vê-lo; 404 se não puder. */
async function requireVisibleFeedback(
  feedbackId: string,
  viewer: { id: string; role: string; adminAccess?: boolean; companyId: string },
) {
  const feedback = await scopedPrisma(viewer.companyId).feedback.findUnique({
    where: { id: feedbackId },
    select: {
      id: true,
      authorId: true,
      targetId: true,
      category: true,
      sharedAt: true,
      recipients: { select: { userId: true } },
    },
  })
  if (!feedback) throw new FeedbackError('Feedback não encontrado.', 404)
  const recipientIds = feedback.recipients.map((r) => r.userId)
  // Privado é do autor, dos destinatários e da G&G — a regra do documento.
  const visible =
    feedback.sharedAt !== null
      ? canViewFeedback({ ...feedback, recipientIds }, viewer)
      : isFullAdmin(viewer) || feedback.authorId === viewer.id || recipientIds.includes(viewer.id)
  if (!visible) throw new FeedbackError('Feedback não encontrado.', 404)
  return feedback
}

export async function toggleReaction(input: {
  feedbackId: string
  userId: string
  emoji: string
  viewerRole: string
  viewerAdminAccess?: boolean
}): Promise<FeedbackWithAuthor> {
  if (!(FEEDBACK_REACTIONS as readonly string[]).includes(input.emoji)) {
    throw new FeedbackError('Reação inválida.', 400)
  }
  const emoji = input.emoji as FeedbackReactionEmoji
  const actor = await prisma.user.findUnique({ where: { id: input.userId }, select: { companyId: true } })
  const feedback = actor ? await scopedPrisma(actor.companyId).feedback.findUnique({ where: { id: input.feedbackId } }) : null
  if (
    !feedback
    || !canViewFeedback(feedback, {
      id: input.userId,
      role: input.viewerRole,
      adminAccess: input.viewerAdminAccess,
    })
  ) {
    // Não vazamos a existência de feedbacks privados (nem de feedbacks de outra empresa).
    throw new FeedbackError('Feedback não encontrado.', 404)
  }
  const db = scopedPrisma(actor!.companyId)
  const existing = await db.feedbackReaction.findUnique({
    where: { feedbackId_userId_emoji: { feedbackId: input.feedbackId, userId: input.userId, emoji } },
  })
  if (existing) {
    await db.feedbackReaction.delete({ where: { id: existing.id } })
  } else {
    await db.feedbackReaction.create({
      data: { feedbackId: input.feedbackId, userId: input.userId, emoji },
    })
  }
  return db.feedback.findUniqueOrThrow({ where: { id: input.feedbackId }, include: feedbackInclude })
}
