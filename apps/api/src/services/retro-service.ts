import { Prisma, type RetroCard, type User } from '@prisma/client'
import {
  MAX_RETRO_TIMER_DURATION_SECONDS,
  MAX_CARD_LENGTH,
  MAX_VOTES_PER_PARTICIPANT,
  MIN_RETRO_TIMER_DURATION_SECONDS,
  MIN_VOTES_PER_PARTICIPANT,
  POSTIT_HEIGHT,
  POSTIT_WIDTH,
  RETRO_CARD_COLORS,
  RETRO_CARD_KINDS,
  RETRO_ACTION_REGION_IDS,
  RETRO_REGIONS,
  RETRO_REACTION_EMOJIS,
  RETRO_SHAPES,
  RETRO_SHAPE_STYLES,
  SHAPE_HEIGHT,
  SHAPE_WIDTH,
  type RetroCardColor,
  type RetroCardKind,
  type RetroShape,
  type RetroShapeStyle,
  type RetroRoomRole,
  type RetroRoomStatus,
  type RetroTimerCommand,
  type RetroTimerMode,
  isLeaderRole,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog, toSafeUserRef } from './audit-log-service'

export class RetroError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'RetroError'
  }
}

export const retroRoomInclude = {
  creator: true,
  timerUpdatedBy: true,
  squads: { include: { squad: true } },
  participants: { include: { user: true }, orderBy: { invitedAt: 'asc' } },
  cards: { include: { author: true, votes: true, reactions: true, editedBy: true }, orderBy: { createdAt: 'asc' } },
} as const
export type RetroRoomWithRelations = Prisma.RetroRoomGetPayload<{ include: typeof retroRoomInclude }>
export type RetroCardWithRelations = RetroRoomWithRelations['cards'][number]

export interface UpdateCardResult {
  card: RetroCardWithRelations
  actionCard: RetroCardWithRelations | null
  actionCardCreated: boolean
}

function assertTimerDuration(mode: RetroTimerMode, durationSeconds: number | null | undefined): number | null {
  if (mode === 'elapsed') return null
  if (!Number.isInteger(durationSeconds)) throw new RetroError('Informe uma duração para a contagem regressiva.', 400)
  const value = Number(durationSeconds)
  if (value < MIN_RETRO_TIMER_DURATION_SECONDS || value > MAX_RETRO_TIMER_DURATION_SECONDS) {
    throw new RetroError('Duração do cronômetro inválida.', 400)
  }
  return value
}

function timerModeToDb(mode: RetroTimerMode): 'ELAPSED' | 'COUNTDOWN' {
  return mode === 'countdown' ? 'COUNTDOWN' : 'ELAPSED'
}

function timerModeFromDb(mode: 'ELAPSED' | 'COUNTDOWN'): RetroTimerMode {
  return mode === 'COUNTDOWN' ? 'countdown' : 'elapsed'
}

function elapsedTimerSeconds(room: Pick<RetroRoomWithRelations, 'timerStatus' | 'timerStartedAt' | 'timerAccumulatedSeconds'>, now: Date): number {
  const runningDelta =
    room.timerStatus === 'RUNNING' && room.timerStartedAt
      ? Math.max(0, Math.floor((now.getTime() - room.timerStartedAt.getTime()) / 1000))
      : 0
  return Math.max(0, room.timerAccumulatedSeconds + runningDelta)
}

/**
 * Contagem regressiva que já chegou a zero. O banco continua `RUNNING` — ninguém
 * roda um job pra virar o estado no instante em que zera —, mas pro usuário o
 * cronômetro acabou. Os comandos precisam enxergar isso, senão `configure` recusa
 * com 409 uma sala que o facilitador vê parada.
 */
export function isCountdownFinished(
  room: Pick<RetroRoomWithRelations, 'timerMode' | 'timerStatus' | 'timerStartedAt' | 'timerAccumulatedSeconds' | 'timerDurationSeconds'>,
  now: Date,
): boolean {
  if (room.timerMode !== 'COUNTDOWN' || room.timerStatus !== 'RUNNING') return false
  if (room.timerDurationSeconds == null) return false
  return elapsedTimerSeconds(room, now) >= room.timerDurationSeconds
}

export interface RetroRoomMeta {
  id: string
  status: RetroRoomStatus
  anonymous: boolean
  createdById: string
  votesPerParticipant: number
  participantUserIds: string[]
}

export function resolveRole(
  room: { createdById: string; participants: { userId: string }[] },
  viewer: { id: string; role: string },
): RetroRoomRole | null {
  if (room.createdById === viewer.id) return 'FACILITATOR'
  if (room.participants.some((p) => p.userId === viewer.id)) return 'PARTICIPANT'
  if (isLeaderRole(viewer.role)) return 'OBSERVER'
  return null
}

async function loadRoom(roomId: string, companyId: string): Promise<RetroRoomWithRelations> {
  const room = await scopedPrisma(companyId).retroRoom.findUnique({ where: { id: roomId }, include: retroRoomInclude })
  if (!room || room.archivedAt) throw new RetroError('Sala não encontrada.', 404)
  return room
}

