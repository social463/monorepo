/** Provedores de calendário suportados; ordem = ordem de exibição na UI. */
export type CalendarProviderKey = 'google' | 'microsoft'

export const CALENDAR_PROVIDERS: readonly CalendarProviderKey[] = ['google', 'microsoft']

export function isCalendarProviderKey(value: unknown): value is CalendarProviderKey {
  return typeof value === 'string' && (CALENDAR_PROVIDERS as readonly string[]).includes(value)
}

export const CALENDAR_PROVIDER_LABELS: Record<CalendarProviderKey, string> = {
  google: 'Google Calendar',
  microsoft: 'Microsoft 365',
}

export type CalendarConnectionStatusKey = 'active' | 'needs_reauth' | 'revoked'

/** Conexão de calendário de uma pessoa. Por construção, sem nenhum campo de token. */
export interface CalendarConnectionDTO {
  provider: CalendarProviderKey
  accountEmail: string
  status: CalendarConnectionStatusKey
  publishEnabled: boolean
  lastSyncAt: string | null
}

export interface CalendarIntegrationStateDTO {
  connections: CalendarConnectionDTO[]
  /** Provedores que o admin da empresa já configurou (têm credenciais). */
  available: CalendarProviderKey[]
}

/** Estado das credenciais de um provedor, do ponto de vista do admin. O secret nunca volta. */
export interface CalendarProviderSettingsDTO {
  configured: boolean
  clientId: string | null
  /** Só Microsoft. */
  tenantId?: string | null
  /** URI que o admin precisa registrar no app do provedor. */
  redirectUri: string
}

export interface CalendarSettingsDTO {
  google: CalendarProviderSettingsDTO
  microsoft: CalendarProviderSettingsDTO
}

/**
 * Campo ausente = mantém o valor atual. String vazia = limpa.
 * Isso permite salvar o formulário sem reenviar o secret.
 */
export interface UpdateCalendarSettingsRequest {
  google?: { clientId?: string; clientSecret?: string }
  microsoft?: { clientId?: string; clientSecret?: string; tenantId?: string }
}
