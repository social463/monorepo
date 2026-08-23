import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  MAX_CARD_LENGTH,
  MAX_RETRO_TIMER_DURATION_SECONDS,
  MAX_SPRINT,
  MAX_VOTES_PER_PARTICIPANT,
  MIN_RETRO_TIMER_DURATION_SECONDS,
  MIN_SPRINT,
  MIN_VOTES_PER_PARTICIPANT,
  RETRO_CARD_COLORS,
  RETRO_CARD_KINDS,
  RETRO_REACTION_EMOJIS,
  RETRO_SHAPES,
  RETRO_SHAPE_STYLES,
} from '@legends/shared'
import {
  RetroError,
  addVote,
  advancePhase,
  archiveRoom,
  setAnonymous,
  countUserVotesInRoom,
  createCard,
  createRoom,
  deleteCard,
  getRoomForViewer,
  getRoomMeta,
  listCarryover,
  listEdits,
  listRoomsForUser,
  removeVote,
  resolveRole,
  updateAction,
  updateTimer,
  setCarryover,
  setParticipants,
  toggleReaction,
  updateCard,
  updateCardPosition,
  type RetroCardWithRelations,
  type RetroRoomMeta,
} from '../services/retro-service'
import { notifyRetroInvited } from '../services/notification-service'
// A listagem das arquivadas vive ao lado da não-arquivada (`listUserActions`),
// que é quem alimenta o perfil: os filtros das duas precisam andar juntos.
import { listUserArchivedActions } from '../services/profile-service'
import { listSquads } from '../services/squad-service'
import { retroRoomDerivedTitle, squadLabel, toRetroActionItemDTO, toRetroCarryoverItemDTO, toRetroCardDTO, toRetroEditDTO, toRetroRoomDTO, toRetroRoomSummaryDTO, toRetroTimerDTO, toSquadWithMembersDTO } from '../lib/serialize'
import { retroHub } from '../lib/retro-hub'

const createRoomSchema = z.object({
  sprint: z.number().int().min(MIN_SPRINT).max(MAX_SPRINT),
  squadIds: z.array(z.string()).min(1).max(50),
  votesPerParticipant: z.number().int().min(MIN_VOTES_PER_PARTICIPANT).max(MAX_VOTES_PER_PARTICIPANT),
  participantIds: z.array(z.string()).max(200),
})
const participantsSchema = z.object({ participantIds: z.array(z.string()).max(200) })
const phaseSchema = z.object({ action: z.literal('conclude') })
const createCardSchema = z.object({
  text: z.string().trim().max(MAX_CARD_LENGTH).optional(),
  color: z.enum(RETRO_CARD_COLORS),
  x: z.number().finite(),
  y: z.number().finite(),
  kind: z.enum(RETRO_CARD_KINDS).optional(),
  shape: z.enum(RETRO_SHAPES).optional(),
  shapeStyle: z.enum(RETRO_SHAPE_STYLES).optional(),
  width: z.number().finite().min(24).max(640).optional(),
  height: z.number().finite().min(24).max(640).optional(),
  actionPlan: z.string().trim().max(MAX_CARD_LENGTH).optional(),
  actionResponsible: z.string().trim().max(120).optional(),
  actionDueDate: z.string().trim().max(20).optional(),
}).superRefine((data, ctx) => {
  const kind = data.kind ?? 'note'
  if (kind === 'note' && (!data.text || data.text.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: 'O card não pode ser vazio.' })
  }
  if (kind === 'shape' && !data.shape) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shape'], message: 'Forma inválida.' })
  }
})
const updateCardSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_CARD_LENGTH).optional(),
    color: z.enum(RETRO_CARD_COLORS).optional(),
    shape: z.enum(RETRO_SHAPES).optional(),
    shapeStyle: z.enum(RETRO_SHAPE_STYLES).optional(),
    width: z.number().finite().min(24).max(640).optional(),
    height: z.number().finite().min(24).max(640).optional(),
    actionPlan: z.string().trim().max(MAX_CARD_LENGTH).optional(),
    actionResponsible: z.string().trim().max(120).optional(),
    actionDueDate: z.string().trim().max(20).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Nada para atualizar.' })
