export const NOTIFICATION_TYPES = [
  'FEEDBACK_RECEIVED',
  'FEEDBACK_REACTION',
  'FEEDBACK_COMMENT',
  'BADGE_EARNED',
  'BADGE_CLAIM_REJECTED',
  'HIGHLIGHT_PUBLISHED',
  /** Alguém assinou o mural de aniversário da pessoa. */
  'BIRTHDAY_GREETING_RECEIVED',
  'DEVELOPMENT_THURSDAY_EVENT',
  'PERIOD_OPENED',
  'PERIOD_CLOSED',
  'RETRO_INVITED',
  'STREAK_AT_RISK',
  'VOTE_REMINDER_MIDWAY',
  'VOTE_REMINDER_CLOSING',
  'REVIEW_COMMENT',
  'REVIEW_COMMENT_REPLY',
  'REVIEW_REACTION',
  'REVIEW_SHARED',
  'REVIEW_MENTION',
  'REVIEW_POLL_PUBLISHED',
  'CORPORATE_POST_COMMENT',
  'CORPORATE_POST_COMMENT_REPLY',
  'CORPORATE_POST_REACTION',
  'CORPORATE_POST_MENTION',
  'CORPORATE_POST_PUBLISHED',
  'VACATION_PLAN_VALIDATED',
  'VACATION_PLAN_DEADLINE',
  'CORPORATE_POST_AWAITING_REVIEW',
  'CORPORATE_POST_APPROVED',
  'CORPORATE_POST_REJECTED',
  'MEETING_INVITED',
  'MEETING_UPDATED',
  'MEETING_CANCELED',
  'MEETING_REMINDER',
  'OFFICE_DESK_REMINDER_RECEIVED',
  'OFFICE_DESK_REMINDER_READ',
  'PDI_ACTION_AWAITING_REVIEW',
  'PDI_ACTION_APPROVED',
  'PDI_ACTION_CHANGES_REQUESTED',
  'MANDATORY_COURSE_ASSIGNED',
  'CERTIFICATE_APPROVED',
  // Validação do registro de treinamento pela G&G (módulo de T&D). Dois tipos e
  // não um com flag: a recusa leva o motivo no título e pede ação de quem
  // recebeu, a validação só informa.
  'TRAINING_VALIDATED',
  'TRAINING_REJECTED',
  'CHALLENGE_SUBMISSION_APPROVED',
  'CHALLENGE_SUBMISSION_REJECTED',
  'STORE_ORDER_APPROVED',
  'STORE_ORDER_DELIVERED',
  'STORE_ORDER_CANCELLED',
  'CALENDAR_EVENT_REMINDER',
  // Convite nominal a um evento (Documento 3, seção 11). É o único tipo que
  // vira pop-up: ver `CalendarInviteToasts`.
  'CALENDAR_EVENT_INVITED',
  'ONE_ON_ONE_INVITED',
  'ONE_ON_ONE_ACTION_ASSIGNED',
  'ONE_ON_ONE_REMINDER',
  'ONE_ON_ONE_RESPONDED',
  'ONE_ON_ONE_PROPOSAL_ACCEPTED',
  'ONE_ON_ONE_PROPOSAL_DECLINED',
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export interface NotificationActor {
  id: string
  name: string
  photoUrl: string | null
}

export interface NotificationDTO {
  id: string
  type: NotificationType
  title: string
  link: string | null
  read: boolean
  createdAt: string
  actor: NotificationActor | null
}

export interface NotificationListResponse {
  items: NotificationDTO[]
  unreadCount: number
  nextCursor: string | null
}

export interface UnreadCountResponse {
  unreadCount: number
}
