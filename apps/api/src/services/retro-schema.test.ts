import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'

describe('retro schema', () => {
  it('cria sala com participante, card, voto e reação', async () => {
    const lead = await prisma.user.create({
      data: { name: 'Lia', email: 'lia@x.com', passwordHash: 'x', role: 'LEAD' },
    })
    const squad = await prisma.squad.create({ data: { name: 'Squad', slug: 'squad' } })
    const room = await prisma.retroRoom.create({
      data: {
        sprint: 1,
        createdById: lead.id,
        anonymous: true,
        votesPerParticipant: 3,
        squads: { create: { squadId: squad.id } },
        participants: { create: { userId: lead.id } },
      },
    })
    const card = await prisma.retroCard.create({
      data: { roomId: room.id, authorId: lead.id, text: 'Deploy tranquilo', x: 0, y: 0, color: 'yellow' },
    })
    await prisma.retroVote.create({ data: { cardId: card.id, userId: lead.id } })
    await prisma.retroReaction.create({ data: { cardId: card.id, userId: lead.id, emoji: '🔥' } })

    expect(await prisma.retroVote.count({ where: { cardId: card.id } })).toBe(1)
    expect(room.status).toBe('OPEN')
  })
})
