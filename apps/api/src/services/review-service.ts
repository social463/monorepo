import { Prisma } from '@prisma/client'
import {
  REVIEW_MAX_LENGTH,
  REVIEW_REACTIONS,
  MAX_REVIEW_MENTIONS,
  REVIEW_POLL_MAX_OPTIONS,
  REVIEW_POLL_MIN_OPTIONS,
  REVIEW_POLL_OPTION_MAX_LENGTH,
  REVIEW_POLL_QUESTION_MAX_LENGTH,
  canAdminister,
  isGiphyHost,
  type AttachedGif,
  type AttachedImage,
  type CreateReviewPollRequest,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { s3Config } from '../lib/s3-client'
import { scopedPrisma } from '../lib/tenant-scope'

export class ReviewError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ReviewError'
  }
}

/**
 * Carrega só o voto do viewer. As contagens agregadas continuam disponíveis,
 * mas nenhum id de outro votante sai desta camada.
 */
export function reviewInclude(viewerId?: string) {
  return {
    author: true,
    reactions: { include: { user: true }, orderBy: { createdAt: 'asc' } },
    mentions: true,
    poll: {
      include: {
        options: {
          include: { _count: { select: { votes: true } } },
          orderBy: { position: 'asc' },
        },
        votes: {
          where: { userId: viewerId ?? '__sem_viewer__' },
          select: { optionId: true },
        },
      },
    },
    _count: { select: { comments: true, shares: true } },
  } as const
}
export type ReviewWithRelations = Prisma.ReviewGetPayload<{ include: ReturnType<typeof reviewInclude> }>

export const reviewCommentInclude = {
  author: true,
  reactions: { include: { user: true }, orderBy: { createdAt: 'asc' } },
  mentions: true,
} as const
export type ReviewCommentWithRelations = Prisma.ReviewCommentGetPayload<{
  include: typeof reviewCommentInclude
}>

/** Conteúdo da resenha: texto (1..MAX) OU presença de anexo (gif/imagem). Devolve o texto trimado. */
function assertContentOrAttachment(content: string, hasAttachment: boolean): string {
  const trimmed = content.trim()
  if (trimmed.length > REVIEW_MAX_LENGTH) {
    throw new ReviewError(`O texto precisa ter no máximo ${REVIEW_MAX_LENGTH} caracteres.`, 400)
  }
  if (trimmed.length === 0 && !hasAttachment) {
    throw new ReviewError('Escreva algo ou adicione um GIF, imagem ou enquete.', 400)
  }
  return trimmed
}

/** Valida que a URL do gif aponta para um host de CDN do Giphy permitido. */
function assertGifHost(gif?: AttachedGif): void {
  if (!gif) return
  let hostname = ''
  try {
    hostname = new URL(gif.url).hostname
  } catch {
    throw new ReviewError('GIF inválido.', 400)
  }
  if (!isGiphyHost(hostname)) {
    throw new ReviewError('GIF inválido.', 400)
  }
}

/** Um post aceita no máximo um anexo: gif OU imagem OU enquete. */
function assertSingleAttachment(gif?: AttachedGif, image?: AttachedImage, poll?: CreateReviewPollRequest): void {
  if ([gif, image, poll].filter(Boolean).length > 1) {
    throw new ReviewError('Adicione um GIF, uma imagem ou uma enquete, não mais de um.', 400)
  }
}

