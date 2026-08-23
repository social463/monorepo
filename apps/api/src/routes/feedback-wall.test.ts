import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { createSector } from '../services/sector-service'

const LONG = 'Conduziu o incidente com calma e comunicou o time a cada 15 minutos.'

async function register(app: FastifyInstance, name: string, email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name, email, password: 'changeme123' },
  })
  return { token: res.json().accessToken as string, id: res.json().user.id as string }
}

/** Autor deixa um feedback para `targetId` e o destinatário compartilha no mural. */
async function shareFeedback(
  app: FastifyInstance,
  authorToken: string,
  targetId: string,
  targetToken: string,
  message = LONG,
) {
  const created = await app.inject({
    method: 'POST',
    url: `/users/${targetId}/feedbacks`,
    headers: { authorization: `Bearer ${authorToken}` },
    payload: { message, category: 'POSITIVO' },
  })
  const id = created.json().feedback.id as string
  await app.inject({
    method: 'POST',
    url: `/feedbacks/${id}/share`,
    headers: { authorization: `Bearer ${targetToken}` },
  })
  return id
}

async function makeSector(name: string) {
  const admin = await prisma.user.create({
    data: { name: 'admin', email: `admin-${name}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  const sector = await createSector({ name, enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
  return sector.id
}

describe('GET /feedbacks/mural', () => {
  it('exige autenticação (401)', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/feedbacks/mural' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('devolve o feedback compartilhado com autor e destinatário', async () => {
    const app = buildApp()
    await app.ready()
    const author = await register(app, 'Autor', 'wall-a@x.com')
    const target = await register(app, 'Alvo', 'wall-t@x.com')
    const id = await shareFeedback(app, author.token, target.id, target.token)

    const res = await app.inject({
      method: 'GET',
      url: '/feedbacks/mural',
      headers: { authorization: `Bearer ${author.token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      feedbacks: { id: string; author: { name: string }; target: { name: string }; sharedAt: string }[]
      hasMore: boolean
    }
    expect(body.feedbacks).toHaveLength(1)
    expect(body.feedbacks[0].id).toBe(id)
    expect(body.feedbacks[0].author.name).toBe('Autor')
    expect(body.feedbacks[0].target.name).toBe('Alvo')
    expect(body.feedbacks[0].sharedAt).toBeTruthy()
    expect(body.hasMore).toBe(false)
    await app.close()
  })

  it('não devolve feedback que o destinatário ainda não compartilhou', async () => {
    const app = buildApp()
    await app.ready()
    const author = await register(app, 'Autor', 'wall-a2@x.com')
    const target = await register(app, 'Alvo', 'wall-t2@x.com')
    await app.inject({
      method: 'POST',
      url: `/users/${target.id}/feedbacks`,
      headers: { authorization: `Bearer ${author.token}` },
      payload: { message: LONG, category: 'POSITIVO' },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/feedbacks/mural',
      headers: { authorization: `Bearer ${author.token}` },
    })
    expect(res.json().feedbacks).toHaveLength(0)
    await app.close()
  })

  it('atravessa setores — o mural é de toda a empresa', async () => {
    const app = buildApp()
    await app.ready()
    const outroSetor = await makeSector('Outro Setor Mural')
    const author = await register(app, 'Autor', 'wall-a3@x.com')
    const target = await register(app, 'Alvo', 'wall-t3@x.com')
    await prisma.user.update({ where: { id: target.id }, data: { sectorId: outroSetor } })
    const id = await shareFeedback(app, author.token, target.id, target.token)

    const res = await app.inject({
      method: 'GET',
      url: '/feedbacks/mural',
      headers: { authorization: `Bearer ${author.token}` },
    })
    expect(res.json().feedbacks.map((f: { id: string }) => f.id)).toEqual([id])
    await app.close()
  })

  it('pagina por offset/limit sinalizando hasMore', async () => {
    const app = buildApp()
    await app.ready()
    const author = await register(app, 'Autor', 'wall-a4@x.com')
    const target = await register(app, 'Alvo', 'wall-t4@x.com')
    const primeiro = await shareFeedback(app, author.token, target.id, target.token, `${LONG} 1`)
    const segundo = await shareFeedback(app, author.token, target.id, target.token, `${LONG} 2`)
    // Os dois compartilhamentos podem cair no mesmo milissegundo; cravamos a ordem.
    await prisma.feedback.update({
      where: { id: primeiro },
      data: { sharedAt: new Date(Date.now() - 60_000) },
    })

    const page1 = await app.inject({
      method: 'GET',
      url: '/feedbacks/mural?offset=0&limit=1',
      headers: { authorization: `Bearer ${author.token}` },
    })
    expect(page1.json().hasMore).toBe(true)
    expect(page1.json().feedbacks.map((f: { id: string }) => f.id)).toEqual([segundo])

    const page2 = await app.inject({
      method: 'GET',
      url: '/feedbacks/mural?offset=1&limit=1',
      headers: { authorization: `Bearer ${author.token}` },
    })
    expect(page2.json().hasMore).toBe(false)
    expect(page2.json().feedbacks.map((f: { id: string }) => f.id)).toEqual([primeiro])
    await app.close()
  })
})

describe('GET /users/company', () => {
  it('exige autenticação (401)', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/users/company' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('lista colegas de outros setores (ao contrário de /users) e omite o próprio usuário', async () => {
    const app = buildApp()
    await app.ready()
    const outroSetor = await makeSector('Outro Setor Colegas')
    const me = await register(app, 'Eu', 'company-me@x.com')
    const colega = await register(app, 'Colega', 'company-peer@x.com')
    await prisma.user.update({ where: { id: colega.id }, data: { sectorId: outroSetor } })

    const res = await app.inject({
      method: 'GET',
      url: '/users/company',
      headers: { authorization: `Bearer ${me.token}` },
    })
    expect(res.statusCode).toBe(200)
    const ids = (res.json().users as { id: string }[]).map((u) => u.id)
    expect(ids).toContain(colega.id)
    expect(ids).not.toContain(me.id)

    const sameSectorOnly = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { authorization: `Bearer ${me.token}` },
    })
    expect((sameSectorOnly.json().users as { id: string }[]).map((u) => u.id)).not.toContain(colega.id)
    await app.close()
  })

  it('não lista administradores', async () => {
    const app = buildApp()
    await app.ready()
    const me = await register(app, 'Eu', 'company-me2@x.com')
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: 'company-admin@x.com', passwordHash: 'x', role: 'ADMIN' },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/users/company',
      headers: { authorization: `Bearer ${me.token}` },
    })
    expect((res.json().users as { id: string }[]).map((u) => u.id)).not.toContain(admin.id)
    await app.close()
  })
})
