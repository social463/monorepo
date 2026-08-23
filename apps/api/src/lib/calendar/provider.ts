/** Credenciais do app OAuth da empresa (BYO app — uma por tenant). */
export interface CalendarCredentials {
  clientId: string
  clientSecret: string
  /** Só Microsoft. */
  tenantId?: string
}

export interface CalendarTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scopes: string
}

/**
 * O consentimento foi revogado ou expirou. É condição **esperada**: o chamador
 * marca a conexão como NEEDS_REAUTH em vez de tratar como falha inesperada.
 */
export class CalendarReauthRequiredError extends Error {
  constructor(message = 'A autorização do calendário expirou. Reconecte sua conta.') {
    super(message)
    this.name = 'CalendarReauthRequiredError'
  }
}

/**
 * Contrato de um provedor de calendário. Só as implementações (google.ts,
 * microsoft.ts) conhecem o formato de cada API — mesma disciplina do
 * lib/teams-client.ts com o Adaptive Card. Fases 2 e 3 acrescentam aqui
 * listEvents e createEvent/updateEvent/deleteEvent.
 */
export interface CalendarProviderAdapter {
  authorizeUrl(input: { creds: CalendarCredentials; redirectUri: string; state: string }): string
  exchangeCode(input: {
    creds: CalendarCredentials
    redirectUri: string
    code: string
  }): Promise<CalendarTokens & { email: string }>
  refresh(input: { creds: CalendarCredentials; refreshToken: string }): Promise<CalendarTokens>
  revoke(input: { creds: CalendarCredentials; refreshToken: string }): Promise<void>
}

const HTTP_TIMEOUT_MS = 10_000

/** POST de formulário nos endpoints de token, com timeout. Compartilhado pelos adapters. */
export async function postForm(url: string, form: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  const body: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = typeof body === 'object' && body !== null ? String((body as { error?: unknown }).error ?? '') : ''
    if (error === 'invalid_grant' || error === 'interaction_required' || error === 'consent_required') {
      throw new CalendarReauthRequiredError()
    }
    throw new Error(`Provedor de calendário respondeu ${res.status}${error ? ` (${error})` : ''}`)
  }
  return body
}

/**
 * Lê uma claim do payload do id_token. Não verifica assinatura de propósito: o
 * token veio direto do endpoint de token do provedor sobre TLS, então a origem
 * já está estabelecida.
 */
export function claimFromIdToken(idToken: string | undefined, claims: string[]): string | null {
  const payload = idToken?.split('.')[1]
  if (!payload) return null
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    for (const claim of claims) {
      const value = decoded[claim]
      if (typeof value === 'string' && value.length > 0) return value
    }
    return null
  } catch {
    return null
  }
}

/** Formato de resposta do endpoint `/token`, idêntico nos provedores suportados (OAuth2 padrão). */
export interface OAuthTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
}

/**
 * Monta `CalendarTokens` a partir da resposta do endpoint de token. Os campos
 * (`access_token`/`refresh_token`/`expires_in`/`scope`) são OAuth2 padrão e
 * idênticos entre os provedores — só o rótulo de erro e os defaults variam.
 */
export function toCalendarTokens(
  body: unknown,
  opts: { fallbackRefresh: string; defaultScopes: string; providerLabel: string },
): CalendarTokens {
  const res = body as OAuthTokenResponse
  if (!res.access_token) {
    throw new Error(`${opts.providerLabel} não devolveu access_token`)
  }
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? opts.fallbackRefresh,
    expiresAt: new Date(Date.now() + (res.expires_in ?? 3600) * 1000),
    scopes: res.scope ?? opts.defaultScopes,
  }
}
