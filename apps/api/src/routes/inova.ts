import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  AGENT_MESSAGE_MAX_LENGTH,
  INOVA_ADMIN_CHAT_MAX_PROJECT_IDS,
  INOVA_GUIA_VIDEO_BEHAVIOR_MAX_LENGTH,
  INOVA_GUIA_VIDEO_CATEGORY_MAX_LENGTH,
  INOVA_GUIA_VIDEO_DESCRIPTION_MAX_LENGTH,
  INOVA_GUIA_VIDEO_DURATION_MAX_LENGTH,
  INOVA_GUIA_VIDEO_TITLE_MAX_LENGTH,
  INOVA_PROJECT_PHASES,
  type InovaProjectPhase,
} from '@legends/shared'
import { AgentError } from '../lib/agent-error'
import { toAgentConversationDTO, toAgentConversationSummaryDTO } from '../lib/serialize'
import { askAgent, getConversation, listConversations } from '../services/agent-service'
import { captureFor } from '../lib/analytics/request'
import {
  InovaError,
  addInovaDiaryEntry,
  changeInovaProjectPhase,
  createInovaGuiaVideoCard,
  createInovaProject,
  createInovaProjectTask,
  deleteInovaDiaryEntry,
  deleteInovaGuiaVideo,
  deleteInovaProject,
  deleteInovaProjectTask,
  ensureInovaModuleEnabled,
  getInovaProjectDetail,
  listInovaGuiaVideos,
  listInovaProjects,
  updateInovaProject,
  updateInovaProjectTask,
  updateInovaProjectTaskStatus,
  upsertInovaGuiaVideo,
} from '../services/inova-service'

const phaseValues = INOVA_PROJECT_PHASES.map((p) => p.value) as [string, ...string[]]

const projectInputSchema = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  sector: z.string().min(1),
  description: z.string().min(1),
  problemDescription: z.string().nullable().optional(),
  results: z.string().nullable().optional(),
  hoursSaved: z.number().nullable().optional(),
  costReduction: z.number().nullable().optional(),
  otherMetrics: z.string().nullable().optional(),
  projectCosts: z.string().nullable().optional(),
  toolsUsed: z.string().nullable().optional(),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida.')
    .nullable()
    .optional(),
  priority: z.boolean().optional(),
  leadershipChallenge: z.boolean().optional(),
  estimatedDeadline: z.string().nullable().optional(),
  sectorRepresentative: z.string().nullable().optional(),
  responsible1Id: z.string().nullable().optional(),
  responsible2Id: z.string().nullable().optional(),
})

const updateProjectSchema = projectInputSchema.partial().extend({
  archived: z.boolean().optional(),
})

const phaseSchema = z.object({
  phase: z.enum(phaseValues),
  note: z.string().optional(),
})

const diaryEntrySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  learnings: z.string().optional(),
  tools: z.string().optional(),
  imageUrls: z.array(z.string().url()).optional(),
  videoLinks: z.array(z.string().url()).optional(),
  externalLinks: z.array(z.string().url()).optional(),
})

const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida.')

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  responsible: z.string().optional(),
  dueDate: dueDateSchema.optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE']).optional(),
})

const taskPatchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  responsible: z.string().nullable().optional(),
  dueDate: dueDateSchema.nullable().optional(),
})

const inovaGuiaVideoPatchSchema = z.object({
  title: z.string().min(1).max(INOVA_GUIA_VIDEO_TITLE_MAX_LENGTH).nullable().optional(),
  description: z.string().max(INOVA_GUIA_VIDEO_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  category: z.string().max(INOVA_GUIA_VIDEO_CATEGORY_MAX_LENGTH).nullable().optional(),
  duration: z.string().max(INOVA_GUIA_VIDEO_DURATION_MAX_LENGTH).nullable().optional(),
  behavior: z.string().max(INOVA_GUIA_VIDEO_BEHAVIOR_MAX_LENGTH).nullable().optional(),
  videoUrl: z.string().url().nullable().optional(),
  storagePath: z.string().min(1).nullable().optional(),
})

const taskStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE']),
})

