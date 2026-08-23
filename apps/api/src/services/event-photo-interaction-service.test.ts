import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { addComment, addReaction, deleteComment, removeReaction } from './event-photo-interaction-service'

const COMPANY = 'company-emr'

async function makePhoto() {
  const user = await prisma.user.create({
    data: { name: 'Pessoa', email: `p-${Math.random()}@empresa.com`, passwordHash: 'x', sectorId: 'sector-dev-produto' },
  })
  const album = await prisma.eventAlbum.create({
    data: { title: 'Confra', createdById: user.id, companyId: COMPANY },
  })
  const photo = await prisma.eventPhoto.create({
    data: { albumId: album.id, storageKey: 'k.jpg', uploadedById: user.id, companyId: COMPANY },
  })
  return { user, album, photo }
}

describe('interação com foto de evento', () => {
  it('reagir duas vezes com o mesmo emoji não duplica', async () => {
    const { user, photo } = await makePhoto()

    await addReaction(photo.id, '🎉', COMPANY, user.id)
    await addReaction(photo.id, '🎉', COMPANY, user.id)

    expect(await prisma.eventPhotoReaction.count({ where: { photoId: photo.id } })).toBe(1)
  })

  it('remove a reação e permite reagir de novo', async () => {
    const { user, photo } = await makePhoto()
    await addReaction(photo.id, '🔥', COMPANY, user.id)

    await removeReaction(photo.id, '🔥', COMPANY, user.id)
    expect(await prisma.eventPhotoReaction.count()).toBe(0)

    await addReaction(photo.id, '🔥', COMPANY, user.id)
    expect(await prisma.eventPhotoReaction.count()).toBe(1)
  })

  it('recusa emoji fora do conjunto padronizado', async () => {
    const { user, photo } = await makePhoto()

    await expect(addReaction(photo.id, '🥔', COMPANY, user.id)).rejects.toMatchObject({ status: 400 })
  })

  it('404 ao reagir em foto de outra empresa', async () => {
    const { user, photo } = await makePhoto()
    await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })

    await expect(addReaction(photo.id, '🎉', 'company-outra', user.id)).rejects.toMatchObject({ status: 404 })
  })

  it('autor apaga o próprio comentário; terceiro sem moderação não', async () => {
    const { user, photo } = await makePhoto()
    const outro = await prisma.user.create({
      data: { name: 'Outro', email: `o-${Math.random()}@empresa.com`, passwordHash: 'x', sectorId: 'sector-dev-produto' },
    })
    const comentario = await addComment(photo.id, 'que dia bom', COMPANY, user.id)

    await expect(
      deleteComment(comentario.id, COMPANY, { userId: outro.id, canModerate: false }),
    ).rejects.toMatchObject({ status: 403 })

    await deleteComment(comentario.id, COMPANY, { userId: user.id, canModerate: false })
    expect(await prisma.eventPhotoComment.count()).toBe(0)
  })

  it('quem modera apaga comentário alheio', async () => {
    const { user, photo } = await makePhoto()
    const moderador = await prisma.user.create({
      data: { name: 'GG', email: `gg-${Math.random()}@empresa.com`, passwordHash: 'x', sectorId: 'sector-dev-produto' },
    })
    const comentario = await addComment(photo.id, 'texto', COMPANY, user.id)

    await deleteComment(comentario.id, COMPANY, { userId: moderador.id, canModerate: true })

    expect(await prisma.eventPhotoComment.count()).toBe(0)
  })

  it('recusa comentário vazio', async () => {
    const { user, photo } = await makePhoto()

    await expect(addComment(photo.id, '   ', COMPANY, user.id)).rejects.toMatchObject({ status: 400 })
  })
})
