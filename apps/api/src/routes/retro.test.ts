// apps/api/src/routes/retro.test.ts
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

describe('retro routes', () => {
  it('LEAD cria sala (201) e DEV não (403)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const dev = await devToken(app)
    const squadId = await mkSquad(app)

    const ok = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 23, squadIds: [squadId], anonymous: true, votesPerParticipant: 3, participantIds: [dev.id] },
    })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().room.myRole).toBe('FACILITATOR')
    expect(ok.json().room.title).toBe('Retrospectiva Sprint 23 - Squad Inovação')
    expect(ok.json().room.sprint).toBe(23)
    expect(ok.json().room.squads.map((s: { id: string }) => s.id)).toContain(squadId)

    const forbidden = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${dev.token}` },
      payload: { sprint: 1, squadIds: [squadId], anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    expect(forbidden.statusCode).toBe(403)
    await app.close()
  })

  it('valida corpo inválido (400)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const res = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 0, squadIds: [], anonymous: 'sim', votesPerParticipant: 3, participantIds: [] },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('DEV não convidado recebe 404 ao abrir sala', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const stranger = await devToken(app, 'Estranho')
    const squadId = await mkSquad(app)
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 1, squadIds: [squadId], anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    const roomId = created.json().room.id
    const res = await app.inject({ method: 'GET', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${stranger.token}` } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('fluxo: cria card, vota e reage (sem revelar, sala OPEN)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const dev = await devToken(app)
    const squadId = await mkSquad(app)
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 1, squadIds: [squadId], anonymous: false, votesPerParticipant: 2, participantIds: [dev.id] },
    })
    const roomId = created.json().room.id

    const card = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${dev.token}` },
      payload: { text: 'Deploy tranquilo', color: 'yellow', x: 10, y: 20 },
    })
    expect(card.statusCode).toBe(201)
    const cardId = card.json().card.id

    const vote = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards/${cardId}/votes`, headers: { authorization: `Bearer ${dev.token}` } })
    expect(vote.statusCode).toBe(200)
    expect(vote.json().voteCount).toBe(1)
    expect(vote.json().myRemainingVotes).toBe(1)

    const react = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/cards/${cardId}/reactions`, headers: { authorization: `Bearer ${dev.token}` },
      payload: { emoji: '🔥' },
    })
    expect(react.statusCode).toBe(200)
    expect(react.json().reactions[0]).toMatchObject({ emoji: '🔥', count: 1, reactedByMe: true })
    await app.close()
  })

  it('PATCH participants notifica os novos convidados', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const dev = await devToken(app)
    const squadId = await mkSquad(app)
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 1, squadIds: [squadId], anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    const roomId = created.json().room.id
    const res = await app.inject({
      method: 'PATCH', url: `/retro/rooms/${roomId}/participants`, headers: { authorization: `Bearer ${lead.token}` },
      payload: { participantIds: [dev.id] },
    })
    expect(res.statusCode).toBe(200)
    expect(await prisma.notification.count({ where: { userId: dev.id, type: 'RETRO_INVITED' } })).toBe(1)
    await app.close()
  })

  it('card sem color/x/y dá 400', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const dev = await devToken(app)
    const squadId = await mkSquad(app)
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 1, squadIds: [squadId], anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] },
    })
    const roomId = created.json().room.id
    const bad = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${dev.token}` },
      payload: { text: 'falta color e coords' },
    })
    expect(bad.statusCode).toBe(400)
    await app.close()
  })

  it('move card via PATCH position e responde {x,y}', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app); const dev = await devToken(app)
    const squadId = await mkSquad(app)
    const created = await app.inject({ method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` }, payload: { sprint: 1, squadIds: [squadId], anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] } })
    const roomId = created.json().room.id
    const card = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${dev.token}` }, payload: { text: 'x', color: 'green', x: 0, y: 0 } })
    const cardId = card.json().card.id
    const moved = await app.inject({ method: 'PATCH', url: `/retro/rooms/${roomId}/cards/${cardId}/position`, headers: { authorization: `Bearer ${lead.token}` }, payload: { x: 99, y: -5 } })
    expect(moved.statusCode).toBe(200)
    expect(moved.json()).toEqual({ x: 99, y: -5 })
  })

  it('facilitador alterna o modo anônimo e mascara o conteúdo dos outros', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const dev = await devToken(app)
    const squadId = await mkSquad(app)
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 1, squadIds: [squadId], anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] },
    })
    const roomId = created.json().room.id
    const card = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${dev.token}` },
      payload: { text: 'segredo', color: 'green', x: 0, y: 0 },
    })
    const cardId = card.json().card.id

    // participante não pode alternar
    const forbidden = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/anonymous`, headers: { authorization: `Bearer ${dev.token}` },
      payload: { anonymous: true },
    })
    expect(forbidden.statusCode).toBe(403)

    // facilitador liga
    const on = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/anonymous`, headers: { authorization: `Bearer ${lead.token}` },
      payload: { anonymous: true },
    })
    expect(on.statusCode).toBe(200)
    expect(on.json().room.anonymous).toBe(true)

    // lead (não-autor) vê mascarado; autor (dev) vê o texto; autor sempre presente
    const asLead = await app.inject({ method: 'GET', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${lead.token}` } })
    const leadCard = asLead.json().room.cards.find((c: { id: string }) => c.id === cardId)
    expect(leadCard.masked).toBe(true)
    expect(leadCard.text).toBe('')
    expect(leadCard.author).toMatchObject({ id: dev.id })

    const asDev = await app.inject({ method: 'GET', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${dev.token}` } })
    const devCard = asDev.json().room.cards.find((c: { id: string }) => c.id === cardId)
    expect(devCard.masked).toBe(false)
    expect(devCard.text).toBe('segredo')

    // desligar revela
    await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/anonymous`, headers: { authorization: `Bearer ${lead.token}` },
      payload: { anonymous: false },
    })
    const revealed = await app.inject({ method: 'GET', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${lead.token}` } })
    expect(revealed.json().room.cards.find((c: { id: string }) => c.id === cardId).text).toBe('segredo')
    await app.close()
  })

  it('facilitador controla cronômetro compartilhado e participante não controla', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app); const dev = await devToken(app)
    const squadId = await mkSquad(app)
    const created = await app.inject({
      method: 'POST',
      url: '/retro/rooms',
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 1, squadIds: [squadId], anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] },
    })
    const roomId = created.json().room.id
    expect(created.json().room.timer).toMatchObject({ mode: 'elapsed', status: 'idle', accumulatedSeconds: 0 })

    const forbidden = await app.inject({
      method: 'POST',
      url: `/retro/rooms/${roomId}/timer`,
      headers: { authorization: `Bearer ${dev.token}` },
      payload: { action: 'start' },
    })
    expect(forbidden.statusCode).toBe(403)

    const started = await app.inject({
      method: 'POST',
      url: `/retro/rooms/${roomId}/timer`,
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { action: 'start', mode: 'countdown', durationSeconds: 600 },
    })
    expect(started.statusCode).toBe(200)
    expect(started.json().timer).toMatchObject({ mode: 'countdown', status: 'running', durationSeconds: 600, accumulatedSeconds: 0 })
    expect(started.json().timer.startedAt).toBeTruthy()

    const paused = await app.inject({
      method: 'POST',
      url: `/retro/rooms/${roomId}/timer`,
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { action: 'pause' },
    })
    expect(paused.statusCode).toBe(200)
    expect(paused.json().timer).toMatchObject({ mode: 'countdown', status: 'paused', durationSeconds: 600 })
    expect(paused.json().timer.startedAt).toBeNull()
    await app.close()
  })

  it('countdown zerado aceita reconfiguração; countdown andando ainda exige pausa', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const squadId = await mkSquad(app)
    const created = await app.inject({
      method: 'POST',
      url: '/retro/rooms',
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 1, squadIds: [squadId], anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    const roomId = created.json().room.id

    await app.inject({
      method: 'POST',
      url: `/retro/rooms/${roomId}/timer`,
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { action: 'start', mode: 'countdown', durationSeconds: 60 },
    })

    // Contagem andando de verdade: reconfigurar no meio segue recusado.
    const running = await app.inject({
      method: 'POST',
      url: `/retro/rooms/${roomId}/timer`,
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { action: 'configure', mode: 'elapsed' },
    })
    expect(running.statusCode).toBe(409)

    // Empurra o início pra trás: a contagem de 60s já zerou. Ninguém vira o
    // estado no banco quando isso acontece, então o registro segue RUNNING.
    await prisma.retroRoom.update({
      where: { id: roomId },
      data: { timerStartedAt: new Date(Date.now() - 120_000) },
    })

    const afterFinish = await app.inject({
      method: 'POST',
      url: `/retro/rooms/${roomId}/timer`,
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { action: 'configure', mode: 'elapsed' },
    })
    expect(afterFinish.statusCode).toBe(200)
    expect(afterFinish.json().timer).toMatchObject({ mode: 'elapsed', status: 'idle', accumulatedSeconds: 0 })

    await app.close()
  })

  it('vota em sala OPEN (sem revelar) e bloqueia após concluir (409)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app); const dev = await devToken(app)
    const squadId = await mkSquad(app)
    const created = await app.inject({ method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` }, payload: { sprint: 1, squadIds: [squadId], anonymous: false, votesPerParticipant: 2, participantIds: [dev.id] } })
    const roomId = created.json().room.id
    const card = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${dev.token}` }, payload: { text: 'x', color: 'blue', x: 0, y: 0 } })
    const cardId = card.json().card.id
    const v = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards/${cardId}/votes`, headers: { authorization: `Bearer ${dev.token}` } })
    expect(v.statusCode).toBe(200)
    await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/phase`, headers: { authorization: `Bearer ${lead.token}` }, payload: { action: 'conclude' } })
    const blocked = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards/${cardId}/votes`, headers: { authorization: `Bearer ${dev.token}` } })
    expect(blocked.statusCode).toBe(409)
    await app.close()
  })

  it('GET /retro/squads lista só ativas com membros', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const active = await prisma.squad.create({ data: { name: 'Ativa', slug: 'ativa' } })
    const dev = await devToken(app)
    const inactive = await prisma.user.create({ data: { name: 'Inativo', email: 'inativo-retro@x.com', passwordHash: 'x', active: false } })
    const former = await prisma.user.create({ data: { name: 'Ex Lenda', email: 'ex-retro@x.com', passwordHash: 'x', leftAt: new Date('2026-07-10') } })
    await prisma.squadMember.create({ data: { squadId: active.id, userId: dev.id } })
    await prisma.squadMember.create({ data: { squadId: active.id, userId: inactive.id } })
    await prisma.squadMember.create({ data: { squadId: active.id, userId: former.id } })
    await prisma.squad.create({ data: { name: 'Inativa', slug: 'inativa', active: false } })
    const res = await app.inject({ method: 'GET', url: '/retro/squads', headers: { authorization: `Bearer ${lead.token}` } })
    expect(res.statusCode).toBe(200)
    const names = res.json().squads.map((s: { name: string }) => s.name)
    expect(names).toContain('Ativa')
    expect(names).not.toContain('Inativa')
    const ativa = res.json().squads.find((s: { name: string }) => s.name === 'Ativa')
    expect(ativa.members.map((m: { id: string }) => m.id)).toEqual([dev.id])
    await app.close()
  })

  it('rejeita criação de sala convidando integrante desligado ou desativado', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const squadId = await mkSquad(app)
    const inactive = await prisma.user.create({ data: { name: 'Inativo Retro', email: 'inactive-room@x.com', passwordHash: 'x', active: false } })
    const former = await prisma.user.create({ data: { name: 'Ex Retro', email: 'former-room@x.com', passwordHash: 'x', leftAt: new Date('2026-07-10') } })

    const withInactive = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 1, squadIds: [squadId], votesPerParticipant: 3, participantIds: [inactive.id] },
    })
    expect(withInactive.statusCode).toBe(400)

    const withFormer = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 1, squadIds: [squadId], votesPerParticipant: 3, participantIds: [former.id] },
    })
    expect(withFormer.statusCode).toBe(400)
    await app.close()
  })

  it('rejeita criação com squad inativa (400)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const inactive = await prisma.squad.create({ data: { name: 'Off', slug: 'off', active: false } })
    const res = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 1, squadIds: [inactive.id], anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('cria sala com 2 squads → título plural e squads[] com 2', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const sqA = await mkSquad(app, 'Inovação')
    const sqB = await mkSquad(app, 'B2B')
    const res = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 7, squadIds: [sqA, sqB], anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().room.squads).toHaveLength(2)
    // nomes ordenados: B2B antes de Inovação
    expect(res.json().room.title).toBe('Retrospectiva Sprint 7 - Squads B2B, Inovação')
    await app.close()
  })

  it('rejeita criação sem squad (squadIds vazio) → 400', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const res = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 1, squadIds: [], anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('ADMIN arquiva sala (204), some da listagem e dá 404 ao acessar; dados ficam', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const admin = await adminToken(app)
    const squadId = await mkSquad(app)
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms',
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 42, squadIds: [squadId], votesPerParticipant: 3, participantIds: [] },
    })
    expect(created.statusCode).toBe(201)
    const roomId = created.json().room.id
    await prisma.retroCard.create({ data: { roomId, authorId: lead.id, text: 'x', x: 0, y: 0, color: 'yellow', kind: 'note' } })

    const del = await app.inject({ method: 'DELETE', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${admin.token}` } })
    expect(del.statusCode).toBe(204)

    const list = await app.inject({ method: 'GET', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` } })
    expect(list.json().rooms.find((r: any) => r.id === roomId)).toBeUndefined()

    const get = await app.inject({ method: 'GET', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${lead.token}` } })
    expect(get.statusCode).toBe(404)

    expect(await prisma.retroCard.count({ where: { roomId } })).toBe(1)
    const row = await prisma.retroRoom.findUnique({ where: { id: roomId } })
    expect(row?.archivedAt).not.toBeNull()
    expect(row?.archivedById).toBe(admin.id)
    await app.close()
  })

  it('DEV e LEAD não arquivam sala (403)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const dev = await devToken(app)
    const squadId = await mkSquad(app)
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms',
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 7, squadIds: [squadId], votesPerParticipant: 3, participantIds: [dev.id] },
    })
    const roomId = created.json().room.id
    for (const t of [lead.token, dev.token]) {
      const res = await app.inject({ method: 'DELETE', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${t}` } })
      expect(res.statusCode).toBe(403)
    }
    await app.close()
  })

  it('arquivar sala inexistente → 404', async () => {
    const app = buildApp(); await app.ready()
    const admin = await adminToken(app, 'Ada2')
    const res = await app.inject({ method: 'DELETE', url: '/retro/rooms/nao-existe', headers: { authorization: `Bearer ${admin.token}` } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('retro routes — isolamento por empresa', () => {
  it('GET /retro/rooms não lista sala de outra empresa; GET /retro/rooms/:id devolve 404', async () => {
    const app = buildApp(); await app.ready()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Rota', slug: 'outra-empresa-retro-rota-test' } })
    const leadOutraEmpresa = await leadToken(app, 'LeadOutraEmpresaRota', otherCompany.id)
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRota', slug: 'squad-outra-empresa-rota-test', companyId: otherCompany.id } })
    const createdOutra = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadOutraEmpresa.token}` },
      payload: { sprint: 1, squadIds: [squadOutraEmpresa.id], votesPerParticipant: 3, participantIds: [] },
    })
    expect(createdOutra.statusCode).toBe(201)
    const roomIdOutra = createdOutra.json().room.id

    const lead = await leadToken(app)
    const list = await app.inject({ method: 'GET', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` } })
    expect(list.json().rooms.find((r: { id: string }) => r.id === roomIdOutra)).toBeUndefined()

    const get = await app.inject({ method: 'GET', url: `/retro/rooms/${roomIdOutra}`, headers: { authorization: `Bearer ${lead.token}` } })
    expect(get.statusCode).toBe(404)
    await app.close()
  })

  it('mutações de sala/card de outra empresa devolvem 404 (não vazam nem quebram)', async () => {
    const app = buildApp(); await app.ready()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Rota Mut', slug: 'outra-empresa-retro-rota-mut-test' } })
    const leadOutraEmpresa = await leadToken(app, 'LeadOutraEmpresaRotaMut', otherCompany.id)
    const devOutraEmpresa = await devToken(app, 'DevOutraEmpresaRotaMut', otherCompany.id)
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRotaMut', slug: 'squad-outra-empresa-rota-mut-test', companyId: otherCompany.id } })
    const createdOutra = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadOutraEmpresa.token}` },
      payload: { sprint: 1, squadIds: [squadOutraEmpresa.id], votesPerParticipant: 3, participantIds: [devOutraEmpresa.id] },
    })
    const roomIdOutra = createdOutra.json().room.id
    const cardOutra = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomIdOutra}/cards`, headers: { authorization: `Bearer ${devOutraEmpresa.token}` },
      payload: { text: 'de outra empresa', color: 'yellow', x: 0, y: 0 },
    })
    const cardIdOutra = cardOutra.json().card.id

    const lead = await leadToken(app)
    const admin = await adminToken(app)

    const patchParticipants = await app.inject({
      method: 'PATCH', url: `/retro/rooms/${roomIdOutra}/participants`, headers: { authorization: `Bearer ${lead.token}` },
      payload: { participantIds: [] },
    })
    expect(patchParticipants.statusCode).toBe(404)

    const phase = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomIdOutra}/phase`, headers: { authorization: `Bearer ${lead.token}` },
      payload: { action: 'conclude' },
    })
    expect(phase.statusCode).toBe(404)

    const createCard = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomIdOutra}/cards`, headers: { authorization: `Bearer ${lead.token}` },
      payload: { text: 'x', color: 'yellow', x: 0, y: 0 },
    })
    expect(createCard.statusCode).toBe(404)

    const updateCard = await app.inject({
      method: 'PATCH', url: `/retro/rooms/${roomIdOutra}/cards/${cardIdOutra}`, headers: { authorization: `Bearer ${lead.token}` },
      payload: { text: 'hack' },
    })
    expect(updateCard.statusCode).toBe(404)

    const vote = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomIdOutra}/cards/${cardIdOutra}/votes`, headers: { authorization: `Bearer ${lead.token}` },
    })
    expect(vote.statusCode).toBe(404)

    const del = await app.inject({ method: 'DELETE', url: `/retro/rooms/${roomIdOutra}`, headers: { authorization: `Bearer ${admin.token}` } })
    expect(del.statusCode).toBe(404)
    await app.close()
  })
})

describe('DELETE /retro/rooms/:id (admin)', () => {
  it('audita arquivamento de sala pelo admin (soft delete)', async () => {
    const app = buildApp()
    await app.ready()
    const adminRes = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Admin Retro', email: 'admin-retro-audit@empresa.com', password: 'changeme123' } })
    await prisma.user.update({ where: { email: 'admin-retro-audit@empresa.com' }, data: { role: 'ADMIN' } })
    const adminLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin-retro-audit@empresa.com', password: 'changeme123' } })
    const adminToken = adminLogin.json().accessToken as string

    const creator = await prisma.user.create({ data: { name: 'Criador Retro', email: 'criador-retro-audit@empresa.com', passwordHash: 'x', role: 'LEAD' } })
    const squad = await prisma.squad.create({ data: { name: 'Squad Retro Audit Soft', slug: 'squad-retro-audit-soft' } })
    const room = await prisma.retroRoom.create({
      data: { sprint: 1, votesPerParticipant: 3, createdById: creator.id, squads: { create: [{ squadId: squad.id }] } },
    })

    await app.inject({ method: 'DELETE', url: `/retro/rooms/${room.id}`, headers: { authorization: `Bearer ${adminToken}` } })

    const row = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityType: 'RetroRoom', entityId: room.id } })
    expect(row.action).toBe('DELETE')
    await app.close()
  })
})
