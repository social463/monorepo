/**
 * Contrato do 1:1 — o ritual de conversa entre duas pessoas.
 *
 * O par é guardado com os ids ORDENADOS (`normalizeOneOnOnePair`): é isso que
 * faz "as ações abertas deste par" ser uma consulta direta, e não um OR de duas
 * combinações espalhado por todo service.
 */

import type { PublicUser } from './auth'
import type { PdiActionStatus } from './pdi'

export const ONE_ON_ONE_RECURRENCES = ['NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const
export type OneOnOneRecurrence = (typeof ONE_ON_ONE_RECURRENCES)[number]

export const ONE_ON_ONE_RECURRENCE_LABELS: Record<OneOnOneRecurrence, string> = {
  NONE: 'Não se repete',
  WEEKLY: 'Toda semana',
  BIWEEKLY: 'A cada duas semanas',
  MONTHLY: 'Todo mês',
}

export const ONE_ON_ONE_MEETING_STATUSES = ['SCHEDULED', 'DONE', 'CANCELED'] as const
export type OneOnOneMeetingStatus = (typeof ONE_ON_ONE_MEETING_STATUSES)[number]

/** `PROMOTED` = virou ação de PDI; sai dos pendentes sem ter sido concluída aqui. */
export const ONE_ON_ONE_ACTION_STATUSES = ['OPEN', 'DONE', 'PROMOTED'] as const
export type OneOnOneActionStatus = (typeof ONE_ON_ONE_ACTION_STATUSES)[number]

export const ONE_ON_ONE_TOPIC_ORIGINS = ['TEMPLATE', 'CUSTOM'] as const
export type OneOnOneTopicOrigin = (typeof ONE_ON_ONE_TOPIC_ORIGINS)[number]

/** Teto de ocorrências materializadas por série — série sem fim não gera até 2099. */
export const MAX_ONE_ON_ONE_OCCURRENCES = 52
export const ONE_ON_ONE_TOPIC_MAX_LENGTH = 200
export const ONE_ON_ONE_ACTION_DESCRIPTION_MAX_LENGTH = 400
export const ONE_ON_ONE_NOTE_MAX_LENGTH = 5000
export const ONE_ON_ONE_DURATIONS_MINUTES = [15, 30, 45, 60, 90] as const

export const ONE_ON_ONE_INVITE_RESPONSES = ['PENDING', 'ACCEPTED', 'DECLINED'] as const
export type OneOnOneInviteResponse = (typeof ONE_ON_ONE_INVITE_RESPONSES)[number]

export const ONE_ON_ONE_DECLINE_NOTE_MAX_LENGTH = 200

/**
 * Antecedência do lembrete in-app do 1:1, em minutos. Mesmo número da reunião de
 * sala (`MEETING_REMINDER_MINUTES`), mas constante própria: são lembretes de
 * coisas diferentes, e amarrar um no outro faria mudar a antecedência de um
 * mexer no outro sem ninguém pedir.
 */
export const ONE_ON_ONE_REMINDER_MINUTES = 10

export function normalizeOneOnOnePair(a: string, b: string): { userAId: string; userBId: string } {
  if (a === b) throw new Error('Um 1:1 precisa de duas pessoas diferentes.')
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a }
}

/**
 * Identidade da pessoa nas telas de 1:1. Carrega os dados de avatar porque o
 * `<Avatar>` resolve na ordem personagem LPC → `photoUrl` → iniciais: sem
 * `avatarStyle`/`avatarOptions` todo mundo do 1:1 cai nas iniciais, já que
 * quem tem personagem montado costuma não ter foto.
 */
export type OneOnOnePersonDTO = Pick<
  PublicUser,
  'id' | 'name' | 'photoUrl' | 'position' | 'avatarStyle' | 'avatarSeed' | 'avatarOptions'
>

