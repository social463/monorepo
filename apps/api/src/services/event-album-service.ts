import {
  EVENT_ALBUM_COVER_POSITION_MAX,
  EVENT_ALBUM_COVER_POSITION_MIN,
  EVENT_ALBUM_COVER_SCALE_MAX,
  EVENT_ALBUM_COVER_SCALE_MIN,
  EVENT_PHOTO_MAX_BATCH,
  type AddEventPhotosRequest,
  type CreateEventAlbumRequest,
  type EventAlbumCover,
  type UpdateEventAlbumRequest,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { deleteS3Object, s3Config } from '../lib/s3-client'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

export class EventAlbumError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'EventAlbumError'
  }
}

const ENTITY = 'EventAlbum'

/**
 * Remove os objetos do storage depois que o banco já foi ajustado. S3 não entra
 * em transação: a etapa é best-effort e a falha é logada, como a avaliação de
 * selos pós-voto. O pior caso é um objeto sobrando no bucket — nunca uma foto
 * fantasma na tela, que é o que aconteceria na ordem inversa.
 */
async function removeObjects(keys: string[]): Promise<void> {
  if (!s3Config()) return
  for (const key of keys) {
    try {
      await deleteS3Object(key)
    } catch (err) {
      console.error('[event-album] falha ao apagar objeto do storage', { key, err })
    }
  }
}

async function findAlbumOrThrow(id: string, companyId: string) {
  const album = await scopedPrisma(companyId).eventAlbum.findFirst({ where: { id } })
  if (!album) throw new EventAlbumError('Álbum não encontrado.', 404)
  return album
}

/**
 * Álbuns da empresa, do evento mais recente para o mais antigo, com a contagem
 * de fotos e a chave da capa. A contagem sai de UM `groupBy` — nada de consultar
 * álbum a álbum, que é justamente o N+1 do portal de origem.
 */
export async function listAlbums(companyId: string) {
  const db = scopedPrisma(companyId)
  const albums = await db.eventAlbum.findMany({
    orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
    include: { cover: { select: { storageKey: true } } },
  })
  const counts = await db.eventPhoto.groupBy({ by: ['albumId'], _count: { _all: true } })
  const countByAlbum = new Map(counts.map((c) => [c.albumId, c._count._all]))

  return albums.map((album) => ({
    album,
    photoCount: countByAlbum.get(album.id) ?? 0,
    coverKey: album.coverStorageKey ?? album.cover?.storageKey ?? null,
  }))
}

/** Álbum com as fotos, reações e contagem de comentários — para a tela do álbum. */
export async function getAlbumWithPhotos(id: string, companyId: string) {
  const db = scopedPrisma(companyId)
  const album = await db.eventAlbum.findFirst({
    where: { id },
    include: { cover: { select: { storageKey: true } } },
  })
  if (!album) throw new EventAlbumError('Álbum não encontrado.', 404)

  const photos = await db.eventPhoto.findMany({
    where: { albumId: id },
    orderBy: { createdAt: 'asc' },
    include: {
      reactions: { include: { user: true } },
      _count: { select: { comments: true } },
    },
  })

  return {
    album,
    photoCount: photos.length,
    coverKey: album.coverStorageKey ?? album.cover?.storageKey ?? null,
    photos,
  }
}

/**
 * A chave pertence ao prefixo `event-photos/<companyId>/` desta empresa? Sem
 * essa checagem, quem administra G&G poderia confirmar como "foto do álbum"
 * qualquer chave que já conheça no bucket — de outro namespace (`manuals/`,
 * `pdi-evidences/`) ou de outra empresa — e depois apagar aquele objeto só
 * apagando o álbum ou a foto. Mesmo padrão de `assertOwnEvidenceKey` em
 * `challenge-service.ts`.
 */
function assertOwnEventPhotoKey(companyId: string, storageKey: string): void {
  if (!storageKey.startsWith(`event-photos/${companyId}/`)) {
    throw new EventAlbumError('Chave de foto inválida.', 400)
  }
}

function parseEventDate(value: string | null | undefined): Date | null {
  if (value == null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new EventAlbumError('Data do evento inválida.', 400)
  return date
}

/**
 * Os campos de enquadramento, prontos para o `data` do Prisma. Ausente vira
 * objeto vazio: quem editou só o título não mexe na capa sem querer.
 *
 * A capa enviada passa pela MESMA checagem de prefixo das fotos — ela sobe pelo
 * mesmo presign, e sem isso quem administra G&G poderia gravar como capa uma
 * chave de outro namespace do bucket e apagá-la depois junto com o álbum.
 */
function coverData(
  input: { coverStorageKey?: string | null; cover?: EventAlbumCover },
  companyId: string,
) {
  if (input.coverStorageKey) assertOwnEventPhotoKey(companyId, input.coverStorageKey)
  return {
    ...(input.coverStorageKey !== undefined ? { coverStorageKey: input.coverStorageKey || null } : {}),
    ...(input.cover
      ? {
          coverFit: input.cover.fit,
          coverPositionY: clamp(input.cover.positionY, EVENT_ALBUM_COVER_POSITION_MIN, EVENT_ALBUM_COVER_POSITION_MAX),
          coverScale: clamp(input.cover.scale, EVENT_ALBUM_COVER_SCALE_MIN, EVENT_ALBUM_COVER_SCALE_MAX),
        }
      : {}),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

export async function createAlbum(input: CreateEventAlbumRequest, companyId: string, actorId: string) {
  const album = await scopedPrisma(companyId).eventAlbum.create({
    data: {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      eventDate: parseEventDate(input.eventDate),
      ...coverData(input, companyId),
      createdById: actorId,
    },
  })
  await recordAuditLog({
    actorId,
    companyId,
    entityType: ENTITY,
    entityId: album.id,
    action: 'CREATE',
    after: album,
  })
  return album
}

export async function updateAlbum(
  id: string,
  input: UpdateEventAlbumRequest,
  companyId: string,
  actorId: string,
) {
  const before = await findAlbumOrThrow(id, companyId)
  const album = await scopedPrisma(companyId).eventAlbum.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.eventDate !== undefined ? { eventDate: parseEventDate(input.eventDate) } : {}),
      ...coverData(input, companyId),
    },
  })

  // Trocar a capa enviada deixa a anterior órfã no bucket.
  if (input.coverStorageKey !== undefined && before.coverStorageKey && before.coverStorageKey !== album.coverStorageKey) {
    await removeObjects([before.coverStorageKey])
  }
  await recordAuditLog({ actorId, companyId, entityType: ENTITY, entityId: id, action: 'UPDATE', before, after: album })
  return album
}

