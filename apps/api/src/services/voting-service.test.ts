import { describe, it, expect } from 'vitest'
import { DEFAULT_SECTOR_ID, DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createVote, getCurrentOpenPeriod, getNextScheduledPeriod, listVotesByVoter } from './voting-service'
import { scheduleVotingPeriod } from './admin-service'
import { createSector } from './sector-service'

function currentOpenPeriodData() {
  const now = new Date()
  return {
    monthRef: now.toISOString().slice(0, 7),
    startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    endsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    status: 'OPEN' as const,
  }
}

async function seedFixtures() {
  const voter = await prisma.user.create({ data: { name: 'Ana', email: 'ana@empresa.com', passwordHash: 'x' } })
  const voted = await prisma.user.create({ data: { name: 'Bruno', email: 'bruno@empresa.com', passwordHash: 'x' } })
  const category = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
  const period = await prisma.votingPeriod.create({
    data: currentOpenPeriodData(),
  })
  return { voter, voted, category, period }
}

describe('voting service', () => {
  it('creates a vote with valid data', async () => {
    const { voter, voted, category } = await seedFixtures()
    const vote = await createVote({
      voterId: voter.id,
      votedId: voted.id,
      categoryIds: [category.id],
      justification: 'Ajudou muito no incidente de produção.',
    })
    expect(vote.id).toBeTruthy()
    expect(vote.voted.name).toBe('Bruno')
    expect(vote.categories.map((c) => c.category.slug)).toEqual(['colaboracao'])
  })

  it('creates a vote with multiple categories', async () => {
    const { voter, voted, category } = await seedFixtures()
    const outra = await prisma.recognitionCategory.create({ data: { name: 'Inovação', slug: 'inovacao' } })
    const vote = await createVote({
      voterId: voter.id,
      votedId: voted.id,
      categoryIds: [category.id, outra.id],
      justification: 'Reconhecimento em dois eixos.',
    })
    expect(vote.categories).toHaveLength(2)
    expect(await prisma.voteCategory.count({ where: { voteId: vote.id } })).toBe(2)
  })

  it('rejects an invalid category (400)', async () => {
    const { voter, voted } = await seedFixtures()
    await expect(
      createVote({ voterId: voter.id, votedId: voted.id, categoryIds: ['nao-existe'], justification: 'texto válido aqui' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita categoryId desativado', async () => {
    // O recorte por setor deixou de existir com o catálogo unificado; o que
    // ainda barra uma categoria é ela estar desativada.
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A', slug: 'setor-a-vote-test', enabledFeatures: [] } })
    const voter = await prisma.user.create({ data: { name: 'Voter', email: 'voter-cat@x.com', passwordHash: 'x', sectorId: sectorA.id } })
    const voted = await prisma.user.create({ data: { name: 'Voted', email: 'voted-cat@x.com', passwordHash: 'x', sectorId: sectorA.id } })
    await prisma.votingPeriod.create({
      data: { sectorId: sectorA.id, monthRef: '2026-07', startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000), status: 'OPEN' },
    })
    const desativada = await prisma.recognitionCategory.create({
      data: { name: 'Desativada', slug: 'desativada', active: false },
    })
    await expect(
      createVote({ voterId: voter.id, votedId: voted.id, categoryIds: [desativada.id], justification: 'Justificativa válida aqui.' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects voting for yourself (400)', async () => {
    const { voter, category } = await seedFixtures()
    await expect(
      createVote({ voterId: voter.id, votedId: voter.id, categoryIds: [category.id], justification: 'qualquer texto aqui' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects when there is no open period (409)', async () => {
    const { voter, voted, category, period } = await seedFixtures()
    await prisma.votingPeriod.update({ where: { id: period.id }, data: { status: 'CLOSED' } })
    await expect(
      createVote({ voterId: voter.id, votedId: voted.id, categoryIds: [category.id], justification: 'justificativa válida' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('rejects an inactive voted user (400)', async () => {
    const { voter, voted, category } = await seedFixtures()
    await prisma.user.update({ where: { id: voted.id }, data: { active: false } })
    await expect(
      createVote({ voterId: voter.id, votedId: voted.id, categoryIds: [category.id], justification: 'justificativa válida' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('lets a LEAD voter recognize a DEV', async () => {
    const { voted, category } = await seedFixtures()
    const lead = await prisma.user.create({
      data: { name: 'Lider', email: 'lider@empresa.com', passwordHash: 'x', role: 'LEAD' },
    })
    const vote = await createVote({
      voterId: lead.id,
      votedId: voted.id,
      categoryIds: [category.id],
      justification: 'Reconhecimento de uma liderança.',
    })
    expect(vote.id).toBeTruthy()
  })

  it('rejects voting for a LEAD target (400)', async () => {
    const { voter, category } = await seedFixtures()
    const lead = await prisma.user.create({
      data: { name: 'Lider', email: 'lider@empresa.com', passwordHash: 'x', role: 'LEAD' },
    })
    await expect(
      createVote({ voterId: voter.id, votedId: lead.id, categoryIds: [category.id], justification: 'justificativa válida' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects voting for an ADMIN target (400)', async () => {
    const { voter, category } = await seedFixtures()
    const admin = await prisma.user.create({
      data: { name: 'Chefe', email: 'chefe@empresa.com', passwordHash: 'x', role: 'ADMIN' },
    })
    await expect(
      createVote({ voterId: voter.id, votedId: admin.id, categoryIds: [category.id], justification: 'justificativa válida' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects voting by a SUBADMIN voter (403)', async () => {
    const { category } = await seedFixtures()
    const sub = await prisma.user.create({
      data: { name: 'ChefinhoSub', email: 'chefinho-sub@empresa.com', passwordHash: 'x', role: 'SUBADMIN' },
    })
    const voted = await prisma.user.create({ data: { name: 'Rui', email: 'rui-sub-target@empresa.com', passwordHash: 'x' } })
    await expect(
      createVote({ voterId: sub.id, votedId: voted.id, categoryIds: [category.id], justification: 'justificativa válida' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('rejects a second vote in the same period, even for a different colleague or category (409)', async () => {
    const { voter, voted, category } = await seedFixtures()
    const otherVoted = await prisma.user.create({ data: { name: 'Carla', email: 'carla@empresa.com', passwordHash: 'x' } })
    const otherCategory = await prisma.recognitionCategory.create({ data: { name: 'Inovação', slug: 'inovacao' } })
    await createVote({ voterId: voter.id, votedId: voted.id, categoryIds: [category.id], justification: 'justificativa válida' })
    await expect(
      createVote({ voterId: voter.id, votedId: otherVoted.id, categoryIds: [otherCategory.id], justification: 'outra justificativa' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('returns the active period when now is inside the window', async () => {
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-07', startsAt: new Date('2026-07-01'), endsAt: new Date('2026-07-31T23:59:59'), status: 'OPEN' },
    })
    const active = await getCurrentOpenPeriod(DEFAULT_SECTOR_ID, DEFAULT_COMPANY_ID, new Date('2026-07-15'))
    expect(active?.monthRef).toBe('2026-07')
  })

  it('ignores a scheduled period whose window has not started', async () => {
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-07', startsAt: new Date('2026-07-01'), endsAt: new Date('2026-07-31T23:59:59'), status: 'OPEN' },
    })
    expect(await getCurrentOpenPeriod(DEFAULT_SECTOR_ID, DEFAULT_COMPANY_ID, new Date('2026-06-15'))).toBeNull()
  })

  it('ignores a period whose window already ended', async () => {
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-07', startsAt: new Date('2026-07-01'), endsAt: new Date('2026-07-31T23:59:59'), status: 'OPEN' },
    })
    expect(await getCurrentOpenPeriod(DEFAULT_SECTOR_ID, DEFAULT_COMPANY_ID, new Date('2026-08-15'))).toBeNull()
  })

  it('ignores a CLOSED period even inside its window', async () => {
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-07', startsAt: new Date('2026-07-01'), endsAt: new Date('2026-07-31T23:59:59'), status: 'CLOSED' },
    })
    expect(await getCurrentOpenPeriod(DEFAULT_SECTOR_ID, DEFAULT_COMPANY_ID, new Date('2026-07-15'))).toBeNull()
  })

  it('returns the nearest future scheduled period as next', async () => {
    await prisma.votingPeriod.create({ data: { monthRef: '2026-09', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-09-30'), status: 'OPEN' } })
    await prisma.votingPeriod.create({ data: { monthRef: '2026-07', startsAt: new Date('2026-07-01'), endsAt: new Date('2026-07-31'), status: 'OPEN' } })
    const next = await getNextScheduledPeriod(DEFAULT_SECTOR_ID, DEFAULT_COMPANY_ID, new Date('2026-06-15'))
    expect(next?.monthRef).toBe('2026-07')
  })

  it('returns null for next when there is no future period', async () => {
    await prisma.votingPeriod.create({ data: { monthRef: '2026-01', startsAt: new Date('2026-01-01'), endsAt: new Date('2026-01-31'), status: 'OPEN' } })
    expect(await getNextScheduledPeriod(DEFAULT_SECTOR_ID, DEFAULT_COMPANY_ID, new Date('2026-06-15'))).toBeNull()
  })

  it('ignores a CLOSED future period when computing next', async () => {
    await prisma.votingPeriod.create({ data: { monthRef: '2026-09', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-09-30'), status: 'CLOSED' } })
    expect(await getNextScheduledPeriod(DEFAULT_SECTOR_ID, DEFAULT_COMPANY_ID, new Date('2026-06-15'))).toBeNull()
  })

  it('lists votes cast by a voter in a period', async () => {
    const { voter, voted, category, period } = await seedFixtures()
    await createVote({ voterId: voter.id, votedId: voted.id, categoryIds: [category.id], justification: 'justificativa válida' })
    const votes = await listVotesByVoter(voter.id, period.id)
    expect(votes).toHaveLength(1)
    expect(votes[0].voted.name).toBe('Bruno')
  })
})

describe('votação escopada por setor', () => {
  it('rejeita voto em colega de outro setor e permite no mesmo setor', async () => {
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-voting-sector@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorA = await createSector({ name: 'Setor A', enabledFeatures: [], roles: ['LEGEND'] }, actor.id, DEFAULT_COMPANY_ID)
    const sectorB = await createSector({ name: 'Setor B', enabledFeatures: [], roles: ['LEGEND'] }, actor.id, DEFAULT_COMPANY_ID)
    const cat = await prisma.recognitionCategory.create({ data: { name: 'Cat', slug: 'cat' } })
    const now = new Date()
    const monthRef = now.toISOString().slice(0, 7)
    const startsAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const periodA = await scheduleVotingPeriod(
      {
        sectorId: sectorA.id,
        monthRef,
        startsAt,
        endsAt,
      },
      actor.id,
      DEFAULT_COMPANY_ID,
    )
    const periodB = await scheduleVotingPeriod(
      {
        sectorId: sectorB.id,
        monthRef,
        startsAt,
        endsAt,
      },
      actor.id,
      DEFAULT_COMPANY_ID,
    )
    expect(periodA.id).not.toBe(periodB.id)

    const voterA = await prisma.user.create({ data: { name: 'Voter A', email: 'va@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sectorA.id } })
    const votedB = await prisma.user.create({ data: { name: 'Voted B', email: 'vb@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sectorB.id } })
    const votedA = await prisma.user.create({ data: { name: 'Voted A', email: 'va2@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sectorA.id } })

    await expect(
      createVote({ voterId: voterA.id, votedId: votedB.id, categoryIds: [cat.id], justification: 'justificativa válida' }),
    ).rejects.toMatchObject({ status: 400 })

    const vote = await createVote({ voterId: voterA.id, votedId: votedA.id, categoryIds: [cat.id], justification: 'justificativa válida' })
    expect(vote.periodId).toBe(periodA.id)
  })

  it('getCurrentOpenPeriod/getNextScheduledPeriod respeitam o setor', async () => {
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-voting-sector-2@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorA = await createSector({ name: 'A2', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    const sectorB = await createSector({ name: 'B2', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    await scheduleVotingPeriod(
      { sectorId: sectorA.id, monthRef: '2026-12', startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 100000) },
      actor.id,
      DEFAULT_COMPANY_ID,
    )
    const currentA = await getCurrentOpenPeriod(sectorA.id, DEFAULT_COMPANY_ID)
    const currentB = await getCurrentOpenPeriod(sectorB.id, DEFAULT_COMPANY_ID)
    expect(currentA).not.toBeNull()
    expect(currentB).toBeNull()
  })
})

describe('votação escopada por empresa', () => {
  it('duas empresas com o mesmo monthRef têm votos e vencedores totalmente isolados', async () => {
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-voting-company@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const companyB = await prisma.company.create({ data: { name: 'Empresa B', slug: 'empresa-b-voting-test' } })

    const sectorA = await createSector({ name: 'Setor A Empresa A', enabledFeatures: [], roles: ['LEGEND'] }, actor.id, DEFAULT_COMPANY_ID)
    const sectorB = await createSector({ name: 'Setor A Empresa B', enabledFeatures: [], roles: ['LEGEND'] }, actor.id, companyB.id)

    const now = new Date()
    const monthRef = now.toISOString().slice(0, 7)
    const startsAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    const periodA = await scheduleVotingPeriod({ sectorId: sectorA.id, monthRef, startsAt, endsAt }, actor.id, DEFAULT_COMPANY_ID)
    const periodB = await scheduleVotingPeriod({ sectorId: sectorB.id, monthRef, startsAt, endsAt }, actor.id, companyB.id)
    expect(periodA.companyId).toBe(DEFAULT_COMPANY_ID)
    expect(periodB.companyId).toBe(companyB.id)

    const voterA = await prisma.user.create({ data: { name: 'Voter A', email: 'voter-a-company@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sectorA.id, companyId: DEFAULT_COMPANY_ID } })
    const votedA = await prisma.user.create({ data: { name: 'Voted A', email: 'voted-a-company@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sectorA.id, companyId: DEFAULT_COMPANY_ID } })
    const voterB = await prisma.user.create({ data: { name: 'Voter B', email: 'voter-b-company@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sectorB.id, companyId: companyB.id } })
    const votedB = await prisma.user.create({ data: { name: 'Voted B', email: 'voted-b-company@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sectorB.id, companyId: companyB.id } })

    const categoryGlobalB = await prisma.recognitionCategory.create({ data: { name: 'Cat B Outra', slug: 'cat-global-b-company-test', companyId: companyB.id } })
    const categoryA = await prisma.recognitionCategory.create({ data: { name: 'Cat A', slug: 'cat-a-company-test', companyId: DEFAULT_COMPANY_ID } })

    // A categoria pertence à empresa B — não pode validar um voto da empresa A.
    await expect(
      createVote({ voterId: voterA.id, votedId: votedA.id, categoryIds: [categoryGlobalB.id], justification: 'justificativa válida' }),
    ).rejects.toMatchObject({ status: 400 })

    const voteA = await createVote({ voterId: voterA.id, votedId: votedA.id, categoryIds: [categoryA.id], justification: 'justificativa válida' })
    expect(voteA.companyId).toBe(DEFAULT_COMPANY_ID)

    const categoryB = await prisma.recognitionCategory.create({ data: { name: 'Cat B', slug: 'cat-b-company-test', companyId: companyB.id } })
    const voteB = await createVote({ voterId: voterB.id, votedId: votedB.id, categoryIds: [categoryB.id], justification: 'justificativa válida' })
    expect(voteB.companyId).toBe(companyB.id)

    const votesOfA = await listVotesByVoter(voterA.id, periodA.id)
    expect(votesOfA.map((v) => v.id)).toEqual([voteA.id])
    const votesOfB = await listVotesByVoter(voterB.id, periodB.id)
    expect(votesOfB.map((v) => v.id)).toEqual([voteB.id])
  })
})

describe('getCurrentOpenPeriod/getNextScheduledPeriod escopados por empresa', () => {
  it('não retorna período de outra empresa mesmo com o mesmo sectorId (id coincidente é impossível, mas o filtro tem que estar lá)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Period', slug: 'outra-empresa-period-test' } })
    const admin = await prisma.user.create({ data: { name: 'Admin Period', email: 'admin-period-empresa@x.com', passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id } })
    const otherSector = await createSector({ name: 'Setor Period Outra Empresa', enabledFeatures: [], roles: [] }, admin.id, otherCompany.id)
    await prisma.votingPeriod.create({
      data: { sectorId: otherSector.id, companyId: otherCompany.id, monthRef: '2026-07', startsAt: new Date('2026-07-01'), endsAt: new Date('2026-07-31'), status: 'OPEN' },
    })

    const result = await getCurrentOpenPeriod(otherSector.id, DEFAULT_COMPANY_ID, new Date('2026-07-15'))
    expect(result).toBeNull()
  })
})