export interface OneOnOneMeetingSummaryDTO {
  id: string
  seriesId: string
  startsAt: string
  endsAt: string
  status: OneOnOneMeetingStatus
  recurrence: OneOnOneRecurrence
  /** A outra pessoa, do ponto de vista de quem pediu. */
  counterpart: OneOnOnePersonDTO
  openActionCount: number
  /**
   * Itens de pauta DESTE encontro. Diferente de `openActionCount`, que é do
   * par: a lista usa isto para avisar "sem pauta" antes da conversa, que é o
   * único aviso acionável enquanto ainda dá tempo de preparar.
   */
  topicCount: number
  /**
   * A resposta EFETIVA do convidado: o override da ocorrência quando existe,
   * senão a resposta da série. Quem consome não precisa saber de qual dos dois
   * veio — só de qual vale.
   */
  inviteeResponse: OneOnOneInviteResponse
  /** True quando quem pediu é o CONVIDADO (não marcou o encontro). Só ele responde. */
  viewerIsInvitee: boolean
  /** Contraproposta de horário do convidado, quando a recusa veio com uma. */
  proposedStartsAt: string | null
  declineNote: string | null
}

export interface OneOnOneTopicDTO {
  id: string
  text: string
  origin: OneOnOneTopicOrigin
  discussed: boolean
  createdById: string
  sortOrder: number
}

export interface OneOnOneActionDTO {
  id: string
  description: string
  owner: OneOnOnePersonDTO
  dueDate: string | null
  status: OneOnOneActionStatus
  completedAt: string | null
  completedById: string | null
  createdInMeetingId: string
  /** Preenchido quando a ação foi promovida ao PDI. */
  pdiActionId: string | null
  createdAt: string
}

/** Ação do plano, em leitura — o 1:1 não edita PDI. */
export interface OneOnOnePdiActionDTO {
  id: string
  description: string
  /** O mesmo enum do `/pdi`: é a mesma ação, só que lida daqui. */
  status: PdiActionStatus
  progressPct: number
  dueDate: string | null
}

/**
 * Só existe quando o par é líder↔liderado (há `PdiPlan` do liderado com
 * `leaderId` do outro lado). `canPromote` é true só para o DONO do plano — o
 * PDI só aceita escrita do dono.
 */
export interface OneOnOnePdiBlockDTO {
  planId: string
  planTitle: string
  owner: OneOnOnePersonDTO
  actions: OneOnOnePdiActionDTO[]
  canPromote: boolean
}

export interface OneOnOneMeetingDetailDTO extends OneOnOneMeetingSummaryDTO {
  topics: OneOnOneTopicDTO[]
  /** Ações OPEN do PAR — carregadas de todo encontro anterior, não só deste. */
  openActions: OneOnOneActionDTO[]
  /** Ações fechadas (DONE/PROMOTED) criadas NESTE encontro, para o histórico. */
  closedActions: OneOnOneActionDTO[]
  /** A nota de quem pediu. A do outro participante nunca vem. */
  note: string | null
  pdi: OneOnOnePdiBlockDTO | null
}

/**
 * Combinado já concluído, como ele aparece no PERFIL das pessoas.
 *
 * Só é devolvido para quem participou daquele 1:1 — o combinado nasceu numa
 * conversa fechada, e o perfil é visto por colegas. Por isso o DTO carrega o
 * `counterpart`: no seu próprio perfil você vê com quem combinou cada coisa.
 */
export interface OneOnOneCompletedActionDTO {
  id: string
  description: string
  owner: OneOnOnePersonDTO
  /** A outra pessoa do 1:1, do ponto de vista de quem pediu. */
  counterpart: OneOnOnePersonDTO
  completedAt: string | null
  meetingId: string
  /** Preenchido quando o combinado virou ação de PDI em vez de ser concluído aqui. */
  pdiActionId: string | null
}

export interface OneOnOneTopicTemplateDTO {
  id: string
  theme: string
  text: string
  active: boolean
  sortOrder: number
}

