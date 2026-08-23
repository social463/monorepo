import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '../lib/prisma'

// `s3Config` também é stubado: sem ele `removeObjects` sai cedo e o teste de
// exclusão passaria sem nunca exercitar o apagamento no storage.
vi.mock('../lib/s3-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/s3-client')>()
  return {
    ...actual,
    deleteS3Object: vi.fn().mockResolvedValue(undefined),
    s3Config: () => ({ bucket: 'b', region: 'us-east-1', publicBaseUrl: 'https://cdn.exemplo.com' }),
  }
})

// Conta as operações Prisma da galeria para provar que a listagem não faz N+1.
const { opLog } = vi.hoisted(() => ({ opLog: [] as string[] }))

vi.mock('../lib/tenant-scope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tenant-scope')>()
  const MODELS = ['eventAlbum', 'eventPhoto', 'eventPhotoReaction', 'eventPhotoComment']
  return {
    ...actual,
    scopedPrisma: (companyId: string) => {
      const db = actual.scopedPrisma(companyId)
      return new Proxy(db as object, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver)
          if (typeof prop !== 'string' || !MODELS.includes(prop)) return value
          return new Proxy(value as object, {
            get(delegate, op, r2) {
              const fn = Reflect.get(delegate, op, r2)
              if (typeof fn !== 'function') return fn
              return (...args: unknown[]) => {
                opLog.push(`${prop}.${String(op)}`)
                return (fn as (...a: unknown[]) => unknown).apply(delegate, args)
              }
            },
          })
        },
      }) as typeof db
    },
  }
})

import { deleteS3Object } from '../lib/s3-client'
import {
  addPhotos,
  createAlbum,
  deleteAlbum,
  deletePhoto,
  EventAlbumError,
  listAlbums,
  setCover,
  updateAlbum,
} from './event-album-service'

const COMPANY = 'company-emr'

async function makeActor() {
  return prisma.user.create({
    data: { name: 'G&G', email: `gg-${Math.random()}@empresa.com`, passwordHash: 'x', sectorId: 'sector-dev-produto' },
  })
}