/**
 * Reduz toda relação `User` aninhada de uma sala (creator, participantes, autor/editor
 * dos cards) a `{ id, name }` antes de virar payload de auditoria — `retroRoomInclude`
 * traz `User` completo (passwordHash, email, teamsWebhookUrl) em vários níveis, e isso
 * nunca pode ser persistido em `AdminAuditLog`. Não muda o que a rota devolve ao cliente,
 * só o que é logado.
 */
function sanitizeRoomForAudit(room: RetroRoomWithRelations) {
  return {
    ...room,
    creator: toSafeUserRef(room.creator),
    participants: room.participants.map((p) => ({ ...p, user: toSafeUserRef(p.user) })),
    cards: room.cards.map((c) => ({ ...c, author: toSafeUserRef(c.author), editedBy: toSafeUserRef(c.editedBy) })),
  }
}

function assertSprint(n: number): void {
  if (!Number.isInteger(n) || n < 1) throw new RetroError('Número da sprint inválido.', 400)
}
function assertVotes(v: number): void {
  if (!Number.isInteger(v) || v < MIN_VOTES_PER_PARTICIPANT || v > MAX_VOTES_PER_PARTICIPANT) {
    throw new RetroError('Número de votos por participante inválido.', 400)
  }
}
async function assertInvitable(ids: string[], companyId: string): Promise<void> {
  if (ids.length === 0) return
  const users = await scopedPrisma(companyId).user.findMany({ where: { id: { in: ids } } })
  if (users.length !== new Set(ids).size) throw new RetroError('Algum participante é inválido.', 400)
  if (users.some((u) => !u.active || u.leftAt)) throw new RetroError('Participante inativo.', 400)
  if (users.some((u) => u.role === 'ADMIN' || u.role === 'SUBADMIN')) throw new RetroError('Administradores não participam de retrospectivas.', 400)
}

export async function createRoom(input: {
  creatorId: string
  sprint: number
  squadIds: string[]
  votesPerParticipant: number
  participantIds: string[]
  companyId: string
}): Promise<RetroRoomWithRelations> {
  const creator = await prisma.user.findUnique({ where: { id: input.creatorId } })
  if (!creator || !creator.active || creator.leftAt) throw new RetroError('Criador inválido.', 400)
  if (!isLeaderRole(creator.role)) throw new RetroError('Apenas líderes abrem salas de retrospectiva.', 403)
  assertSprint(input.sprint)
  assertVotes(input.votesPerParticipant)
  const squadIds = [...new Set(input.squadIds)]
  if (squadIds.length === 0) throw new RetroError('Selecione ao menos uma squad.', 400)
  const db = scopedPrisma(input.companyId)
  // scopedPrisma já filtra squad de outra empresa pra fora do resultado — a checagem de
  // comprimento abaixo cobre tanto squad inativa/inexistente quanto squad de outra empresa.
  const squads = await db.squad.findMany({ where: { id: { in: squadIds } } })
  if (squads.length !== squadIds.length || squads.some((s) => !s.active)) {
    throw new RetroError('Squad inválida.', 400)
  }
  const invited = [...new Set(input.participantIds)].filter((id) => id !== input.creatorId)
  await assertInvitable(invited, input.companyId)
  const allParticipantIds = [input.creatorId, ...invited]
  return db.retroRoom.create({
    data: {
      sprint: input.sprint,
      createdById: input.creatorId,
      // Sala começa anônima (conteúdo oculto); o facilitador revela quando quiser.
      anonymous: true,
      votesPerParticipant: input.votesPerParticipant,
      squads: { create: squadIds.map((squadId) => ({ squadId })) },
      participants: { create: allParticipantIds.map((userId) => ({ userId })) },
    },
    include: retroRoomInclude,
  })
}

export async function listRoomsForUser(viewer: { id: string; role: string }, companyId: string): Promise<RetroRoomWithRelations[]> {
  const where: Prisma.RetroRoomWhereInput =
    isLeaderRole(viewer.role)
      ? { archivedAt: null }
      : { archivedAt: null, participants: { some: { userId: viewer.id } } }
  return scopedPrisma(companyId).retroRoom.findMany({ where, include: retroRoomInclude, orderBy: { createdAt: 'desc' } })
}

/** Lista todas as salas não arquivadas para gestão pelo admin (OPEN + CONCLUDED). */
export async function listRoomsForAdmin(companyId: string): Promise<RetroRoomWithRelations[]> {
  return scopedPrisma(companyId).retroRoom.findMany({
    where: { archivedAt: null },
    include: retroRoomInclude,
    orderBy: [{ sprint: 'desc' }, { createdAt: 'desc' }],
  })
}

