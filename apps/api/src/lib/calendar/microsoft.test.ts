import { describe, it, expect, vi, afterEach } from 'vitest'
import { microsoftAdapter } from './microsoft'
import { adapterFor } from './index'
import { googleAdapter } from './google'
import { CalendarReauthRequiredError } from './provider'

const creds = { clientId: 'cid', clientSecret: 'csecret', tenantId: 'tenant-123' }

function idToken(claims: Record<string, string>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
}

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => vi.restoreAllMocks())

describe('microsoftAdapter.authorizeUrl', () => {
  it('usa o tenant configurado e pede offline_access', () => {
    const url = new URL(
      microsoftAdapter.authorizeUrl({ creds, redirectUri: 'https://app/api/calendar/callback/microsoft', state: 'st8' }),
    )
    expect(url.pathname).toBe('/tenant-123/oauth2/v2.0/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('state')).toBe('st8')
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(url.searchParams.get('scope')).toContain('Calendars.ReadWrite')
  })

  it('cai em `common` quando o tenant não foi informado', () => {
    const url = new URL(
      microsoftAdapter.authorizeUrl({
        creds: { clientId: 'cid', clientSecret: 'cs' },
        redirectUri: 'https://app/cb',
        state: 's',
      }),
    )
    expect(url.pathname).toBe('/common/oauth2/v2.0/authorize')
  })
})

describe('microsoftAdapter.exchangeCode', () => {
  it('extrai o e-mail de preferred_username quando não há claim email', async () => {
    stubFetch(200, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3599,
      scope: 'Calendars.ReadWrite',
      id_token: idToken({ preferred_username: 'ana@empresa.com' }),
    })
    const tokens = await microsoftAdapter.exchangeCode({ creds, redirectUri: 'https://app/cb', code: 'c' })
    expect(tokens.email).toBe('ana@empresa.com')
    expect(tokens.refreshToken).toBe('rt')
  })
})

describe('microsoftAdapter.refresh', () => {
  it('invalid_grant vira CalendarReauthRequiredError', async () => {
    stubFetch(400, { error: 'invalid_grant' })
    await expect(microsoftAdapter.refresh({ creds, refreshToken: 'rt' })).rejects.toBeInstanceOf(
      CalendarReauthRequiredError,
    )
  })
})

describe('microsoftAdapter.revoke', () => {
  it('não chama a rede — a Microsoft não expõe revoke de refresh token delegado', async () => {
    const spy = stubFetch(200, {})
    await microsoftAdapter.revoke({ creds, refreshToken: 'rt' })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('adapterFor', () => {
  it('resolve provedor → adapter', () => {
    expect(adapterFor('google')).toBe(googleAdapter)
    expect(adapterFor('microsoft')).toBe(microsoftAdapter)
  })
})
