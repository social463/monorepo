/**
 * Reuniões marcadas em salas do escritório. A sala é identificada por
 * `(companyId, roomExternalKey)`, nunca por `OfficeRoom.id`: aquelas linhas são
 * recriadas a cada publicação de mapa (ver office-map-service.publishMap), e uma
 * FK morreria no primeiro publish.
 *
 * Reserva é leve: conflito de horário vira 409 informativo, e o chamador decide
 * marcar mesmo assim com `force`. Nada aqui altera status ou accessPolicy da sala.
 */
import {
  MEETING_AGENDA_MAX_LENGTH,
  MEETING_TITLE_MAX_LENGTH,
  officeRoomDeepLinkPath,
  type MeetingDurationMinutes,
  type OfficeMeetingDTO,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { toCalendarMeeting, toOfficeMeetingDTO, type MeetingWithPeople } from '../lib/serialize'
import { buildMeetingIcs } from '../lib/calendar-export'
import { createNotification } from './notification-service'
import { OfficeMapError, getActiveOfficeMap } from './office-map-service'

export class OfficeMeetingError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'OfficeMeetingError'
  }
}

/** 409 com a lista do que colide — o front oferece "marcar mesmo assim". */
export class OfficeMeetingConflictError extends Error {
  public status = 409
  constructor(public conflicts: OfficeMeetingDTO[]) {
    super('A sala já tem reunião marcada nesse horário')
    this.name = 'OfficeMeetingConflictError'
  }
}

export const MEETING_INCLUDE = {
  organizer: { select: { id: true, name: true, email: true } },
  participants: { include: { user: { select: { id: true, name: true, email: true } } } },
} as const

export interface CreateMeetingInput {
  companyId: string
  organizerId: string
  roomExternalKey: string
  title: string
  agenda: string | null
  startsAt: Date
  durationMinutes: MeetingDurationMinutes
  participantIds: string[]
  force?: boolean
}

function endFrom(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + durationMinutes * 60_000)
}

/**
 * Nome da sala no mapa ativo. Sala que não existe lá é 404 — e escritório sem
 * mapa publicado também: `getActiveOfficeMap` lança `OfficeMapError`, que a
 * route não sabe traduzir (`sendDomainError` só conhece `OfficeMeetingError`) e
 * viraria 500. Traduzimos aqui, mantendo a route fina.
 */
async function resolveRoomName(companyId: string, roomExternalKey: string): Promise<string> {
  let active
  try {
    active = await getActiveOfficeMap(companyId)
  } catch (err) {
    if (err instanceof OfficeMapError) throw new OfficeMeetingError(err.message, err.status)
    throw err
  }
  const room = active.rooms.find((r) => r.externalKey === roomExternalKey)
  if (!room) throw new OfficeMeetingError('Sala não encontrada no mapa ativo', 404)
  return room.name
}

function assertTexts(title: string, agenda: string | null): void {
  if (title.trim().length === 0) throw new OfficeMeetingError('Informe um título para a reunião')
  if (title.length > MEETING_TITLE_MAX_LENGTH) throw new OfficeMeetingError('Título muito longo')
  if (agenda && agenda.length > MEETING_AGENDA_MAX_LENGTH) throw new OfficeMeetingError('Pauta muito longa')
}

/**
 * O organizador nunca entra na própria lista de convidados: ele já é
 * `ORGANIZER` no .ics e não deve receber convite de si mesmo (mesmo cuidado de
 * `notifyRetroInvited`/`notifyReviewMention`, que tiram o `actorId`).
 */
function withoutOrganizer(participantIds: string[], organizerId: string): string[] {
  return participantIds.filter((id) => id !== organizerId)
}

/** Participantes precisam existir e ser da mesma empresa. */
async function assertParticipants(companyId: string, participantIds: string[]): Promise<void> {
  if (participantIds.length === 0) return
  const db = scopedPrisma(companyId)
  const found = await db.user.findMany({ where: { id: { in: participantIds } }, select: { id: true } })
  if (found.length !== new Set(participantIds).size) {
    throw new OfficeMeetingError('Participante inválido')
  }
}