/** Edita metadados da sala (sprint, squads, votos) — uso administrativo. */
export async function updateRoomAsAdmin(input: {
  roomId: string
  actorId: string
  companyId: string
  sprint?: number
  squadIds?: string[]
  votesPerParticipant?: number
}): Promise<RetroRoomWithRelations> {
  const db = scopedPrisma(input.companyId)
  const before = await loadRoom(input.roomId, input.companyId) // 404 se não existir / arquivada / outra empresa

  const data: Prisma.RetroRoomUpdateInput = {}
  if (input.sprint !== undefined) {
    assertSprint(input.sprint)
    data.sprint = input.sprint
  }
  if (input.votesPerParticipant !== undefined) {
    assertVotes(input.votesPerParticipant)
    data.votesPerParticipant = input.votesPerParticipant
  }

  let squadIds: string[] | null = null
  if (input.squadIds !== undefined) {
    squadIds = [...new Set(input.squadIds)]
    if (squadIds.length === 0) throw new RetroError('Selecione ao menos uma squad.', 400)
    const squads = await db.squad.findMany({ where: { id: { in: squadIds } } })
    if (squads.length !== squadIds.length || squads.some((s) => !s.active)) {
      throw new RetroError('Squad inválida.', 400)
    }
  }

  await db.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.retroRoom.update({ where: { id: input.roomId }, data })
    }
    if (squadIds) {
      await tx.retroRoomSquad.deleteMany({ where: { roomId: input.roomId } })
      await tx.retroRoomSquad.createMany({ data: squadIds.map((squadId) => ({ roomId: input.roomId, squadId })) })
    }
  })

  const after = await loadRoom(input.roomId, input.companyId)
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'RetroRoom',
    entityId: input.roomId,
    action: 'UPDATE',
    before: sanitizeRoomForAudit(before),
    after: sanitizeRoomForAudit(after),
    companyId: input.companyId,
  })
  return after
}

/** Exclusão definitiva da sala (cascata remove cards/votos/reações/participantes/squads/edits). */
export async function hardDeleteRoom(input: { roomId: string; actorId: string; companyId: string }): Promise<void> {
  const before = await loadRoom(input.roomId, input.companyId) // 404 se não existir / arquivada / outra empresa
  await scopedPrisma(input.companyId).retroRoom.delete({ where: { id: input.roomId } })
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'RetroRoom',
    entityId: input.roomId,
    action: 'DELETE',
    before: sanitizeRoomForAudit(before),
    companyId: input.companyId,
  })
}

export async function getRoomForViewer(
  roomId: string,
  viewer: { id: string; role: string },
  companyId: string,
): Promise<{ room: RetroRoomWithRelations; role: RetroRoomRole }> {
  const room = await loadRoom(roomId, companyId)
  const role = resolveRole(room, viewer)
  if (!role) throw new RetroError('Sala não encontrada.', 404)
  return { room, role }
}

export async function setParticipants(input: {
  roomId: string
  userId: string
  participantIds: string[]
  companyId: string
}): Promise<{ room: RetroRoomWithRelations; addedUserIds: string[] }> {
  const room = await loadRoom(input.roomId, input.companyId)
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador gerencia participantes.', 403)
  if (room.status === 'CONCLUDED') throw new RetroError('A sala foi concluída.', 409)
  const desired = new Set([room.createdById, ...input.participantIds])
  await assertInvitable([...desired].filter((id) => id !== room.createdById), input.companyId)
  const current = new Set(room.participants.map((p) => p.userId))
  const toAdd = [...desired].filter((id) => !current.has(id))
  const toRemove = [...current].filter((id) => !desired.has(id) && id !== room.createdById)
  const db = scopedPrisma(input.companyId)
  await db.$transaction([
    ...(toAdd.length ? [db.retroParticipant.createMany({ data: toAdd.map((userId) => ({ roomId: room.id, userId })) })] : []),
    ...(toRemove.length ? [db.retroParticipant.deleteMany({ where: { roomId: room.id, userId: { in: toRemove } } })] : []),
  ])
  return { room: await loadRoom(room.id, input.companyId), addedUserIds: toAdd }
}

export async function advancePhase(input: {
  roomId: string
  userId: string
  action: 'conclude'
  companyId: string
}): Promise<RetroRoomWithRelations> {
  const room = await loadRoom(input.roomId, input.companyId)
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador muda a fase.', 403)
  if (room.status !== 'OPEN') throw new RetroError('Transição de fase inválida.', 409)
  await scopedPrisma(input.companyId).retroRoom.update({ where: { id: room.id }, data: { status: 'CONCLUDED', concludedAt: new Date() } })
  return loadRoom(room.id, input.companyId)
}

export async function setAnonymous(input: {
  roomId: string
  userId: string
  anonymous: boolean
  companyId: string
}): Promise<RetroRoomWithRelations> {
  const room = await loadRoom(input.roomId, input.companyId)
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador muda o modo anônimo.', 403)
  if (room.status !== 'OPEN') throw new RetroError('Sala não está aberta.', 409)
  await scopedPrisma(input.companyId).retroRoom.update({ where: { id: room.id }, data: { anonymous: input.anonymous } })
  return loadRoom(room.id, input.companyId)
}

