import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  EVENT_ALBUM_COVER_FITS,
  EVENT_ALBUM_COVER_POSITION_MAX,
  EVENT_ALBUM_COVER_POSITION_MIN,
  EVENT_ALBUM_COVER_SCALE_MAX,
  EVENT_ALBUM_COVER_SCALE_MIN,
  EVENT_ALBUM_DESCRIPTION_MAX_LENGTH,
  EVENT_ALBUM_TITLE_MAX_LENGTH,
  EVENT_PHOTO_COMMENT_MAX_LENGTH,
  EVENT_PHOTO_MAX_BATCH,
  isFullAdmin,
} from '@legends/shared'
import { toEventAlbumDTO, toEventPhotoCommentDTO, toEventPhotoDTO } from '../lib/serialize'
import {
  addPhotos,
  createAlbum,
  deleteAlbum,
  deletePhoto,
  EventAlbumError,
  getAlbumWithPhotos,
  listAlbums,
  setCover,
  updateAlbum,
} from '../services/event-album-service'
import {
  addComment,
  addReaction,
  deleteComment,
  findPhotoOrThrow,
  listComments,
  removeReaction,
} from '../services/event-photo-interaction-service'
import { presignDocumentDownload, s3Config } from '../lib/s3-client'

const idParams = z.object({ id: z.string().min(1) })
/** Enquadramento da capa. Os limites são os mesmos que o editor oferece. */
const coverSchema = z.object({
  fit: z.enum(EVENT_ALBUM_COVER_FITS),
  positionY: z.number().int().min(EVENT_ALBUM_COVER_POSITION_MIN).max(EVENT_ALBUM_COVER_POSITION_MAX),
  scale: z.number().int().min(EVENT_ALBUM_COVER_SCALE_MIN).max(EVENT_ALBUM_COVER_SCALE_MAX),
})

const albumBody = z.object({
  title: z.string().trim().min(1).max(EVENT_ALBUM_TITLE_MAX_LENGTH),
  description: z.string().trim().max(EVENT_ALBUM_DESCRIPTION_MAX_LENGTH).nullish(),
  eventDate: z.string().datetime().nullish(),
  coverStorageKey: z.string().trim().min(1).nullish(),
  cover: coverSchema.optional(),
})
const albumPatchBody = albumBody.partial()
const photosBody = z.object({
  photos: z
    .array(
      z.object({
        storageKey: z.string().min(1),
        width: z.number().int().positive().nullish(),
        height: z.number().int().positive().nullish(),
      }),
    )
    .min(1)
    .max(EVENT_PHOTO_MAX_BATCH),
})
const coverBody = z.object({ photoId: z.string().min(1) })
const photoParams = z.object({ albumId: z.string().min(1), photoId: z.string().min(1) })
const photoIdParams = z.object({ photoId: z.string().min(1) })
const reactionBody = z.object({ emoji: z.string().min(1) })
const commentBody = z.object({ body: z.string().trim().min(1).max(EVENT_PHOTO_COMMENT_MAX_LENGTH) })

/** Responde o erro tipado do service; o que não for dele sobe. */
function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof EventAlbumError) return reply.code(err.status).send({ message: err.message })
  throw err
}