/**
 * Reuniões não canceladas da sala que se sobrepõem à janela. Sobreposição é
 * estrita (`início < fimNovo && fim > inícioNovo`): reunião que começa
 * exatamente quando a outra acaba não conflita.
 */
async function findConflicts(
  companyId: string,
  roomExternalKey: string,
  startsAt: Date,
  endsAt: Date,
  ignoreMeetingId?: string,
): Promise<OfficeMeetingDTO[]> {
  const db = scopedPrisma(companyId)
  const rows = await db.officeMeeting.findMany({
    where: {
      roomExternalKey,
      canceledAt: null,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(ignoreMeetingId ? { id: { not: ignoreMeetingId } } : {}),
    },
    include: MEETING_INCLUDE,
    orderBy: { startsAt: 'asc' },
  })
  return rows.map((row) => toOfficeMeetingDTO(row as MeetingWithPeople))
}

/** Notifica convidados (e, em update/cancel, também o organizador). */
/** Quantas notificações de reunião saem em paralelo. */
const NOTIFY_CONCURRENCY = 10

async function notifyPeople(
  userIds: string[],
  companyId: string,
  actorId: string,
  type: 'MEETING_INVITED' | 'MEETING_UPDATED' | 'MEETING_CANCELED' | 'MEETING_REMINDER',
  title: string,
  roomExternalKey: string,
): Promise<void> {
  // Em lotes, não uma a uma: com "empresa inteira" a um clique de distância,
  // esta lista passou a poder ter centenas de nomes, e cada notificação é uma
  // transação (mais um POST ao Teams de quem tem webhook). Serial, isso deixava
  // a resposta do POST /office/meetings esperando por todas elas. O teto de
  // paralelismo é baixo de propósito: o objetivo é encurtar a espera, não
  // afogar o Postgres nem o webhook de ninguém.
  for (let start = 0; start < userIds.length; start += NOTIFY_CONCURRENCY) {
    await Promise.all(
      userIds.slice(start, start + NOTIFY_CONCURRENCY).map(async (userId) => {
        try {
          await createNotification({
            userId,
            type,
            title,
            actorId,
            link: officeRoomDeepLinkPath(roomExternalKey),
            companyId,
          })
        } catch (err) {
          // Best-effort, igual ao resto do office: a reunião já está persistida.
          console.error(`[office-meeting] falha ao notificar ${userId}`, err)
        }
      }),
    )
  }
}

/** Texto de convite — usado na criação e para quem entrou numa edição. */
function inviteText(organizerName: string, title: string, roomName: string, startsAt: Date): string {
  return `${organizerName} marcou "${title}" na sala ${roomName} em ${meetingWhen(startsAt)}`
}