export interface RespondToOneOnOneRequest {
  /** `PENDING` não é resposta: quem responde diz sim ou não. */
  response: Exclude<OneOnOneInviteResponse, 'PENDING'>
  /** Contraproposta de horário — só faz sentido ao recusar. ISO completo. */
  proposedStartsAt?: string | null
  declineNote?: string | null
}

export interface CreateOneOnOneRequest {
  counterpartId: string
  /** Data civil YYYY-MM-DD da primeira ocorrência. */
  date: string
  /** HH:MM local. */
  startTime: string
  durationMinutes: number
  recurrence: OneOnOneRecurrence
  /** Exclusivo com `recurrenceCount`. */
  recurrenceUntil?: string | null
  recurrenceCount?: number | null
}

/**
 * Eventos de tempo real do 1:1 empurrados pelo servidor (WebSocket).
 *
 * São **magros**, como os da resenha: carregam só o suficiente para o cliente
 * invalidar a query certa e reler com as permissões DELE. Nenhum conteúdo viaja
 * aqui — a nota privada de um participante jamais pode ser empurrada para o
 * outro, e evento magro torna esse erro impossível por construção.
 *
 * O canal é **por pessoa**: cada conexão só recebe eventos dos 1:1 de quem está
 * conectado. É isso que dispensa identificar o par em `actions:changed` e
 * `pdi:changed` — quem recebe já é uma das duas pessoas dele.
 */
export type OneOnOneEvent =
  /** Encontro nasceu, mudou de horário, de status ou de resposta ao convite. */
  | { type: 'agenda:changed' }
  /** Pauta de UM encontro (tópico criado, editado, removido ou marcado). */
  | { type: 'meeting:changed'; meetingId: string }
  /**
   * Combinados do par. Sem `meetingId` de propósito: ação aberta pertence ao
   * PAR e aparece em todo encontro entre as duas pessoas, não só naquele em que
   * nasceu (ver `openActions` no detalhe).
   */
  | { type: 'actions:changed' }
  /** Plano ou ação de PDI que liga as duas pessoas — o bloco "Plano de X". */
  | { type: 'pdi:changed' }

/** Semente do catálogo da empresa — catálogo que nasce vazio ninguém preenche. */
export const DEFAULT_ONE_ON_ONE_TOPICS: { theme: string; text: string }[] = [
  { theme: 'Como você está', text: 'Como você está se sentindo em relação ao trabalho nas últimas semanas?' },
  { theme: 'Como você está', text: 'Sua carga de trabalho está sustentável?' },
  { theme: 'Como você está', text: 'Tem algo fora do trabalho que eu deveria saber para te apoiar melhor?' },
  { theme: 'Prioridades e bloqueios', text: 'Qual é a sua principal prioridade até o próximo 1:1?' },
  { theme: 'Prioridades e bloqueios', text: 'O que está te travando hoje?' },
  { theme: 'Prioridades e bloqueios', text: 'Tem alguma decisão parada esperando alguém?' },
  { theme: 'Carreira e desenvolvimento', text: 'O que você quer estar fazendo daqui a um ano?' },
  { theme: 'Carreira e desenvolvimento', text: 'Que habilidade você quer desenvolver neste ciclo?' },
  { theme: 'Carreira e desenvolvimento', text: 'Como está o seu PDI? Alguma ação precisa de ajuda?' },
  { theme: 'Feedback', text: 'Que feedback você tem para mim?' },
  { theme: 'Feedback', text: 'Tem algum feedback que você recebeu e ficou remoendo?' },
  { theme: 'Feedback', text: 'O que eu poderia parar de fazer para facilitar o seu trabalho?' },
  { theme: 'Time e processo', text: 'Como está a sua relação com o time?' },
  { theme: 'Time e processo', text: 'Que processo do time está atrapalhando mais do que ajudando?' },
  { theme: 'Time e processo', text: 'Tem alguém do time que merecia um reconhecimento agora?' },
]
