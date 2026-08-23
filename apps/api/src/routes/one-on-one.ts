import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  ONE_ON_ONE_ACTION_DESCRIPTION_MAX_LENGTH,
  ONE_ON_ONE_NOTE_MAX_LENGTH,
  ONE_ON_ONE_RECURRENCES,
  ONE_ON_ONE_DECLINE_NOTE_MAX_LENGTH,
  ONE_ON_ONE_TOPIC_MAX_LENGTH,
  ONE_ON_ONE_TOPIC_ORIGINS,
} from '@legends/shared'
import {
  OneOnOneError,
  acceptProposal,
  addTopic,
  cancelMeeting,
  declineProposal,
  respondToInvite,
  createActionItem,
  createSeries,
  deleteTopic,
  getMeeting,
  listCompletedActionsForProfile,
  listMeetings,
  listTopicTemplates,
  markMeetingDone,
  promoteActionToPdi,
  rescheduleMeeting,
  saveNote,
  updateActionItem,
  updateTopic,
} from '../services/one-on-one-service'

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD')
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida')
const idParams = z.object({ id: z.string().min(1) })
const scopeQuery = z.object({ scope: z.enum(['this', 'future']).default('this') })

const respondSchema = z.object({
  // `PENDING` não é resposta: quem responde diz sim ou não.
  response: z.enum(['ACCEPTED', 'DECLINED']),
  proposedStartsAt: z.string().datetime().nullish(),
  declineNote: z.string().max(ONE_ON_ONE_DECLINE_NOTE_MAX_LENGTH).nullish(),
})

const createSchema = z
  .object({
    counterpartId: z.string().min(1),
    date: ymd,
    startTime: hhmm,
    durationMinutes: z.number().int().min(5).max(240),
    recurrence: z.enum(ONE_ON_ONE_RECURRENCES),
    recurrenceUntil: ymd.nullish(),
    recurrenceCount: z.number().int().min(1).max(52).nullish(),
  })
  // Fim por data e fim por contagem são exclusivos — os dois juntos deixam
  // ambíguo qual manda, mesmo problema já resolvido assim em CalendarEvent.
  .refine((input) => !(input.recurrenceUntil && input.recurrenceCount), {
    message: 'Escolha encerrar por data ou por número de encontros, não os dois',
  })

