import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getOfficeSettings, setBroadcastEnabled } from './office-setting-service'

async function createActor() {
  const user = await prisma.user.create({ data: { name: 'Admin', email: `admin-${Date.now()}-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
  return user.id
}

async function otherCompany(slug: string) {
  return prisma.company.create({ data: { name: slug, slug } })
}

describe('office-setting-service', () => {
  it('sem linha no banco, o default é desligado', async () => {
    expect(await getOfficeSettings(DEFAULT_COMPANY_ID)).toEqual({ broadcastEnabled: false, activeMapPublicationId: null })
  })

  it('liga, persiste e lê de volta', async () => {
    const actorId = await createActor()
    expect(await setBroadcastEnabled(true, actorId, DEFAULT_COMPANY_ID)).toEqual({ broadcastEnabled: true, activeMapPublicationId: null })
    expect(await getOfficeSettings(DEFAULT_COMPANY_ID)).toEqual({ broadcastEnabled: true, activeMapPublicationId: null })
  })

  it('desligar de novo é idempotente (upsert da linha única)', async () => {
    const actorId = await createActor()
    await setBroadcastEnabled(true, actorId, DEFAULT_COMPANY_ID)
    await setBroadcastEnabled(false, actorId, DEFAULT_COMPANY_ID)
    await setBroadcastEnabled(false, actorId, DEFAULT_COMPANY_ID)
    expect(await getOfficeSettings(DEFAULT_COMPANY_ID)).toEqual({ broadcastEnabled: false, activeMapPublicationId: null })
  })

  it('configuração de uma empresa não vaza pra outra', async () => {
    const company = await otherCompany('outra-empresa-office-setting-test')
    const actorId = await createActor()
    await setBroadcastEnabled(true, actorId, DEFAULT_COMPANY_ID)

    expect(await getOfficeSettings(company.id)).toEqual({ broadcastEnabled: false, activeMapPublicationId: null })
  })

  it('ligar numa empresa não afeta o desligado da outra', async () => {
    const company = await otherCompany('outra-empresa-office-setting-test-2')
    const actorId = await createActor()
    await setBroadcastEnabled(true, actorId, company.id)

    expect(await getOfficeSettings(DEFAULT_COMPANY_ID)).toEqual({ broadcastEnabled: false, activeMapPublicationId: null })
    expect(await getOfficeSettings(company.id)).toEqual({ broadcastEnabled: true, activeMapPublicationId: null })
  })
})
