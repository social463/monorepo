import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH,
  CALENDAR_EVENT_TAG_MAX_LENGTH,
  CALENDAR_EVENT_TITLE_MAX_LENGTH,
  CALENDAR_RECURRENCES,
  canManageCalendarEvents,
  isCalendarProviderKey,
  type CalendarProviderKey,
} from '@legends/shared'
import {
  CalendarEventError,
  createEvent,
  deleteEvent,
  getManagedEvent,
  listEventTypes,
  listEvents,
  listCalendarCampaignPosts,
  listOccurrences,
  updateEvent,
} from '../services/calendar-event-service'
import { appBaseUrl } from '../lib/app-url'
import {
  CalendarError,
  completeCalendarConnection,
  disconnectCalendar,
  getCalendarIntegrationState,
  startCalendarConnection,
} from '../services/calendar-connection-service'

const providerParamsSchema = z.object({
  provider: z.string().refine(isCalendarProviderKey, 'Provedor de calendário não suportado'),
})

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida')

const eventSchema = z.object({
  title: z.string().trim().min(1).max(CALENDAR_EVENT_TITLE_MAX_LENGTH),
  description: z.string().trim().max(CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH).optional(),
  tag: z.string().trim().max(CALENDAR_EVENT_TAG_MAX_LENGTH).nullish(),
  date: ymd,
  endDate: ymd.nullish(),
  startTime: hhmm.nullish(),
  endTime: hhmm.nullish(),
  typeId: z.string().min(1),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')
    .nullish(),
  // Teto no número e no tamanho da tag: o campo é texto livre separado por
  // vírgula, e sem limite uma colagem acidental viraria centenas de tags.
  audienceTags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  isInternalComm: z.boolean().optional(),
  sectorIds: z.array(z.string().min(1)).optional(),
  // Convidados nominais (seção 11). Teto de 200 pelo mesmo motivo das tags: o
  // campo é lista, e sem limite uma colagem viraria uma notificação por pessoa
  // da empresa inteira. Quem quer chamar todo mundo usa o público-alvo.
  guestIds: z.array(z.string().min(1)).max(200).optional(),
  recurrence: z.enum(CALENDAR_RECURRENCES).optional(),
  recurrenceUntil: ymd.nullish(),
  recurrenceCount: z.number().int().min(1).max(500).nullish(),
  reminderDaysBefore: z.array(z.number().int().min(0).max(365)).max(6).optional(),
})

const eventsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
})

const callbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
})

/** Volta para o perfil da pessoa com o resultado do fluxo. */
function profileRedirect(userId: string | null, result: 'ok' | 'erro'): string {
  const base = appBaseUrl()
  return userId ? `${base}/perfil/${userId}?calendario=${result}` : `${base}/login?calendario=${result}`
}

