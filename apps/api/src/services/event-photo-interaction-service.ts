import { EVENT_PHOTO_COMMENT_MAX_LENGTH, EVENT_PHOTO_REACTIONS } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { EventAlbumError } from './event-album-service'

/**
 * A foto, do álbum de uma empresa. Exportada porque o download também precisa
 * dela — e o 404 de foto de OUTRA empresa tem que sair daqui, não de um
 * `findUnique` solto que ignoraria o escopo do tenant.
 */
export async function findPhotoOrThrow(photoId: string, companyId: string) {
  const photo = await scopedPrisma(companyId).eventPhoto.findFirst({ where: { id: photoId } })
  if (!photo) throw new EventAlbumError('Foto não encontrada.', 404)
  return photo
}

function assertEmoji(emoji: string) {
  if (!(EVENT_PHOTO_REACTIONS as readonly string[]).includes(emoji)) {
    throw new EventAlbumError('Reação não suportada.', 400)
  }
}

/**
 * Idempotente por (foto, pessoa, emoji): o `@@unique` garante a linha única e a
 * violação (P2002) é tratada como no-op. Duas requisições em corrida — clique
 * duplo, retry do cliente — não duplicam nem se auto-desfazem.
 */
export async function addReaction(photoId: string, emoji: string, companyId: string, userId: string): Promise<void> {
  assertEmoji(emoji)
  await findPhotoOrThrow(photoId, companyId)
  try {
    await scopedPrisma(companyId).eventPhotoReaction.create({ data: { photoId, userId, emoji } })
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return
    throw err
  }
}

export async function removeReaction(
  photoId: string,
  emoji: string,
  companyId: string,
  userId: string,
): Promise<void> {
  assertEmoji(emoji)
  await findPhotoOrThrow(photoId, companyId)
  await scopedPrisma(companyId).eventPhotoReaction.deleteMany({ where: { photoId, userId, emoji } })
}

export async function listComments(photoId: string, companyId: string) {
  await findPhotoOrThrow(photoId, companyId)
  return scopedPrisma(companyId).eventPhotoComment.findMany({
    where: { photoId },
    orderBy: { createdAt: 'asc' },
    include: { author: true },
  })
}

export async function addComment(photoId: string, body: string, companyId: string, authorId: string) {
  await findPhotoOrThrow(photoId, companyId)
  const trimmed = body.trim()
  if (trimmed.length === 0) throw new EventAlbumError('Escreva um comentário.', 400)
  if (trimmed.length > EVENT_PHOTO_COMMENT_MAX_LENGTH) {
    throw new EventAlbumError(`Comentário muito longo (máx. ${EVENT_PHOTO_COMMENT_MAX_LENGTH} caracteres).`, 400)
  }
  return scopedPrisma(companyId).eventPhotoComment.create({
    data: { photoId, body: trimmed, authorId },
    include: { author: true },
  })
}

/** Autor apaga o próprio; quem administra G&G apaga qualquer um. */
export async function deleteComment(
  commentId: string,
  companyId: string,
  ctx: { userId: string; canModerate: boolean },
): Promise<void> {
  const db = scopedPrisma(companyId)
  const comment = await db.eventPhotoComment.findFirst({ where: { id: commentId } })
  if (!comment) throw new EventAlbumError('Comentário não encontrado.', 404)
  if (!ctx.canModerate && comment.authorId !== ctx.userId) {
    throw new EventAlbumError('Você não pode apagar este comentário.', 403)
  }
  await db.eventPhotoComment.delete({ where: { id: commentId } })
}