function normalizePoll(poll?: CreateReviewPollRequest): CreateReviewPollRequest | undefined {
  if (!poll) return undefined
  const question = poll.question.trim()
  if (!question || question.length > REVIEW_POLL_QUESTION_MAX_LENGTH) {
    throw new ReviewError(
      `A pergunta da enquete precisa ter entre 1 e ${REVIEW_POLL_QUESTION_MAX_LENGTH} caracteres.`,
      400,
    )
  }
  if (poll.options.length < REVIEW_POLL_MIN_OPTIONS || poll.options.length > REVIEW_POLL_MAX_OPTIONS) {
    throw new ReviewError(
      `A enquete precisa ter entre ${REVIEW_POLL_MIN_OPTIONS} e ${REVIEW_POLL_MAX_OPTIONS} opções.`,
      400,
    )
  }
  const options = poll.options.map((option) => option.trim())
  if (options.some((option) => !option || option.length > REVIEW_POLL_OPTION_MAX_LENGTH)) {
    throw new ReviewError(
      `Cada opção precisa ter entre 1 e ${REVIEW_POLL_OPTION_MAX_LENGTH} caracteres.`,
      400,
    )
  }
  const distinct = new Set(options.map((option) => option.toLocaleLowerCase('pt-BR')))
  if (distinct.size !== options.length) {
    throw new ReviewError('As opções da enquete precisam ser diferentes.', 400)
  }
  return { question, options }
}

/** Valida que a URL da imagem aponta para o nosso bucket público (S3_PUBLIC_BASE_URL). */
function assertImageHost(image?: AttachedImage): void {
  if (!image) return
  const cfg = s3Config()
  if (!cfg || !image.url.startsWith(`${cfg.publicBaseUrl}/`)) {
    throw new ReviewError('Imagem inválida.', 400)
  }
}

/** Resolve mentionedUserIds em {userId, name}: dedup, só ativos não-admin do mesmo setor (dentro da empresa), cap MAX_REVIEW_MENTIONS. */
async function resolveMentions(
  userIds: string[] | undefined,
  companyId: string,
  sectorId: string,
): Promise<{ userId: string; name: string }[]> {
  if (!userIds?.length) return []
  const unique = [...new Set(userIds)].slice(0, MAX_REVIEW_MENTIONS)
  const users = await scopedPrisma(companyId).user.findMany({
    where: { id: { in: unique }, active: true, role: { notIn: ['ADMIN', 'SUBADMIN'] }, sectorId },
    select: { id: true, name: true },
  })
  return users.map((u) => ({ userId: u.id, name: u.name }))
}

function encodeCursor(n: { createdAt: Date; id: string }): string {
  return Buffer.from(`${n.createdAt.toISOString()}|${n.id}`).toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|', 2)
    const createdAt = new Date(iso)
    if (!id || Number.isNaN(createdAt.getTime())) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

export async function createReview(input: {
  authorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
  poll?: CreateReviewPollRequest
  companyId: string
}): Promise<ReviewWithRelations> {
  assertSingleAttachment(input.gif, input.image, input.poll)
  const poll = normalizePoll(input.poll)
  const content = assertContentOrAttachment(input.content, Boolean(input.gif || input.image || poll))
  assertGifHost(input.gif)
  assertImageHost(input.image)
  const author = await prisma.user.findUnique({ where: { id: input.authorId } })
  if (!author || !author.active) {
    throw new ReviewError('Autor inválido.', 400)
  }
  const mentions = await resolveMentions(input.mentionedUserIds, input.companyId, author.sectorId)
  return scopedPrisma(input.companyId).review.create({
    data: {
      authorId: input.authorId,
      content,
      sectorId: author.sectorId,
      ...(input.gif ? { gifUrl: input.gif.url, gifWidth: input.gif.width, gifHeight: input.gif.height } : {}),
      ...(input.image
        ? { imageUrl: input.image.url, imageWidth: input.image.width, imageHeight: input.image.height }
        : {}),
      ...(poll
        ? {
            poll: {
              create: {
                question: poll.question,
                companyId: input.companyId,
                sectorId: author.sectorId,
                options: {
                  create: poll.options.map((text, position) => ({
                    text,
                    position,
                    companyId: input.companyId,
                    sectorId: author.sectorId,
                  })),
                },
              },
            },
          }
        : {}),
      ...(mentions.length
        ? {
            mentions: {
              create: mentions.map((m) => ({
                userId: m.userId,
                name: m.name,
                companyId: input.companyId,
                sectorId: author.sectorId,
              })),
            },
          }
        : {}),
    },
    include: reviewInclude(input.authorId),
  })
}

export async function listFeed(
  viewerId: string,
  companyId: string,
  sectorId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: ReviewWithRelations[]; nextCursor: string | null; sharedReviewIds: Set<string> }> {
  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null
  const where: Prisma.ReviewWhereInput = {
    sectorId,
    author: { active: true },
    ...(decoded
      ? {
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, id: { lt: decoded.id } },
          ],
        }
      : {}),
  }
  const db = scopedPrisma(companyId)
  const rows = await db.review.findMany({
    where,
    include: reviewInclude(viewerId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
  })
  const hasMore = rows.length > opts.limit
  const items = hasMore ? rows.slice(0, opts.limit) : rows
  const nextCursor = hasMore ? encodeCursor(items[items.length - 1]) : null
  const shares = items.length
    ? await db.reviewShare.findMany({
        where: { userId: viewerId, reviewId: { in: items.map((r) => r.id) } },
        select: { reviewId: true },
      })
    : []
  return { items, nextCursor, sharedReviewIds: new Set(shares.map((s) => s.reviewId)) }
}

