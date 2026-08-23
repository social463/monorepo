import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { closeVotingPeriod, monthRefFor, scheduleVotingPeriod, updateVotingPeriod } from './admin-service'

async function createActor() {
  const user = await prisma.user.create({
    data: { name: 'Admin', email: `admin-${Date.now()}-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  return user.id
}

describe('admin service', () => {
  it('formats monthRef as YYYY-MM', () => {
    expect(monthRefFor(new Date(2026, 5, 15))).toBe('2026-06')
    expect(monthRefFor(new Date(2026, 0, 1))).toBe('2026-01')
  })

  it('schedules a voting period with an explicit month and window', async () => {
    const actorId = await createActor()
    const period = await scheduleVotingPeriod(
      {
        sectorId: DEFAULT_SECTOR_ID,
        monthRef: '2026-09',
        startsAt: new Date('2026-09-10T00:00:00Z'),
        endsAt: new Date('2026-09-17T23:59:59Z'),
      },
      actorId,
      DEFAULT_COMPANY_ID,
    )
    expect(period.monthRef).toBe('2026-09')
    expect(period.status).toBe('OPEN')
    expect(period.startsAt.toISOString()).toBe('2026-09-10T00:00:00.000Z')
    expect(period.endsAt.toISOString()).toBe('2026-09-17T23:59:59.000Z')
  })

  it('rejects a duplicate month', async () => {
    const actorId = await createActor()
    const win = { sectorId: DEFAULT_SECTOR_ID, startsAt: new Date('2026-09-01'), endsAt: new Date('2026-09-30') }
    await scheduleVotingPeriod({ monthRef: '2026-09', ...win }, actorId, DEFAULT_COMPANY_ID)
    await expect(scheduleVotingPeriod({ monthRef: '2026-09', ...win }, actorId, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ code: 'P2002' })
  })

  it('re-opens a period when its window is edited (rescheduling a closed cycle)', async () => {
    const actorId = await createActor()
    const period = await scheduleVotingPeriod(
      {
        sectorId: DEFAULT_SECTOR_ID,
        monthRef: '2026-09',
        startsAt: new Date('2026-09-01'),
        endsAt: new Date('2026-09-30'),
      },
      actorId,
      DEFAULT_COMPANY_ID,
    )
    await closeVotingPeriod(period.id, actorId, DEFAULT_COMPANY_ID)
    const updated = await updateVotingPeriod(
      period.id,
      {
        startsAt: new Date('2026-09-10'),
        endsAt: new Date('2026-09-20'),
      },
      actorId,
      DEFAULT_COMPANY_ID,
    )
    expect(updated.status).toBe('OPEN')
    expect(updated.startsAt.toISOString()).toBe(new Date('2026-09-10').toISOString())
  })

  it('closes a voting period', async () => {
    const actorId = await createActor()
    const period = await scheduleVotingPeriod(
      {
        sectorId: DEFAULT_SECTOR_ID,
        monthRef: '2026-09',
        startsAt: new Date('2026-09-01'),
        endsAt: new Date('2026-09-30'),
      },
      actorId,
      DEFAULT_COMPANY_ID,
    )
    const closed = await closeVotingPeriod(period.id, actorId, DEFAULT_COMPANY_ID)
    expect(closed.status).toBe('CLOSED')
  })

  it('audita schedule/update/close', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin', email: 'auditadmin-period@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const period = await scheduleVotingPeriod(
      { sectorId: DEFAULT_SECTOR_ID, monthRef: '2027-03', startsAt: new Date(Date.now() + 1000), endsAt: new Date(Date.now() + 100000) },
      admin.id,
      DEFAULT_COMPANY_ID,
    )
    await updateVotingPeriod(period.id, { startsAt: new Date(Date.now() + 2000), endsAt: new Date(Date.now() + 200000) }, admin.id, DEFAULT_COMPANY_ID)
    await closeVotingPeriod(period.id, admin.id, DEFAULT_COMPANY_ID)

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'VotingPeriod', entityId: period.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'UPDATE'])
  })

  it('updateVotingPeriod/closeVotingPeriod de um período de outra empresa rejeitam (P2025, tratado como 404 na rota)', async () => {
    const actorId = await createActor()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Periodo', slug: 'outra-empresa-periodo-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Periodo', slug: 'setor-outra-empresa-periodo-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherPeriod = await prisma.votingPeriod.create({
      data: { monthRef: '2026-09', startsAt: new Date(Date.now() + 1000), endsAt: new Date(Date.now() + 100000), status: 'OPEN', sectorId: otherSector.id, companyId: otherCompany.id },
    })

    await expect(
      updateVotingPeriod(otherPeriod.id, { startsAt: new Date(Date.now() + 2000), endsAt: new Date(Date.now() + 200000) }, actorId, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({ code: 'P2025' })
    await expect(closeVotingPeriod(otherPeriod.id, actorId, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ code: 'P2025' })
  })

  it('rejeita agendar período com sectorId de outra empresa (companyId do ator, não do setor)', async () => {
    const actorId = await createActor()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Agenda Periodo', slug: 'outra-empresa-agenda-periodo-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Agenda Periodo', slug: 'setor-outra-empresa-agenda-periodo-test', enabledFeatures: [], companyId: otherCompany.id },
    })

    await expect(
      scheduleVotingPeriod(
        { sectorId: otherSector.id, monthRef: '2026-09', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-09-30') },
        actorId,
        DEFAULT_COMPANY_ID,
      ),
    ).rejects.toMatchObject({ status: 400 })
  })
})
