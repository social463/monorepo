// apps/api/src/services/retro-service.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  advancePhase,
  archiveRoom,
  createCard,
  createRoom,
  getRoomForViewer,
  getRoomMeta,
  hardDeleteRoom,
  listCarryover,
  listEdits,
  listRoomsForAdmin,
  listRoomsForUser,
  resolveRole,
  setAnonymous,
  setCarryover,
  setParticipants,
  updateCard,
  updateRoomAsAdmin,
} from './retro-service'

async function mkUser(name: string, role: 'LEGEND' | 'LEAD' | 'MANAGER' | 'HEAD' | 'ADMIN' | 'SUBADMIN' = 'LEGEND') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
/** Usuário com segredos "marcados" — para provar que não vazam pro log de auditoria. */
async function mkUserWithSecrets(name: string, role: 'LEGEND' | 'LEAD' = 'LEGEND') {
  return prisma.user.create({
    data: {
      name,
      email: `${name}-${Date.now()}-${Math.random()}@x.com`,
      passwordHash: `secret-hash-${name}-nao-pode-vazar`,
      teamsWebhookUrl: `https://outlook.office.com/webhook/${name}-nao-pode-vazar`,
      role,
    },
  })
}
function assertNoSecretsInAuditPayload(payload: unknown, secretUsers: { name: string }[]) {
  const serialized = JSON.stringify(payload)
  expect(serialized).not.toContain('passwordHash')
  expect(serialized).not.toContain('teamsWebhookUrl')
  for (const u of secretUsers) {
    expect(serialized).not.toContain(`secret-hash-${u.name}-nao-pode-vazar`)
    expect(serialized).not.toContain(`${u.name}-nao-pode-vazar`)
  }
}
async function mkSquad(name = 'Inovação') {
  return prisma.squad.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } })
}

