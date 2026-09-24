import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  APPRENTICE_ACTIVITY_KINDS,
  APPRENTICE_CONTRACT_CLAUSE_MAX_LENGTH,
  APPRENTICE_CONTRACT_MAX_CLAUSES,
  APPRENTICE_FIELD_TYPES,
  APPRENTICE_TASK_CATEGORIES,
  APPRENTICE_TASK_COLUMNS,
  APPRENTICE_TASK_MAX_ITEMS,
  APPRENTICE_TASK_TITLE_MAX_LENGTH,
  type ApprenticeActivitySchema,
} from '@legends/shared'
import { apprenticeContextOf } from '../lib/apprentice-context'
import { handleApprenticeError } from './apprentice'
import {
  addApprenticeMaterial,
  createApprenticeActivity,
  createApprenticeClass,
  createApprenticeMakeup,
  createApprenticeMeeting,
  deleteApprenticeActivity,
  deleteApprenticeClass,
  deleteApprenticeMakeup,
  deleteApprenticeMeeting,
  getApprenticeOverview,
  getApprenticeProgress,
  listApprenticeActivities,
  listApprenticeAttendance,
  listApprenticeClasses,
  listApprenticeMakeups,
  listApprenticeMeetings,
  markAllPresent,
  removeApprenticeMaterial,
  setApprenticeAttendance,
  setApprenticeEnrollment,
  toggleApprenticeMeetingFlag,
  updateApprenticeActivity,
  updateApprenticeContract,
  updateApprenticeMeeting,
} from '../services/apprentice-admin-service'
import { listApprenticePeople } from '../services/apprentice-service'
import {
  createApprenticeSectorMove,
  deleteApprenticeSectorMove,
  listApprenticeJourneys,
  saveApprenticeJourney,
} from '../services/apprentice-journey-service'
import {
  createApprenticeTask,
  deleteApprenticeTask,
  listApprenticeTasks,
  toggleApprenticeTaskItem,
  updateApprenticeTask,
} from '../services/apprentice-task-service'

const idParams = z.object({ id: z.string().min(1) })
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.')

/**
 * O schema da ficha é recursivo (campo `lista` tem subcampos), mas de um nível
 * só: lista dentro de lista não tem tela que renderize, então o Zod para aqui de
 * propósito em vez de aceitar uma árvore que o formulário ignoraria.
 */
const leafFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  type: z.enum(APPRENTICE_FIELD_TYPES),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  rows: z.number().int().min(1).max(20).optional(),
  required: z.boolean().optional(),
})

const fieldSchema = leafFieldSchema.extend({
  fields: z.array(leafFieldSchema).optional(),
  items: z.number().int().min(1).max(20).optional(),
})

const blockSchema = z.object({
  number: z.number().int().optional(),
  title: z.string().min(1),
  time: z.string().optional(),
  note: z.string().optional(),
  highlight: z.boolean().optional(),
  items: z.array(z.object({ title: z.string().optional(), lines: z.array(z.string()) })).optional(),
  fields: z.array(fieldSchema).optional(),
})

const activitySchemaSchema = z.object({
  eyebrow: z.string().optional(),
  subtitle: z.string().optional(),
  footer: z.string().optional(),
  blocks: z.array(blockSchema),
})

const meetingSchema = z.object({
  order: z.number().int().min(1).optional(),
  title: z.string().min(1),
  theme: z.string().default(''),
  objectives: z.array(z.string()).default([]),
  deliverable: z.string().default(''),
  scheduledOn: ymd.nullable().optional(),
  slideUrl: z.string().nullable().optional(),
  slideKey: z.string().nullable().optional(),
  slideFileName: z.string().nullable().optional(),
})

