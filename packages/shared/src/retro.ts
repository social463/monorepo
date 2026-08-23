import type { PublicUser } from './auth'

export const RETRO_ROOM_STATUS = ['OPEN', 'CONCLUDED'] as const
export type RetroRoomStatus = (typeof RETRO_ROOM_STATUS)[number]

export const RETRO_ROOM_ROLES = ['FACILITATOR', 'PARTICIPANT', 'OBSERVER'] as const
export type RetroRoomRole = (typeof RETRO_ROOM_ROLES)[number]

export const RETRO_TIMER_MODES = ['elapsed', 'countdown'] as const
export type RetroTimerMode = (typeof RETRO_TIMER_MODES)[number]

export const RETRO_TIMER_STATUS = ['idle', 'running', 'paused'] as const
export type RetroTimerStatus = (typeof RETRO_TIMER_STATUS)[number]

export const RETRO_CARD_COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'orange'] as const
export type RetroCardColor = (typeof RETRO_CARD_COLORS)[number]

export const RETRO_CARD_KINDS = ['note', 'shape'] as const
export type RetroCardKind = (typeof RETRO_CARD_KINDS)[number]

export const RETRO_SHAPES = [
  'rectangle',
  'circle',
  'diamond',
  'triangle',
  'arrow-right',
  'line',
  'star',
  'heart',
  'target',
  'document',
  'robot',
  'bug',
  'cloud',
  'database',
  'gear',
  'briefcase',
  'calendar',
  'checklist',
  'person',
  'smiley',
  'shield',
  'battery',
  'grid',
  'chart',
  'warning',
  'lock',
] as const
export type RetroShape = (typeof RETRO_SHAPES)[number]

export const RETRO_SHAPE_STYLES = ['solid', 'outline'] as const
export type RetroShapeStyle = (typeof RETRO_SHAPE_STYLES)[number]

export const RETRO_REACTION_EMOJIS = ['👍', '❤️', '🎯', '💡', '🚀', '🔥', '👏', '🎉', '😂', '🤔', '👎', '❓', '🙌', '💯', '✅', '⚠️', '😍', '😮'] as const
export type RetroReactionEmoji = (typeof RETRO_REACTION_EMOJIS)[number]

/** Emojis das reações flutuantes efêmeras (estilo Meet). Distinto de RETRO_REACTION_EMOJIS (reações por card). */
export const RETRO_FLOAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '👏', '🎉'] as const
export type RetroFloatReaction = (typeof RETRO_FLOAT_REACTIONS)[number]

export const MIN_CARD_LENGTH = 1
export const MAX_CARD_LENGTH = 500
export const MIN_SPRINT = 1
export const MAX_SPRINT = 999
export const MIN_VOTES_PER_PARTICIPANT = 1
export const MAX_VOTES_PER_PARTICIPANT = 20
export const MIN_RETRO_TIMER_DURATION_SECONDS = 60
export const MAX_RETRO_TIMER_DURATION_SECONDS = 3 * 60 * 60

/** Título exibível da sala, derivado de sprint + nomes das squads (já ordenados). Fonte única (api e web). */
export function retroRoomTitle(sprint: number, squadNames: string[]): string {
  if (squadNames.length <= 1) return `Retrospectiva Sprint ${sprint} - Squad ${squadNames[0] ?? ''}`
  return `Retrospectiva Sprint ${sprint} - Squads ${squadNames.join(', ')}`
}

export function formatRetroTimerSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function currentRetroTimerSeconds(
  timer: Pick<RetroTimerDTO, 'mode' | 'status' | 'durationSeconds' | 'startedAt' | 'accumulatedSeconds'>,
  nowMs = Date.now(),
): number {
  const runningDelta =
    timer.status === 'running' && timer.startedAt
      ? Math.max(0, Math.floor((nowMs - new Date(timer.startedAt).getTime()) / 1000))
      : 0
  const elapsed = Math.max(0, timer.accumulatedSeconds + runningDelta)
  if (timer.mode === 'countdown') return Math.max(0, (timer.durationSeconds ?? 0) - elapsed)
  return elapsed
}