describe('retro-service: salas', () => {
  it('LEAD cria sala e entra como participante automaticamente', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const dev = await mkUser('Dan', 'LEGEND')
    const squad = await mkSquad()
    const room = await createRoom({
      creatorId: lead.id, sprint: 23, squadIds: [squad.id],
      votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID,
    })
    const ids = room.participants.map((p) => p.userId).sort()
    expect(ids).toEqual([lead.id, dev.id].sort())
    expect(room.status).toBe('OPEN')
    expect(room.sprint).toBe(23)
    expect(room.squads.map((rs) => rs.squad.name)).toContain('Inovação')
  })

  it('não-LEAD não cria sala (403)', async () => {
    const dev = await mkUser('Dan', 'LEGEND')
    const squad = await mkSquad()
    await expect(
      createRoom({ creatorId: dev.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('MANAGER e HEAD também criam sala (papéis de liderança)', async () => {
    const squad = await mkSquad()
    for (const role of ['MANAGER', 'HEAD'] as const) {
      const leader = await mkUser(`Lead${role}`, role)
      const room = await createRoom({
        creatorId: leader.id, sprint: 5, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [], companyId: DEFAULT_COMPANY_ID,
      })
      expect(room.status).toBe('OPEN')
      expect(room.participants.map((p) => p.userId)).toContain(leader.id)
    }
  })

  it('rejeita votesPerParticipant fora do intervalo (400)', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const squad = await mkSquad()
    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 0, participantIds: [], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita squad inativa (400)', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const squad = await prisma.squad.create({ data: { name: 'Off', slug: 'off', active: false } })
    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita convidar ADMIN (400)', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const admin = await mkUser('Ada', 'ADMIN')
    const squad = await mkSquad()
    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [admin.id], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita convidar SUBADMIN (400)', async () => {
    const lead = await mkUser('Lia2', 'LEAD')
    const sub = await mkUser('Suba', 'SUBADMIN')
    const squad = await mkSquad('Inovação Sub')
    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [sub.id], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('resolveRole: criador=FACILITATOR, convidado=PARTICIPANT, LEAD externo=OBSERVER, DEV externo=null', async () => {
    const room = { createdById: 'lead1', participants: [{ userId: 'lead1' }, { userId: 'dev1' }] }
    expect(resolveRole(room, { id: 'lead1', role: 'LEAD' })).toBe('FACILITATOR')
    expect(resolveRole(room, { id: 'dev1', role: 'LEGEND' })).toBe('PARTICIPANT')
    expect(resolveRole(room, { id: 'lead2', role: 'LEAD' })).toBe('OBSERVER')
    expect(resolveRole(room, { id: 'mgr', role: 'MANAGER' })).toBe('OBSERVER')
    expect(resolveRole(room, { id: 'head', role: 'HEAD' })).toBe('OBSERVER')
    expect(resolveRole(room, { id: 'dev2', role: 'LEGEND' })).toBeNull()
    expect(resolveRole(room, { id: 'adm', role: 'ADMIN' })).toBeNull()
  })

  it('listRoomsForUser: LEAD vê todas; DEV só as suas', async () => {
    const lead1 = await mkUser('L1', 'LEAD')
    const lead2 = await mkUser('L2', 'LEAD')
    const dev = await mkUser('D', 'LEGEND')
    const squad = await mkSquad()
    await createRoom({ creatorId: lead1.id, sprint: 10, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    await createRoom({ creatorId: lead2.id, sprint: 20, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [], companyId: DEFAULT_COMPANY_ID })

    expect((await listRoomsForUser({ id: lead1.id, role: 'LEAD' }, DEFAULT_COMPANY_ID)).length).toBe(2)
    const devRooms = await listRoomsForUser({ id: dev.id, role: 'LEGEND' }, DEFAULT_COMPANY_ID)
    expect(devRooms.map((r) => r.sprint)).toEqual([10])
  })

  it('getRoomForViewer: DEV não convidado recebe 404', async () => {
    const lead = await mkUser('L', 'LEAD')
    const stranger = await mkUser('S', 'LEGEND')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [], companyId: DEFAULT_COMPANY_ID })
    await expect(getRoomForViewer(room.id, { id: stranger.id, role: 'LEGEND' }, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
  })

  it('conclui a sala (OPEN→CONCLUDED) só pelo facilitador; transição inválida = 409', async () => {
    const lead = await mkUser('L', 'LEAD')
    const dev = await mkUser('D', 'LEGEND')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    await expect(advancePhase({ roomId: room.id, userId: dev.id, action: 'conclude', companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 403 })
    const done = await advancePhase({ roomId: room.id, userId: lead.id, action: 'conclude', companyId: DEFAULT_COMPANY_ID })
    expect(done.status).toBe('CONCLUDED')
    await expect(advancePhase({ roomId: room.id, userId: lead.id, action: 'conclude', companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 409 })
  })

  it('setParticipants substitui a lista (add/remove) e mantém o criador', async () => {
    const lead = await mkUser('L', 'LEAD')
    const d1 = await mkUser('D1', 'LEGEND')
    const d2 = await mkUser('D2', 'LEGEND')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [d1.id], companyId: DEFAULT_COMPANY_ID })

    const res = await setParticipants({ roomId: room.id, userId: lead.id, participantIds: [d2.id], companyId: DEFAULT_COMPANY_ID })
    expect(res.addedUserIds).toEqual([d2.id])
    const ids = res.room.participants.map((p) => p.userId).sort()
    expect(ids).toEqual([lead.id, d2.id].sort())
  })

  it('remover participante mantém os cards dele', async () => {
    const lead = await mkUser('L', 'LEAD')
    const d1 = await mkUser('D1', 'LEGEND')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [d1.id], companyId: DEFAULT_COMPANY_ID })
    const card = await createCard({ roomId: room.id, userId: d1.id, text: 'oi', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })

    const res = await setParticipants({ roomId: room.id, userId: lead.id, participantIds: [], companyId: DEFAULT_COMPANY_ID })
    expect(res.room.participants.map((p) => p.userId)).toEqual([lead.id])
    expect(res.room.cards.some((c) => c.id === card.id)).toBe(true)
  })
})

describe('retro-service: auditoria não vaza User completo (passwordHash/teamsWebhookUrl)', () => {
  it('updateRoomAsAdmin não persiste passwordHash/teamsWebhookUrl aninhados (before/after)', async () => {
    const lead = await mkUserWithSecrets('LeadSecreto', 'LEAD')
    const dev = await mkUserWithSecrets('DevSecreto')
    const admin = await mkUser('AdminAud', 'ADMIN')
    const squad = await mkSquad()
    const squad2 = await mkSquad('Outra')
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    await createCard({ roomId: room.id, userId: dev.id, text: 'card com autor sensível', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })

    await updateRoomAsAdmin({ roomId: room.id, actorId: admin.id, sprint: 2, squadIds: [squad2.id], companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'RetroRoom', entityId: room.id, action: 'UPDATE' } })
    expect(log).not.toBeNull()
    assertNoSecretsInAuditPayload(log?.before, [lead, dev])
    assertNoSecretsInAuditPayload(log?.after, [lead, dev])
    // continua rastreável: nome sobrevive no resumo seguro
    expect(JSON.stringify(log?.before)).toContain('LeadSecreto')
  })

  it('hardDeleteRoom não persiste passwordHash/teamsWebhookUrl aninhados (before)', async () => {
    const lead = await mkUserWithSecrets('LeadDel', 'LEAD')
    const dev = await mkUserWithSecrets('DevDel')
    const admin = await mkUser('AdminDel', 'ADMIN')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    await createCard({ roomId: room.id, userId: dev.id, text: 'card', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })

    await hardDeleteRoom({ roomId: room.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'RetroRoom', entityId: room.id, action: 'DELETE' } })
    expect(log).not.toBeNull()
    assertNoSecretsInAuditPayload(log?.before, [lead, dev])
  })

  it('archiveRoom não persiste passwordHash/teamsWebhookUrl aninhados (before)', async () => {
    const lead = await mkUserWithSecrets('LeadArc', 'LEAD')
    const dev = await mkUserWithSecrets('DevArc')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    await createCard({ roomId: room.id, userId: dev.id, text: 'card', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })

    await archiveRoom({ roomId: room.id, userId: lead.id, companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'RetroRoom', entityId: room.id, action: 'DELETE' } })
    expect(log).not.toBeNull()
    assertNoSecretsInAuditPayload(log?.before, [lead, dev])
  })
})

describe('retro-service: isolamento por empresa', () => {
  it('listRoomsForUser (LEAD) não retorna sala de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro', slug: 'outra-empresa-retro-list-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetro', email: 'lead-outra-empresa-retro@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetro', slug: 'squad-outra-empresa-retro-test', companyId: otherCompany.id } })
    await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })
    const leadDaqui = await mkUser('LeadDaquiRetroList', 'LEAD')

    const rooms = await listRoomsForUser({ id: leadDaqui.id, role: 'LEAD' }, DEFAULT_COMPANY_ID)
    expect(rooms).toHaveLength(0)
  })

  it('listRoomsForAdmin não retorna sala de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Admin', slug: 'outra-empresa-retro-admin-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetroAdmin', email: 'lead-outra-empresa-retro-admin@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetroAdmin', slug: 'squad-outra-empresa-retro-admin-test', companyId: otherCompany.id } })
    await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })

    const rooms = await listRoomsForAdmin(DEFAULT_COMPANY_ID)
    expect(rooms).toHaveLength(0)
  })

  it('getRoomForViewer/updateRoomAsAdmin/hardDeleteRoom/archiveRoom tratam sala de outra empresa como 404', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Mutacao', slug: 'outra-empresa-retro-mutacao-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetroMut', email: 'lead-outra-empresa-retro-mut@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetroMut', slug: 'squad-outra-empresa-retro-mut-test', companyId: otherCompany.id } })
    const room = await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })
    const actor = await mkUser('AtorRetroMut', 'ADMIN')

    await expect(getRoomForViewer(room.id, { id: actor.id, role: 'ADMIN' }, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
    await expect(updateRoomAsAdmin({ roomId: room.id, actorId: actor.id, sprint: 2, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
    await expect(archiveRoom({ roomId: room.id, userId: actor.id, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
    await expect(hardDeleteRoom({ roomId: room.id, actorId: actor.id, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
  })

  it('setAnonymous e getRoomMeta tratam sala de outra empresa como inexistente', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Meta', slug: 'outra-empresa-retro-meta-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetroMeta', email: 'lead-outra-empresa-retro-meta@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetroMeta', slug: 'squad-outra-empresa-retro-meta-test', companyId: otherCompany.id } })
    const room = await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })

    await expect(setAnonymous({ roomId: room.id, userId: leadOutraEmpresa.id, anonymous: false, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
    expect(await getRoomMeta(room.id, DEFAULT_COMPANY_ID)).toBeNull()
  })

  it('createRoom rejeita squad de outra empresa anexada à sala (400)', async () => {
    const lead = await mkUser('LeadRejeitaSquad', 'LEAD')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Squad', slug: 'outra-empresa-retro-squad-test' } })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRejeita', slug: 'squad-outra-empresa-rejeita-test', companyId: otherCompany.id } })

    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squadOutraEmpresa.id], votesPerParticipant: 3, participantIds: [], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('createRoom rejeita participante de outra empresa convidado (400)', async () => {
    const lead = await mkUser('LeadRejeitaParticipante', 'LEAD')
    const squad = await mkSquad('SquadRejeitaParticipante')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Participante', slug: 'outra-empresa-retro-participante-test' } })
    const outsider = await prisma.user.create({
      data: { name: 'ForaRetroParticipante', email: 'fora-retro-participante@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })

    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [outsider.id], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('retro-service: carry-over e histórico de edições — isolamento por empresa', () => {
  it('listEdits/listCarryover/setCarryover tratam sala de outra empresa como inexistente', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Carryover', slug: 'outra-empresa-retro-carryover-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetroCarryover', email: 'lead-outra-empresa-retro-carryover@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetroCarryover', slug: 'squad-outra-empresa-retro-carryover-test', companyId: otherCompany.id } })
    const roomOutraEmpresa = await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })
    const cardOutraEmpresa = await prisma.retroCard.create({
      data: { roomId: roomOutraEmpresa.id, authorId: leadOutraEmpresa.id, text: 'de outra empresa', color: 'yellow', kind: 'note', x: 0, y: 0, companyId: otherCompany.id },
    })
    const actor = await mkUser('AtorRetroCarryover', 'ADMIN')

    await expect(listEdits(roomOutraEmpresa.id, { id: actor.id, role: 'ADMIN' }, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
    await expect(listCarryover(roomOutraEmpresa.id, { id: actor.id, role: 'ADMIN' }, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
    await expect(
      setCarryover({ roomId: roomOutraEmpresa.id, cardId: cardOutraEmpresa.id, userId: actor.id, role: 'ADMIN', action: 'validate', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('listCarryover só considera salas concluídas da mesma squad e empresa', async () => {
    const lead = await mkUser('LeadCarryoverEmpresa', 'LEAD')
    const dev = await mkUser('DevCarryoverEmpresa', 'LEGEND')
    const squad = await mkSquad('SquadCarryoverEmpresa')
    const prevRoom = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    const prevCard = await createCard({ roomId: prevRoom.id, userId: dev.id, text: 'ação vencida', color: 'pink', x: 1200, y: 360, companyId: DEFAULT_COMPANY_ID })
    await updateCard({
      roomId: prevRoom.id, cardId: prevCard.id, userId: dev.id,
      actionPlan: 'Plano', actionResponsible: dev.id, actionDueDate: '2020-01-01', companyId: DEFAULT_COMPANY_ID,
    })
    await advancePhase({ roomId: prevRoom.id, userId: lead.id, action: 'conclude', companyId: DEFAULT_COMPANY_ID })

    const currentRoom = await createRoom({ creatorId: lead.id, sprint: 2, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    const { overdue } = await listCarryover(currentRoom.id, { id: lead.id, role: 'LEAD' }, DEFAULT_COMPANY_ID)
    expect(overdue.some((item) => item.card.id === prevCard.id)).toBe(true)
  })
})