export async function apprenticeAdminRoutes(app: FastifyInstance) {
  // Bloco de administração por setor: ADMIN pleno sempre, e o SUBADMIN só com
  // `gente-gestao` ligada no setor dele — é o "Facilitador (Gente & Gestão)".
  const guard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  // ---- Turmas e matrículas ----

  app.get('/admin/apprentice/classes', guard, async (request, reply) => {
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await listApprenticeClasses(context.companyId))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.post('/admin/apprentice/classes', guard, async (request, reply) => {
    const parsed = z
      .object({ name: z.string().min(1), shift: z.string().nullable().optional() })
      .safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const context = await apprenticeContextOf(request)
      return reply.code(201).send(await createApprenticeClass(context.companyId, parsed.data))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.delete('/admin/apprentice/classes/:id', guard, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const context = await apprenticeContextOf(request)
      await deleteApprenticeClass(context.companyId, parsed.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.put('/admin/apprentice/enrollments', guard, async (request, reply) => {
    const parsed = z
      .object({ userId: z.string().min(1), classId: z.string().min(1).nullable() })
      .safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const context = await apprenticeContextOf(request)
      await setApprenticeEnrollment(context.companyId, parsed.data.userId, parsed.data.classId)
      return reply.send(await listApprenticePeople(context.companyId))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  // ---- Encontros ----

  app.get('/admin/apprentice/meetings', guard, async (request, reply) => {
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await listApprenticeMeetings(context.companyId))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.post('/admin/apprentice/meetings', guard, async (request, reply) => {
    const parsed = meetingSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const context = await apprenticeContextOf(request)
      return reply.code(201).send(await createApprenticeMeeting(context.companyId, parsed.data))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.patch('/admin/apprentice/meetings/:id', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = meetingSchema.partial().safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.' })
    }
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await updateApprenticeMeeting(context.companyId, params.data.id, body.data))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.delete('/admin/apprentice/meetings/:id', guard, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const context = await apprenticeContextOf(request)
      await deleteApprenticeMeeting(context.companyId, parsed.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.put('/admin/apprentice/meetings/:id/flags', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = z
      .object({ flag: z.enum(['accessReleased', 'surveyOpen']), value: z.boolean() })
      .safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.' })
    }
    try {
      const context = await apprenticeContextOf(request)
      const updated = await toggleApprenticeMeetingFlag(
        context.companyId,
        params.data.id,
        body.data.flag,
        body.data.value,
      )
      return reply.send(updated)
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  // ---- Materiais ----

  app.post('/admin/apprentice/meetings/:id/materials', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = z
      .object({
        name: z.string().min(1),
        url: z.string().nullable().optional(),
        documentKey: z.string().nullable().optional(),
        fileName: z.string().nullable().optional(),
        contentType: z.string().nullable().optional(),
        sizeBytes: z.number().int().nullable().optional(),
      })
      .safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.' })
    }
    try {
      const context = await apprenticeContextOf(request)
      await addApprenticeMaterial(context.companyId, params.data.id, body.data)
      return reply.code(201).send()
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.delete('/admin/apprentice/materials/:id', guard, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const context = await apprenticeContextOf(request)
      await removeApprenticeMaterial(context.companyId, parsed.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  // ---- Fichas ----

  app.get('/admin/apprentice/activities', guard, async (request, reply) => {
    const query = z.object({ meetingId: z.string().min(1).optional() }).safeParse(request.query)
    if (!query.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await listApprenticeActivities(context.companyId, query.data.meetingId))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.post('/admin/apprentice/activities', guard, async (request, reply) => {
    const parsed = z
      .object({
        meetingId: z.string().min(1),
        title: z.string().min(1),
        kind: z.enum(APPRENTICE_ACTIVITY_KINDS).optional(),
        order: z.number().int().optional(),
        schema: activitySchemaSchema,
      })
      .safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const context = await apprenticeContextOf(request)
      const created = await createApprenticeActivity(context.companyId, {
        ...parsed.data,
        schema: parsed.data.schema as ApprenticeActivitySchema,
      })
      return reply.code(201).send(created)
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.patch('/admin/apprentice/activities/:id', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = z
      .object({
        title: z.string().min(1).optional(),
        kind: z.enum(APPRENTICE_ACTIVITY_KINDS).optional(),
        order: z.number().int().optional(),
        schema: activitySchemaSchema.optional(),
      })
      .safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.' })
    }
    try {
      const context = await apprenticeContextOf(request)
      const updated = await updateApprenticeActivity(context.companyId, params.data.id, {
        ...body.data,
        ...(body.data.schema ? { schema: body.data.schema as ApprenticeActivitySchema } : {}),
      })
      return reply.send(updated)
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.delete('/admin/apprentice/activities/:id', guard, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const context = await apprenticeContextOf(request)
      await deleteApprenticeActivity(context.companyId, parsed.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  // ---- Chamada e reposição ----

  app.get('/admin/apprentice/meetings/:id/attendance', guard, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await listApprenticeAttendance(context.companyId, parsed.data.id))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.put('/admin/apprentice/meetings/:id/attendance', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = z
      .object({
        userId: z.string().min(1),
        present: z.boolean().nullable(),
        justification: z.string().nullable().optional(),
        needsMakeup: z.boolean().optional(),
      })
      .safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.' })
    }
    try {
      const context = await apprenticeContextOf(request)
      const rows = await setApprenticeAttendance(context, params.data.id, body.data.userId, body.data)
      return reply.send(rows)
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.post('/admin/apprentice/meetings/:id/attendance/all-present', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = z.object({ classId: z.string().min(1).nullable().default(null) }).safeParse(request.body ?? {})
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.' })
    }
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await markAllPresent(context, params.data.id, body.data.classId))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.get('/admin/apprentice/makeups', guard, async (request, reply) => {
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await listApprenticeMakeups(context.companyId))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.post('/admin/apprentice/makeups', guard, async (request, reply) => {
    const parsed = z
      .object({
        meetingId: z.string().min(1),
        scheduledAt: z.string().min(1),
        userIds: z.array(z.string().min(1)).min(1),
      })
      .safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const context = await apprenticeContextOf(request)
      return reply.code(201).send(await createApprenticeMakeup(context, parsed.data))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.delete('/admin/apprentice/makeups/:id', guard, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const context = await apprenticeContextOf(request)
      await deleteApprenticeMakeup(context.companyId, parsed.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  // ---- Jornada e movimentações ----

  app.get('/admin/apprentice/journeys', guard, async (request, reply) => {
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await listApprenticeJourneys(context.companyId))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.put('/admin/apprentice/journeys/:id', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = z
      .object({
        contractEndsOn: ymd.nullable().optional(),
        activities: z.string().optional(),
        notes: z.string().nullable().optional(),
      })
      .safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.' })
    }
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await saveApprenticeJourney(context, params.data.id, body.data))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.post('/admin/apprentice/sector-moves', guard, async (request, reply) => {
    const parsed = z
      .object({
        userId: z.string().min(1),
        fromSector: z.string().optional(),
        toSector: z.string().min(1),
        movedOn: ymd,
        reason: z.string().optional(),
        responsibles: z.string().optional(),
      })
      .safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const context = await apprenticeContextOf(request)
      return reply.code(201).send(await createApprenticeSectorMove(context, parsed.data))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.delete('/admin/apprentice/sector-moves/:id', guard, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const context = await apprenticeContextOf(request)
      await deleteApprenticeSectorMove(context.companyId, parsed.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  // ---- Quadro de gestão ----

  app.get('/admin/apprentice/tasks', guard, async (request, reply) => {
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await listApprenticeTasks(context.companyId))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.post('/admin/apprentice/tasks', guard, async (request, reply) => {
    const parsed = z
      .object({
        title: z.string().min(1).max(APPRENTICE_TASK_TITLE_MAX_LENGTH),
        category: z.enum(APPRENTICE_TASK_CATEGORIES).optional(),
        meetingId: z.string().min(1).nullable().optional(),
        dueOn: ymd.nullable().optional(),
        items: z.array(z.string()).max(APPRENTICE_TASK_MAX_ITEMS).optional(),
      })
      .safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const context = await apprenticeContextOf(request)
      return reply.code(201).send(await createApprenticeTask(context, parsed.data))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.patch('/admin/apprentice/tasks/:id', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = z
      .object({
        title: z.string().min(1).optional(),
        category: z.enum(APPRENTICE_TASK_CATEGORIES).optional(),
        meetingId: z.string().min(1).nullable().optional(),
        dueOn: ymd.nullable().optional(),
        boardColumn: z.enum(APPRENTICE_TASK_COLUMNS).optional(),
        sortOrder: z.number().int().optional(),
      })
      .safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.' })
    }
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await updateApprenticeTask(context.companyId, params.data.id, body.data))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.delete('/admin/apprentice/tasks/:id', guard, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const context = await apprenticeContextOf(request)
      await deleteApprenticeTask(context.companyId, parsed.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.put('/admin/apprentice/task-items/:id', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = z.object({ done: z.boolean() }).safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.' })
    }
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(
        await toggleApprenticeTaskItem(context.companyId, params.data.id, body.data.done),
      )
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  // ---- Contrato e painel ----

  app.put('/admin/apprentice/contract', guard, async (request, reply) => {
    const parsed = z
      .object({
        clauses: z
          .array(z.string().max(APPRENTICE_CONTRACT_CLAUSE_MAX_LENGTH))
          .max(APPRENTICE_CONTRACT_MAX_CLAUSES),
      })
      .safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const context = await apprenticeContextOf(request)
      return reply.send({ clauses: await updateApprenticeContract(context, parsed.data.clauses) })
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.get('/admin/apprentice/overview', guard, async (request, reply) => {
    const query = z
      .object({
        meetingId: z.string().min(1).optional(),
        classId: z.string().min(1).optional(),
        userId: z.string().min(1).optional(),
      })
      .safeParse(request.query)
    if (!query.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await getApprenticeOverview(context.companyId, query.data))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.get('/admin/apprentice/meetings/:id/progress', guard, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const context = await apprenticeContextOf(request)
      return reply.send(await getApprenticeProgress(context.companyId, parsed.data.id))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })
}