export async function calendarRoutes(app: FastifyInstance) {
  /**
   * As ocorrências de evento cadastrado que a pessoa alcança na janela pedida,
   * mais o catálogo de tipos (é ele que vira chip de filtro na tela).
   *
   * O recorte por público-alvo é aqui, não na tela: evento restrito a setores
   * nunca sai da API para quem não é do público. A guarda é a feature
   * `calendario` — a mesma que libera a tela.
   */
  /**
   * Cadastro de evento: ADMIN global, SUBADMIN do setor com a feature de bloco
   * `desenvolvimento-produto` e **liderança** (LEAD, MANAGER, HEAD). Fica aqui,
   * e não em `/admin/*`, justamente porque líder não é admin e não entra no
   * `/admin` — a regra única mora em `canManageCalendarEvents`.
   *
   * Quem pode EDITAR/EXCLUIR é mais estreito e é decidido no service: líder só
   * mexe no que criou.
   */
  const eventManager = {
    onRequest: [
      app.authenticate,
      async (request: FastifyRequest, reply: FastifyReply) => {
        if (!canManageCalendarEvents(request.user.role, request.user.features ?? [], request.user.adminAccess)) {
          return reply.code(403).send({ message: 'Sem permissão para cadastrar eventos no calendário.' })
        }
      },
    ],
  }

  /** Lista de gestão (não é a do calendário): todos os eventos da empresa. */
  app.get('/calendar/managed-events', eventManager, async (request, reply) => {
    const [events, types] = await Promise.all([
      listEvents({
        companyId: request.user.companyId,
        role: request.user.role,
        sectorFeatures: request.user.features ?? [],
        adminAccess: request.user.adminAccess,
      }),
      listEventTypes(request.user.companyId),
    ])
    return reply.send({ events, types })
  })

  /**
   * Um evento inteiro, para o formulário de edição aberto a partir do próprio
   * calendário. A tela só tem ocorrências; editar exige a regra que as gerou.
   */
  app.get('/calendar/events/:id', eventManager, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const event = await getManagedEvent({
        id,
        actorId: request.user.sub,
        actorRole: request.user.role,
        actorFeatures: request.user.features ?? [],
        actorAdminAccess: request.user.adminAccess,
        companyId: request.user.companyId,
      })
      return reply.send({ event })
    } catch (err) {
      if (err instanceof CalendarEventError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/calendar/events', eventManager, async (request, reply) => {
    const parsed = eventSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    try {
      const event = await createEvent({
        data: parsed.data,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
      return reply.code(201).send({ event })
    } catch (err) {
      if (err instanceof CalendarEventError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/calendar/events/:id', eventManager, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = eventSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    try {
      const event = await updateEvent({
        id,
        data: parsed.data,
        actorId: request.user.sub,
        actorRole: request.user.role,
        actorFeatures: request.user.features ?? [],
        actorAdminAccess: request.user.adminAccess,
        companyId: request.user.companyId,
      })
      return reply.send({ event })
    } catch (err) {
      if (err instanceof CalendarEventError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/calendar/events/:id', eventManager, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteEvent({
        id,
        actorId: request.user.sub,
        actorRole: request.user.role,
        actorFeatures: request.user.features ?? [],
        actorAdminAccess: request.user.adminAccess,
        companyId: request.user.companyId,
      })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof CalendarEventError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get(
    '/calendar/events',
    { onRequest: [app.authenticate, app.requireFeature('calendario')] },
    async (request, reply) => {
      const parsed = eventsQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
      }
      try {
        const viewer = {
          userId: request.user.sub,
          companyId: request.user.companyId,
          sectorId: request.user.sectorId ?? null,
          sectorFeatures: request.user.features ?? [],
          role: request.user.role,
          adminAccess: request.user.adminAccess,
          from: parsed.data.from,
          to: parsed.data.to,
        }
        // O calendário editorial de Campanhas entra na mesma janela (Documento
        // 4, seção 13.2). Volta vazio para quem não é G&G — o recorte é do
        // service, não desta rota.
        const [occurrences, types, campaignPosts] = await Promise.all([
          listOccurrences(viewer),
          listEventTypes(request.user.companyId),
          listCalendarCampaignPosts(viewer),
        ])
        return reply.send({ occurrences, types, campaignPosts })
      } catch (err) {
        if (err instanceof CalendarEventError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )

  app.get('/calendar/connections', { onRequest: [app.authenticate] }, async (request, reply) => {
    const state = await getCalendarIntegrationState({
      userId: request.user.sub,
      companyId: request.user.companyId,
    })
    return reply.send(state)
  })

  app.post('/calendar/connect/:provider', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = providerParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      const result = await startCalendarConnection({
        userId: request.user.sub,
        companyId: request.user.companyId,
        provider: parsed.data.provider as CalendarProviderKey,
      })
      return reply.send(result)
    } catch (err) {
      if (err instanceof CalendarError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /**
   * Callback do provedor. Não passa por `authenticate`: quem chega aqui é o
   * navegador redirecionado pelo Google/Microsoft, sem o access token em memória.
   * A identidade vem do `state` assinado, não da sessão.
   */
  app.get('/calendar/callback/:provider', async (request, reply) => {
    const params = providerParamsSchema.safeParse(request.params)
    const query = callbackQuerySchema.safeParse(request.query)
    if (!params.success || !query.success || query.data.error || !query.data.code || !query.data.state) {
      return reply.redirect(profileRedirect(null, 'erro'), 302)
    }
    try {
      // O service valida o state e devolve de quem é o fluxo — a route não
      // reinterpreta o state, para não existirem duas leituras da mesma coisa.
      const { userId } = await completeCalendarConnection({
        provider: params.data.provider as CalendarProviderKey,
        code: query.data.code,
        state: query.data.state,
      })
      return reply.redirect(profileRedirect(userId, 'ok'), 302)
    } catch (err) {
      if (!(err instanceof CalendarError)) {
        console.error('[calendar] callback falhou', err)
      }
      return reply.redirect(profileRedirect(null, 'erro'), 302)
    }
  })

  app.delete('/calendar/connections/:provider', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = providerParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      await disconnectCalendar({
        userId: request.user.sub,
        provider: parsed.data.provider as CalendarProviderKey,
      })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof CalendarError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
