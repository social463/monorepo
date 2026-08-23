import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'

describe('retro canvas schema', () => {
  it('cria card com x/y/color e sala OPEN', async () => {
    const lead = await prisma.user.create({ data: { name: 'Lia', email: 'lia@x.com', passwordHash: 'x', role: 'LEAD' } })
    const squad = await prisma.squad.create({ data: { name: 'Squad', slug: 'squad' } })
    const room = await prisma.retroRoom.create({
      data: { sprint: 1, createdById: lead.id, anonymous: false, votesPerParticipant: 3, squads: { create: { squadId: squad.id } }, participants: { create: { userId: lead.id } } },
    })
    expect(room.status).toBe('OPEN')
    const card = await prisma.retroCard.create({
      data: { roomId: room.id, authorId: lead.id, text: 'oi', x: 12.5, y: -8, color: 'yellow' },
    })
    expect(card.x).toBe(12.5)
    expect(card.color).toBe('yellow')
  })
})
