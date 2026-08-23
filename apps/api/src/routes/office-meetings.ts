import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  MEETING_AGENDA_DAYS_AHEAD,
  MEETING_AGENDA_MAX_LENGTH,
  MEETING_MAX_PARTICIPANTS,
  MEETING_DURATION_MINUTES,
  MEETING_TITLE_MAX_LENGTH,
  type MeetingDurationMinutes,
  type OfficeMeetingDTO,
} from '@legends/shared'
import {
  OfficeMeetingConflictError,
  OfficeMeetingError,
  buildMeetingIcsFor,
  cancelOfficeMeeting,
  createOfficeMeeting,
  listCompanyMeetings,
  listRoomMeetings,
  updateOfficeMeeting,
} from '../services/office-meeting-service'

/**
 * `z.number().refine` em vez de `z.union` de literais: a lista de durações
 * válidas vem de um array em runtime (`MEETING_DURATION_MINUTES`), e montar um
 * union de `z.literal` a partir dele exige um cast de tupla feio para o
 * TypeScript aceitar (`ZodLiteral[] as [A, B, ...C[]]`). O refine com type
 * guard dá o mesmo resultado — número fora da lista vira issue de zod — com o
 * tipo de saída (`MeetingDurationMinutes`) inferido sem cast.
 */
const durationSchema = z
  .number()
  .int()
  .refine((value): value is MeetingDurationMinutes => (MEETING_DURATION_MINUTES as readonly number[]).includes(value), {
    message: `Duração deve ser uma das opções: ${MEETING_DURATION_MINUTES.join(', ')} minutos`,
  })

/** Remove duplicatas: `OfficeMeetingParticipant` tem PK composta (meetingId, userId) e um id repetido vira 500 no create. */
function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids)]
}

const createSchema = z.object({
  roomExternalKey: z.string().min(1),
  title: z.string().trim().min(1).max(MEETING_TITLE_MAX_LENGTH),
  agenda: z.string().trim().max(MEETING_AGENDA_MAX_LENGTH).optional(),
  startsAt: z.string().datetime(),
  durationMinutes: durationSchema,
  participantIds: z.array(z.string().min(1)).max(MEETING_MAX_PARTICIPANTS).transform(dedupeIds),
  force: z.boolean().optional(),
})

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(MEETING_TITLE_MAX_LENGTH).optional(),
    agenda: z.string().trim().max(MEETING_AGENDA_MAX_LENGTH).nullable().optional(),
    startsAt: z.string().datetime().optional(),
    durationMinutes: durationSchema.optional(),
    participantIds: z.array(z.string().min(1)).max(MEETING_MAX_PARTICIPANTS).transform(dedupeIds).optional(),
    force: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nada para atualizar' })

/** Teto do intervalo da agenda da empresa — impede que a rota vire dump. */
const MAX_AGENDA_RANGE_DAYS = 62

const listQuerySchema = z.object({
  /** Ausente = agenda da empresa (as minhas, salvo `mine=false`). */
  room: z.string().min(1).optional(),
  mine: z.enum(['true', 'false']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

const idParamsSchema = z.object({ id: z.string().min(1) })

function badInput(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ message: 'Dados inválidos', issues: error.issues })
}

/**
 * Traduz erro de domínio em resposta. O conflito tem corpo próprio (a lista do
 * que colide) para o front oferecer "marcar mesmo assim".
 */
function sendDomainError(reply: FastifyReply, err: unknown) {
  if (err instanceof OfficeMeetingConflictError) {
    return reply.code(err.status).send({ message: err.message, conflicts: err.conflicts })
  }
  if (err instanceof OfficeMeetingError) {
    return reply.code(err.status).send({ message: err.message })
  }
  throw err
}

/** Convidado (JWT de guest) não é usuário real — não marca nem lista reunião. */
function isGuest(request: { user: { role: string } }): boolean {
  return request.user.role === 'GUEST'
}

export async function officeMeetingRoutes(app: FastifyInstance) {
  const authed = { onRequest: [app.authenticate] }

  app.post('/office/meetings', authed, async (request, reply): Promise<OfficeMeetingDTO | FastifyReply> => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não pode agendar reunião' })
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const meeting = await createOfficeMeeting({
        companyId: request.user.companyId,
        organizerId: request.user.sub,
        roomExternalKey: parsed.data.roomExternalKey,
        title: parsed.data.title,
        agenda: parsed.data.agenda ?? null,
        startsAt: new Date(parsed.data.startsAt),
        durationMinutes: parsed.data.durationMinutes,
        participantIds: parsed.data.participantIds,
        force: parsed.data.force,
      })
      return reply.code(201).send(meeting)
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })

  app.get('/office/meetings', authed, async (request, reply): Promise<OfficeMeetingDTO[] | FastifyReply> => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não vê a agenda da sala' })
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) return badInput(reply, parsed.error)
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date()
    const to = parsed.data.to
      ? new Date(parsed.data.to)
      : new Date(from.getTime() + MEETING_AGENDA_DAYS_AHEAD * 24 * 60 * 60 * 1000)

    if (parsed.data.room) {
      return listRoomMeetings(request.user.companyId, parsed.data.room, from, to)
    }

    if (to.getTime() - from.getTime() > MAX_AGENDA_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      return reply.code(400).send({ message: `O intervalo não pode passar de ${MAX_AGENDA_RANGE_DAYS} dias` })
    }
    return listCompanyMeetings(request.user.companyId, {
      participantId: parsed.data.mine === 'false' ? null : request.user.sub,
      from,
      to,
    })
  })

  app.patch('/office/meetings/:id', authed, async (request, reply): Promise<OfficeMeetingDTO | FastifyReply> => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não pode editar reunião' })
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      return await updateOfficeMeeting(params.data.id, request.user.sub, request.user.companyId, {
        title: parsed.data.title,
        agenda: parsed.data.agenda,
        startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : undefined,
        durationMinutes: parsed.data.durationMinutes,
        participantIds: parsed.data.participantIds,
        force: parsed.data.force,
      })
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })

  app.delete('/office/meetings/:id', authed, async (request, reply): Promise<OfficeMeetingDTO | FastifyReply> => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não pode cancelar reunião' })
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    try {
      return await cancelOfficeMeeting(params.data.id, request.user.sub, request.user.companyId)
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })

  app.get('/office/meetings/:id/ics', authed, async (request, reply) => {
    if (isGuest(request)) return reply.code(403).send({ message: 'Convidado não baixa o convite' })
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    try {
      const { filename, ics } = await buildMeetingIcsFor(params.data.id, request.user.sub, request.user.companyId)
      return reply
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(ics)
    } catch (err) {
      return sendDomainError(reply, err)
    }
  })
}