export async function getReviewForViewer(
  reviewId: string,
  viewerId: string,
  companyId: string,
  sectorId: string,
): Promise<{ review: ReviewWithRelations; sharedByMe: boolean }> {
  const db = scopedPrisma(companyId)
  const review = await db.review.findUnique({ where: { id: reviewId }, include: reviewInclude(viewerId) })
  if (!review || review.sectorId !== sectorId) {
    throw new ReviewError('Resenha não encontrada.', 404)
  }
  const share = await db.reviewShare.findUnique({
    where: { reviewId_userId: { reviewId, userId: viewerId } },
    select: { id: true },
  })
  return { review, sharedByMe: Boolean(share) }
}

export async function deleteReview(input: {
  reviewId: string
  userId: string
  role: string
  adminAccess?: boolean
  companyId: string
  sectorId: string
}): Promise<void> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.review.findUnique({
    where: { id: input.reviewId },
    select: { authorId: true, sectorId: true },
  })
  if (!existing || existing.sectorId !== input.sectorId) throw new ReviewError('Resenha não encontrada.', 404)
  if (existing.authorId !== input.userId && !canAdminister(input)) {
    throw new ReviewError('Sem permissão para excluir esta resenha.', 403)
  }
  await db.review.delete({ where: { id: input.reviewId } })
}

export async function listComments(
  reviewId: string,
  companyId: string,
  sectorId: string,
  opts: { offset: number; limit: number },
): Promise<ReviewCommentWithRelations[]> {
  const db = scopedPrisma(companyId)
  const review = await db.review.findUnique({ where: { id: reviewId }, select: { id: true, sectorId: true } })
  if (!review || review.sectorId !== sectorId) throw new ReviewError('Resenha não encontrada.', 404)
  return db.reviewComment.findMany({
    where: { reviewId },
    include: reviewCommentInclude,
    orderBy: { createdAt: 'asc' },
    skip: opts.offset,
    take: opts.limit + 1,
  })
}

export async function createComment(input: {
  reviewId: string
  authorId: string
  viewerSectorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
  companyId: string
}): Promise<{ comment: ReviewCommentWithRelations; reviewAuthorId: string; replyRecipientIds: string[] }> {
  assertSingleAttachment(input.gif, input.image)
  const content = assertContentOrAttachment(input.content, Boolean(input.gif || input.image))
  assertGifHost(input.gif)
  assertImageHost(input.image)
  const db = scopedPrisma(input.companyId)
  const review = await db.review.findUnique({
    where: { id: input.reviewId },
    select: { authorId: true, sectorId: true },
  })
  if (!review || review.sectorId !== input.viewerSectorId) throw new ReviewError('Resenha não encontrada.', 404)
  // Participantes anteriores (distintos) ANTES de inserir o novo comentário.
  const prior = await db.reviewComment.findMany({
    where: { reviewId: input.reviewId },
    select: { authorId: true },
    distinct: ['authorId'],
  })
  const mentions = await resolveMentions(input.mentionedUserIds, input.companyId, input.viewerSectorId)
  const comment = await db.reviewComment.create({
    data: {
      reviewId: input.reviewId,
      authorId: input.authorId,
      content,
      sectorId: input.viewerSectorId,
      ...(input.gif ? { gifUrl: input.gif.url, gifWidth: input.gif.width, gifHeight: input.gif.height } : {}),
      ...(input.image
        ? { imageUrl: input.image.url, imageWidth: input.image.width, imageHeight: input.image.height }
        : {}),
      ...(mentions.length
        ? {
            mentions: {
              create: mentions.map((m) => ({
                userId: m.userId,
                name: m.name,
                companyId: input.companyId,
                sectorId: input.viewerSectorId,
              })),
            },
          }
        : {}),
    },
    include: reviewCommentInclude,
  })
  const replyRecipientIds = [...new Set(prior.map((c) => c.authorId))].filter(
    (id) => id !== input.authorId && id !== review.authorId,
  )
  return { comment, reviewAuthorId: review.authorId, replyRecipientIds }
}

