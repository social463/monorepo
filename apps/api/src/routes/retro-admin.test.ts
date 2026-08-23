// apps/api/src/routes/retro-admin.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function leadToken(app: any, name = 'Lia', companyId = DEFAULT_COMPANY_ID) {
  const u = await prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role: 'LEAD', companyId } })
  return { id: u.id, token: app.jwt.sign({ sub: u.id, role: 'LEAD', companyId, features: ['retrospectivas'] }) }
}
async function devToken(app: any, name = 'Dan', companyId = DEFAULT_COMPANY_ID) {
  const u = await prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role: 'LEGEND', companyId } })
  return { id: u.id, token: app.jwt.sign({ sub: u.id, role: 'LEGEND', companyId, features: ['retrospectivas'] }) }
}
async function adminToken(app: any, name = 'Ada', companyId = DEFAULT_COMPANY_ID) {
  const u = await prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role: 'ADMIN', companyId } })
  return { id: u.id, token: app.jwt.sign({ sub: u.id, role: 'ADMIN', companyId, features: ['retrospectivas'] }) }
}
async function mkSquad(app: any, name = 'Inovação') {
  const s = await prisma.squad.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } })
  return s.id
}
async function mkRoom(app: any, leadTk: string, squadId: string, sprint = 10) {
  const res = await app.inject({
    method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadTk}` },
    payload: { sprint, squadIds: [squadId], votesPerParticipant: 3, participantIds: [] },
  })
  return res.json().room.id as string
}

describe('admin retro rooms — edição', () => {
  it('ADMIN edita sprint, squads e votos; recria os RetroRoomSquad', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const admin = await adminToken(app)
    const squadA = await mkSquad(app, 'Squad A')
    const squadB = await mkSquad(app, 'Squad B')
    const roomId = await mkRoom(app, lead.token, squadA, 20)

    const res = await app.inject({
      method: 'PATCH', url: `/admin/retro/rooms/${roomId}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { sprint: 21, squadIds: [squadB], votesPerParticipant: 5 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().room.sprint).toBe(21)
    expect(res.json().room.votesPerParticipant).toBe(5)
    expect(res.json().room.squads.map((s: { id: string }) => s.id)).toEqual([squadB])

    const squads = await prisma.retroRoomSquad.findMany({ where: { roomId } })
    expect(squads.map((s) => s.squadId)).toEqual([squadB])
    await app.close()
  })

  it('valida payload inválido (400) e sala inexistente (404)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const admin = await adminToken(app)
    const squadId = await mkSquad(app)
    const roomId = await mkRoom(app, lead.token, squadId, 30)

    const bad = await app.inject({
      method: 'PATCH', url: `/admin/retro/rooms/${roomId}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { votesPerParticipant: 999 },
    })
    expect(bad.statusCode).toBe(400)

    const missing = await app.inject({
      method: 'PATCH', url: '/admin/retro/rooms/nao-existe',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { sprint: 5 },
    })
    expect(missing.statusCode).toBe(404)
    await app.close()
  })

  it('LEAD recebe 403 ao editar', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const squadId = await mkSquad(app)
    const roomId = await mkRoom(app, lead.token, squadId, 40)
    const res = await app.inject({
      method: 'PATCH', url: `/admin/retro/rooms/${roomId}`,
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 41 },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('admin retro rooms — listagem', () => {
  it('ADMIN lista salas OPEN e CONCLUDED, mas não as arquivadas', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const admin = await adminToken(app)
    const squadId = await mkSquad(app)
    const openId = await mkRoom(app, lead.token, squadId, 11)
    const concludedId = await mkRoom(app, lead.token, squadId, 12)
    const archivedId = await mkRoom(app, lead.token, squadId, 13)

    // conclui uma e arquiva outra
    await prisma.retroRoom.update({ where: { id: concludedId }, data: { status: 'CONCLUDED', concludedAt: new Date() } })
    await app.inject({ method: 'DELETE', url: `/retro/rooms/${archivedId}`, headers: { authorization: `Bearer ${admin.token}` } })

    const res = await app.inject({ method: 'GET', url: '/admin/retro/rooms', headers: { authorization: `Bearer ${admin.token}` } })
    expect(res.statusCode).toBe(200)
    const ids = res.json().rooms.map((r: { id: string }) => r.id)
    expect(ids).toContain(openId)
    expect(ids).toContain(concludedId)
    expect(ids).not.toContain(archivedId)
    await app.close()
  })

  it('LEAD e DEV recebem 403', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const dev = await devToken(app)
    const a = await app.inject({ method: 'GET', url: '/admin/retro/rooms', headers: { authorization: `Bearer ${lead.token}` } })
    const b = await app.inject({ method: 'GET', url: '/admin/retro/rooms', headers: { authorization: `Bearer ${dev.token}` } })
    expect(a.statusCode).toBe(403)
    expect(b.statusCode).toBe(403)
    await app.close()
  })
})

describe('admin retro rooms — isolamento por empresa', () => {
  it('GET /admin/retro/rooms não lista sala de outra empresa', async () => {
    const app = buildApp(); await app.ready()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Admin Rota', slug: 'outra-empresa-retro-admin-rota-test' } })
    const leadOutraEmpresa = await leadToken(app, 'LeadOutraEmpresaAdminRota', otherCompany.id)
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaAdminRota', slug: 'squad-outra-empresa-admin-rota-test', companyId: otherCompany.id } })
    const roomIdOutra = await mkRoom(app, leadOutraEmpresa.token, squadOutraEmpresa.id, 99)

    const admin = await adminToken(app)
    const res = await app.inject({ method: 'GET', url: '/admin/retro/rooms', headers: { authorization: `Bearer ${admin.token}` } })
    expect(res.json().rooms.find((r: { id: string }) => r.id === roomIdOutra)).toBeUndefined()
    await app.close()
  })

  it('PATCH/DELETE /admin/retro/rooms/:id de outra empresa devolvem 404', async () => {
    const app = buildApp(); await app.ready()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Admin Mut', slug: 'outra-empresa-retro-admin-mut-test' } })
    const leadOutraEmpresa = await leadToken(app, 'LeadOutraEmpresaAdminMut', otherCompany.id)
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaAdminMut', slug: 'squad-outra-empresa-admin-mut-test', companyId: otherCompany.id } })
    const roomIdOutra = await mkRoom(app, leadOutraEmpresa.token, squadOutraEmpresa.id, 98)

    const admin = await adminToken(app)
    const patch = await app.inject({
      method: 'PATCH', url: `/admin/retro/rooms/${roomIdOutra}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { sprint: 100 },
    })
    expect(patch.statusCode).toBe(404)

    const del = await app.inject({ method: 'DELETE', url: `/admin/retro/rooms/${roomIdOutra}`, headers: { authorization: `Bearer ${admin.token}` } })
    expect(del.statusCode).toBe(404)
    expect(await prisma.retroRoom.findUnique({ where: { id: roomIdOutra } })).not.toBeNull()
    await app.close()
  })
})