// Throttle do canal efêmero (cliente). ~30 msgs/s.
export const CURSOR_THROTTLE_MS = 33
export const MOVE_THROTTLE_MS = 33

// Dimensões padrão de um post-it (espaço do mundo) — usado pelo front no hit-test/centralização.
export const POSTIT_WIDTH = 180
// Cards nas regiões de ação (ruim/começar/parar) são mais largos para acomodar o formulário.
export const POSTIT_WIDTH_WIDE = 280
export const POSTIT_HEIGHT = 180
export const SHAPE_WIDTH = 160
export const SHAPE_HEIGHT = 104

/** Regiões de fundo do canvas — guia visual rotulado, SEM vínculo de dado. Coordenadas no mundo. */
export interface RetroRegion {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}
// Layout: 4 quadrantes (2×2) + Ações deslocada à direita. Instruções ocupam y 0..~240 (acima).
// Quadrantes 1080×920 (gap 60) comportam ~24 post-its de 180×180 (6 col × 4 lin); Ações abrange a altura do bloco 2×2.
export const RETRO_REGIONS: RetroRegion[] = [
  { id: 'went_well', label: 'O que foi bom', x: 0, y: 280, w: 1080, h: 920 },
  { id: 'went_bad', label: 'O que foi ruim', x: 1140, y: 280, w: 1080, h: 920 },
  { id: 'start', label: 'O que precisamos começar', x: 0, y: 1260, w: 1080, h: 920 },
  { id: 'stop', label: 'O que precisamos parar', x: 1140, y: 1260, w: 1080, h: 920 },
  { id: 'actions', label: 'Ações', x: 2320, y: 280, w: 1080, h: 1900 },
]

// Quadrantes cujos cards ganham o formulário de ação (plano/responsável/prazo) e geram
// um card-espelho no quadrante "Ações". Fonte única para front e back.
export const RETRO_ACTION_REGION_IDS = ['went_bad', 'start', 'stop'] as const

export interface RetroReactionSummary {
  emoji: RetroReactionEmoji
  count: number
  reactedByMe: boolean
}

/** Identidade + dados de avatar do autor do card (suficiente para renderizar o avatar). */
export type RetroCardAuthor = Pick<
  PublicUser,
  'id' | 'name' | 'photoUrl' | 'avatarStyle' | 'avatarSeed' | 'avatarOptions'
>

export interface RetroCardDTO {
  id: string
  text: string
  x: number
  y: number
  color: RetroCardColor
  kind?: RetroCardKind
  shape?: RetroShape | null
  shapeStyle?: RetroShapeStyle | null
  width?: number
  height?: number
  actionPlan?: string | null
  actionResponsible?: string | null
  actionDueDate?: string | null
  actionCardId?: string | null
  /** Autor do card (sempre presente quando conhecido). */
  author: RetroCardAuthor | null
  mine: boolean
  /** true quando o modo anônimo está ON e o card é de outro autor: `text` vem ''. */
  masked?: boolean
  editedBy: { id: string; name: string } | null
  editedAt: string | null
  voteCount: number
  myVotes: number
  reactions: RetroReactionSummary[]
  createdAt: string
  updatedAt: string
}

export interface RetroActionItemDTO {
  id: string
  plan: string
  problem: string            // texto do card de origem (RetroCard.text)
  note: string | null        // observação do responsável (RetroCard.actionNote)
  dueDate: string            // AAAA-MM-DD
  done: boolean
  doneAt: string | null      // ISO
  archivedAt: string | null  // ISO — concluída e tirada da lista do perfil
  sprint: number
  squad: string              // squads de origem, ordenadas pt-BR, juntas com ", "
  roomId: string
  auditStatus: 'VALIDATED' | 'REJECTED' | null
}

export interface RetroCarryoverItemDTO {
  id: string                 // id do card de origem
  plan: string
  note: string | null        // observação do responsável (RetroCard.actionNote)
  dueDate: string            // AAAA-MM-DD
  responsible: RetroCardAuthor | null
  sprint: number             // sprint da retro de origem
  type: 'validate' | 'overdue'
  auditStatus: 'VALIDATED' | 'REJECTED' | null
}

export interface RetroEditDTO {
  id: string
  editor: { id: string; name: string }
  action: string
  detail: string | null
  createdAt: string
}