export async function updateTimer(input: {
  roomId: string
  userId: string
  companyId: string
  command: RetroTimerCommand
}): Promise<RetroRoomWithRelations> {
  const room = await loadRoom(input.roomId, input.companyId)
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador controla o cronômetro.', 403)
  if (room.status !== 'OPEN') throw new RetroError('Sala não está aberta.', 409)

  const now = new Date()
  const currentMode = timerModeFromDb(room.timerMode)
  // Countdown zerado conta como parado: o `RUNNING` que sobra no banco é resíduo,
  // não um cronômetro andando.
  const stillRunning = room.timerStatus === 'RUNNING' && !isCountdownFinished(room, now)
  const data: Prisma.RetroRoomUpdateInput = {
    timerUpdatedAt: now,
    timerUpdatedBy: { connect: { id: input.userId } },
  }

  switch (input.command.action) {
    case 'configure': {
      if (stillRunning) throw new RetroError('Pause o cronômetro antes de configurar.', 409)
      const mode = input.command.mode
      data.timerMode = timerModeToDb(mode)
      data.timerDurationSeconds = assertTimerDuration(mode, input.command.durationSeconds ?? null)
      data.timerStatus = 'IDLE'
      data.timerStartedAt = null
      data.timerAccumulatedSeconds = 0
      break
    }
    case 'start': {
      const mode = input.command.mode ?? currentMode
      const durationSeconds = mode === 'countdown'
        ? assertTimerDuration(mode, input.command.durationSeconds ?? room.timerDurationSeconds)
        : null
      data.timerMode = timerModeToDb(mode)
      data.timerDurationSeconds = durationSeconds
      data.timerStatus = 'RUNNING'
      data.timerStartedAt = now
      data.timerAccumulatedSeconds = 0
      break
    }
    case 'pause': {
      if (!stillRunning) throw new RetroError('Cronômetro não está rodando.', 409)
      data.timerStatus = 'PAUSED'
      data.timerStartedAt = null
      data.timerAccumulatedSeconds = elapsedTimerSeconds(room, now)
      break
    }
    case 'resume': {
      if (room.timerStatus !== 'PAUSED') throw new RetroError('Cronômetro não está pausado.', 409)
      data.timerStatus = 'RUNNING'
      data.timerStartedAt = now
      break
    }
    case 'reset': {
      const mode = input.command.mode ?? currentMode
      const durationSeconds = mode === 'countdown'
        ? assertTimerDuration(mode, input.command.durationSeconds ?? room.timerDurationSeconds)
        : null
      data.timerMode = timerModeToDb(mode)
      data.timerDurationSeconds = durationSeconds
      data.timerStatus = 'IDLE'
      data.timerStartedAt = null
      data.timerAccumulatedSeconds = 0
      break
    }
  }

  await scopedPrisma(input.companyId).retroRoom.update({ where: { id: room.id }, data })
  return loadRoom(room.id, input.companyId)
}

export async function getRoomMeta(roomId: string, companyId: string): Promise<RetroRoomMeta | null> {
  const room = await scopedPrisma(companyId).retroRoom.findUnique({
    where: { id: roomId },
    include: { participants: { select: { userId: true } } },
  })
  if (!room || room.archivedAt) return null
  return {
    id: room.id,
    status: room.status,
    anonymous: room.anonymous,
    createdById: room.createdById,
    votesPerParticipant: room.votesPerParticipant,
    participantUserIds: room.participants.map((p) => p.userId),
  }
}

export function countUserVotesInRoom(roomId: string, userId: string, companyId: string): Promise<number> {
  return scopedPrisma(companyId).retroVote.count({ where: { userId, card: { roomId } } })
}

export async function loadCard(roomId: string, cardId: string, companyId: string): Promise<RetroCardWithRelations> {
  const card = await scopedPrisma(companyId).retroCard.findFirst({
    where: { id: cardId, roomId },
    include: { author: true, votes: true, reactions: true, editedBy: true },
  })
  if (!card) throw new RetroError('Card não encontrado.', 404)
  return card
}

