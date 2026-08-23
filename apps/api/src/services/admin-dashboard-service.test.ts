import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createSector } from './sector-service'
import { getAdminDashboard } from './admin-dashboard-service'

describe('getAdminDashboard', () => {
  it('agrega período ativo, votos e destaque pendente por setor', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin', email: 'dash-admin@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const sector = await createSector({ name: 'Setor Dashboard', enabledFeatures: [], roles: ['LEGEND'] }, admin.id, DEFAULT_COMPANY_ID)
    const legend = await prisma.user.create({ data: { name: 'Legend Dash', email: 'dash-legend@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sector.id } })
    const voter = await prisma.user.create({ data: { name: 'Voter Dash', email: 'dash-voter@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sector.id } })
    const cat = await prisma.recognitionCategory.create({ data: { name: 'Cat Dash', slug: 'cat-dash' } })
    const now = new Date('2027-05-15T12:00:00.000Z')
    const period = await prisma.votingPeriod.create({
      data: { sectorId: sector.id, monthRef: '2027-05', startsAt: new Date('2027-05-01'), endsAt: new Date('2027-05-31'), status: 'OPEN' },
    })
    await prisma.vote.create({ data: { voterId: voter.id, votedId: legend.id, periodId: period.id, justification: 'justificativa válida', categories: { create: [{ categoryId: cat.id }] } } })

    const dashboard = await getAdminDashboard(now, DEFAULT_COMPANY_ID)
    const card = dashboard.sectors.find((s) => s.sectorId === sector.id)!
    expect(card.activeUserCount).toBe(2)
    expect(card.period?.state).toBe('ACTIVE')
    expect(card.period?.votesCast).toBe(1)
    expect(card.pendingHighlight).toBe(false) // não há período ENCERRADO ainda
  })

  it('marca pendingHighlight quando o último período encerrado não tem destaque publicado', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin2', email: 'dash-admin2@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const sector = await createSector({ name: 'Setor Dashboard 2', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
    await prisma.votingPeriod.create({
      data: { sectorId: sector.id, monthRef: '2027-04', startsAt: new Date('2027-04-01'), endsAt: new Date('2027-04-30'), status: 'CLOSED', highlightStatus: 'NONE' },
    })
    const dashboard = await getAdminDashboard(new Date('2027-05-01T00:00:00.000Z'), DEFAULT_COMPANY_ID)
    const card = dashboard.sectors.find((s) => s.sectorId === sector.id)!
    expect(card.pendingHighlight).toBe(true)
    expect(card.period).toBeNull() // não há período ATIVO nem AGENDADO
  })

  it('prioriza o período ATIVO sobre um SCHEDULED futuro do mesmo setor', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin3', email: 'dash-admin3@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const sector = await createSector({ name: 'Setor Dashboard 3', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
    const now = new Date('2027-07-15T12:00:00.000Z')
    const activePeriod = await prisma.votingPeriod.create({
      data: { sectorId: sector.id, monthRef: '2027-07', startsAt: new Date('2027-07-01'), endsAt: new Date('2027-07-31'), status: 'OPEN' },
    })
    // Agendado para o mês seguinte — não pode esconder o período ativo em julho.
    await prisma.votingPeriod.create({
      data: { sectorId: sector.id, monthRef: '2027-08', startsAt: new Date('2027-08-01'), endsAt: new Date('2027-08-31'), status: 'OPEN' },
    })

    const dashboard = await getAdminDashboard(now, DEFAULT_COMPANY_ID)
    const card = dashboard.sectors.find((s) => s.sectorId === sector.id)!
    expect(card.period?.id).toBe(activePeriod.id)
    expect(card.period?.state).toBe('ACTIVE')
  })

  it('quando só há períodos SCHEDULED, escolhe o mais próximo (não o mais distante)', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin4', email: 'dash-admin4@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const sector = await createSector({ name: 'Setor Dashboard 4', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
    const now = new Date('2027-07-15T12:00:00.000Z')
    const nearest = await prisma.votingPeriod.create({
      data: { sectorId: sector.id, monthRef: '2027-08', startsAt: new Date('2027-08-01'), endsAt: new Date('2027-08-31'), status: 'OPEN' },
    })
    await prisma.votingPeriod.create({
      data: { sectorId: sector.id, monthRef: '2027-09', startsAt: new Date('2027-09-01'), endsAt: new Date('2027-09-30'), status: 'OPEN' },
    })

    const dashboard = await getAdminDashboard(now, DEFAULT_COMPANY_ID)
    const card = dashboard.sectors.find((s) => s.sectorId === sector.id)!
    expect(card.period?.id).toBe(nearest.id)
    expect(card.period?.state).toBe('SCHEDULED')
  })

  it('filtra por sectorId quando informado, retornando só o card daquele setor', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin5', email: 'dash-admin5@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorA = await createSector({ name: 'Setor Dashboard A', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
    await createSector({ name: 'Setor Dashboard B', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)

    const dashboard = await getAdminDashboard(new Date(), DEFAULT_COMPANY_ID, sectorA.id)
    expect(dashboard.sectors).toHaveLength(1)
    expect(dashboard.sectors[0].sectorId).toBe(sectorA.id)
  })

  it('não soma setores/votos de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Dashboard', slug: 'outra-empresa-dashboard-test' } })
    const admin = await prisma.user.create({ data: { name: 'Admin Outra Empresa Dash', email: 'admin-outra-empresa-dash@x.com', passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id } })
    const otherSector = await createSector({ name: 'Setor Outra Empresa Dash', enabledFeatures: [], roles: [] }, admin.id, otherCompany.id)
    await prisma.user.create({ data: { name: 'Legend Outra Empresa Dash', email: 'legend-outra-empresa-dash@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: otherSector.id, companyId: otherCompany.id } })

    const dashboard = await getAdminDashboard(new Date(), DEFAULT_COMPANY_ID)
    expect(dashboard.sectors.some((s) => s.sectorId === otherSector.id)).toBe(false)
  })
})
