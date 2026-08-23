import { describe, it, expect, vi } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import * as notificationService from '../services/notification-service'

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Ana', email: 'ana@x.com', password: 'changeme123' } })
  const token = reg.json().accessToken as string
  const userId = reg.json().user.id as string
  return { app, token, userId }
}

describe('notification routes', () => {
  it('as rotas exigem autenticação (401)', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/notifications' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/notifications/unread-count' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/notifications/read' })).statusCode).toBe(401)
    await app.close()
  })

  it('unread-count conta apenas as não-lidas do usuário', async () => {
    const { app, token, userId } = await setup()
    await prisma.notification.create({ data: { userId, type: 'PERIOD_OPENED', title: 'a' } })
    await prisma.notification.create({ data: { userId, type: 'PERIOD_CLOSED', title: 'b', readAt: new Date() } })
    const res = await app.inject({ method: 'GET', url: '/notifications/unread-count', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().unreadCount).toBe(1)
    await app.close()
  })

  it('GET /notifications só traz as do próprio usuário e pagina por cursor', async () => {
    const { app, token, userId } = await setup()
    const other = await prisma.user.create({ data: { name: 'Bia', email: 'bia@x.com', passwordHash: 'x' } })
    await prisma.notification.create({ data: { userId: other.id, type: 'PERIOD_OPENED', title: 'de outro' } })
    for (let i = 0; i < 3; i++) {
      await prisma.notification.create({ data: { userId, type: 'PERIOD_OPENED', title: `n${i}` } })
    }

    const page1 = await app.inject({ method: 'GET', url: '/notifications?limit=2', headers: { authorization: `Bearer ${token}` } })
    expect(page1.statusCode).toBe(200)
    expect(page1.json().items).toHaveLength(2)
    expect(page1.json().unreadCount).toBe(3)
    expect(page1.json().nextCursor).not.toBeNull()
    expect(page1.json().items.every((n: { title: string }) => n.title !== 'de outro')).toBe(true)

    const page2 = await app.inject({ method: 'GET', url: `/notifications?limit=2&cursor=${page1.json().nextCursor}`, headers: { authorization: `Bearer ${token}` } })
    expect(page2.json().items).toHaveLength(1)
    expect(page2.json().nextCursor).toBeNull()
    await app.close()
  })

  it('GET /notifications?read filtra por lidas / não-lidas', async () => {
    const { app, token, userId } = await setup()
    await prisma.notification.create({ data: { userId, type: 'PERIOD_OPENED', title: 'nao-lida' } })
    await prisma.notification.create({ data: { userId, type: 'PERIOD_CLOSED', title: 'lida', readAt: new Date() } })

    const unread = await app.inject({ method: 'GET', url: '/notifications?read=false', headers: { authorization: `Bearer ${token}` } })
    expect(unread.json().items.map((n: { title: string }) => n.title)).toEqual(['nao-lida'])

    const read = await app.inject({ method: 'GET', url: '/notifications?read=true', headers: { authorization: `Bearer ${token}` } })
    expect(read.json().items.map((n: { title: string }) => n.title)).toEqual(['lida'])
    expect(read.json().unreadCount).toBe(1)
    await app.close()
  })

  it('POST /notifications/:id/read marca uma só e atualiza o contador', async () => {
    const { app, token, userId } = await setup()
    const a = await prisma.notification.create({ data: { userId, type: 'PERIOD_OPENED', title: 'a' } })
    await prisma.notification.create({ data: { userId, type: 'PERIOD_OPENED', title: 'b' } })

    const res = await app.inject({ method: 'POST', url: `/notifications/${a.id}/read`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().unreadCount).toBe(1)
    expect((await prisma.notification.findUnique({ where: { id: a.id } }))?.readAt).not.toBeNull()
    await app.close()
  })

  it('POST /notifications/:id/read não marca notificação de outro usuário', async () => {
    const { app, token } = await setup()
    const other = await prisma.user.create({ data: { name: 'Bia', email: 'bia3@x.com', passwordHash: 'x' } })
    const alheia = await prisma.notification.create({ data: { userId: other.id, type: 'PERIOD_OPENED', title: 'dela' } })

    const res = await app.inject({ method: 'POST', url: `/notifications/${alheia.id}/read`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect((await prisma.notification.findUnique({ where: { id: alheia.id } }))?.readAt).toBeNull()
    await app.close()
  })

  it('falha ao notificar não derruba a criação de feedback (best-effort)', async () => {
    const { app, token } = await setup()
    const target = await prisma.user.create({ data: { name: 'Alvo', email: 'alvo-be@x.com', passwordHash: 'x', role: 'LEAD' } })
    const spy = vi.spyOn(notificationService, 'notifyFeedbackReceived').mockRejectedValueOnce(new Error('boom'))
    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'Mensagem de feedback suficientemente longa para validar.', category: 'POSITIVO' },
    })
    expect(res.statusCode).toBe(201)
    expect(await prisma.feedback.count({ where: { targetId: target.id } })).toBe(1)
    spy.mockRestore()
    await app.close()
  })

  it('POST /notifications/read zera o contador e não mexe em outro usuário', async () => {
    const { app, token, userId } = await setup()
    const other = await prisma.user.create({ data: { name: 'Bia', email: 'bia2@x.com', passwordHash: 'x' } })
    await prisma.notification.create({ data: { userId, type: 'PERIOD_OPENED', title: 'minha' } })
    await prisma.notification.create({ data: { userId: other.id, type: 'PERIOD_OPENED', title: 'dela' } })

    const res = await app.inject({ method: 'POST', url: '/notifications/read', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().unreadCount).toBe(0)
    expect(await prisma.notification.count({ where: { userId, readAt: null } })).toBe(0)
    expect(await prisma.notification.count({ where: { userId: other.id, readAt: null } })).toBe(1)
    await app.close()
  })

  it('DELETE /notifications/read exige autenticação (401)', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'DELETE', url: '/notifications/read' })).statusCode).toBe(401)
    await app.close()
  })

  it('DELETE /notifications/read remove só as lidas do próprio usuário', async () => {
    const { app, token, userId } = await setup()
    const other = await prisma.user.create({ data: { name: 'Bia', email: 'bia4@x.com', passwordHash: 'x' } })
    const lida = await prisma.notification.create({ data: { userId, type: 'PERIOD_CLOSED', title: 'lida', readAt: new Date() } })
    const naoLida = await prisma.notification.create({ data: { userId, type: 'PERIOD_OPENED', title: 'nao-lida' } })
    const lidaAlheia = await prisma.notification.create({ data: { userId: other.id, type: 'PERIOD_CLOSED', title: 'dela', readAt: new Date() } })

    const res = await app.inject({ method: 'DELETE', url: '/notifications/read', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(204)
    expect(await prisma.notification.findUnique({ where: { id: lida.id } })).toBeNull()
    expect(await prisma.notification.findUnique({ where: { id: naoLida.id } })).not.toBeNull()
    expect(await prisma.notification.findUnique({ where: { id: lidaAlheia.id } })).not.toBeNull()
    await app.close()
  })
})
