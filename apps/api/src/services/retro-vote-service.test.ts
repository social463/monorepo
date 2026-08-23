// apps/api/src/services/retro-vote-service.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { addVote, advancePhase, createCard, createRoom, removeVote, toggleReaction } from './retro-service'

async function mkUser(name: string, role: 'LEGEND' | 'LEAD' = 'LEGEND') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
async function mkSquad(name = 'Squad') {
  return prisma.squad.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } })
}
async function openRoomWithCard(votes = 2) {
  const lead = await mkUser('L', 'LEAD')
  const dev = await mkUser('D', 'LEGEND')
  const squad = await mkSquad()
  const r = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: votes, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
  const card = await createCard({ roomId: r.id, userId: dev.id, text: 'bom', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })
  return { lead, dev, r, card }
}

describe('retro-service: votos e reações', () => {
  it('empilha dots e respeita o orçamento', async () => {
    const { dev, r, card } = await openRoomWithCard(2)
    expect((await addVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).voteCount).toBe(1)
    expect((await addVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).voteCount).toBe(2)
    await expect(addVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 409 })
  })

  it('removeVote tira um dot por vez', async () => {
    const { dev, r, card } = await openRoomWithCard(2)
    await addVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })
    await addVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })
    expect((await removeVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).voteCount).toBe(1)
  })

  it('toggle de reação adiciona e remove', async () => {
    const { dev, r, card } = await openRoomWithCard()
    const added = await toggleReaction({ roomId: r.id, cardId: card.id, userId: dev.id, emoji: '🔥', companyId: DEFAULT_COMPANY_ID })
    expect(added.reactions).toHaveLength(1)
    const removed = await toggleReaction({ roomId: r.id, cardId: card.id, userId: dev.id, emoji: '🔥', companyId: DEFAULT_COMPANY_ID })
    expect(removed.reactions).toHaveLength(0)
  })

  it('rejeita emoji fora da paleta (400)', async () => {
    const { dev, r, card } = await openRoomWithCard()
    await expect(toggleReaction({ roomId: r.id, cardId: card.id, userId: dev.id, emoji: '🤡', companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 400 })
  })

  it('não vota em sala concluída (409)', async () => {
    const { lead, dev, r, card } = await openRoomWithCard(2)
    await advancePhase({ roomId: r.id, userId: lead.id, action: 'conclude', companyId: DEFAULT_COMPANY_ID })
    await expect(addVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 409 })
  })

  it('addVote/removeVote/toggleReaction tratam card de outra empresa como inexistente (404)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Voto', slug: 'outra-empresa-retro-voto-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetroVoto', email: 'lead-outra-empresa-retro-voto@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetroVoto', slug: 'squad-outra-empresa-retro-voto-test', companyId: otherCompany.id } })
    const roomOutraEmpresa = await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })
    const cardOutraEmpresa = await prisma.retroCard.create({
      data: { roomId: roomOutraEmpresa.id, authorId: leadOutraEmpresa.id, text: 'de outra empresa', color: 'yellow', kind: 'note', x: 0, y: 0, companyId: otherCompany.id },
    })
    const { dev, r } = await openRoomWithCard()

    await expect(addVote({ roomId: r.id, cardId: cardOutraEmpresa.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
    await expect(removeVote({ roomId: r.id, cardId: cardOutraEmpresa.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
    await expect(toggleReaction({ roomId: r.id, cardId: cardOutraEmpresa.id, userId: dev.id, emoji: '🔥', companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
  })
})