describe('event-album-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    opLog.length = 0
  })

  it('apaga o álbum, as fotos e os objetos do storage — nada fica órfão', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Confra 2026' }, COMPANY, actor.id)
    await addPhotos(
      album.id,
      { photos: [{ storageKey: 'event-photos/company-emr/a.jpg' }, { storageKey: 'event-photos/company-emr/b.jpg' }] },
      COMPANY,
      actor.id,
    )

    await deleteAlbum(album.id, COMPANY, actor.id)

    expect(await prisma.eventAlbum.count()).toBe(0)
    expect(await prisma.eventPhoto.count()).toBe(0)
    const apagadas = (deleteS3Object as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).sort()
    expect(apagadas).toEqual(['event-photos/company-emr/a.jpg', 'event-photos/company-emr/b.jpg'])
  })

  it('grava auditoria de DELETE do álbum', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Hackathon' }, COMPANY, actor.id)

    await deleteAlbum(album.id, COMPANY, actor.id)

    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'EventAlbum' } })
    expect(logs.map((l) => l.action).sort()).toEqual(['CREATE', 'DELETE'])
  })

  it('apagar a foto-capa anula a capa em vez de deixar chave morta', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Onboarding' }, COMPANY, actor.id)
    const [foto] = await addPhotos(
      album.id,
      { photos: [{ storageKey: 'event-photos/company-emr/k1.jpg' }] },
      COMPANY,
      actor.id,
    )
    await setCover(album.id, foto.id, COMPANY, actor.id)

    await deletePhoto(album.id, foto.id, COMPANY, actor.id)

    const recarregado = await prisma.eventAlbum.findUniqueOrThrow({ where: { id: album.id } })
    expect(recarregado.coverPhotoId).toBeNull()
    expect(deleteS3Object).toHaveBeenCalledWith('event-photos/company-emr/k1.jpg')
  })

  it('recusa capa que não é foto do álbum', async () => {
    const actor = await makeActor()
    const a = await createAlbum({ title: 'A' }, COMPANY, actor.id)
    const b = await createAlbum({ title: 'B' }, COMPANY, actor.id)
    const [fotoDeB] = await addPhotos(
      b.id,
      { photos: [{ storageKey: 'event-photos/company-emr/k2.jpg' }] },
      COMPANY,
      actor.id,
    )

    await expect(setCover(a.id, fotoDeB.id, COMPANY, actor.id)).rejects.toMatchObject({
      name: 'EventAlbumError',
      status: 400,
    })
  })

  it('lista com a contagem de fotos sem consultar álbum a álbum', async () => {
    const actor = await makeActor()
    const a = await createAlbum({ title: 'A', eventDate: '2026-05-01T00:00:00.000Z' }, COMPANY, actor.id)
    const b = await createAlbum({ title: 'B', eventDate: '2026-06-01T00:00:00.000Z' }, COMPANY, actor.id)
    await addPhotos(
      a.id,
      { photos: [{ storageKey: 'event-photos/company-emr/k3.jpg' }, { storageKey: 'event-photos/company-emr/k4.jpg' }] },
      COMPANY,
      actor.id,
    )

    const lista = await listAlbums(COMPANY)

    // Mais recente primeiro.
    expect(lista.map((i) => i.album.id)).toEqual([b.id, a.id])
    expect(lista.find((i) => i.album.id === a.id)?.photoCount).toBe(2)
    expect(lista.find((i) => i.album.id === b.id)?.photoCount).toBe(0)
  })

  it('404 ao mexer em álbum de outra empresa', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Da EMR' }, COMPANY, actor.id)
    await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })

    await expect(deleteAlbum(album.id, 'company-outra', actor.id)).rejects.toMatchObject({ status: 404 })
    expect(await prisma.eventAlbum.count()).toBe(1)
  })

  it('recusa lote acima do máximo', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Grande' }, COMPANY, actor.id)
    const photos = Array.from({ length: 21 }, (_, i) => ({ storageKey: `k${i}.jpg` }))

    await expect(addPhotos(album.id, { photos }, COMPANY, actor.id)).rejects.toMatchObject({ status: 400 })
  })

  it('recusa storageKey com o prefixo de outra empresa', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Confra' }, COMPANY, actor.id)

    await expect(
      addPhotos(album.id, { photos: [{ storageKey: 'event-photos/company-outra/x.jpg' }] }, COMPANY, actor.id),
    ).rejects.toMatchObject({ name: 'EventAlbumError', status: 400 })
  })

  it('recusa storageKey de outro namespace do bucket', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Confra' }, COMPANY, actor.id)

    await expect(
      addPhotos(album.id, { photos: [{ storageKey: 'manuals/company-emr/x.pdf' }] }, COMPANY, actor.id),
    ).rejects.toMatchObject({ name: 'EventAlbumError', status: 400 })
  })

  it('aceita storageKey com o prefixo legítimo da empresa', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Confra' }, COMPANY, actor.id)

    const created = await addPhotos(
      album.id,
      { photos: [{ storageKey: 'event-photos/company-emr/x.jpg' }] },
      COMPANY,
      actor.id,
    )

    expect(created).toHaveLength(1)
  })

  it('não grava nenhuma foto quando o lote tem uma chave inválida no meio', async () => {
    const actor = await makeActor()
    const album = await createAlbum({ title: 'Confra' }, COMPANY, actor.id)

    await expect(
      addPhotos(
        album.id,
        {
          photos: [
            { storageKey: 'event-photos/company-emr/ok1.jpg' },
            { storageKey: 'manuals/company-emr/intruso.pdf' },
            { storageKey: 'event-photos/company-emr/ok2.jpg' },
          ],
        },
        COMPANY,
        actor.id,
      ),
    ).rejects.toMatchObject({ status: 400 })

    expect(await prisma.eventPhoto.count()).toBe(0)
  })

  it('lista 20 álbuns sem uma consulta por álbum (sem N+1)', async () => {
    const actor = await makeActor()
    for (let i = 0; i < 20; i++) {
      await createAlbum({ title: `Álbum ${i}` }, COMPANY, actor.id)
    }
    opLog.length = 0

    const lista = await listAlbums(COMPANY)

    expect(lista).toHaveLength(20)
    // Exatamente duas idas ao banco: os álbuns e o groupBy das contagens.
    expect(opLog).toEqual(['eventAlbum.findMany', 'eventPhoto.groupBy'])
  })
})