describe('admin retro rooms — hard delete', () => {
  it('ADMIN deleta de vez: sala e dados vinculados somem do banco (204)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const admin = await adminToken(app)
    const squadId = await mkSquad(app)
    const roomId = await mkRoom(app, lead.token, squadId, 50)
    // cria um card com voto para provar a cascata
    const card = await prisma.retroCard.create({ data: { roomId, authorId: lead.id, text: 'x', x: 0, y: 0, color: 'yellow', kind: 'note' } })
    await prisma.retroVote.create({ data: { cardId: card.id, userId: lead.id } })

    const del = await app.inject({ method: 'DELETE', url: `/admin/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${admin.token}` } })
    expect(del.statusCode).toBe(204)

    expect(await prisma.retroRoom.findUnique({ where: { id: roomId } })).toBeNull()
    expect(await prisma.retroCard.count({ where: { roomId } })).toBe(0)
    expect(await prisma.retroVote.count({ where: { cardId: card.id } })).toBe(0)
    expect(await prisma.retroRoomSquad.count({ where: { roomId } })).toBe(0)
    await app.close()
  })

  it('sala inexistente → 404; LEAD → 403', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const admin = await adminToken(app)
    const squadId = await mkSquad(app)
    const roomId = await mkRoom(app, lead.token, squadId, 60)

    const missing = await app.inject({ method: 'DELETE', url: '/admin/retro/rooms/nao-existe', headers: { authorization: `Bearer ${admin.token}` } })
    expect(missing.statusCode).toBe(404)

    const forbidden = await app.inject({ method: 'DELETE', url: `/admin/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${lead.token}` } })
    expect(forbidden.statusCode).toBe(403)
    await app.close()
  })
})