export async function deleteComment(input: {
  commentId: string
  userId: string
  role: string
  adminAccess?: boolean
  companyId: string
  sectorId: string
}): Promise<{ reviewId: string }> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.reviewComment.findUnique({
    where: { id: input.commentId },
    select: { authorId: true, reviewId: true, sectorId: true },
  })
  if (!existing || existing.sectorId !== input.sectorId) {
    throw new ReviewError('Comentário não encontrado.', 404)
  }
  if (existing.authorId !== input.userId && !canAdminister(input)) {
    throw new ReviewError('Sem permissão para excluir este comentário.', 403)
  }
  await db.reviewComment.delete({ where: { id: input.commentId } })
  return { reviewId: existing.reviewId }
}

function assertEmoji(emoji: string) {
  if (!(REVIEW_REACTIONS as readonly string[]).includes(emoji)) {
    throw new ReviewError('Reação inválida.', 400)
  }
}

export async function toggleReviewReaction(input: {
  reviewId: string
  userId: string
  emoji: string
  companyId: string
  sectorId: string
}): Promise<{ review: ReviewWithRelations; added: boolean; reviewAuthorId: string; sharedByMe: boolean }> {
  assertEmoji(input.emoji)
  const db = scopedPrisma(input.companyId)
  const review = await db.review.findUnique({
    where: { id: input.reviewId },
    select: { authorId: true, sectorId: true },
  })
  if (!review || review.sectorId !== input.sectorId) throw new ReviewError('Resenha não encontrada.', 404)
  const existing = await db.reviewReaction.findUnique({
    where: { reviewId_userId_emoji: { reviewId: input.reviewId, userId: input.userId, emoji: input.emoji } },
  })
  let added: boolean
  if (existing) {
    await db.reviewReaction.delete({ where: { id: existing.id } })
    added = false
  } else {
    await db.reviewReaction.create({
      data: { reviewId: input.reviewId, userId: input.userId, emoji: input.emoji, sectorId: input.sectorId },
    })
    added = true
  }
  const full = await db.review.findUniqueOrThrow({
    where: { id: input.reviewId },
    include: reviewInclude(input.userId),
  })
  const share = await db.reviewShare.findUnique({
    where: { reviewId_userId: { reviewId: input.reviewId, userId: input.userId } },
    select: { id: true },
  })
  return { review: full, added, reviewAuthorId: review.authorId, sharedByMe: Boolean(share) }
}

export async function toggleCommentReaction(input: {
  commentId: string
  userId: string
  emoji: string
  companyId: string
  sectorId: string
}): Promise<{ comment: ReviewCommentWithRelations }> {
  assertEmoji(input.emoji)
  const db = scopedPrisma(input.companyId)
  const comment = await db.reviewComment.findUnique({
    where: { id: input.commentId },
    select: { id: true, sectorId: true },
  })
  if (!comment || comment.sectorId !== input.sectorId) {
    throw new ReviewError('Comentário não encontrado.', 404)
  }
  const existing = await db.reviewCommentReaction.findUnique({
    where: { commentId_userId_emoji: { commentId: input.commentId, userId: input.userId, emoji: input.emoji } },
  })
  if (existing) {
    await db.reviewCommentReaction.delete({ where: { id: existing.id } })
  } else {
    await db.reviewCommentReaction.create({
      data: { commentId: input.commentId, userId: input.userId, emoji: input.emoji, sectorId: input.sectorId },
    })
  }
  const full = await db.reviewComment.findUniqueOrThrow({
    where: { id: input.commentId },
    include: reviewCommentInclude,
  })
  return { comment: full }
}

