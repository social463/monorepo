import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { ONE_ON_ONE_TOPIC_MAX_LENGTH } from '@legends/shared'
import {
  TopicTemplateError,
  createTopicTemplate,
  deleteTopicTemplate,
  listTopicTemplatesAdmin,
  updateTopicTemplate,
} from '../services/one-on-one-topic-admin-service'

const idParams = z.object({ id: z.string().min(1) })
const createSchema = z.object({
  theme: z.string().trim().min(1).max(60),
  text: z.string().trim().min(1).max(ONE_ON_ONE_TOPIC_MAX_LENGTH),
  sortOrder: z.number().int().min(0).max(999).optional(),
})
const patchSchema = createSchema
  .partial()
  .extend({ active: z.boolean().optional() })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nada para atualizar' })

function handle(reply: FastifyReply, err: unknown) {
  if (err instanceof TopicTemplateError) return reply.code(err.status).send({ message: err.message })
  throw err
}

export async function adminOneOnOneTopicRoutes(app: FastifyInstance) {
  // Bloco de Gente e Gestão: ADMIN global sempre; SUBADMIN só com a feature no
  // setor dele. `requireFeature` não serve — liberaria todo SUBADMIN.
  const gate = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  function actorOf(request: { user: { sub: string; companyId: string } }) {
    return { id: request.user.sub, companyId: request.user.companyId }
  }

  app.get('/admin/one-on-one-topics', gate, async (request, reply) => {
    return reply.send({ templates: await listTopicTemplatesAdmin(actorOf(request)) })
  })

  app.post('/admin/one-on-one-topics', gate, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    const template = await createTopicTemplate(actorOf(request), parsed.data)
    return reply.code(201).send({ template })
  })

  app.patch('/admin/one-on-one-topics/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Dados inválidos', issues: params.error.issues })
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    try {
      return reply.send({ template: await updateTopicTemplate(actorOf(request), params.data.id, parsed.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/admin/one-on-one-topics/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Dados inválidos', issues: params.error.issues })
    try {
      await deleteTopicTemplate(actorOf(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handle(reply, err)
    }
  })
}
