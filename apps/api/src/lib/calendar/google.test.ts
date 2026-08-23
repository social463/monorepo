import { describe, it, expect, vi, afterEach } from 'vitest'
import { googleAdapter } from './google'
import { CalendarReauthRequiredError } from './provider'

const creds = { clientId: 'cid', clientSecret: 'csecret' }

/** id_token só precisa do payload — o token vem do endpoint do Google sobre TLS. */
function idToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email })).toString('base64url')
  return `header.${payload}.sig`
}

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => vi.restoreAllMocks())

describe('googleAdapter.authorizeUrl', () => {
  it('monta a URL com scopes, state e refresh token garantido', () => {
    const url = new URL(
      googleAdapter.authorizeUrl({ creds, redirectUri: 'https://app/api/calendar/callback/google', state: 'st8' }),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app/api/calendar/callback/google')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('st8')
    // sem estes dois o Google não devolve refresh token numa reautorização
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.events')
  })
})

describe('googleAdapter.exchangeCode', () => {
  it('mapeia a resposta para CalendarTokens e extrai o e-mail do id_token', async () => {
    stubFetch(200, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3599,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      id_token: idToken('ana@empresa.com'),
    })
    const tokens = await googleAdapter.exchangeCode({ creds, redirectUri: 'https://app/cb', code: 'code-1' })
    expect(tokens.accessToken).toBe('at')
    expect(tokens.refreshToken).toBe('rt')
    expect(tokens.email).toBe('ana@empresa.com')
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('lança em erro do provedor', async () => {
    stubFetch(400, { error: 'invalid_grant' })
    await expect(googleAdapter.exchangeCode({ creds, redirectUri: 'https://app/cb', code: 'ruim' })).rejects.toThrow()
  })
})

describe('googleAdapter.refresh', () => {
  it('preserva o refresh token quando a resposta não traz um novo', async () => {
    stubFetch(200, { access_token: 'at2', expires_in: 3599, scope: 'calendar.events' })
    const tokens = await googleAdapter.refresh({ creds, refreshToken: 'rt-antigo' })
    expect(tokens.accessToken).toBe('at2')
    expect(tokens.refreshToken).toBe('rt-antigo')
  })

  it('invalid_grant vira CalendarReauthRequiredError, não erro genérico', async () => {
    stubFetch(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
    await expect(googleAdapter.refresh({ creds, refreshToken: 'rt' })).rejects.toBeInstanceOf(
      CalendarReauthRequiredError,
    )
  })
})

describe('googleAdapter.revoke', () => {
  it('posta o refresh token no endpoint de revoke', async () => {
    const spy = stubFetch(200, {})
    await googleAdapter.revoke({ creds, refreshToken: 'rt' })
    expect(String(spy.mock.calls[0][0])).toContain('https://oauth2.googleapis.com/revoke')
  })

  it('engole falha de rede (best-effort)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede') }))
    await expect(googleAdapter.revoke({ creds, refreshToken: 'rt' })).resolves.toBeUndefined()
  })
})