const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() })
const reactionSchema = z.object({ emoji: z.enum(RETRO_REACTION_EMOJIS) })
const anonymousSchema = z.object({ anonymous: z.boolean() })
const timerModeSchema = z.enum(['elapsed', 'countdown'])
const timerSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('configure'),
    mode: timerModeSchema,
    durationSeconds: z.number().int().min(MIN_RETRO_TIMER_DURATION_SECONDS).max(MAX_RETRO_TIMER_DURATION_SECONDS).nullable().optional(),
  }),
  z.object({
    action: z.literal('start'),
    mode: timerModeSchema.optional(),
    durationSeconds: z.number().int().min(MIN_RETRO_TIMER_DURATION_SECONDS).max(MAX_RETRO_TIMER_DURATION_SECONDS).nullable().optional(),
  }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({
    action: z.literal('reset'),
    mode: timerModeSchema.optional(),
    durationSeconds: z.number().int().min(MIN_RETRO_TIMER_DURATION_SECONDS).max(MAX_RETRO_TIMER_DURATION_SECONDS).nullable().optional(),
  }),
])
const actionUpdateSchema = z
  .object({ done: z.boolean().optional(), note: z.string().max(500).optional(), archived: z.boolean().optional() })
  .refine((d) => d.done !== undefined || d.note !== undefined || d.archived !== undefined, {
    message: 'Nada para atualizar.',
  })
const carryoverSchema = z
  .object({ action: z.enum(['validate', 'reject', 'reschedule', 'done']), dueDate: z.string().optional() })
  .refine((d) => d.action !== 'reschedule' || (d.dueDate != null && /^\d{4}-\d{2}-\d{2}$/.test(d.dueDate)), { message: 'Novo prazo inválido.' })

const badBody = { message: 'Dados inválidos.' }

/** card.created/updated por-viewer (anonimato + `mine`/`myVotes` variam por usuário). */
function broadcastCard(type: 'card.created' | 'card.updated', meta: RetroRoomMeta, card: RetroCardWithRelations): void {
  retroHub.broadcast(meta.id, (viewerId) => ({
    type,
    card: toRetroCardDTO(card, { viewerId, anonymous: meta.anonymous }),
  }))
}

