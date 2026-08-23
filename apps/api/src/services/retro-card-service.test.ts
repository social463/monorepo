// apps/api/src/services/retro-card-service.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { advancePhase, createCard, createRoom, deleteCard, updateCard, updateCardPosition } from './retro-service'

async function mkUser(name: string, role: 'LEGEND' | 'LEAD' = 'LEGEND') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
async function mkSquad(name = 'Squad') {
  return prisma.squad.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } })
}
async function room(extraDevIds: string[] = []) {
  const lead = await mkUser('L', 'LEAD')
  const dev = await mkUser('D', 'LEGEND')
  const squad = await mkSquad()
  const r = await createRoom({
    creatorId: lead.id,
    sprint: 1,
    squadIds: [squad.id],
    votesPerParticipant: 3,
    participantIds: [dev.id, ...extraDevIds],
    companyId: DEFAULT_COMPANY_ID,
  })
  return { lead, dev, r }
}

describe('retro-service: cards', () => {
  it('participante cria card em OPEN', async () => {
    const { dev, r } = await room()
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Pair programming', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })
    expect(card.text).toBe('Pair programming')
    expect(card.color).toBe('yellow')
  })

  it('participante cria forma sem texto obrigatório', async () => {
    const { dev, r } = await room()
    const card = await createCard({
      roomId: r.id,
      userId: dev.id,
      text: '',
      color: 'blue',
      kind: 'shape',
      shape: 'arrow-right',
      shapeStyle: 'outline',
      width: 160,
      height: 104,
      x: 10,
      y: 20,
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(card).toMatchObject({ kind: 'shape', shape: 'arrow-right', shapeStyle: 'outline', width: 160, height: 104 })
  })

  it('observador (LEAD externo) não cria card (403)', async () => {
    const { r } = await room()
    const otherLead = await mkUser('L2', 'LEAD')
    await expect(
      createCard({ roomId: r.id, userId: otherLead.id, text: 'x', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('texto vazio é rejeitado (400)', async () => {
    const { dev, r } = await room()
    await expect(createCard({ roomId: r.id, userId: dev.id, text: '   ', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 400 })
  })

  it('criar card em CONCLUDED é bloqueado (409)', async () => {
    const { lead, dev, r } = await room()
    await advancePhase({ roomId: r.id, userId: lead.id, action: 'conclude', companyId: DEFAULT_COMPANY_ID })
    await expect(createCard({ roomId: r.id, userId: dev.id, text: 'x', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 409 })
  })

  it('só o autor edita/exclui o próprio card (403 para outro)', async () => {
    const { lead, dev, r } = await room()
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'orig', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })
    await expect(updateCard({ roomId: r.id, cardId: card.id, userId: lead.id, text: 'hack', companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 403 })

    const { card: updated } = await updateCard({ roomId: r.id, cardId: card.id, userId: dev.id, text: 'editado', companyId: DEFAULT_COMPANY_ID })
    expect(updated.text).toBe('editado')

    await deleteCard({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })
    expect(await prisma.retroCard.count({ where: { id: card.id } })).toBe(0)
  })

  it('qualquer participante move qualquer card (updateCardPosition)', async () => {
    const { lead, dev, r } = await room()
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'x', color: 'pink', x: 1, y: 2, companyId: DEFAULT_COMPANY_ID })
    const moved = await updateCardPosition({ roomId: r.id, cardId: card.id, userId: lead.id, x: 50, y: 60, companyId: DEFAULT_COMPANY_ID })
    expect(moved).toEqual({ x: 50, y: 60 })
  })

  it('rejeita cor inválida (400)', async () => {
    const { dev, r } = await room()
    await expect(createCard({ roomId: r.id, userId: dev.id, text: 'x', color: 'turquoise', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita forma inválida (400)', async () => {
    const { dev, r } = await room()
    await expect(createCard({ roomId: r.id, userId: dev.id, text: '', color: 'blue', kind: 'shape', shape: 'blob', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 400 })
  })

  it('cria card de ação quando card em ruim tem plano, responsável e prazo', async () => {
    const { dev, r } = await room()
    const ana = await mkUser('Ana')
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360, companyId: DEFAULT_COMPANY_ID })
    const { card: updated, actionCard, actionCardCreated } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Revisar pipeline',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
      companyId: DEFAULT_COMPANY_ID,
    })

    expect(actionCardCreated).toBe(true)
    expect(updated.actionResponsible).toBe(ana.id)
    expect(updated.actionCardId).toBe(actionCard?.id)
    expect(actionCard?.text).toContain('Plano: Revisar pipeline')
    // `actionResponsible` guarda o ID; o card-espelho mostra o nome resolvido.
    expect(actionCard?.text).toContain('Responsável: Ana')
    expect(actionCard?.text).toContain('Prazo: 30-06-2026')
  })

  it('sem carry-over: card-espelho nasce no slot 0 do quadrante Ações', async () => {
    const { dev, r } = await room()
    const ana = await mkUser('AnaTopo')
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360, companyId: DEFAULT_COMPANY_ID })
    const { actionCard } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Revisar pipeline',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
      companyId: DEFAULT_COMPANY_ID,
    })
    // sem carry-over → slot 0: x = 2320+40 = 2360; y = 280+80 = 360.
    expect(actionCard?.x).toBe(2360)
    expect(actionCard?.y).toBe(360)
  })

  it('com carry-over: card-espelho nasce logo após os cards carregados', async () => {
    const { lead, dev, r } = await room()
    const ana = await mkUser('AnaSeq')
    // squad da sala atual (criada pelo helper room()).
    const sqId = (await prisma.retroRoom.findUniqueOrThrow({ where: { id: r.id }, include: { squads: true } })).squads[0].squadId
    // sala anterior concluída, mesma squad, com 1 ação vencida (vira 1 item de carry-over na sala atual).
    const prev = await prisma.retroRoom.create({
      data: {
        sprint: 0, createdById: lead.id, anonymous: true, votesPerParticipant: 3,
        status: 'CONCLUDED', concludedAt: new Date('2020-01-01'), createdAt: new Date('2019-12-01'),
        squads: { create: { squadId: sqId } },
      },
    })
    await prisma.retroCard.create({
      data: {
        roomId: prev.id, authorId: lead.id, text: 'o', color: 'blue', kind: 'note', x: 1200, y: 340,
        actionPlan: 'P', actionResponsible: lead.id, actionDueDate: '2020-01-01', actionDone: false,
      },
    })

    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360, companyId: DEFAULT_COMPANY_ID })
    const { actionCard } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Revisar pipeline',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
      companyId: DEFAULT_COMPANY_ID,
    })
    // 1 carry-over + 0 espelhos = slot 1: x = 2360 + 240 = 2600; y = 360 (mesma linha).
    expect(actionCard?.x).toBe(2600)
    expect(actionCard?.y).toBe(360)
  })

  it.each([
    ['começar', 100, 1300],
    ['parar', 1200, 1300],
  ])('cria card de ação também no quadrante "%s"', async (_label, x, y) => {
    const { dev, r } = await room()
    const ana = await mkUser(`Ana-${x}-${y}`)
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Ponto', color: 'green', x, y, companyId: DEFAULT_COMPANY_ID })
    const { actionCard, actionCardCreated } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Plano X',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(actionCardCreated).toBe(true)
    expect(actionCard?.text).toContain('Plano: Plano X')
    expect(actionCard?.text).toContain(`Responsável: ${ana.name}`)
  })

  it('não cria card de ação para card no quadrante "O que foi bom"', async () => {
    const { dev, r } = await room()
    const ana = await mkUser('AnaBom')
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Ponto bom', color: 'green', x: 100, y: 360, companyId: DEFAULT_COMPANY_ID })
    const { actionCard, actionCardCreated } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Plano X',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(actionCardCreated).toBe(false)
    expect(actionCard).toBeNull()
  })

  it('rejeita responsável inexistente (400)', async () => {
    const { dev, r } = await room()
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360, companyId: DEFAULT_COMPANY_ID })
    await expect(
      updateCard({ roomId: r.id, cardId: card.id, userId: dev.id, actionResponsible: 'id-invalido', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita responsável de outra empresa (400)', async () => {
    const { dev, r } = await room()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Responsavel', slug: 'outra-empresa-retro-resp-test' } })
    const outsider = await prisma.user.create({
      data: { name: 'ForaRetroResponsavel', email: 'fora-retro-resp@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360, companyId: DEFAULT_COMPANY_ID })
    await expect(
      updateCard({ roomId: r.id, cardId: card.id, userId: dev.id, actionResponsible: outsider.id, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('createCard/updateCard/updateCardPosition/deleteCard tratam card de outra empresa como inexistente (404)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Card', slug: 'outra-empresa-retro-card-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetroCard', email: 'lead-outra-empresa-retro-card@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetroCard', slug: 'squad-outra-empresa-retro-card-test', companyId: otherCompany.id } })
    const roomOutraEmpresa = await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })
    const cardOutraEmpresa = await prisma.retroCard.create({
      data: { roomId: roomOutraEmpresa.id, authorId: leadOutraEmpresa.id, text: 'de outra empresa', color: 'yellow', kind: 'note', x: 0, y: 0, companyId: otherCompany.id },
    })
    const { dev, r } = await room()

    await expect(
      createCard({ roomId: roomOutraEmpresa.id, userId: dev.id, text: 'x', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      updateCard({ roomId: r.id, cardId: cardOutraEmpresa.id, userId: dev.id, text: 'x', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      updateCardPosition({ roomId: r.id, cardId: cardOutraEmpresa.id, userId: dev.id, x: 1, y: 1, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      deleteCard({ roomId: r.id, cardId: cardOutraEmpresa.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