const listQuery = z.object({ from: ymd, to: ymd })
const topicSchema = z.object({
  text: z.string().trim().min(1).max(ONE_ON_ONE_TOPIC_MAX_LENGTH),
  origin: z.enum(ONE_ON_ONE_TOPIC_ORIGINS).default('CUSTOM'),
})
const topicPatchSchema = z
  .object({
    text: z.string().trim().min(1).max(ONE_ON_ONE_TOPIC_MAX_LENGTH).optional(),
    discussed: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nada para atualizar' })
const noteSchema = z.object({ body: z.string().max(ONE_ON_ONE_NOTE_MAX_LENGTH) })
const actionSchema = z.object({
  description: z.string().trim().min(1).max(ONE_ON_ONE_ACTION_DESCRIPTION_MAX_LENGTH),
  ownerId: z.string().min(1),
  dueDate: ymd.nullish(),
})
const actionPatchSchema = z
  .object({
    description: z.string().trim().min(1).max(ONE_ON_ONE_ACTION_DESCRIPTION_MAX_LENGTH).optional(),
    ownerId: z.string().min(1).optional(),
    dueDate: ymd.nullable().optional(),
    status: z.enum(['OPEN', 'DONE']).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nada para atualizar' })
const rescheduleSchema = z.object({
  date: ymd,
  startTime: hhmm,
  durationMinutes: z.number().int().min(5).max(240),
})

function badInput(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ message: 'Dados inválidos', issues: error.issues })
}

export async function oneOnOneRoutes(app: FastifyInstance) {
  const gate = { onRequest: [app.authenticate, app.requireFeature('um-a-um')] }

  function viewerOf(request: { user: { sub: string; companyId: string } }) {
    return { userId: request.user.sub, companyId: request.user.companyId }
  }

  function handle(reply: FastifyReply, err: unknown) {
    if (err instanceof OneOnOneError) return reply.code(err.status).send({ message: err.message })
    throw err
  }

  app.get('/one-on-ones', gate, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return badInput(reply, parsed.error)
    const meetings = await listMeetings(viewerOf(request), parsed.data.from, parsed.data.to)
    return reply.send({ meetings })
  })

  // Antes de `/one-on-ones/:id`: senão `topic-templates` cairia no parâmetro.
  app.get('/one-on-ones/topic-templates', gate, async (request, reply) => {
    return reply.send({ templates: await listTopicTemplates(request.user.companyId) })
  })

  /**
   * Combinados concluídos que alimentam a seção do perfil. O recorte de quem vê
   * o quê é do service — aqui só chega o id do perfil aberto. Também antes de
   * `/one-on-ones/:id`, pelo mesmo motivo do catálogo.
   */
  app.get('/one-on-ones/completed-actions/:userId', gate, async (request, reply) => {
    const params = z.object({ userId: z.string().min(1) }).safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const actions = await listCompletedActionsForProfile(viewerOf(request), params.data.userId)
    return reply.send({ actions })
  })

  app.post('/one-on-ones', gate, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const criado = await createSeries(viewerOf(request), parsed.data)
      return reply.code(201).send(criado)
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/one-on-ones/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    try {
      return reply.send(await getMeeting(viewerOf(request), params.data.id))
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/one-on-ones/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const scope = scopeQuery.safeParse(request.query)
    if (!scope.success) return badInput(reply, scope.error)
    const parsed = rescheduleSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const meetings = await rescheduleMeeting(viewerOf(request), params.data.id, parsed.data, scope.data.scope)
      return reply.send({ meetings })
    } catch (err) {
      return handle(reply, err)
    }
  })

  /**
   * Resposta do CONVIDADO ao convite. O escopo viaja na query, como em remarcar
   * e cancelar — mas o PADRÃO de cada ação é diferente e mora no front: aceitar
   * assume a série, recusar assume só esta ocorrência.
   */
  app.post('/one-on-ones/:id/response', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const scope = scopeQuery.safeParse(request.query)
    if (!scope.success) return badInput(reply, scope.error)
    const parsed = respondSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const meeting = await respondToInvite(viewerOf(request), params.data.id, parsed.data, scope.data.scope)
      return reply.send({ meeting })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/one-on-ones/:id/proposal/accept', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const scope = scopeQuery.safeParse(request.query)
    if (!scope.success) return badInput(reply, scope.error)
    try {
      const meeting = await acceptProposal(viewerOf(request), params.data.id, scope.data.scope)
      return reply.send({ meeting })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/one-on-ones/:id/proposal/decline', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    try {
      const meeting = await declineProposal(viewerOf(request), params.data.id)
      return reply.send({ meeting })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/one-on-ones/:id/done', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    try {
      return reply.send({ meeting: await markMeetingDone(viewerOf(request), params.data.id) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/one-on-ones/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const scope = scopeQuery.safeParse(request.query)
    if (!scope.success) return badInput(reply, scope.error)
    try {
      await cancelMeeting(viewerOf(request), params.data.id, scope.data.scope)
      return reply.code(204).send()
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/one-on-ones/:id/topics', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const parsed = topicSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const topic = await addTopic(viewerOf(request), params.data.id, parsed.data)
      return reply.code(201).send({ topic })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/one-on-ones/topics/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const parsed = topicPatchSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      return reply.send({ topic: await updateTopic(viewerOf(request), params.data.id, parsed.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/one-on-ones/topics/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    try {
      await deleteTopic(viewerOf(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.put('/one-on-ones/:id/note', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const parsed = noteSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const note = await saveNote(viewerOf(request), params.data.id, parsed.data.body)
      return reply.send({ note })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/one-on-ones/:id/actions', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const parsed = actionSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const action = await createActionItem(viewerOf(request), params.data.id, {
        description: parsed.data.description,
        ownerId: parsed.data.ownerId,
        dueDate: parsed.data.dueDate ?? null,
      })
      return reply.code(201).send({ action })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/one-on-ones/actions/:id', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const parsed = actionPatchSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      return reply.send({ action: await updateActionItem(viewerOf(request), params.data.id, parsed.data) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/one-on-ones/actions/:id/promote-to-pdi', gate, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    try {
      return reply.send({ action: await promoteActionToPdi(viewerOf(request), params.data.id) })
    } catch (err) {
      return handle(reply, err)
    }
  })
}