export async function retroRoutes(app: FastifyInstance) {
  app.post('/retro/rooms', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const parsed = createRoomSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    try {
      const room = await createRoom({ creatorId: request.user.sub, companyId: request.user.companyId, ...parsed.data })
      try {
        await notifyRetroInvited({
          roomId: room.id,
          title: retroRoomDerivedTitle(room),
          actorId: request.user.sub,
          invitedUserIds: room.participants.map((p) => p.userId),
        }, request.user.companyId)
      } catch (err) {
        request.log.error(err)
      }
      return reply.code(201).send({ room: toRetroRoomDTO(room, { id: request.user.sub }, 'FACILITATOR') })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/retro/rooms', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const rooms = await listRoomsForUser({ id: request.user.sub, role: request.user.role }, request.user.companyId)
    const dtos = rooms.map((room) =>
      toRetroRoomSummaryDTO(room, resolveRole(room, { id: request.user.sub, role: request.user.role }) ?? 'OBSERVER'),
    )
    return reply.send({ rooms: dtos })
  })

  app.get('/retro/squads', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const squads = await listSquads(request.user.companyId, { activeOnly: true })
    return reply.send({ squads: squads.map(toSquadWithMembersDTO) })
  })

  app.get('/retro/rooms/:id', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { room, role } = await getRoomForViewer(id, { id: request.user.sub, role: request.user.role }, request.user.companyId)
      return reply.send({ room: toRetroRoomDTO(room, { id: request.user.sub }, role) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/retro/rooms/:id/participants', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const parsed = participantsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const { room, addedUserIds } = await setParticipants({ roomId: id, userId: request.user.sub, participantIds: parsed.data.participantIds, companyId: request.user.companyId })
      if (addedUserIds.length) {
        try {
          await notifyRetroInvited({ roomId: room.id, title: retroRoomDerivedTitle(room), actorId: request.user.sub, invitedUserIds: addedUserIds }, request.user.companyId)
        } catch (err) {
          request.log.error(err)
        }
      }
      retroHub.broadcast(room.id, () => ({ type: 'participants.changed' }))
      return reply.send({ room: toRetroRoomDTO(room, { id: request.user.sub }, 'FACILITATOR') })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/retro/rooms/:id/phase', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const parsed = phaseSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const room = await advancePhase({ roomId: id, userId: request.user.sub, action: parsed.data.action, companyId: request.user.companyId })
      retroHub.broadcast(room.id, () => ({
        type: 'phase.changed',
        status: room.status,
        concludedAt: room.concludedAt ? room.concludedAt.toISOString() : null,
      }))
      return reply.send({ room: toRetroRoomDTO(room, { id: request.user.sub }, 'FACILITATOR') })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/retro/rooms/:id/anonymous', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const parsed = anonymousSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const room = await setAnonymous({ roomId: id, userId: request.user.sub, anonymous: parsed.data.anonymous, companyId: request.user.companyId })
      retroHub.broadcast(room.id, () => ({ type: 'anonymous.changed', anonymous: room.anonymous }))
      return reply.send({ room: toRetroRoomDTO(room, { id: request.user.sub }, 'FACILITATOR') })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/retro/rooms/:id/timer', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const parsed = timerSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const room = await updateTimer({ roomId: id, userId: request.user.sub, companyId: request.user.companyId, command: parsed.data })
      const timer = toRetroTimerDTO(room)
      retroHub.broadcast(room.id, () => ({ type: 'timer.changed', timer }))
      return reply.send({ timer, room: toRetroRoomDTO(room, { id: request.user.sub }, 'FACILITATOR') })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/retro/rooms/:id/cards', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const parsed = createCardSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const card = await createCard({ roomId: id, userId: request.user.sub, companyId: request.user.companyId, ...parsed.data })
      const meta = await getRoomMeta(id, request.user.companyId)
      if (meta) broadcastCard('card.created', meta, card)
      return reply.code(201).send({ card: toRetroCardDTO(card, { viewerId: request.user.sub, anonymous: meta?.anonymous ?? true }) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/retro/rooms/:id/cards/:cardId', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const parsed = updateCardSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const room0 = await getRoomMeta(id, request.user.companyId)
      const { card, actionCard, actionCardCreated } = await updateCard({ roomId: id, cardId, userId: request.user.sub, role: request.user.role, companyId: request.user.companyId, ...parsed.data })
      const meta = await getRoomMeta(id, request.user.companyId)
      if (meta) {
        broadcastCard('card.updated', meta, card)
        if (actionCard) broadcastCard(actionCardCreated ? 'card.created' : 'card.updated', meta, actionCard)
      }
      if (room0?.status === 'CONCLUDED') retroHub.broadcast(id, () => ({ type: 'edits.changed' }))
      return reply.send({
        card: toRetroCardDTO(card, { viewerId: request.user.sub, anonymous: meta?.anonymous ?? true }),
        actionCard: actionCard ? toRetroCardDTO(actionCard, { viewerId: request.user.sub, anonymous: meta?.anonymous ?? true }) : null,
      })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/retro/rooms/:id/cards/:cardId/position', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const parsed = positionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const { x, y } = await updateCardPosition({ roomId: id, cardId, userId: request.user.sub, companyId: request.user.companyId, ...parsed.data })
      retroHub.broadcast(id, () => ({ type: 'card.moved', cardId, x, y }))
      return reply.send({ x, y })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/retro/rooms/:id', { onRequest: [app.authenticate, app.requireAdmin, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await archiveRoom({ roomId: id, userId: request.user.sub, companyId: request.user.companyId })
      retroHub.broadcast(id, () => ({ type: 'room.deleted' }))
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/retro/rooms/:id/cards/:cardId', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      await deleteCard({ roomId: id, cardId, userId: request.user.sub, companyId: request.user.companyId })
      retroHub.broadcast(id, () => ({ type: 'card.deleted', cardId }))
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/retro/rooms/:id/cards/:cardId/votes', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const { voteCount } = await addVote({ roomId: id, cardId, userId: request.user.sub, companyId: request.user.companyId })
      retroHub.broadcast(id, () => ({ type: 'vote.changed', cardId, voteCount }))
      const meta = await getRoomMeta(id, request.user.companyId)
      const used = await countUserVotesInRoom(id, request.user.sub, request.user.companyId)
      return reply.send({ voteCount, myRemainingVotes: Math.max(0, (meta?.votesPerParticipant ?? 0) - used) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/retro/rooms/:id/cards/:cardId/votes', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const { voteCount } = await removeVote({ roomId: id, cardId, userId: request.user.sub, companyId: request.user.companyId })
      retroHub.broadcast(id, () => ({ type: 'vote.changed', cardId, voteCount }))
      const meta = await getRoomMeta(id, request.user.companyId)
      const used = await countUserVotesInRoom(id, request.user.sub, request.user.companyId)
      return reply.send({ voteCount, myRemainingVotes: Math.max(0, (meta?.votesPerParticipant ?? 0) - used) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/retro/rooms/:id/cards/:cardId/reactions', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const parsed = reactionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const card = await toggleReaction({ roomId: id, cardId, userId: request.user.sub, emoji: parsed.data.emoji, companyId: request.user.companyId })
      retroHub.broadcast(id, (viewerId) => ({
        type: 'reaction.changed',
        cardId,
        reactions: toRetroCardDTO(card, { viewerId, anonymous: false }).reactions,
      }))
      return reply.send({ reactions: toRetroCardDTO(card, { viewerId: request.user.sub, anonymous: false }).reactions })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /** As ações que o próprio usuário arquivou — o resgate do que saiu do perfil. */
  app.get('/retro/actions/archived', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const cards = await listUserArchivedActions(request.user.sub)
    return reply.send({
      actions: cards.map((card) => toRetroActionItemDTO(card, card.room.sprint, squadLabel(card.room.squads))),
    })
  })

  app.patch('/retro/actions/:cardId', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const parsed = actionUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { cardId } = request.params as { cardId: string }
    try {
      const card = await updateAction({
        cardId,
        userId: request.user.sub,
        done: parsed.data.done,
        note: parsed.data.note,
        archived: parsed.data.archived,
        companyId: request.user.companyId,
      })
      return reply.send({ action: toRetroActionItemDTO(card, card.room.sprint, squadLabel(card.room.squads)) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/retro/rooms/:id/carryover', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { toValidate, overdue } = await listCarryover(id, { id: request.user.sub, role: request.user.role }, request.user.companyId)
      return reply.send({
        toValidate: toValidate.map(({ card, responsible, sprint }) => toRetroCarryoverItemDTO(card, responsible, 'validate', sprint)),
        overdue: overdue.map(({ card, responsible, sprint }) => toRetroCarryoverItemDTO(card, responsible, 'overdue', sprint)),
      })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/retro/rooms/:id/carryover/:cardId', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const parsed = carryoverSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const { card, responsible, sprint } = await setCarryover({ roomId: id, cardId, userId: request.user.sub, role: request.user.role, companyId: request.user.companyId, ...parsed.data })
      retroHub.broadcast(id, () => ({ type: 'carryover.changed' }))
      const type = card.actionDone ? 'validate' : 'overdue'
      return reply.send({ item: toRetroCarryoverItemDTO(card, responsible, type, sprint) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/retro/rooms/:id/edits', { onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const edits = await listEdits(id, { id: request.user.sub, role: request.user.role }, request.user.companyId)
      return reply.send({ edits: edits.map(toRetroEditDTO) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
