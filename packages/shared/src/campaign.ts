export const CAMPAIGN_QUANTITY_MIN = 1
export const CAMPAIGN_QUANTITY_MAX = 20
export const CAMPAIGN_THEME_MAX_LENGTH = 200
export const CAMPAIGN_NOTES_MAX_LENGTH = 1000
export const CAMPAIGN_TITLE_MAX_LENGTH = 120
export const CAMPAIGN_VISUAL_HINT_MAX_LENGTH = 200

/**
 * Deixou de derivar do limite do post: o Feed Corporativo passou a aceitar
 * 5.000 caracteres com texto rico, e rascunho de campanha desse tamanho não é
 * o que a ferramenta se propõe a gerar — comunicado de campanha é curto por
 * desenho. O número continua sendo o teto antigo do mural, de propósito.
 */
export const CAMPAIGN_BODY_MAX_LENGTH = 280

export const CAMPAIGN_AUDIENCES = ['ALL', 'LEADERSHIP'] as const
export type CampaignAudience = (typeof CAMPAIGN_AUDIENCES)[number]

export const CAMPAIGN_CHANNELS = ['MURAL', 'TEAMS', 'EMAIL'] as const
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number]

export const CAMPAIGN_POST_STATUSES = ['SCHEDULED', 'PUBLISHED', 'CANCELLED'] as const
export type CampaignPostStatus = (typeof CAMPAIGN_POST_STATUSES)[number]

export const CAMPAIGN_AUDIENCE_LABELS: Record<CampaignAudience, string> = {
  ALL: 'Todos',
  LEADERSHIP: 'Liderança',
}

export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = {
  MURAL: 'Mural da empresa',
  TEAMS: 'Teams',
  EMAIL: 'E-mail',
}

export const CAMPAIGN_POST_STATUS_LABELS: Record<CampaignPostStatus, string> = {
  SCHEDULED: 'Agendado',
  PUBLISHED: 'Publicado',
  CANCELLED: 'Cancelado',
}

/** Canais cuja entrega hoje é manual — o Legends registra, não dispara. */
export const CAMPAIGN_MANUAL_DELIVERY_CHANNELS: readonly CampaignChannel[] = ['TEAMS', 'EMAIL']

export interface GenerateCampaignRequest {
  theme: string
  /** ISO 8601. */
  startsAt: string
  endsAt: string
  audience: CampaignAudience
  channel: CampaignChannel
  quantity: number
  notes?: string
}

/** Rascunho proposto pela IA. Ainda não existe no banco. */
export interface CampaignDraftDTO {
  title: string
  body: string
  visualHint: string | null
  /** Vem da grade calculada no servidor, nunca do modelo. */
  scheduledFor: string
}

export interface CampaignPostDTO {
  id: string
  campaignId: string | null
  campaignTheme: string | null
  title: string
  body: string
  visualHint: string | null
  scheduledFor: string
  channel: CampaignChannel
  audience: CampaignAudience
  status: CampaignPostStatus
  responsibleId: string | null
  responsibleName: string | null
  publishedPostId: string | null
  publishedAt: string | null
  createdAt: string
}

export interface ConfirmCampaignPostInput {
  title: string
  body: string
  visualHint?: string | null
  scheduledFor: string
  channel: CampaignChannel
  responsibleId?: string | null
}

export interface ConfirmCampaignRequest {
  theme: string
  startsAt: string
  endsAt: string
  audience: CampaignAudience
  notes?: string
  posts: ConfirmCampaignPostInput[]
}

export interface CreateCampaignPostRequest {
  title: string
  body: string
  visualHint?: string | null
  scheduledFor: string
  channel: CampaignChannel
  audience: CampaignAudience
  responsibleId?: string | null
}

export interface UpdateCampaignPostRequest {
  title?: string
  body?: string
  visualHint?: string | null
  scheduledFor?: string
  channel?: CampaignChannel
  audience?: CampaignAudience
  responsibleId?: string | null
}
