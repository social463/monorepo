import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  availableCalendarProviders,
  calendarRedirectUri,
  getCalendarCredentials,
  getCalendarSettings,
  updateCalendarSettings,
} from './calendar-settings-service'

async function actor() {
  const user = await prisma.user.create({
    data: { name: 'Admin', email: 'admin@empresa.com', passwordHash: 'x', role: 'ADMIN', companyId: DEFAULT_COMPANY_ID },
  })
  return user.id
}

describe('calendar settings service', () => {
  it('sem credenciais, nada está configurado nem disponível', async () => {
    const settings = await getCalendarSettings(DEFAULT_COMPANY_ID)
    expect(settings.google.configured).toBe(false)
    expect(settings.google.clientId).toBeNull()
    expect(await availableCalendarProviders(DEFAULT_COMPANY_ID)).toEqual([])
  })

  it('grava credenciais do Google e passa a considerar o provedor disponível', async () => {
    const actorId = await actor()
    const settings = await updateCalendarSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId,
      body: { google: { clientId: 'cid', clientSecret: 'csecret' } },
    })
    expect(settings.google).toMatchObject({ configured: true, clientId: 'cid' })
    expect(await availableCalendarProviders(DEFAULT_COMPANY_ID)).toEqual(['google'])
    const creds = await getCalendarCredentials(DEFAULT_COMPANY_ID, 'google')
    expect(creds).toMatchObject({ clientId: 'cid', clientSecret: 'csecret' })
  })

  it('o secret vai cifrado para o banco', async () => {
    const actorId = await actor()
    await updateCalendarSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId,
      body: { google: { clientId: 'cid', clientSecret: 'csecret' } },
    })
    const row = await prisma.appSetting.findFirst({ where: { key: 'calendar_google_client_secret_enc' } })
    expect(row?.value).not.toContain('csecret')
    expect(row?.value?.startsWith('v1:')).toBe(true)
  })

  it('o audit log não guarda o secret', async () => {
    const actorId = await actor()
    await updateCalendarSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId,
      body: { google: { clientId: 'cid', clientSecret: 'csecret' } },
    })
    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'CalendarSettings' } })
    expect(logs).toHaveLength(1)
    expect(JSON.stringify(logs[0])).not.toContain('csecret')
  })

  it('secret ausente mantém o atual; string vazia limpa', async () => {
    const actorId = await actor()
    const base = { companyId: DEFAULT_COMPANY_ID, actorId }
    await updateCalendarSettings({ ...base, body: { google: { clientId: 'cid', clientSecret: 'csecret' } } })

    await updateCalendarSettings({ ...base, body: { google: { clientId: 'cid-2' } } })
    expect(await getCalendarCredentials(DEFAULT_COMPANY_ID, 'google')).toMatchObject({
      clientId: 'cid-2',
      clientSecret: 'csecret',
    })

    await updateCalendarSettings({ ...base, body: { google: { clientSecret: '' } } })
    expect(await getCalendarCredentials(DEFAULT_COMPANY_ID, 'google')).toBeNull()
  })

  it('Microsoft só está configurada com tenantId', async () => {
    const actorId = await actor()
    await updateCalendarSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId,
      body: { microsoft: { clientId: 'cid', clientSecret: 'cs' } },
    })
    expect((await getCalendarSettings(DEFAULT_COMPANY_ID)).microsoft.configured).toBe(false)

    await updateCalendarSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId,
      body: { microsoft: { tenantId: 'tenant-1' } },
    })
    expect((await getCalendarSettings(DEFAULT_COMPANY_ID)).microsoft.configured).toBe(true)
  })

  it('credenciais são isoladas por empresa', async () => {
    const actorId = await actor()
    const other = await prisma.company.create({ data: { name: 'Outra', slug: 'outra' } })
    await updateCalendarSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId,
      body: { google: { clientId: 'cid', clientSecret: 'cs' } },
    })
    expect(await getCalendarCredentials(other.id, 'google')).toBeNull()
  })

  it('o redirect URI é derivado do app base URL e inclui /api', () => {
    expect(calendarRedirectUri('google')).toMatch(/\/api\/calendar\/callback\/google$/)
  })
})
