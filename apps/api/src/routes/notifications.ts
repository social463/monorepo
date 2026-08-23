import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { clearRead, countUnread, listNotifications, markAllRead, markRead } from '../services/notification-service'
import { toNotificationDTO } from '../lib/serialize'

const listQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  read: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
})

const idParamsSchema = z.object({ id: z.string().min(1) })

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/notifications/unread-count', { onRequest: [app.authenticate, app.requireFeature('notificacoes')] }, async (request, reply) => {
    const unreadCount = await countUnread(request.user.sub, request.user.companyId)
    return reply.send({ unreadCount })
  })

  app.get('/notifications', { onRequest: [app.authenticate, app.requireFeature('notificacoes')] }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: parsed.error.flatten() })
    }
    const { items, nextCursor, unreadCount } = await listNotifications(request.user.sub, request.user.companyId, {
      cursor: parsed.data.cursor,
      limit: parsed.data.limit ?? 20,
      read: parsed.data.read,
    })
    return reply.send({ items: items.map(toNotificationDTO), nextCursor, unreadCount })
  })

  app.post('/notifications/read', { onRequest: [app.authenticate, app.requireFeature('notificacoes')] }, async (request, reply) => {
    await markAllRead(request.user.sub, request.user.companyId)
    return reply.send({ unreadCount: 0 })
  })

  app.delete('/notifications/read', { onRequest: [app.authenticate, app.requireFeature('notificacoes')] }, async (request, reply) => {
    await clearRead(request.user.sub, request.user.companyId)
    return reply.code(204).send()
  })

  app.post('/notifications/:id/read', { onRequest: [app.authenticate, app.requireFeature('notificacoes')] }, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: parsed.error.flatten() })
    }
    await markRead(request.user.sub, request.user.companyId, parsed.data.id)
    const unreadCount = await countUnread(request.user.sub, request.user.companyId)
    return reply.send({ unreadCount })
  })
}
