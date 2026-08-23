import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { electWinner, listPublishedHighlights } from './highlight-service'

async function seedPeriod() {
  const category = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
  const period = await prisma.votingPeriod.create({
    data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'), status: 'CLOSED' },
  })
  return { category, period }
}

async function mkUser(name: string) {
  return prisma.user.create({ data: { name, email: `${name.toLowerCase()}@empresa.com`, passwordHash: 'x' } })
}

// Cada votante dá 1 voto/período; criamos votantes distintos por voto.
async function castVote(opts: { votedId: string; categoryId: string; periodId: string; at: Date; voterName: string }) {
  const voter = await mkUser(opts.voterName)
  return prisma.vote.create({
    data: {
      voterId: voter.id,
      votedId: opts.votedId,
      periodId: opts.periodId,
      justification: 'reconhecimento de teste',
      createdAt: opts.at,
      categories: { create: [{ categoryId: opts.categoryId }] },
    },
  })
}

describe('electWinner', () => {
  it('returns the most-voted user', async () => {
    const { category, period } = await seedPeriod()
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    await castVote({ votedId: ana.id, categoryId: category.id, periodId: period.id, at: new Date('2026-06-02'), voterName: 'V1' })
    await castVote({ votedId: ana.id, categoryId: category.id, periodId: period.id, at: new Date('2026-06-03'), voterName: 'V2' })
    await castVote({ votedId: bruno.id, categoryId: category.id, periodId: period.id, at: new Date('2026-06-04'), voterName: 'V3' })

    const result = await electWinner(period.id, DEFAULT_COMPANY_ID)
    expect(result).toEqual({ winnerId: ana.id, winnerVotes: 2 })
  })

  it('breaks a tie by who reached the winning score first', async () => {
    const { category, period } = await seedPeriod()
    const ana = await mkUser('Ana')
    const bruno = await mkUser('Bruno')
    // Ambos chegam a 2 votos; Bruno atinge 2 (voto às 03) antes de Ana atingir 2 (voto às 05).
    await castVote({ votedId: bruno.id, categoryId: category.id, periodId: period.id, at: new Date('2026-06-01'), voterName: 'V1' })
    await castVote({ votedId: ana.id, categoryId: category.id, periodId: period.id, at: new Date('2026-06-02'), voterName: 'V2' })
    await castVote({ votedId: bruno.id, categoryId: category.id, periodId: period.id, at: new Date('2026-06-03'), voterName: 'V3' })
    await castVote({ votedId: ana.id, categoryId: category.id, periodId: period.id, at: new Date('2026-06-05'), voterName: 'V4' })

    const result = await electWinner(period.id, DEFAULT_COMPANY_ID)
    expect(result).toEqual({ winnerId: bruno.id, winnerVotes: 2 })
  })

  it('returns null when there are no votes', async () => {
    const { period } = await seedPeriod()
    expect(await electWinner(period.id, DEFAULT_COMPANY_ID)).toBeNull()
  })

  it('ignora votos cujo alvo não é DEV (ex.: liderança)', async () => {
    const { category, period } = await seedPeriod()
    const dev = await mkUser('Dev')
    const lead = await prisma.user.create({ data: { name: 'Lider', email: 'lider@empresa.com', passwordHash: 'x', role: 'LEAD' } })
    // Lider tem mais votos brutos, mas não deve vencer (não recebe reconhecimento).
    await castVote({ votedId: lead.id, categoryId: category.id, periodId: period.id, at: new Date('2026-06-01'), voterName: 'V1' })
    await castVote({ votedId: lead.id, categoryId: category.id, periodId: period.id, at: new Date('2026-06-02'), voterName: 'V2' })
    await castVote({ votedId: dev.id, categoryId: category.id, periodId: period.id, at: new Date('2026-06-03'), voterName: 'V3' })

    const result = await electWinner(period.id, DEFAULT_COMPANY_ID)
    expect(result).toEqual({ winnerId: dev.id, winnerVotes: 1 })
  })
})

describe('highlight-service escopado por empresa', () => {
  it('electWinner não conta voto de outra empresa no mesmo período id coincidente', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Highlight', slug: 'outra-empresa-highlight-test' } })
    const category = await prisma.recognitionCategory.create({ data: { name: 'Cat Highlight', slug: 'cat-highlight-test' } })
    const period = await prisma.votingPeriod.create({
      data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'), status: 'CLOSED' },
    })
    const dev = await prisma.user.create({ data: { name: 'Dev Highlight', email: 'dev-highlight-empresa@x.com', passwordHash: 'x' } })
    const voter = await prisma.user.create({ data: { name: 'Voter Highlight', email: 'voter-highlight-empresa@x.com', passwordHash: 'x' } })
    await prisma.vote.create({
      data: { voterId: voter.id, votedId: dev.id, periodId: period.id, justification: 'justificativa válida', categories: { create: [{ categoryId: category.id }] } },
    })

    // Voto de outra empresa em outro período — não pode contaminar a apuração.
    // Setor próprio para não colidir com o setor default (@@unique([sectorId, monthRef])
    // não é escopado por companyId).
    const otherSector = await prisma.sector.create({ data: { name: 'Setor Outra Empresa Highlight', slug: 'setor-outra-empresa-highlight-test', companyId: otherCompany.id } })
    const otherPeriod = await prisma.votingPeriod.create({
      data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'), status: 'CLOSED', companyId: otherCompany.id, sectorId: otherSector.id },
    })
    const otherDev = await prisma.user.create({ data: { name: 'Dev Outra Empresa Highlight', email: 'dev-outra-empresa-highlight@x.com', passwordHash: 'x', companyId: otherCompany.id } })
    const otherVoter = await prisma.user.create({ data: { name: 'Voter Outra Empresa Highlight', email: 'voter-outra-empresa-highlight@x.com', passwordHash: 'x', companyId: otherCompany.id } })
    await prisma.vote.create({
      data: { voterId: otherVoter.id, votedId: otherDev.id, periodId: otherPeriod.id, justification: 'justificativa válida', companyId: otherCompany.id },
    })

    const result = await electWinner(period.id, DEFAULT_COMPANY_ID)
    expect(result).toEqual({ winnerId: dev.id, winnerVotes: 1 })
  })

  it('listPublishedHighlights isola por empresa quando companyId é informado', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Publicados', slug: 'outra-empresa-publicados-test' } })
    // Setor próprio para não colidir com o setor default (@@unique([sectorId, monthRef])
    // não é escopado por companyId).
    const otherSector = await prisma.sector.create({ data: { name: 'Setor Outra Empresa Publicados', slug: 'setor-outra-empresa-publicados-test', companyId: otherCompany.id } })
    await prisma.votingPeriod.create({
      data: { monthRef: '2026-05', startsAt: new Date('2026-05-01'), endsAt: new Date('2026-05-31'), status: 'CLOSED', highlightStatus: 'PUBLISHED', companyId: otherCompany.id, sectorId: otherSector.id },
    })
    const ownPeriod = await prisma.votingPeriod.create({
      data: { monthRef: '2026-05', startsAt: new Date('2026-05-01'), endsAt: new Date('2026-05-31'), status: 'CLOSED', highlightStatus: 'PUBLISHED' },
    })

    const entries = await listPublishedHighlights(DEFAULT_COMPANY_ID)
    expect(entries.some((e) => e.period.id === ownPeriod.id)).toBe(true)
    expect(entries.every((e) => e.period.companyId === DEFAULT_COMPANY_ID)).toBe(true)
  })
})