export async function eventAlbumRoutes(app: FastifyInstance) {
  // Leitura: quem tem a feature de colaborador `galeria`. ADMIN e SUBADMIN passam
  // sempre, como em todo `requireFeature`.
  const readGuard = { onRequest: [app.authenticate, app.requireFeature('galeria')] }

  app.get('/event-albums', readGuard, async (request, reply) => {
    const albums = await listAlbums(request.user.companyId)
    return reply.send({ albums: albums.map(toEventAlbumDTO) })
  })

  app.get('/event-albums/:id', readGuard, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const found = await getAlbumWithPhotos(parsed.data.id, request.user.companyId)
      return reply.send({
        album: toEventAlbumDTO(found),
        photos: found.photos.map((photo) => toEventPhotoDTO(photo, request.user.sub)),
      })
    } catch (err) {
      return fail(reply, err)
    }
  })

  /** Quem administra G&G modera comentário alheio; o resto só apaga o próprio. */
  function canModerate(request: {
    user: { role: string; features?: string[]; adminAccess?: boolean }
  }): boolean {
    if (isFullAdmin(request.user)) return true
    return request.user.role === 'SUBADMIN' && (request.user.features ?? []).includes('gente-gestao')
  }

  app.post('/event-albums/photos/:photoId/reactions', readGuard, async (request, reply) => {
    const params = photoIdParams.safeParse(request.params)
    const parsed = reactionBody.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      await addReaction(params.data.photoId, parsed.data.emoji, request.user.companyId, request.user.sub)
      return reply.code(204).send()
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/event-albums/photos/:photoId/reactions', readGuard, async (request, reply) => {
    const params = photoIdParams.safeParse(request.params)
    const parsed = reactionBody.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      await removeReaction(params.data.photoId, parsed.data.emoji, request.user.companyId, request.user.sub)
      return reply.code(204).send()
    } catch (err) {
      return fail(reply, err)
    }
  })

  /**
   * Link de download da foto — para TODO mundo que enxerga a galeria, não só
   * para quem administra.
   *
   * Precisa de URL assinada em vez de um `<a download>` no front: o objeto é
   * servido de outro domínio (o `publicBaseUrl` do bucket), e o navegador
   * ignora o atributo `download` em origem cruzada — o clique abriria a imagem
   * numa aba em vez de baixar. A assinatura carrega o
   * `Content-Disposition: attachment` e um nome de arquivo decente.
   */
  app.get('/event-albums/photos/:photoId/download', readGuard, async (request, reply) => {
    const params = photoIdParams.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    if (!s3Config()) return reply.code(503).send({ message: 'Download de fotos indisponível.' })
    try {
      const photo = await findPhotoOrThrow(params.data.photoId, request.user.companyId)
      const extension = photo.storageKey.split('.').pop() ?? 'jpg'
      const url = await presignDocumentDownload({ key: photo.storageKey, fileName: `foto-${photo.id}.${extension}` })
      return reply.send({ url })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/event-albums/photos/:photoId/comments', readGuard, async (request, reply) => {
    const params = photoIdParams.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    try {
      const comments = await listComments(params.data.photoId, request.user.companyId)
      const ctx = { viewerId: request.user.sub, canModerate: canModerate(request) }
      return reply.send({ comments: comments.map((c) => toEventPhotoCommentDTO(c, ctx)) })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/event-albums/photos/:photoId/comments', readGuard, async (request, reply) => {
    const params = photoIdParams.safeParse(request.params)
    const parsed = commentBody.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const comment = await addComment(
        params.data.photoId,
        parsed.data.body,
        request.user.companyId,
        request.user.sub,
      )
      const ctx = { viewerId: request.user.sub, canModerate: canModerate(request) }
      return reply.code(201).send({ comment: toEventPhotoCommentDTO(comment, ctx) })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/event-albums/comments/:id', readGuard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    try {
      await deleteComment(params.data.id, request.user.companyId, {
        userId: request.user.sub,
        canModerate: canModerate(request),
      })
      return reply.code(204).send()
    } catch (err) {
      return fail(reply, err)
    }
  })

  // Escrita: bloco de Gente e Gestão. `requireSectorFeature` (e não
  // `requireAdminOrSubadmin`) porque este último libera TODO subadmin, de
  // qualquer setor — ver AGENTS.md.
  const adminGuard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  app.post('/admin/event-albums', adminGuard, async (request, reply) => {
    const parsed = albumBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const album = await createAlbum(parsed.data, request.user.companyId, request.user.sub)
    return reply.code(201).send({ album: toEventAlbumDTO({ album, photoCount: 0, coverKey: null }) })
  })

  app.patch('/admin/event-albums/:id', adminGuard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const parsed = albumPatchBody.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      await updateAlbum(params.data.id, parsed.data, request.user.companyId, request.user.sub)
      const found = await getAlbumWithPhotos(params.data.id, request.user.companyId)
      return reply.send({ album: toEventAlbumDTO(found) })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/admin/event-albums/:id', adminGuard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    try {
      await deleteAlbum(params.data.id, request.user.companyId, request.user.sub)
      return reply.code(204).send()
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/admin/event-albums/:id/photos', adminGuard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const parsed = photosBody.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const photos = await addPhotos(params.data.id, parsed.data, request.user.companyId, request.user.sub)
      return reply.code(201).send({ photos: photos.map((p) => ({ id: p.id, storageKey: p.storageKey })) })
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/admin/event-albums/:albumId/photos/:photoId', adminGuard, async (request, reply) => {
    const params = photoParams.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    try {
      await deletePhoto(params.data.albumId, params.data.photoId, request.user.companyId, request.user.sub)
      return reply.code(204).send()
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.patch('/admin/event-albums/:id/cover', adminGuard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const parsed = coverBody.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      await setCover(params.data.id, parsed.data.photoId, request.user.companyId, request.user.sub)
      const found = await getAlbumWithPhotos(params.data.id, request.user.companyId)
      return reply.send({ album: toEventAlbumDTO(found) })
    } catch (err) {
      return fail(reply, err)
    }
  })
}