export interface RetroParticipantDTO {
  user: PublicUser
  isCreator: boolean
}

export interface RetroRoomSummaryDTO {
  id: string
  title: string
  sprint: number
  squads: { id: string; name: string }[]
  status: RetroRoomStatus
  anonymous: boolean
  votesPerParticipant: number
  createdAt: string
  concludedAt: string | null
  creator: { id: string; name: string }
  participantCount: number
  myRole: RetroRoomRole
}

export interface RetroTimerDTO {
  mode: RetroTimerMode
  status: RetroTimerStatus
  durationSeconds: number | null
  startedAt: string | null
  accumulatedSeconds: number
  updatedAt: string
  updatedBy: { id: string; name: string } | null
  serverNow: string
}

export interface RetroRoomDTO extends RetroRoomSummaryDTO {
  participants: RetroParticipantDTO[]
  cards: RetroCardDTO[]
  myRemainingVotes: number
  timer: RetroTimerDTO
}

// Eventos servidor → cliente.
export type RetroEvent =
  // autoritativos (pós-persistência)
  | { type: 'card.created'; card: RetroCardDTO }
  | { type: 'card.updated'; card: RetroCardDTO }
  | { type: 'card.moved'; cardId: string; x: number; y: number }
  | { type: 'card.deleted'; cardId: string }
  | { type: 'vote.changed'; cardId: string; voteCount: number }
  | { type: 'reaction.changed'; cardId: string; reactions: RetroReactionSummary[] }
  | { type: 'phase.changed'; status: RetroRoomStatus; concludedAt: string | null }
  | { type: 'room.deleted' }
  | { type: 'anonymous.changed'; anonymous: boolean }
  | { type: 'timer.changed'; timer: RetroTimerDTO }
  | { type: 'carryover.changed' }
  | { type: 'edits.changed' }
  | { type: 'participants.changed' }
  | { type: 'presence.changed'; userIds: string[] }
  // efêmeros (relay, não persistem)
  | { type: 'card.moving'; cardId: string; x: number; y: number; byUserId: string }
  | { type: 'cursor.moved'; userId: string; name: string; x: number; y: number }
  | { type: 'card.locked'; cardId: string; byUserId: string; byName: string }
  | { type: 'card.unlocked'; cardId: string }
  | { type: 'reaction.floated'; userId: string; name: string; emoji: string }

// Mensagens cliente → servidor (canal efêmero/WS bidirecional).
export type RetroClientMessage =
  | { type: 'cursor'; x: number; y: number }
  | { type: 'card.grab'; cardId: string }
  | { type: 'card.move'; cardId: string; x: number; y: number }
  | { type: 'card.drop'; cardId: string }
  | { type: 'reaction.float'; emoji: string }

export interface CreateRetroRoomRequest {
  sprint: number
  squadIds: string[]
  votesPerParticipant: number
  participantIds: string[]
}
export interface UpdateRetroRoomAdminRequest {
  sprint?: number
  squadIds?: string[]
  votesPerParticipant?: number
}
export interface UpdateParticipantsRequest {
  participantIds: string[]
}
export interface CreateRetroCardRequest {
  text?: string
  color: RetroCardColor
  x: number
  y: number
  kind?: RetroCardKind
  shape?: RetroShape
  shapeStyle?: RetroShapeStyle
  width?: number
  height?: number
  actionPlan?: string
  actionResponsible?: string
  actionDueDate?: string
}
export interface UpdateRetroCardRequest {
  text?: string
  color?: RetroCardColor
  shape?: RetroShape
  shapeStyle?: RetroShapeStyle
  width?: number
  height?: number
  actionPlan?: string
  actionResponsible?: string
  actionDueDate?: string
}
export interface UpdateCardPositionRequest {
  x: number
  y: number
}
export interface RetroPhaseRequest {
  action: 'conclude'
}

export type RetroTimerCommand =
  | { action: 'configure'; mode: RetroTimerMode; durationSeconds?: number | null }
  | { action: 'start'; mode?: RetroTimerMode; durationSeconds?: number | null }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'reset'; mode?: RetroTimerMode; durationSeconds?: number | null }