describe('capa enviada no formulário', () => {
  it('grava a chave e o enquadramento, e a capa enviada vence a foto marcada', async () => {
    const actor = await makeActor()
    const album = await createAlbum(
      {
        title: 'Confra 2026',
        coverStorageKey: `event-photos/${COMPANY}/capa.jpg`,
        cover: { fit: 'CONTAIN', positionY: 20, scale: 150 },
      },
      COMPANY,
      actor.id,
    )

    expect(album).toMatchObject({
      coverStorageKey: `event-photos/${COMPANY}/capa.jpg`,
      coverFit: 'CONTAIN',
      coverPositionY: 20,
      coverScale: 150,
    })

    // Mesmo com uma foto marcada como capa, a imagem enviada é a que vale.
    await addPhotos(album.id, { photos: [{ storageKey: `event-photos/${COMPANY}/foto.jpg` }] }, COMPANY, actor.id)
    const foto = await prisma.eventPhoto.findFirstOrThrow({ where: { albumId: album.id } })
    await setCover(album.id, foto.id, COMPANY, actor.id)

    const [listado] = await listAlbums(COMPANY)
    expect(listado!.coverKey).toBe(`event-photos/${COMPANY}/capa.jpg`)
  })

  it('recusa chave de outro namespace do bucket como capa', async () => {
    const actor = await makeActor()
    await expect(
      createAlbum({ title: 'X', coverStorageKey: 'manuals/segredo.pdf' }, COMPANY, actor.id),
    ).rejects.toBeInstanceOf(EventAlbumError)
  })

  it('trocar a capa apaga a imagem anterior do storage', async () => {
    const actor = await makeActor()
    const album = await createAlbum(
      { title: 'Hackathon', coverStorageKey: `event-photos/${COMPANY}/velha.jpg` },
      COMPANY,
      actor.id,
    )

    await updateAlbum(album.id, { coverStorageKey: `event-photos/${COMPANY}/nova.jpg` }, COMPANY, actor.id)

    expect(deleteS3Object).toHaveBeenCalledWith(`event-photos/${COMPANY}/velha.jpg`)
  })

  it('editar só o título não mexe no enquadramento', async () => {
    const actor = await makeActor()
    const album = await createAlbum(
      { title: 'Antes', cover: { fit: 'CONTAIN', positionY: 10, scale: 200 } },
      COMPANY,
      actor.id,
    )

    const depois = await updateAlbum(album.id, { title: 'Depois' }, COMPANY, actor.id)

    expect(depois).toMatchObject({ title: 'Depois', coverFit: 'CONTAIN', coverPositionY: 10, coverScale: 200 })
  })

  it('apagar o álbum apaga também a capa enviada', async () => {
    const actor = await makeActor()
    const album = await createAlbum(
      { title: 'Fim', coverStorageKey: `event-photos/${COMPANY}/capa.jpg` },
      COMPANY,
      actor.id,
    )

    await deleteAlbum(album.id, COMPANY, actor.id)

    expect(deleteS3Object).toHaveBeenCalledWith(`event-photos/${COMPANY}/capa.jpg`)
  })
})
