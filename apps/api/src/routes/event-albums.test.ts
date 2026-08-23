import { describe, it, expect, vi } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { presignDocumentDownload } from '../lib/s3-client'

vi.mock('../lib/s3-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/s3-client')>()
  return {
    ...actual,
    deleteS3Object: vi.fn().mockResolvedValue(undefined),
    presignDocumentDownload: vi.fn().mockResolvedValue('https://s3.exemplo.com/assinado'),
    s3Config: () => ({ bucket: 'b', region: 'us-east-1', publicBaseUrl: 'https://cdn.exemplo.com' }),
  }
})

async function makeUser(
  app: ReturnType<typeof buildApp>,
  role: string,
  features: string[] = ['galeria', 'gente-gestao'],
  companyId = 'company-emr',
) {
  const user = await prisma.user.create({
    data: {
      name: role.toLowerCase(),
      email: `${role.toLowerCase()}-${Math.random()}@empresa.com`,
      passwordHash: 'x',
      role: role as never,
      sectorId: 'sector-dev-produto',
      companyId,
    },
  })
  const token = app.jwt.sign({ sub: user.id, role, sectorId: 'sector-dev-produto', companyId, features })
  return { user, token }
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('galeria — leitura', () => {
  it('lista álbuns do mais recente para o mais antigo, com capa e contagem', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')

    const criado = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: 'Confra 2026', eventDate: '2026-05-10T00:00:00.000Z' },
    })
    const albumId = criado.json().album.id
    const fotos = await app.inject({
      method: 'POST',
      url: `/admin/event-albums/${albumId}/photos`,
      headers: auth(gg.token),
      payload: { photos: [{ storageKey: 'event-photos/company-emr/a.jpg', width: 800, height: 600 }] },
    })
    await app.inject({
      method: 'PATCH',
      url: `/admin/event-albums/${albumId}/cover`,
      headers: auth(gg.token),
      payload: { photoId: fotos.json().photos[0].id },
    })

    const colaborador = await makeUser(app, 'LEGEND', ['galeria'])
    const res = await app.inject({ method: 'GET', url: '/event-albums', headers: auth(colaborador.token) })

    expect(res.statusCode).toBe(200)
    expect(res.json().albums[0]).toMatchObject({
      title: 'Confra 2026',
      photoCount: 1,
      coverUrl: 'https://cdn.exemplo.com/event-photos/company-emr/a.jpg',
    })
    await app.close()
  })

  it('nega a leitura de quem não tem a feature galeria', async () => {
    const app = buildApp()
    await app.ready()
    const semFeature = await makeUser(app, 'LEGEND', [])

    const res = await app.inject({ method: 'GET', url: '/event-albums', headers: auth(semFeature.token) })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('não mostra álbum de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })
    const daOutra = await makeUser(app, 'ADMIN', ['galeria', 'gente-gestao'], 'company-outra')
    await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(daOutra.token),
      payload: { title: 'Confra alheia' },
    })

    const daEmr = await makeUser(app, 'LEGEND', ['galeria'])
    const res = await app.inject({ method: 'GET', url: '/event-albums', headers: auth(daEmr.token) })

    expect(res.json().albums).toEqual([])
    await app.close()
  })

  it('serve 20 álbuns numa resposta só', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')
    for (let i = 0; i < 20; i++) {
      await app.inject({
        method: 'POST',
        url: '/admin/event-albums',
        headers: auth(gg.token),
        payload: { title: `Álbum ${i}` },
      })
    }

    const res = await app.inject({ method: 'GET', url: '/event-albums', headers: auth(gg.token) })

    expect(res.json().albums).toHaveLength(20)
    await app.close()
  })
})

