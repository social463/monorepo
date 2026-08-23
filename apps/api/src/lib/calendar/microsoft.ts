import {
  claimFromIdToken,
  postForm,
  toCalendarTokens,
  type CalendarCredentials,
  type CalendarProviderAdapter,
  type OAuthTokenResponse,
} from './provider'

const BASE = 'https://login.microsoftonline.com'

/** Escrita já entra aqui para a fase 3 não pedir consentimento de novo. */
export const MICROSOFT_SCOPES = 'openid email offline_access https://graph.microsoft.com/Calendars.ReadWrite'

function tenant(creds: CalendarCredentials): string {
  return creds.tenantId?.trim() || 'common'
}

export const microsoftAdapter: CalendarProviderAdapter = {
  authorizeUrl({ creds, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      response_mode: 'query',
      scope: MICROSOFT_SCOPES,
      state,
    })
    return `${BASE}/${tenant(creds)}/oauth2/v2.0/authorize?${params.toString()}`
  },

  async exchangeCode({ creds, redirectUri, code }) {
    const body = await postForm(`${BASE}/${tenant(creds)}/oauth2/v2.0/token`, {
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: MICROSOFT_SCOPES,
    })
    const tokens = toCalendarTokens(body, {
      fallbackRefresh: '',
      defaultScopes: MICROSOFT_SCOPES,
      providerLabel: 'Microsoft',
    })
    if (!tokens.refreshToken) throw new Error('Microsoft não devolveu refresh_token')
    const email = claimFromIdToken((body as OAuthTokenResponse).id_token, [
      'email',
      'preferred_username',
      'upn',
    ])
    if (!email) throw new Error('Microsoft não devolveu o e-mail da conta')
    return { ...tokens, email }
  },

  async refresh({ creds, refreshToken }) {
    const body = await postForm(`${BASE}/${tenant(creds)}/oauth2/v2.0/token`, {
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
      scope: MICROSOFT_SCOPES,
    })
    return toCalendarTokens(body, {
      fallbackRefresh: refreshToken,
      defaultScopes: MICROSOFT_SCOPES,
      providerLabel: 'Microsoft',
    })
  },

  async revoke() {
    // A Microsoft não expõe revoke de refresh token delegado (só
    // /me/revokeSignInSessions, que mata todas as sessões da pessoa — desproporcional).
    // Apagar a conexão local já impede qualquer uso do token pelo Legends.
  },
}
