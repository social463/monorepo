// apps/api/src/routes/retro-ws.test.ts
import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

function waitOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
}
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function waitForMessage(ws: WebSocket, predicate: (m: any) => boolean, timeoutMs = 1500) {
  return new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout esperando mensagem WS')), timeoutMs)
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString())
      if (predicate(m)) { clearTimeout(t); resolve(m) }
    })
  })
}

describe('retro websocket', () => {
  it('recebe card.created após revelar a sala', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const lead = await prisma.user.create({ data: { name: 'L', email: 'l@x.com', passwordHash: 'x', role: 'LEAD' } })
    const dev = await prisma.user.create({ data: { name: 'D', email: 'd@x.com', passwordHash: 'x', role: 'LEGEND' } })
    const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
    const devTk = app.jwt.sign({ sub: dev.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
    const squad = await prisma.squad.create({ data: { name: 'Squad', slug: 'squad' } })

    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadTk}` },
      payload: { sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id] },
    })
    const roomId = created.json().room.id

    // sala nasce anônima; o facilitador revela para que o texto trafegue aos demais
    await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/anonymous`, headers: { authorization: `Bearer ${leadTk}` },
      payload: { anonymous: false },
    })

    const client = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=${devTk}`)
    const messages: any[] = []
    client.on('message', (d) => messages.push(JSON.parse(d.toString())))
    await waitOpen(client)

    await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${leadTk}` },
      payload: { text: 'Boa comunicação', color: 'yellow', x: 0, y: 0 },
    })
    await delay(150)

    expect(messages.some((m) => m.type === 'card.created' && m.card.text === 'Boa comunicação')).toBe(true)
    client.close()
    await app.close()
  })

  it('recusa conexão sem token válido', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const lead = await prisma.user.create({ data: { name: 'L', email: 'l@x.com', passwordHash: 'x', role: 'LEAD' } })
    const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
    const squad2 = await prisma.squad.create({ data: { name: 'Squad2', slug: 'squad2' } })
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadTk}` },
      payload: { sprint: 1, squadIds: [squad2.id], anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    const roomId = created.json().room.id

    const client = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=invalido`)
    const closed = await new Promise<boolean>((resolve) => {
      client.on('close', () => resolve(true))
      client.on('error', () => resolve(true))
      client.on('open', () => resolve(false))
    })
    expect(closed).toBe(true)
    await app.close()
  })

  it('relay de grab/move/drop e cursor entre dois clientes', async () => {
    const app = buildApp(); await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const lead = await prisma.user.create({ data: { name: 'Lia', email: 'lia@x.com', passwordHash: 'x', role: 'LEAD' } })
    const dev = await prisma.user.create({ data: { name: 'Dan', email: 'dan@x.com', passwordHash: 'x', role: 'LEGEND' } })
    const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
    const devTk = app.jwt.sign({ sub: dev.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
    const squad3 = await prisma.squad.create({ data: { name: 'Squad3', slug: 'squad3' } })
    const created = await app.inject({ method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadTk}` }, payload: { sprint: 1, squadIds: [squad3.id], anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] } })
    const roomId = created.json().room.id
    const card = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${leadTk}` }, payload: { text: 'x', color: 'yellow', x: 0, y: 0 } })
    const cardId = card.json().card.id

    const wsA = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=${leadTk}`)
    const wsB = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=${devTk}`)
    await Promise.all([
      new Promise((r) => wsA.on('open', r)),
      new Promise((r) => wsB.on('open', r)),
    ])

    // A pega o card; B recebe card.locked
    const lockedOnB = waitForMessage(wsB, (m) => m.type === 'card.locked' && m.cardId === cardId)
    wsA.send(JSON.stringify({ type: 'card.grab', cardId }))
    const locked = await lockedOnB
    expect(locked.byUserId).toBe(lead.id)

    // A move; B recebe card.moving
    const movingOnB = waitForMessage(wsB, (m) => m.type === 'card.moving' && m.cardId === cardId)
    wsA.send(JSON.stringify({ type: 'card.move', cardId, x: 42, y: 7 }))
    const moving = await movingOnB
    expect(moving).toMatchObject({ x: 42, y: 7, byUserId: lead.id })

    // A solta; B recebe card.unlocked
    const unlockedOnB = waitForMessage(wsB, (m) => m.type === 'card.unlocked' && m.cardId === cardId)
    wsA.send(JSON.stringify({ type: 'card.drop', cardId }))
    await unlockedOnB

    // cursor de A chega em B
    const cursorOnB = waitForMessage(wsB, (m) => m.type === 'cursor.moved' && m.userId === lead.id)
    wsA.send(JSON.stringify({ type: 'cursor', x: 5, y: 9 }))
    const cur = await cursorOnB
    expect(cur).toMatchObject({ name: 'Lia', x: 5, y: 9 })

    wsA.close(); wsB.close(); await app.close()
  })

  it('relay de reaction.float chega em ambos os clientes (inclusive o autor) e ignora emoji inválido', async () => {
    const app = buildApp(); await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const lead = await prisma.user.create({ data: { name: 'Rea', email: 'rea@x.com', passwordHash: 'x', role: 'LEAD' } })
    const dev = await prisma.user.create({ data: { name: 'Bo', email: 'bo@x.com', passwordHash: 'x', role: 'LEGEND' } })
    const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
    const devTk = app.jwt.sign({ sub: dev.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
    const squad = await prisma.squad.create({ data: { name: 'SquadR', slug: 'squadr' } })
    const created = await app.inject({ method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadTk}` }, payload: { sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id] } })
    const roomId = created.json().room.id

    const wsA = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=${leadTk}`)
    const wsB = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=${devTk}`)
    await Promise.all([new Promise((r) => wsA.on('open', r)), new Promise((r) => wsB.on('open', r))])

    // A envia; ambos (A inclusive) recebem reaction.floated
    const onA = waitForMessage(wsA, (m) => m.type === 'reaction.floated' && m.emoji === '❤️')
    const onB = waitForMessage(wsB, (m) => m.type === 'reaction.floated' && m.emoji === '❤️')
    wsA.send(JSON.stringify({ type: 'reaction.float', emoji: '❤️' }))
    const [ma, mb] = await Promise.all([onA, onB])
    expect(ma).toMatchObject({ userId: lead.id, name: 'Rea', emoji: '❤️' })
    expect(mb).toMatchObject({ userId: lead.id, name: 'Rea', emoji: '❤️' })

    // emoji inválido: nenhum reaction.floated chega (usamos um cursor logo depois como "marco")
    const bogus: any[] = []
    wsB.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'reaction.floated') bogus.push(m) })
    wsA.send(JSON.stringify({ type: 'reaction.float', emoji: '💣' }))
    const cursorMark = waitForMessage(wsB, (m) => m.type === 'cursor.moved' && m.userId === lead.id)
    wsA.send(JSON.stringify({ type: 'cursor', x: 1, y: 1 }))
    await cursorMark
    expect(bogus).toHaveLength(0)

    wsA.close(); wsB.close(); await app.close()
  })

  it('recusa conexão de usuário de outra empresa (mesmo LEAD, mesmo com roomId válido)', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const lead = await prisma.user.create({ data: { name: 'L', email: 'l-iso@x.com', passwordHash: 'x', role: 'LEAD' } })
    const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
    const squad = await prisma.squad.create({ data: { name: 'SquadIso', slug: 'squad-iso' } })
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadTk}` },
      payload: { sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [] },
    })
    const roomId = created.json().room.id

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro WS', slug: 'outra-empresa-retro-ws-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaWS', email: 'lead-outra-empresa-ws@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const outraEmpresaTk = app.jwt.sign({
      sub: leadOutraEmpresa.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: otherCompany.id, features: ['retrospectivas'],
    })

    const client = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=${outraEmpresaTk}`)
    const closed = await new Promise<boolean>((resolve) => {
      client.on('close', () => resolve(true))
      client.on('error', () => resolve(true))
      client.on('open', () => resolve(false))
    })
    expect(closed).toBe(true)
    await app.close()
  })
})