/** Facilitador ou participante (não observador). */
function assertParticipant(room: RetroRoomWithRelations, userId: string): void {
  const isParticipant = room.createdById === userId || room.participants.some((p) => p.userId === userId)
  if (!isParticipant) throw new RetroError('Apenas participantes da sala podem fazer isso.', 403)
}
function assertOpen(room: RetroRoomWithRelations): void {
  if (room.status !== 'OPEN') throw new RetroError('A sala foi concluída.', 409)
}
function assertText(text: string): string {
  const t = text.trim()
  if (t.length === 0) throw new RetroError('O card não pode ser vazio.', 400)
  if (t.length > MAX_CARD_LENGTH) throw new RetroError('Card muito longo.', 400)
  return t
}
function assertColor(color: string): RetroCardColor {
  if (!(RETRO_CARD_COLORS as readonly string[]).includes(color)) throw new RetroError('Cor inválida.', 400)
  return color as RetroCardColor
}
function assertKind(kind: string): RetroCardKind {
  if (!(RETRO_CARD_KINDS as readonly string[]).includes(kind)) throw new RetroError('Tipo de card inválido.', 400)
  return kind as RetroCardKind
}
function assertShape(shape: string | undefined, kind: RetroCardKind): RetroShape | null {
  if (kind === 'note') return null
  if (!shape || !(RETRO_SHAPES as readonly string[]).includes(shape)) throw new RetroError('Forma inválida.', 400)
  return shape as RetroShape
}
function assertShapeStyle(style: string | undefined, kind: RetroCardKind): RetroShapeStyle | null {
  if (kind === 'note') return null
  const value = style ?? 'solid'
  if (!(RETRO_SHAPE_STYLES as readonly string[]).includes(value)) throw new RetroError('Estilo de forma inválido.', 400)
  return value as RetroShapeStyle
}
function assertDimension(value: number | undefined, fallback: number): number {
  const n = value ?? fallback
  if (!Number.isFinite(n) || n < 24 || n > 640) throw new RetroError('Dimensão inválida.', 400)
  return n
}
function optionalText(value: string | undefined, max: number): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > max) throw new RetroError('Campo muito longo.', 400)
  return trimmed
}
function isCardInRegion(card: { x: number; y: number }, regionId: string): boolean {
  const region = RETRO_REGIONS.find((r) => r.id === regionId)
  if (!region) return false
  const cx = card.x + POSTIT_WIDTH / 2
  const cy = card.y + POSTIT_HEIGHT / 2
  return cx >= region.x && cx <= region.x + region.w && cy >= region.y && cy <= region.y + region.h
}
function isActionCard(card: { kind: string; x: number; y: number }): boolean {
  return card.kind === 'note' && RETRO_ACTION_REGION_IDS.some((rid) => isCardInRegion(card, rid))
}
export function logEdit(roomId: string, editorId: string, action: string, detail: string | null, companyId: string): Promise<unknown> {
  return scopedPrisma(companyId).retroEdit.create({ data: { roomId, editorId, action, detail } })
}
/** `actionResponsible` guarda o ID do usuário; resolvemos para o nome ao montar o texto. */
async function resolveResponsibleName(responsibleId: string | null, companyId: string): Promise<string | null> {
  if (!responsibleId) return responsibleId
  const user = await scopedPrisma(companyId).user.findUnique({ where: { id: responsibleId }, select: { name: true } })
  return user?.name ?? responsibleId
}
/** `actionDueDate` vem do input HTML como AAAA-MM-DD; exibimos como DD-MM-AAAA. */
function formatDueDate(value: string | null): string | null {
  if (!value) return value
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : value
}
function actionCardText(card: { text: string; actionPlan: string | null; actionDueDate: string | null }, responsibleName: string | null): string {
  return [
    `Plano: ${card.actionPlan ?? '—'}`,
    `Responsável: ${responsibleName ?? '—'}`,
    `Prazo: ${formatDueDate(card.actionDueDate) ?? '—'}`,
    '',
    `Origem: ${card.text}`,
  ].join('\n')
}
/** Garante que o responsável (quando informado) é um usuário válido da mesma empresa — base para o futuro vínculo com o perfil. */
async function assertResponsible(responsibleId: string | null | undefined, companyId: string): Promise<void> {
  if (!responsibleId) return
  const user = await scopedPrisma(companyId).user.findUnique({ where: { id: responsibleId }, select: { id: true } })
  if (!user) throw new RetroError('Responsável inválido.', 400)
}
async function countCarryover(room: RetroRoomWithRelations): Promise<number> {
  const sources = await priorConcludedSquadRooms(room)
  if (sources.length === 0) return 0
  const cards = await scopedPrisma(room.companyId).retroCard.findMany({
    where: { roomId: { in: sources.map((s) => s.id) }, actionPlan: { not: null }, actionResponsible: { not: null }, actionDueDate: { not: null } },
    select: { actionDone: true, auditStatus: true, actionDueDate: true },
  })
  const roomDate = room.createdAt.toISOString().slice(0, 10)
  const toValidate = cards.filter((c) => c.actionDone && c.auditStatus == null).length
  const overdue = cards.filter((c) => !c.actionDone && (c.actionDueDate ?? '') <= roomDate).length
  return toValidate + overdue
}
async function upsertActionCard(room: RetroRoomWithRelations, source: RetroCardWithRelations): Promise<{ card: RetroCardWithRelations | null; created: boolean }> {
  if (source.kind !== 'note') return { card: null, created: false }
  if (!RETRO_ACTION_REGION_IDS.some((rid) => isCardInRegion(source, rid))) return { card: null, created: false }
  const db = scopedPrisma(room.companyId)

  const text = actionCardText(source, await resolveResponsibleName(source.actionResponsible, room.companyId))
  // Espelho já existe: mantém sempre em sincronia com a origem (reflete qualquer edição, mesmo parcial).
  if (source.actionCardId) {
    const existing = await db.retroCard.findFirst({ where: { id: source.actionCardId, roomId: room.id } })
    if (existing) {
      await db.retroCard.update({ where: { id: existing.id }, data: { text } })
      return { card: await loadCard(room.id, existing.id, room.companyId), created: false }
    }
  }

  // Ainda sem espelho: só cria quando a ação está completa (plano + responsável + prazo).
  if (!source.actionPlan || !source.actionResponsible || !source.actionDueDate) return { card: null, created: false }

  const actions = RETRO_REGIONS.find((r) => r.id === 'actions')
  const actionCount = await db.retroCard.count({ where: { roomId: room.id, x: { gte: actions?.x ?? 0 } } })
  // Novo espelho entra logo na sequência dos cards de carry-over (fixos no topo), grade única de 240px.
  const slot = (await countCarryover(room)) + actionCount
  const x = (actions?.x ?? 2320) + 40 + (slot % 4) * 240
  const y = (actions?.y ?? 280) + 80 + Math.floor(slot / 4) * 240
  const created = await db.retroCard.create({
    data: { roomId: room.id, authorId: source.authorId, text, color: 'blue', kind: 'note', x, y },
  })
  await db.retroCard.update({ where: { id: source.id }, data: { actionCardId: created.id } })
  return { card: await loadCard(room.id, created.id, room.companyId), created: true }
}

