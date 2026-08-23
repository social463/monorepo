import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { materializeVoteFeedbacks } from './vote-feedback-service'

let counter = 0
async function makeUser(name: string) {
  counter += 1
  return prisma.user.create({ data: { name, email: `${name}-${counter}@empresa.com`, passwordHash: 'x' } })
}

async function makePeriod(monthRef: string) {
  return prisma.votingPeriod.create({
    data: {
      monthRef,
      startsAt: new Date(`${monthRef}-01`),
      endsAt: new Date(`${monthRef}-28`),
      status: 'CLOSED',
      highlightStatus: 'DRAFT',
    },
  })
}

describe('materializeVoteFeedbacks', () => {
  it('transforma cada voto do período em feedback do votante para o votado', async () => {
    const voter = await makeUser('Votante')
    const voted = await makeUser('Votado')
    const cat = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
    const period = await makePeriod('2026-06')
    const vote = await prisma.vote.create({
      data: {
        voterId: voter.id,
        votedId: voted.id,
        periodId: period.id,
        justification: 'Segurou a virada do sistema no fim de semana.',
        createdAt: new Date('2026-06-15T10:00:00.000Z'),
        categories: { create: [{ categoryId: cat.id }] },
      },
    })

    await materializeVoteFeedbacks(period.id)

    const feedback = await prisma.feedback.findUnique({
      where: { voteId: vote.id },
      include: { recipients: true, recognitionCategories: true },
    })
    expect(feedback).not.toBeNull()
    expect(feedback!.authorId).toBe(voter.id)
    expect(feedback!.targetId).toBe(voted.id)
    expect(feedback!.message).toBe('Segurou a virada do sistema no fim de semana.')
    expect(feedback!.category).toBe('ELOGIO')
    // Data do voto, não a da publicação: o feedback é daquele mês.
    expect(feedback!.createdAt.toISOString()).toBe('2026-06-15T10:00:00.000Z')
    expect(feedback!.recipients.map((r) => r.userId)).toEqual([voted.id])
    expect(feedback!.recognitionCategories.map((c) => c.categoryId)).toEqual([cat.id])
  })

  /** Publicar o histórico inteiro no mural de uma vez seria spam no dia da publicação. */
  it('nasce privado — quem recebeu decide o que vai para o mural', async () => {
    const voter = await makeUser('Votante')
    const voted = await makeUser('Votado')
    const period = await makePeriod('2026-06')
    await prisma.vote.create({
      data: { voterId: voter.id, votedId: voted.id, periodId: period.id, justification: 'justificativa válida' },
    })

    await materializeVoteFeedbacks(period.id)

    const feedback = await prisma.feedback.findFirst({ where: { targetId: voted.id } })
    expect(feedback?.sharedAt).toBeNull()
  })

  it('é idempotente: republicar o mesmo período não duplica feedback', async () => {
    const voter = await makeUser('Votante')
    const voted = await makeUser('Votado')
    const period = await makePeriod('2026-06')
    await prisma.vote.create({
      data: { voterId: voter.id, votedId: voted.id, periodId: period.id, justification: 'justificativa válida' },
    })

    expect(await materializeVoteFeedbacks(period.id)).toHaveLength(1)
    expect(await materializeVoteFeedbacks(period.id)).toHaveLength(0)
    expect(await prisma.feedback.count({ where: { targetId: voted.id } })).toBe(1)
  })

  it('não toca em voto de outro período', async () => {
    const voter = await makeUser('Votante')
    const voted = await makeUser('Votado')
    const publicado = await makePeriod('2026-05')
    const emAberto = await prisma.votingPeriod.create({
      data: {
        monthRef: '2026-06',
        startsAt: new Date('2026-06-01'),
        endsAt: new Date('2026-06-30'),
        status: 'OPEN',
      },
    })
    await prisma.vote.create({
      data: { voterId: voter.id, votedId: voted.id, periodId: publicado.id, justification: 'do mês publicado' },
    })
    await prisma.vote.create({
      data: { voterId: voter.id, votedId: voted.id, periodId: emAberto.id, justification: 'de outro período' },
    })

    await materializeVoteFeedbacks(publicado.id)

    const messages = (await prisma.feedback.findMany({ where: { targetId: voted.id } })).map((f) => f.message)
    expect(messages).toEqual(['do mês publicado'])
  })
})
