import { vi, afterEach, describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  CalendarError,
  completeCalendarConnection,
  disconnectCalendar,
  getCalendarIntegrationState,
  getValidAccessToken,
  startCalendarConnection,
} from './calendar-connection-service'
import { updateCalendarSettings } from './calendar-settings-service'
import { signCalendarState } from '../lib/calendar/state'
import { decryptSecret, encryptSecret } from '../lib/crypto'

async function createUser(email: string) {
  return prisma.user.create({
    data: { name: 'Ana', email, passwordHash: 'x', companyId: DEFAULT_COMPANY_ID },
  })
}

async function withGoogleCredentials(companyId: string, actorId: string) {
  await updateCalendarSettings({
    companyId,
    actorId,
    body: { google: { clientId: 'cid', clientSecret: 'csecret' } },
  })
}

function stubTokenResponse(body: Record<string, unknown>) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  vi.stubGlobal('fetch', spy)
  return spy
}

function idToken(email: string): string {
  return `h.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.s`
}

afterEach(() => vi.restoreAllMocks())

describe('CalendarConnection (modelo)', () => {
  it('grava uma conexão e impede duas do mesmo provedor para o mesmo usuário', async () => {
    const user = await createUser('ana@empresa.com')
    const data = {
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      provider: 'GOOGLE' as const,
      providerAccountEmail: 'ana@empresa.com',
      accessTokenEnc: 'enc-a',
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: 'enc-r',
      scopes: 'calendar.events',
    }
    const created = await prisma.calendarConnection.create({ data })
    expect(created.status).toBe('ACTIVE')
    expect(created.publishEnabled).toBe(true)
    expect(created.syncCursor).toBeNull()
    await expect(prisma.calendarConnection.create({ data })).rejects.toThrow()
  })
})

describe('calendar connection service', () => {
  it('startCalendarConnection devolve authorizeUrl com state verificável', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    const { authorizeUrl } = await startCalendarConnection({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      provider: 'google',
    })
    const state = new URL(authorizeUrl).searchParams.get('state')
    expect(state).toBeTruthy()
    expect(authorizeUrl).toContain('accounts.google.com')
  })

  it('startCalendarConnection falha com 409 quando a empresa não configurou o provedor', async () => {
    const user = await createUser('ana@empresa.com')
    await expect(
      startCalendarConnection({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('completeCalendarConnection grava a conexão com tokens cifrados', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    stubTokenResponse({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: 'calendar.events',
      id_token: idToken('ana@gmail.com'),
    })

    await completeCalendarConnection({
      provider: 'google',
      code: 'code-1',
      state: signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' }),
    })

    const row = await prisma.calendarConnection.findFirstOrThrow({ where: { userId: user.id } })
    expect(row.providerAccountEmail).toBe('ana@gmail.com')
    expect(row.status).toBe('ACTIVE')
    expect(row.accessTokenEnc).not.toContain('at')
    expect(decryptSecret(row.accessTokenEnc)).toBe('at')
    expect(decryptSecret(row.refreshTokenEnc)).toBe('rt')
  })

  it('reconectar o mesmo provedor atualiza a linha, não duplica', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    const state = () => signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' })

    stubTokenResponse({ access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, id_token: idToken('a@b.com') })
    await completeCalendarConnection({ provider: 'google', code: 'c1', state: state() })
    stubTokenResponse({ access_token: 'at2', refresh_token: 'rt2', expires_in: 3600, id_token: idToken('a@b.com') })
    await completeCalendarConnection({ provider: 'google', code: 'c2', state: state() })

    const rows = await prisma.calendarConnection.findMany({ where: { userId: user.id } })
    expect(rows).toHaveLength(1)
    expect(decryptSecret(rows[0].accessTokenEnc)).toBe('at2')
    expect(rows[0].status).toBe('ACTIVE')
  })

  it('completeCalendarConnection rejeita state adulterado', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    await expect(
      completeCalendarConnection({ provider: 'google', code: 'c', state: 'invalido' }),
    ).rejects.toBeInstanceOf(CalendarError)
  })

  it('completeCalendarConnection rejeita provedor diferente do assinado no state', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    const state = signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' })
    await expect(
      completeCalendarConnection({ provider: 'microsoft', code: 'c', state }),
    ).rejects.toBeInstanceOf(CalendarError)
  })

  it('getCalendarIntegrationState lista conexão e provedores disponíveis, sem token', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    stubTokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idToken('a@b.com') })
    await completeCalendarConnection({
      provider: 'google',
      code: 'c',
      state: signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' }),
    })

    const state = await getCalendarIntegrationState({ userId: user.id, companyId: DEFAULT_COMPANY_ID })
    expect(state.available).toEqual(['google'])
    expect(state.connections).toEqual([
      { provider: 'google', accountEmail: 'a@b.com', status: 'active', publishEnabled: true, lastSyncAt: null },
    ])
    expect(JSON.stringify(state)).not.toContain('rt')
  })

  it('getValidAccessToken renova quando o access token está expirado', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    const connection = await prisma.calendarConnection.create({
      data: {
        userId: user.id,
        companyId: DEFAULT_COMPANY_ID,
        provider: 'GOOGLE',
        providerAccountEmail: 'a@b.com',
        accessTokenEnc: encryptSecret('velho'),
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenEnc: encryptSecret('rt'),
        scopes: 'calendar.events',
      },
    })
    stubTokenResponse({ access_token: 'novo', expires_in: 3600, scope: 'calendar.events' })

    expect(await getValidAccessToken(connection.id)).toBe('novo')
    const reloaded = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connection.id } })
    expect(decryptSecret(reloaded.accessTokenEnc)).toBe('novo')
    expect(reloaded.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('getValidAccessToken marca NEEDS_REAUTH quando o consentimento foi revogado', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    const connection = await prisma.calendarConnection.create({
      data: {
        userId: user.id,
        companyId: DEFAULT_COMPANY_ID,
        provider: 'GOOGLE',
        providerAccountEmail: 'a@b.com',
        accessTokenEnc: encryptSecret('velho'),
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenEnc: encryptSecret('rt'),
        scopes: 'calendar.events',
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))

    await expect(getValidAccessToken(connection.id)).rejects.toBeTruthy()
    const reloaded = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connection.id } })
    expect(reloaded.status).toBe('NEEDS_REAUTH')
  })

  it('disconnectCalendar apaga a conexão', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    stubTokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idToken('a@b.com') })
    await completeCalendarConnection({
      provider: 'google',
      code: 'c',
      state: signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' }),
    })

    await disconnectCalendar({ userId: user.id, provider: 'google' })
    expect(await prisma.calendarConnection.count({ where: { userId: user.id } })).toBe(0)
  })
})