/**
 * Apaga álbum, fotos, reações e comentários (cascata do Prisma) e só então os
 * objetos do storage. As chaves são coletadas ANTES do delete — depois não há
 * de onde tirá-las.
 */
export async function deleteAlbum(id: string, companyId: string, actorId: string): Promise<void> {
  const album = await findAlbumOrThrow(id, companyId)
  const photos = await scopedPrisma(companyId).eventPhoto.findMany({
    where: { albumId: id },
    select: { storageKey: true },
  })

  await prisma.$transaction(async (tx) => {
    // A capa aponta para uma foto do próprio álbum: zerar antes evita que a FK
    // segure o delete numa ordem infeliz de cascata.
    await tx.eventAlbum.update({ where: { id }, data: { coverPhotoId: null } })
    await tx.eventAlbum.delete({ where: { id } })
    await recordAuditLog({
      actorId,
      companyId,
      entityType: ENTITY,
      entityId: id,
      action: 'DELETE',
      before: album,
      tx,
    })
  })

  // A capa enviada não é foto do álbum, então não vem na lista acima.
  await removeObjects([...photos.map((p) => p.storageKey), ...(album.coverStorageKey ? [album.coverStorageKey] : [])])
}

/** Confirma no álbum as fotos já enviadas ao storage. */
export async function addPhotos(
  albumId: string,
  input: AddEventPhotosRequest,
  companyId: string,
  actorId: string,
) {
  await findAlbumOrThrow(albumId, companyId)
  if (input.photos.length === 0) {
    throw new EventAlbumError('Envie ao menos uma foto.', 400)
  }
  if (input.photos.length > EVENT_PHOTO_MAX_BATCH) {
    throw new EventAlbumError(`Envie no máximo ${EVENT_PHOTO_MAX_BATCH} fotos por vez.`, 400)
  }
  // Valida o lote inteiro ANTES de gravar qualquer linha: uma chave inválida
  // no meio do lote não pode deixar as anteriores confirmadas no banco.
  for (const photo of input.photos) {
    assertOwnEventPhotoKey(companyId, photo.storageKey)
  }

  const db = scopedPrisma(companyId)
  const created = []
  for (const photo of input.photos) {
    created.push(
      await db.eventPhoto.create({
        data: {
          albumId,
          storageKey: photo.storageKey,
          width: photo.width ?? null,
          height: photo.height ?? null,
          uploadedById: actorId,
        },
      }),
    )
  }

  await recordAuditLog({
    actorId,
    companyId,
    entityType: ENTITY,
    entityId: albumId,
    action: 'UPDATE',
    after: { addedPhotos: created.length },
  })
  return created
}

export async function deletePhoto(
  albumId: string,
  photoId: string,
  companyId: string,
  actorId: string,
): Promise<void> {
  const db = scopedPrisma(companyId)
  const photo = await db.eventPhoto.findFirst({ where: { id: photoId, albumId } })
  if (!photo) throw new EventAlbumError('Foto não encontrada.', 404)

  // `coverPhotoId` é SetNull: apagar a foto-capa anula a capa sozinho.
  await db.eventPhoto.delete({ where: { id: photoId } })
  await recordAuditLog({
    actorId,
    companyId,
    entityType: ENTITY,
    entityId: albumId,
    action: 'UPDATE',
    before: { removedPhotoId: photoId },
  })
  await removeObjects([photo.storageKey])
}

export async function setCover(albumId: string, photoId: string, companyId: string, actorId: string) {
  const db = scopedPrisma(companyId)
  await findAlbumOrThrow(albumId, companyId)
  const photo = await db.eventPhoto.findFirst({ where: { id: photoId, albumId } })
  if (!photo) throw new EventAlbumError('A capa precisa ser uma foto deste álbum.', 400)

  const album = await db.eventAlbum.update({ where: { id: albumId }, data: { coverPhotoId: photoId } })
  await recordAuditLog({
    actorId,
    companyId,
    entityType: ENTITY,
    entityId: albumId,
    action: 'UPDATE',
    after: { coverPhotoId: photoId },
  })
  return album
}