export async function inovaRoutes(app: FastifyInstance) {
  /**
   * Quem está agindo, no formato que o service entende. Papel e acesso
   * delegado vêm do JWT; o dono do projeto é resolvido linha a linha, porque
   * cadastrar projeto é de qualquer colaborador.
   */
  const actorOf = (request: { user: { sub: string; role: string; adminAccess?: boolean } }) => ({
    id: request.user.sub,
    role: request.user.role,
    adminAccess: request.user.adminAccess,
  })

  app.get('/inova/projects', { onRequest: [app.authenticate] }, async (request, reply) => {
    const archived = (request.query as { archived?: string }).archived === 'true'
    const projects = await listInovaProjects(request.user.companyId, { archived })
    return reply.send({ projects })
  })

  app.get('/inova/projects/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      return reply.send(await getInovaProjectDetail(request.user.companyId, id))
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // Cadastrar projeto é de QUALQUER colaborador: a comunidade é da empresa
  // inteira, e quem tem a ideia é quem está no problema. O que continua
  // restrito é mexer no projeto dos outros — a checagem é por projeto, no
  // service (`canManageInovaProject`).
  app.post(
    '/inova/projects',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const parsed = projectInputSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
      try {
        const project = await createInovaProject({
          ...parsed.data,
          deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null,
          companyId: request.user.companyId,
          actorId: request.user.sub,
        })
        return reply.send({ project })
      } catch (err) {
        if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )

  app.patch(
    '/inova/projects/:id',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = updateProjectSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
      try {
        const project = await updateInovaProject({
          ...parsed.data,
          deadline: parsed.data.deadline === undefined ? undefined : parsed.data.deadline === null ? null : new Date(parsed.data.deadline),
          id,
          companyId: request.user.companyId,
          actor: actorOf(request),
        })
        return reply.send({ project })
      } catch (err) {
        if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )

  app.patch(
    '/inova/projects/:id/phase',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = phaseSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
      try {
        const project = await changeInovaProjectPhase({
          id,
          phase: parsed.data.phase as InovaProjectPhase,
          note: parsed.data.note,
          companyId: request.user.companyId,
          actor: actorOf(request),
        })
        return reply.send({ project })
      } catch (err) {
        if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )

  app.delete('/inova/projects/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteInovaProject({ id, companyId: request.user.companyId, actor: actorOf(request) })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/inova/diary/:entryId', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { entryId } = request.params as { entryId: string }
    try {
      await deleteInovaDiaryEntry({ entryId, companyId: request.user.companyId, actor: actorOf(request) })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/inova/tasks/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteInovaProjectTask({ taskId: id, companyId: request.user.companyId, actor: actorOf(request) })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/inova/projects/:id/diary', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = diaryEntrySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    try {
      const entry = await addInovaDiaryEntry({
        ...parsed.data,
        projectId: id,
        companyId: request.user.companyId,
        actorId: request.user.sub,
      })
      return reply.send({ entry })
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/inova/projects/:id/tasks', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = taskSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    try {
      const task = await createInovaProjectTask({
        ...parsed.data,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        projectId: id,
        companyId: request.user.companyId,
        actorId: request.user.sub,
      })
      return reply.send({ task })
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/inova/tasks/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = taskPatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    const { dueDate, ...rest } = parsed.data
    try {
      const task = await updateInovaProjectTask({
        ...rest,
        dueDate: dueDate === undefined ? undefined : dueDate === null ? null : new Date(dueDate),
        taskId: id,
        companyId: request.user.companyId,
        actorId: request.user.sub,
      })
      return reply.send({ task })
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/inova/tasks/:id/status', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = taskStatusSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    try {
      const task = await updateInovaProjectTaskStatus({
        taskId: id,
        status: parsed.data.status,
        companyId: request.user.companyId,
        actorId: request.user.sub,
      })
      return reply.send({ task })
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  const askChatSchema = z.object({
    conversationId: z.string().min(1).optional(),
    message: z.string().trim().min(1).max(AGENT_MESSAGE_MAX_LENGTH),
    // Recorte do painel (setor/período). Ausente = empresa inteira.
    projectIds: z.array(z.string().min(1)).max(INOVA_ADMIN_CHAT_MAX_PROJECT_IDS).optional(),
  })

  function handleChatError(err: unknown, reply: FastifyReply) {
    if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
    if (err instanceof AgentError) return reply.code(err.status).send({ message: err.message })
    throw err
  }

  app.post(
    '/inova/admin/chat/ask',
    { onRequest: [app.authenticate, app.requireAdminOrSubadmin] },
    async (request, reply) => {
      const parsed = askChatSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
      }
      // Medimos também a chamada que falha: empresa sem chave cadastrada
      // responde 503, e uma série de `error` é justamente o sinal de que
      // alguém está tentando usar o agente e esbarrando na configuração.
      const startedAt = Date.now()
      try {
        await ensureInovaModuleEnabled(request.user.companyId)
        const conversation = await askAgent({
          actor: { id: request.user.sub, companyId: request.user.companyId },
          agent: 'inova',
          conversationId: parsed.data.conversationId,
          message: parsed.data.message,
          scope: parsed.data.projectIds ? { inovaProjectIds: parsed.data.projectIds } : undefined,
        })
        captureFor(request, 'ai_agent_invoked', {
          agent: 'inova',
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        })
        return reply.send({ conversation: toAgentConversationDTO(conversation) })
      } catch (err) {
        captureFor(request, 'ai_agent_invoked', {
          agent: 'inova',
          outcome: 'error',
          durationMs: Date.now() - startedAt,
        })
        return handleChatError(err, reply)
      }
    },
  )

  app.get(
    '/inova/admin/chat/conversations',
    { onRequest: [app.authenticate, app.requireAdminOrSubadmin] },
    async (request, reply) => {
      const startedAt = Date.now()
      try {
        await ensureInovaModuleEnabled(request.user.companyId)
        const conversations = await listConversations({ id: request.user.sub, companyId: request.user.companyId }, 'inova')
        captureFor(request, 'ai_agent_invoked', {
          agent: 'inova',
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        })
        return reply.send({ conversations: conversations.map(toAgentConversationSummaryDTO) })
      } catch (err) {
        captureFor(request, 'ai_agent_invoked', {
          agent: 'inova',
          outcome: 'error',
          durationMs: Date.now() - startedAt,
        })
        return handleChatError(err, reply)
      }
    },
  )

  app.get(
    '/inova/admin/chat/conversations/:id',
    { onRequest: [app.authenticate, app.requireAdminOrSubadmin] },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params)
      if (!params.success) {
        return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: params.error.issues })
      }
      const startedAt = Date.now()
      try {
        await ensureInovaModuleEnabled(request.user.companyId)
        const conversation = await getConversation(
          { id: request.user.sub, companyId: request.user.companyId },
          'inova',
          params.data.id,
        )
        captureFor(request, 'ai_agent_invoked', {
          agent: 'inova',
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        })
        return reply.send({ conversation: toAgentConversationDTO(conversation) })
      } catch (err) {
        captureFor(request, 'ai_agent_invoked', {
          agent: 'inova',
          outcome: 'error',
          durationMs: Date.now() - startedAt,
        })
        return handleChatError(err, reply)
      }
    },
  )

  /**
   * Biblioteca de vídeos do Guia AI First. Leitura aberta a qualquer
   * autenticado do módulo (o catálogo estático vive no front — esta lista
   * são só as sobrescritas); escrita é admin/subadmin, como criar/editar
   * projeto.
   */
  app.get('/inova/guia/videos', { onRequest: [app.authenticate] }, async (request, reply) => {
    try {
      return reply.send({ videos: await listInovaGuiaVideos(request.user.companyId) })
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post(
    '/inova/guia/videos',
    { onRequest: [app.authenticate, app.requireAdminOrSubadmin] },
    async (request, reply) => {
      try {
        const video = await createInovaGuiaVideoCard(request.user.companyId, request.user.sub)
        return reply.send({ video })
      } catch (err) {
        if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )

  app.patch(
    '/inova/guia/videos/:videoId',
    { onRequest: [app.authenticate, app.requireAdminOrSubadmin] },
    async (request, reply) => {
      const { videoId } = request.params as { videoId: string }
      const parsed = inovaGuiaVideoPatchSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
      try {
        const video = await upsertInovaGuiaVideo(request.user.companyId, videoId, request.user.sub, parsed.data)
        return reply.send({ video })
      } catch (err) {
        if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )

  app.delete(
    '/inova/guia/videos/:videoId',
    { onRequest: [app.authenticate, app.requireAdminOrSubadmin] },
    async (request, reply) => {
      const { videoId } = request.params as { videoId: string }
      try {
        await deleteInovaGuiaVideo(request.user.companyId, videoId)
        return reply.code(204).send()
      } catch (err) {
        if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )
}
