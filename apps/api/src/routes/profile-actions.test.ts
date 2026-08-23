import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function user(name: string, role: 'LEGEND' | 'LEAD' = 'LEGEND') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}

describe('GET /users/:id/profile — ações', () => {
  it('lista ações de sala CONCLUÍDA do responsável e ignora OPEN', async () => {
    const app = buildApp(); await app.ready()
    const lead = await user('Lia', 'LEAD'); const dev = await user('Dan')
    const squad = await prisma.squad.create({ data: { name: 'S', slug: 's' } })
    const concluded = await prisma.retroRoom.create({ data: { sprint: 5, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date(), squads: { create: { squadId: squad.id } } } })
    const open = await prisma.retroRoom.create({ data: { sprint: 6, createdById: lead.id, anonymous: true, votesPerParticipant: 3, squads: { create: { squadId: squad.id } } } })
    await prisma.retroCard.create({ data: { roomId: concluded.id, authorId: lead.id, text: 'o', color: 'blue', x: 0, y: 0, actionPlan: 'Fazer X', actionResponsible: dev.id, actionDueDate: '2026-07-01' } })
    await prisma.retroCard.create({ data: { roomId: open.id, authorId: lead.id, text: 'o', color: 'blue', x: 0, y: 0, actionPlan: 'Fazer Y', actionResponsible: dev.id, actionDueDate: '2026-07-02' } })

    const token = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
    const res = await app.inject({ method: 'GET', url: `/users/${dev.id}/profile`, headers: { authorization: `Bearer ${token}` } })
    const actions = res.json().actions
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ plan: 'Fazer X', problem: 'o', note: null, dueDate: '2026-07-01', sprint: 5, squad: 'S', done: false })
    await app.close()
  })

  it('oculta ações de sala CONCLUÍDA mas ARQUIVADA', async () => {
    const app = buildApp(); await app.ready()
    try {
      const lead = await user('LiaArq', 'LEAD'); const dev = await user('DanArq')
      const squad = await prisma.squad.create({ data: { name: 'SArq', slug: 's-arq' } })
      const archived = await prisma.retroRoom.create({
        data: {
          sprint: 10, createdById: lead.id, anonymous: true, votesPerParticipant: 3,
          status: 'CONCLUDED', concludedAt: new Date(), archivedAt: new Date(),
          squads: { create: { squadId: squad.id } },
        },
      })
      await prisma.retroCard.create({
        data: {
          roomId: archived.id, authorId: lead.id, text: 'o', color: 'blue', x: 0, y: 0,
          actionPlan: 'Fazer Z', actionResponsible: dev.id, actionDueDate: '2026-07-10',
        },
      })

      const token = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
      const res = await app.inject({ method: 'GET', url: `/users/${dev.id}/profile`, headers: { authorization: `Bearer ${token}` } })
      const actions = res.json().actions
      expect(actions).toHaveLength(0)
    } finally {
      await app.close()
    }
  })
})
