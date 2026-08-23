import {
  claimFromIdToken,
  postForm,
  toCalendarTokens,
  type CalendarProviderAdapter,
  type OAuthTokenResponse,
} from './provider'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

/** Escrita já entra aqui para a fase 3 não pedir consentimento de novo. */
export const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events'

export const googleAdapter: CalendarProviderAdapter = {
  authorizeUrl({ creds, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      state,
      // sem estes dois o Google só devolve refresh token na primeira autorização
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    })
    return `${AUTH_URL}?${params.toString()}`
  },

  async exchangeCode({ creds, redirectUri, code }) {
    const body = await postForm(TOKEN_URL, {
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    })
    const tokens = toCalendarTokens(body, { fallbackRefresh: '', defaultScopes: GOOGLE_SCOPES, providerLabel: 'Google' })
    if (!tokens.refreshToken) throw new Error('Google não devolveu refresh_token')
    const email = claimFromIdToken((body as OAuthTokenResponse).id_token, ['email'])
    if (!email) throw new Error('Google não devolveu o e-mail da conta')
    return { ...tokens, email }
  },

  async refresh({ creds, refreshToken }) {
    const body = await postForm(TOKEN_URL, {
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
    })
    return toCalendarTokens(body, { fallbackRefresh: refreshToken, defaultScopes: GOOGLE_SCOPES, providerLabel: 'Google' })
  },

  async revoke({ refreshToken }) {
    // Best-effort: a conexão local é apagada de todo jeito.
    try {
      await postForm(REVOKE_URL, { token: refreshToken })
    } catch (err) {
      console.error('[calendar/google] revoke falhou', err)
    }
  },
}