export async function shareReview(input: {
  reviewId: string
  userId: string
  companyId: string
  sectorId: string
}): Promise<{ reviewAuthorId: string; created: boolean }> {
  const db = scopedPrisma(input.companyId)
  const review = await db.review.findUnique({
    where: { id: input.reviewId },
    select: { authorId: true, sectorId: true },
  })
  if (!review || review.sectorId !== input.sectorId) throw new ReviewError('Resenha não encontrada.', 404)
  const existing = await db.reviewShare.findUnique({
    where: { reviewId_userId: { reviewId: input.reviewId, userId: input.userId } },
  })
  if (existing) return { reviewAuthorId: review.authorId, created: false }
  await db.reviewShare.create({ data: { reviewId: input.reviewId, userId: input.userId, sectorId: input.sectorId } })
  return { reviewAuthorId: review.authorId, created: true }
}

export async function unshareReview(input: { reviewId: string; userId: string; companyId: string }): Promise<void> {
  await scopedPrisma(input.companyId).reviewShare.deleteMany({ where: { reviewId: input.reviewId, userId: input.userId } })
}

export async function voteReviewPoll(input: {
  reviewId: string
  optionId: string
  userId: string
  companyId: string
  sectorId: string
}): Promise<{ review: ReviewWithRelations; sharedByMe: boolean }> {
  const db = scopedPrisma(input.companyId)
  const review = await db.review.findUnique({
    where: { id: input.reviewId },
    select: {
      id: true,
      sectorId: true,
      poll: { include: { options: { select: { id: true } } } },
    },
  })
  if (!review || review.sectorId !== input.sectorId || !review.poll) {
    throw new ReviewError('Enquete não encontrada.', 404)
  }
  if (!review.poll.options.some((option) => option.id === input.optionId)) {
    throw new ReviewError('Opção da enquete não encontrada.', 404)
  }
  const existing = await db.reviewPollVote.findUnique({
    where: { pollId_userId: { pollId: review.poll.id, userId: input.userId } },
    select: { id: true },
  })
  if (existing) throw new ReviewError('Você já votou nesta enquete.', 409)

  try {
    await db.reviewPollVote.create({
      data: {
        pollId: review.poll.id,
        optionId: input.optionId,
        userId: input.userId,
        sectorId: input.sectorId,
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ReviewError('Você já votou nesta enquete.', 409)
    }
    throw err
  }

  const [full, share] = await Promise.all([
    db.review.findUniqueOrThrow({ where: { id: input.reviewId }, include: reviewInclude(input.userId) }),
    db.reviewShare.findUnique({
      where: { reviewId_userId: { reviewId: input.reviewId, userId: input.userId } },
      select: { id: true },
    }),
  ])
  return { review: full, sharedByMe: Boolean(share) }
}

export async function listReviewPollVotes(input: {
  reviewId: string
  viewerId: string
  companyId: string
  sectorId: string
}) {
  const poll = await scopedPrisma(input.companyId).reviewPoll.findFirst({
    where: { reviewId: input.reviewId, sectorId: input.sectorId },
    include: {
      votes: { where: { userId: input.viewerId }, select: { id: true } },
      options: {
        orderBy: { position: 'asc' },
        include: {
          votes: {
            orderBy: { createdAt: 'asc' },
            include: { user: true },
          },
        },
      },
    },
  })
  if (!poll) throw new ReviewError('Enquete não encontrada.', 404)
  if (poll.votes.length === 0) {
    throw new ReviewError('Vote na enquete para ver quem votou.', 403)
  }
  return poll
}