function meetingWhen(startsAt: Date): string {
  return startsAt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export async function createOfficeMeeting(input: CreateMeetingInput): Promise<OfficeMeetingDTO> {
  assertTexts(input.title, input.agenda)
  if (input.startsAt.getTime() <= Date.now()) {
    throw new OfficeMeetingError('Escolha um horário no futuro')
  }
  const roomName = await resolveRoomName(input.companyId, input.roomExternalKey)
  const participantIds = withoutOrganizer(input.participantIds, input.organizerId)
  await assertParticipants(input.companyId, participantIds)

  const endsAt = endFrom(input.startsAt, input.durationMinutes)
  if (!input.force) {
    const conflicts = await findConflicts(input.companyId, input.roomExternalKey, input.startsAt, endsAt)
    if (conflicts.length > 0) throw new OfficeMeetingConflictError(conflicts)
  }

  const db = scopedPrisma(input.companyId)
  const created = await db.officeMeeting.create({
    data: {
      roomExternalKey: input.roomExternalKey,
      roomName,
      title: input.title.trim(),
      agenda: input.agenda?.trim() || null,
      startsAt: input.startsAt,
      endsAt,
      organizerId: input.organizerId,
      participants: { create: participantIds.map((userId) => ({ userId })) },
    },
    include: MEETING_INCLUDE,
  })

  const dto = toOfficeMeetingDTO(created as MeetingWithPeople)
  await notifyPeople(
    participantIds,
    input.companyId,
    input.organizerId,
    'MEETING_INVITED',
    inviteText(created.organizer.name, dto.title, roomName, created.startsAt),
    input.roomExternalKey,
  )
  return dto
}

/** Agenda da sala numa janela — inclui canceladas, que o front mostra riscadas. */
export async function listRoomMeetings(
  companyId: string,
  roomExternalKey: string,
  from: Date,
  to: Date,
): Promise<OfficeMeetingDTO[]> {
  const db = scopedPrisma(companyId)
  const rows = await db.officeMeeting.findMany({
    where: { roomExternalKey, startsAt: { gte: from, lt: to } },
    include: MEETING_INCLUDE,
    orderBy: { startsAt: 'asc' },
  })
  return rows.map((row) => toOfficeMeetingDTO(row as MeetingWithPeople))
}

/**
 * Agenda da empresa no intervalo, para o Calendário. Diferente da agenda da
 * sala, aqui reunião cancelada não aparece: o calendário mostra o que vai
 * acontecer, não o histórico do que foi desmarcado.
 */
export async function listCompanyMeetings(
  companyId: string,
  opts: { participantId: string | null; from: Date; to: Date },
): Promise<OfficeMeetingDTO[]> {
  const db = scopedPrisma(companyId)
  const rows = await db.officeMeeting.findMany({
    where: {
      startsAt: { gte: opts.from, lt: opts.to },
      canceledAt: null,
      ...(opts.participantId
        ? {
            OR: [
              { organizerId: opts.participantId },
              { participants: { some: { userId: opts.participantId } } },
            ],
          }
        : {}),
    },
    include: MEETING_INCLUDE,
    orderBy: { startsAt: 'asc' },
  })
  return rows.map((row) => toOfficeMeetingDTO(row as MeetingWithPeople))
}

export interface UpdateMeetingPatch {
  title?: string
  agenda?: string | null
  startsAt?: Date
  durationMinutes?: MeetingDurationMinutes
  participantIds?: string[]
  force?: boolean
}

/** Carrega a reunião no escopo da empresa. Fora do escopo = 404, nunca 403. */
async function loadMeeting(meetingId: string, companyId: string) {
  const db = scopedPrisma(companyId)
  const meeting = await db.officeMeeting.findUnique({ where: { id: meetingId }, include: MEETING_INCLUDE })
  if (!meeting) throw new OfficeMeetingError('Reunião não encontrada', 404)
  return meeting
}

export async function updateOfficeMeeting(
  meetingId: string,
  userId: string,
  companyId: string,
  patch: UpdateMeetingPatch,
): Promise<OfficeMeetingDTO> {
  const meeting = await loadMeeting(meetingId, companyId)
  if (meeting.organizerId !== userId) {
    throw new OfficeMeetingError('Só quem marcou pode editar a reunião', 403)
  }
  if (meeting.canceledAt) throw new OfficeMeetingError('Reunião já cancelada', 409)

  const title = patch.title ?? meeting.title
  const agenda = patch.agenda === undefined ? meeting.agenda : patch.agenda
  assertTexts(title, agenda)

  const startsAt = patch.startsAt ?? meeting.startsAt
  const durationMinutes =
    patch.durationMinutes ?? Math.round((meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 60_000)
  const endsAt = endFrom(startsAt, durationMinutes)

  const horarioMudou = startsAt.getTime() !== meeting.startsAt.getTime() || endsAt.getTime() !== meeting.endsAt.getTime()
  if (horarioMudou && startsAt.getTime() <= Date.now()) {
    throw new OfficeMeetingError('Escolha um horário no futuro')
  }
  if (horarioMudou && !patch.force) {
    const conflicts = await findConflicts(companyId, meeting.roomExternalKey, startsAt, endsAt, meeting.id)
    if (conflicts.length > 0) throw new OfficeMeetingConflictError(conflicts)
  }

  const participantIds = patch.participantIds
    ? withoutOrganizer(patch.participantIds, meeting.organizerId)
    : undefined
  if (participantIds) await assertParticipants(companyId, participantIds)

  const previousParticipantIds = meeting.participants.map((p) => p.userId)

  const db = scopedPrisma(companyId)
  const updated = await db.officeMeeting.update({
    where: { id: meeting.id },
    data: {
      title: title.trim(),
      agenda: agenda?.trim() || null,
      startsAt,
      endsAt,
      sequence: { increment: 1 },
      // Horário novo, lembrete novo — o do horário antigo não vale mais.
      ...(horarioMudou ? { remindedAt: null } : {}),
      ...(participantIds
        ? {
            participants: {
              deleteMany: {},
              create: participantIds.map((id) => ({ userId: id })),
            },
          }
        : {}),
    },
    include: MEETING_INCLUDE,
  })

  const dto = toOfficeMeetingDTO(updated as MeetingWithPeople)

  // Três grupos, três avisos diferentes: quem entrou agora nunca ouviu falar da
  // reunião (é convite, não "mudou"), quem saiu precisa saber que caiu da lista
  // — e não que a reunião foi cancelada, porque ela continua de pé.
  const currentIds = dto.participants.map((p) => p.id)
  const added = currentIds.filter((id) => !previousParticipantIds.includes(id))
  const kept = currentIds.filter((id) => previousParticipantIds.includes(id))
  const removed = previousParticipantIds.filter((id) => !currentIds.includes(id))

  await notifyPeople(
    added,
    companyId,
    userId,
    'MEETING_INVITED',
    inviteText(updated.organizer.name, dto.title, dto.roomName, updated.startsAt),
    dto.roomExternalKey,
  )
  await notifyPeople(
    kept,
    companyId,
    userId,
    'MEETING_UPDATED',
    `"${dto.title}" mudou: agora é ${meetingWhen(updated.startsAt)} na sala ${dto.roomName}`,
    dto.roomExternalKey,
  )
  await notifyPeople(
    removed,
    companyId,
    userId,
    'MEETING_CANCELED',
    `Você saiu da lista de "${dto.title}" na sala ${dto.roomName} — a reunião continua marcada, mas sem você`,
    dto.roomExternalKey,
  )
  return dto
}

export async function cancelOfficeMeeting(
  meetingId: string,
  userId: string,
  companyId: string,
): Promise<OfficeMeetingDTO> {
  const meeting = await loadMeeting(meetingId, companyId)
  if (meeting.organizerId !== userId) {
    throw new OfficeMeetingError('Só quem marcou pode cancelar a reunião', 403)
  }
  if (meeting.canceledAt) throw new OfficeMeetingError('Reunião já cancelada', 409)

  const db = scopedPrisma(companyId)
  const canceled = await db.officeMeeting.update({
    where: { id: meeting.id },
    data: { canceledAt: new Date(), sequence: { increment: 1 } },
    include: MEETING_INCLUDE,
  })

  const dto = toOfficeMeetingDTO(canceled as MeetingWithPeople)
  await notifyPeople(
    dto.participants.map((p) => p.id),
    companyId,
    userId,
    'MEETING_CANCELED',
    `"${dto.title}" na sala ${dto.roomName} foi cancelada`,
    dto.roomExternalKey,
  )
  return dto
}

/** Nome de arquivo amigável a partir do título. */
function icsFilename(title: string): string {
  const slug =
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'reuniao'
  return `${slug}.ics`
}

/** Só organizador e convidados baixam o .ics. */
export async function buildMeetingIcsFor(
  meetingId: string,
  userId: string,
  companyId: string,
): Promise<{ filename: string; ics: string }> {
  const meeting = await loadMeeting(meetingId, companyId)
  const convidado = meeting.participants.some((p) => p.userId === userId)
  if (meeting.organizerId !== userId && !convidado) {
    throw new OfficeMeetingError('Você não participa desta reunião', 403)
  }
  return {
    filename: icsFilename(meeting.title),
    ics: buildMeetingIcs(toCalendarMeeting(meeting as MeetingWithPeople)),
  }
}
