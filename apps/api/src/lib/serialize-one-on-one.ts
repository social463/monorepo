import type { OneOnOneAction, OneOnOneMeeting, OneOnOneSeries, OneOnOneTopic, User } from '@prisma/client'
import type {
  OneOnOneActionDTO,
  OneOnOneInviteResponse,
  OneOnOneMeetingSummaryDTO,
  OneOnOnePersonDTO,
  OneOnOneTopicDTO,
} from '@legends/shared'
import { sanitizeAvatarOptions, sanitizeAvatarStyle } from './serialize'

/**
 * O mínimo que o serializer precisa da linha de `User`. Todas as consultas do
 * 1:1 usam `include` (linha inteira), então isto só documenta a dependência —
 * e trava em compilação quem trocar por um `select` estreito demais.
 */
export type OneOnOnePersonSource = Pick<
  User,
  'id' | 'name' | 'photoUrl' | 'position' | 'avatarStyle' | 'avatarSeed' | 'avatarOptions'
>

export function toOneOnOnePersonDTO(user: OneOnOnePersonSource): OneOnOnePersonDTO {
  return {
    id: user.id,
    name: user.name,
    photoUrl: user.photoUrl,
    position: user.position,
    // Mesmos sanitizadores do `toPublicUser`: o que está no banco é JSON solto,
    // e o front só sabe desenhar personagem com as options no formato atual.
    avatarStyle: sanitizeAvatarStyle(user.avatarStyle),
    avatarSeed: user.avatarSeed,
    avatarOptions: sanitizeAvatarOptions(user.avatarOptions),
  }
}

export type OneOnOneMeetingWithSeries = OneOnOneMeeting & {
  series: OneOnOneSeries & { userA: User; userB: User }
  /** Vem do `_count` de `MEETING_INCLUDE`; ausente só no encontro recém-criado. */
  _count?: { topics: number }
}

/** O par como ele é guardado: ids normalizados (ordenados). */
type PairIds = { userAId: string; userBId: string }
/** …e as duas pessoas, quando a consulta trouxe o `include`. */
type PairSides<T> = PairIds & { userA: T; userB: T }

/**
 * Quem é "o outro" e quem sou "eu" no par. Uma regra só, num lugar só: a
 * comparação `userAId === viewerId` estava repetida em quatro pontos do
 * service e do serialize — metade delas invertida (o autor da notificação é o
 * viewer, não a contraparte), que é justamente o tipo de detalhe que troca de
 * pessoa numa refatoração distraída.
 */
export function counterpartIdOf(pair: PairIds, viewerId: string): string {
  return pair.userAId === viewerId ? pair.userBId : pair.userAId
}

export function counterpartOf<T>(pair: PairSides<T>, viewerId: string): T {
  return pair.userAId === viewerId ? pair.userB : pair.userA
}

/** O lado de quem pediu — usado onde o que falta é o nome de quem agiu. */
export function viewerSideOf<T>(pair: PairSides<T>, viewerId: string): T {
  return pair.userAId === viewerId ? pair.userA : pair.userB
}

/**
 * O `counterpart` é sempre "o outro" do ponto de vista de quem pediu — por isso
 * o `viewerId` entra aqui, e não no include da consulta.
 */
export function toOneOnOneMeetingSummary(
  meeting: OneOnOneMeetingWithSeries,
  viewerId: string,
  openActionCount: number,
): OneOnOneMeetingSummaryDTO {
  const outro = counterpartOf(meeting.series, viewerId)
  return {
    id: meeting.id,
    seriesId: meeting.seriesId,
    startsAt: meeting.startsAt.toISOString(),
    endsAt: meeting.endsAt.toISOString(),
    status: meeting.status,
    recurrence: meeting.series.recurrence,
    counterpart: toOneOnOnePersonDTO(outro),
    openActionCount,
    // Sem `_count` na consulta, o encontro é recém-criado — pauta vazia por
    // construção, e não "não sei contar".
    topicCount: meeting._count?.topics ?? 0,
    inviteeResponse: effectiveInviteResponse(meeting),
    // Quem marcou não responde ao próprio convite (aceite implícito).
    viewerIsInvitee: meeting.series.createdById !== viewerId,
    proposedStartsAt: meeting.proposedStartsAt?.toISOString() ?? null,
    declineNote: meeting.declineNote ?? null,
  }
}

/**
 * A resposta que VALE para esta ocorrência: o override dela quando existe, senão
 * a da série. Uma função só, usada pelo serialize e pelo scheduler de lembrete —
 * duas leituras da mesma regra divergiriam no primeiro caso de borda.
 */
export function effectiveInviteResponse(meeting: {
  inviteeResponse: OneOnOneInviteResponse | null
  series: { inviteeResponse: OneOnOneInviteResponse }
}): OneOnOneInviteResponse {
  return meeting.inviteeResponse ?? meeting.series.inviteeResponse
}

export function toOneOnOneTopicDTO(topic: OneOnOneTopic): OneOnOneTopicDTO {
  return {
    id: topic.id,
    text: topic.text,
    origin: topic.origin,
    discussed: topic.discussed,
    createdById: topic.createdById,
    sortOrder: topic.sortOrder,
  }
}

export function toOneOnOneActionDTO(action: OneOnOneAction & { owner: User }): OneOnOneActionDTO {
  return {
    id: action.id,
    description: action.description,
    owner: toOneOnOnePersonDTO(action.owner),
    dueDate: action.dueDate ? action.dueDate.toISOString() : null,
    status: action.status,
    completedAt: action.completedAt ? action.completedAt.toISOString() : null,
    completedById: action.completedById,
    createdInMeetingId: action.createdInMeetingId,
    pdiActionId: action.promotedPdiActionId,
    createdAt: action.createdAt.toISOString(),
  }
}