describe('galeria — escrita', () => {
  it('subadmin de G&G cria álbum e sobe um lote de fotos', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'SUBADMIN', ['gente-gestao'])

    const criado = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: 'Hackathon 2026', description: 'Dois dias', eventDate: '2026-04-01T00:00:00.000Z' },
    })
    expect(criado.statusCode).toBe(201)

    const res = await app.inject({
      method: 'POST',
      url: `/admin/event-albums/${criado.json().album.id}/photos`,
      headers: auth(gg.token),
      payload: {
        photos: [
          { storageKey: 'event-photos/company-emr/k1.jpg' },
          { storageKey: 'event-photos/company-emr/k2.jpg' },
        ],
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().photos).toHaveLength(2)
    await app.close()
  })

  it('nega escrita a subadmin de setor sem a feature gente-gestao', async () => {
    const app = buildApp()
    await app.ready()
    const outroSetor = await makeUser(app, 'SUBADMIN', ['galeria'])

    const res = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(outroSetor.token),
      payload: { title: 'Não deveria entrar' },
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('nega escrita a colaborador', async () => {
    const app = buildApp()
    await app.ready()
    const colaborador = await makeUser(app, 'LEGEND', ['galeria'])

    const res = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(colaborador.token),
      payload: { title: 'Nem esse' },
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('recusa título vazio com issues', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')

    const res = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: '' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Requisição inválida.')
    expect(res.json().issues).toBeDefined()
    await app.close()
  })

  it('recusa lote acima de 20 fotos', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')
    const criado = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: 'Grande' },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/admin/event-albums/${criado.json().album.id}/photos`,
      headers: auth(gg.token),
      payload: { photos: Array.from({ length: 21 }, (_, i) => ({ storageKey: `k${i}.jpg` })) },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('PATCH altera o álbum e responde 200', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')
    const criado = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: 'Rascunho', eventDate: '2026-04-01T00:00:00.000Z' },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/event-albums/${criado.json().album.id}`,
      headers: auth(gg.token),
      payload: { title: 'Confra 2026 — Final', description: 'Data confirmada' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().album).toMatchObject({ title: 'Confra 2026 — Final', description: 'Data confirmada' })
    await app.close()
  })

  it('PATCH de álbum de outra empresa responde 404', async () => {
    const app = buildApp()
    await app.ready()
    await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })
    const daOutra = await makeUser(app, 'ADMIN', ['galeria', 'gente-gestao'], 'company-outra')
    const criado = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(daOutra.token),
      payload: { title: 'Da outra empresa' },
    })

    const gg = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/event-albums/${criado.json().album.id}`,
      headers: auth(gg.token),
      payload: { title: 'Tentativa alheia' },
    })

    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('excluir álbum some com ele da listagem', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')
    const criado = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: 'Some' },
    })

    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/event-albums/${criado.json().album.id}`,
      headers: auth(gg.token),
    })

    expect(del.statusCode).toBe(204)
    const lista = await app.inject({ method: 'GET', url: '/event-albums', headers: auth(gg.token) })
    expect(lista.json().albums).toEqual([])
    await app.close()
  })
})

describe('galeria — interação pela rota', () => {
  it('reage, aparece no detalhe do álbum e não duplica no segundo POST', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'ADMIN')
    const criado = await app.inject({
      method: 'POST',
      url: '/admin/event-albums',
      headers: auth(gg.token),
      payload: { title: 'Confra' },
    })
    const albumId = criado.json().album.id
    const fotos = await app.inject({
      method: 'POST',
      url: `/admin/event-albums/${albumId}/photos`,
      headers: auth(gg.token),
      payload: { photos: [{ storageKey: 'event-photos/company-emr/k1.jpg' }] },
    })
    const photoId = fotos.json().photos[0].id

    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/event-albums/photos/${photoId}/reactions`,
        headers: auth(gg.token),
        payload: { emoji: '🎉' },
      })
      expect(res.statusCode).toBe(204)
    }

    const detalhe = await app.inject({ method: 'GET', url: `/event-albums/${albumId}`, headers: auth(gg.token) })
    const reacoes = detalhe.json().photos[0].reactions
    expect(reacoes).toHaveLength(1)
    expect(reacoes[0]).toMatchObject({ emoji: '🎉', count: 1, reactedByMe: true })
    await app.close()
  })
})

describe('galeria — baixar foto', () => {
  it('devolve link assinado para qualquer pessoa que enxerga a galeria', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const album = await prisma.eventAlbum.create({
      data: { title: 'Confra', createdById: admin.user.id, companyId: 'company-emr' },
    })
    const photo = await prisma.eventPhoto.create({
      data: {
        album: { connect: { id: album.id } },
        storageKey: 'event-photos/company-emr/f1.jpg',
        uploadedBy: { connect: { id: admin.user.id } },
        company: { connect: { id: 'company-emr' } },
      },
    })
    // Colaborador comum: baixar não é privilégio de quem administra.
    const legend = await makeUser(app, 'LEGEND', ['galeria'])

    const res = await app.inject({
      method: 'GET',
      url: `/event-albums/photos/${photo.id}/download`,
      headers: auth(legend.token),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().url).toBe('https://s3.exemplo.com/assinado')
    // A assinatura leva o nome do arquivo — é ele que vira o Content-Disposition.
    expect(presignDocumentDownload).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'event-photos/company-emr/f1.jpg', fileName: `foto-${photo.id}.jpg` }),
    )
    await app.close()
  })

  it('404 ao baixar foto de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const outro = await makeUser(app, 'ADMIN', ['galeria', 'gente-gestao'], 'company-legends-internal')
    const album = await prisma.eventAlbum.create({
      data: { title: 'De fora', createdById: outro.user.id, companyId: 'company-legends-internal' },
    })
    const photo = await prisma.eventPhoto.create({
      data: {
        album: { connect: { id: album.id } },
        storageKey: 'event-photos/company-legends-internal/f1.jpg',
        uploadedBy: { connect: { id: outro.user.id } },
        company: { connect: { id: 'company-legends-internal' } },
      },
    })
    const legend = await makeUser(app, 'LEGEND', ['galeria'])

    const res = await app.inject({
      method: 'GET',
      url: `/event-albums/photos/${photo.id}/download`,
      headers: auth(legend.token),
    })

    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