export async function createCard(input: {
  roomId: string
  userId: string
  companyId: string
  text?: string
  color: string
  x: number
  y: number
  kind?: string
  shape?: string
  shapeStyle?: string
  width?: number
  height?: number
  actionPlan?: string
  actionResponsible?: string
  actionDueDate?: string
}): Promise<RetroCardWithRelations> {
  const room = await loadRoom(input.roomId, input.companyId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  const kind = assertKind(input.kind ?? 'note')
  const text = kind === 'note' ? assertText(input.text ?? '') : (input.text ?? '').trim().slice(0, MAX_CARD_LENGTH)
  const color = assertColor(input.color)
  const shape = assertShape(input.shape, kind)
  const shapeStyle = assertShapeStyle(input.shapeStyle, kind)
  const width = kind === 'shape' ? assertDimension(input.width, SHAPE_WIDTH) : null
  const height = kind === 'shape' ? assertDimension(input.height, SHAPE_HEIGHT) : null
  const actionPlan = optionalText(input.actionPlan, MAX_CARD_LENGTH)
  const actionResponsible = optionalText(input.actionResponsible, 120)
  await assertResponsible(actionResponsible, input.companyId)
  const actionDueDate = optionalText(input.actionDueDate, 20)
  const created = await scopedPrisma(input.companyId).retroCard.create({
    data: { roomId: room.id, authorId: input.userId, text, color, kind, shape, shapeStyle, width, height, actionPlan, actionResponsible, actionDueDate, x: input.x, y: input.y },
  })
  return loadCard(room.id, created.id, input.companyId)
}

export async function updateCard(input: {
  roomId: string
  cardId: string
  userId: string
  companyId: string
  role?: string  // opcional: chamadas legadas (OPEN) não precisam; ausente = trata como não-LEAD
  text?: string
  color?: string
  shape?: string
  shapeStyle?: string
  width?: number
  height?: number
  actionPlan?: string
  actionResponsible?: string
  actionDueDate?: string
}): Promise<UpdateCardResult> {
  const room = await loadRoom(input.roomId, input.companyId)
  const card = await loadCard(input.roomId, input.cardId, input.companyId)
  const postConclusion = room.status === 'CONCLUDED'
  if (postConclusion) {
    if (!isLeaderRole(input.role)) throw new RetroError('A sala foi concluída.', 409)
    if (!isActionCard(card)) throw new RetroError('Após concluir, só action cards podem ser editados.', 409)
  } else {
    if (card.authorId !== input.userId) throw new RetroError('Apenas o autor edita o card.', 403)
  }
  const kind = assertKind(card.kind)
  const data: {
    text?: string
    color?: RetroCardColor
    shape?: RetroShape | null
    shapeStyle?: RetroShapeStyle | null
    width?: number
    height?: number
    actionPlan?: string | null
    actionResponsible?: string | null
    actionDueDate?: string | null
    editedById?: string
    editedAt?: Date
  } = {}
  if (input.text !== undefined) data.text = assertText(input.text)
  if (input.color !== undefined) data.color = assertColor(input.color)
  if (input.shape !== undefined) data.shape = assertShape(input.shape, kind)
  if (input.shapeStyle !== undefined) data.shapeStyle = assertShapeStyle(input.shapeStyle, kind)
  if (input.width !== undefined) data.width = assertDimension(input.width, card.width ?? SHAPE_WIDTH)
  if (input.height !== undefined) data.height = assertDimension(input.height, card.height ?? SHAPE_HEIGHT)
  if (input.actionPlan !== undefined) data.actionPlan = optionalText(input.actionPlan, MAX_CARD_LENGTH)
  if (input.actionResponsible !== undefined) {
    data.actionResponsible = optionalText(input.actionResponsible, 120)
    await assertResponsible(data.actionResponsible, input.companyId)
  }
  if (input.actionDueDate !== undefined) data.actionDueDate = optionalText(input.actionDueDate, 20)
  if (postConclusion) {
    data.editedById = input.userId
    data.editedAt = new Date()
  }
  if (Object.keys(data).length > 0) await scopedPrisma(input.companyId).retroCard.update({ where: { id: card.id }, data })
  const updated = await loadCard(input.roomId, card.id, input.companyId)
  if (postConclusion) await logEdit(room.id, input.userId, 'action.updated', updated.actionPlan ?? updated.text, input.companyId)
  const action = await upsertActionCard(room, updated)
  const refreshed = action.created ? await loadCard(input.roomId, card.id, input.companyId) : updated
  return { card: refreshed, actionCard: action.card, actionCardCreated: action.created }
}

/** Qualquer participante pode mover qualquer card (canvas livre). */
export async function updateCardPosition(input: {
  roomId: string
  cardId: string
  userId: string
  companyId: string
  x: number
  y: number
}): Promise<{ x: number; y: number }> {
  const room = await loadRoom(input.roomId, input.companyId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  const card = await loadCard(input.roomId, input.cardId, input.companyId)
  await scopedPrisma(input.companyId).retroCard.update({ where: { id: card.id }, data: { x: input.x, y: input.y } })
  return { x: input.x, y: input.y }
}

export async function deleteCard(input: { roomId: string; cardId: string; userId: string; companyId: string }): Promise<void> {
  const room = await loadRoom(input.roomId, input.companyId)
  assertOpen(room)
  const card = await loadCard(input.roomId, input.cardId, input.companyId)
  if (card.authorId !== input.userId) throw new RetroError('Apenas o autor exclui o card.', 403)
  await scopedPrisma(input.companyId).retroCard.delete({ where: { id: card.id } })
}

export async function addVote(input: { roomId: string; cardId: string; userId: string; companyId: string }): Promise<{ voteCount: number }> {
  const room = await loadRoom(input.roomId, input.companyId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  await loadCard(input.roomId, input.cardId, input.companyId)
  const used = await countUserVotesInRoom(input.roomId, input.userId, input.companyId)
  if (used >= room.votesPerParticipant) throw new RetroError('Você já usou todos os seus votos.', 409)
  const db = scopedPrisma(input.companyId)
  await db.retroVote.create({ data: { cardId: input.cardId, userId: input.userId } })
  return { voteCount: await db.retroVote.count({ where: { cardId: input.cardId } }) }
}

export async function removeVote(input: { roomId: string; cardId: string; userId: string; companyId: string }): Promise<{ voteCount: number }> {
  const room = await loadRoom(input.roomId, input.companyId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  await loadCard(input.roomId, input.cardId, input.companyId)
  const db = scopedPrisma(input.companyId)
  const one = await db.retroVote.findFirst({
    where: { cardId: input.cardId, userId: input.userId, card: { roomId: input.roomId } },
    orderBy: { createdAt: 'desc' },
  })
  if (one) await db.retroVote.delete({ where: { id: one.id } })
  return { voteCount: await db.retroVote.count({ where: { cardId: input.cardId } }) }
}

export async function toggleReaction(input: {
  roomId: string
  cardId: string
  userId: string
  emoji: string
  companyId: string
}): Promise<RetroCardWithRelations> {
  if (!(RETRO_REACTION_EMOJIS as readonly string[]).includes(input.emoji)) throw new RetroError('Reação inválida.', 400)
  const room = await loadRoom(input.roomId, input.companyId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  await loadCard(input.roomId, input.cardId, input.companyId)
  const db = scopedPrisma(input.companyId)
  const existing = await db.retroReaction.findUnique({
    where: { cardId_userId_emoji: { cardId: input.cardId, userId: input.userId, emoji: input.emoji } },
  })
  if (existing) await db.retroReaction.delete({ where: { id: existing.id } })
  else await db.retroReaction.create({ data: { cardId: input.cardId, userId: input.userId, emoji: input.emoji } })
  return loadCard(input.roomId, input.cardId, input.companyId)
}

export async function updateAction(input: {
  cardId: string
  userId: string
  done?: boolean
  note?: string
  archived?: boolean
  companyId: string
}) {
  const db = scopedPrisma(input.companyId)
  const card = await db.retroCard.findUnique({
    where: { id: input.cardId },
    include: { room: { select: { sprint: true, archivedAt: true } } },
  })
  if (!card || card.room.archivedAt || !card.actionPlan || !card.actionResponsible || !card.actionDueDate) {
    throw new RetroError('Ação não encontrada.', 404)
  }
  if (card.actionResponsible !== input.userId) throw new RetroError('Apenas o responsável trata a ação.', 403)
  const data: Prisma.RetroCardUncheckedUpdateInput = {}
  if (input.done !== undefined) {
    // Espelha o comportamento anterior de setActionDone: concluir/reabrir reseta a auditoria.
    data.actionDone = input.done
    data.actionDoneAt = input.done ? new Date() : null
    data.auditStatus = null
    data.auditedById = null
    data.auditedAt = null
    // Reabrir traz de volta para a lista: ação pendente escondida é ação
    // esquecida, que é justamente o que a seção existe para evitar.
    if (!input.done) data.actionArchivedAt = null
  }
  if (input.archived !== undefined) {
    // Só arquiva o que está concluído — inclusive quando a conclusão vem na
    // mesma chamada. A regra é do servidor, não só do botão: esconder ação em
    // aberto some com a pendência sem resolvê-la.
    const ficaConcluida = input.done ?? card.actionDone
    if (input.archived && !ficaConcluida) throw new RetroError('Só dá para arquivar ação concluída.', 409)
    data.actionArchivedAt = input.archived ? new Date() : null
  }
  if (input.note !== undefined) {
    const trimmed = input.note.trim()
    data.actionNote = trimmed.length === 0 ? null : trimmed
  }
  return db.retroCard.update({
    where: { id: card.id },
    data,
    include: { room: { select: { sprint: true, squads: { select: { squad: { select: { name: true } } } } } } },
  })
}


export async function listEdits(roomId: string, viewer: { id: string; role: string }, companyId: string) {
  const room = await loadRoom(roomId, companyId)
  if (!resolveRole(room, viewer)) throw new RetroError('Sala não encontrada.', 404)
  return scopedPrisma(companyId).retroEdit.findMany({
    where: { roomId },
    include: { editor: true },
    orderBy: { createdAt: 'desc' },
  })
}

function priorConcludedSquadRooms(room: { id: string; companyId: string; createdAt: Date; squads: { squadId: string }[] }) {
  const squadIds = room.squads.map((s) => s.squadId)
  if (squadIds.length === 0) return Promise.resolve([] as { id: string; sprint: number }[])
  return scopedPrisma(room.companyId).retroRoom.findMany({
    where: { id: { not: room.id }, archivedAt: null, status: 'CONCLUDED', concludedAt: { lt: room.createdAt }, squads: { some: { squadId: { in: squadIds } } } },
    select: { id: true, sprint: true },
  })
}

export async function listCarryover(roomId: string, viewer: { id: string; role: string }, companyId: string) {
  const room = await loadRoom(roomId, companyId)
  if (!resolveRole(room, viewer)) throw new RetroError('Sala não encontrada.', 404)
  const sources = await priorConcludedSquadRooms(room)
  if (sources.length === 0) return { toValidate: [], overdue: [] }
  const sprintByRoom = new Map(sources.map((s) => [s.id, s.sprint]))
  const db = scopedPrisma(companyId)
  const cards = await db.retroCard.findMany({
    where: { roomId: { in: sources.map((s) => s.id) }, actionPlan: { not: null }, actionResponsible: { not: null }, actionDueDate: { not: null } },
    include: { author: true },
  })
  const roomDate = room.createdAt.toISOString().slice(0, 10)
  const toValidate = cards.filter((c) => c.actionDone && c.auditStatus == null)
    .sort((a, b) => (b.actionDoneAt?.getTime() ?? 0) - (a.actionDoneAt?.getTime() ?? 0))
  const overdue = cards.filter((c) => !c.actionDone && (c.actionDueDate ?? '') <= roomDate)
    .sort((a, b) => (a.actionDueDate ?? '').localeCompare(b.actionDueDate ?? ''))
  const respIds = [...new Set([...toValidate, ...overdue].map((c) => c.actionResponsible).filter((x): x is string => Boolean(x)))]
  const users = await db.user.findMany({ where: { id: { in: respIds } } })
  const byId = new Map(users.map((u) => [u.id, u]))
  const item = (c: (typeof cards)[number]) => ({
    card: c,
    responsible: c.actionResponsible ? byId.get(c.actionResponsible) ?? null : null,
    sprint: sprintByRoom.get(c.roomId) ?? 0,
  })
  return { toValidate: toValidate.map(item), overdue: overdue.map(item) }
}

export async function setCarryover(input: {
  roomId: string
  cardId: string
  userId: string
  role: string
  action: 'validate' | 'reject' | 'reschedule' | 'done'
  dueDate?: string
  companyId: string
}): Promise<{ card: RetroCard; responsible: User | null; sprint: number }> {
  const room = await loadRoom(input.roomId, input.companyId)
  if (!resolveRole(room, { id: input.userId, role: input.role })) throw new RetroError('Sala não encontrada.', 404)
  if (!isLeaderRole(input.role)) throw new RetroError('Apenas líderes resolvem ações de outras sprints.', 403)
  const sources = await priorConcludedSquadRooms(room)
  const db = scopedPrisma(input.companyId)
  const card = await db.retroCard.findFirst({
    where: { id: input.cardId, roomId: { in: sources.map((s) => s.id) }, actionPlan: { not: null }, actionResponsible: { not: null }, actionDueDate: { not: null } },
  })
  if (!card) throw new RetroError('Ação não encontrada para esta sala.', 404)
  const now = new Date()
  let data: Record<string, unknown>
  if (input.action === 'validate') data = { auditStatus: 'VALIDATED', auditedById: input.userId, auditedAt: now }
  // Reprovar reabre a ação — e desarquiva junto, senão ela voltaria a pendente
  // escondida da lista de quem precisa refazê-la.
  else if (input.action === 'reject') data = { auditStatus: 'REJECTED', auditedById: input.userId, auditedAt: now, actionDone: false, actionDoneAt: null, actionArchivedAt: null }
  else if (input.action === 'done') data = { actionDone: true, actionDoneAt: now, auditStatus: null, auditedById: null, auditedAt: null }
  else {
    const due = optionalText(input.dueDate, 20)
    if (!due) throw new RetroError('Novo prazo inválido.', 400)
    data = { actionDueDate: due }
  }
  await db.retroCard.update({ where: { id: card.id }, data })
  const updated = await loadCard(card.roomId, card.id, input.companyId)
  const sourceRoom = await loadRoom(card.roomId, input.companyId)
  if (input.action === 'reschedule') {
    await upsertActionCard(sourceRoom, updated)
  }
  const responsible = updated.actionResponsible ? await db.user.findUnique({ where: { id: updated.actionResponsible } }) : null
  return { card: updated, responsible, sprint: sourceRoom.sprint }
}

export async function archiveRoom(input: { roomId: string; userId: string; companyId: string }): Promise<void> {
  const before = await loadRoom(input.roomId, input.companyId)
  await scopedPrisma(input.companyId).retroRoom.update({
    where: { id: input.roomId },
    data: { archivedAt: new Date(), archivedById: input.userId },
  })
  await recordAuditLog({
    actorId: input.userId,
    entityType: 'RetroRoom',
    entityId: input.roomId,
    action: 'DELETE',
    before: sanitizeRoomForAudit(before),
    companyId: input.companyId,
  })
}
