import { describe, it, expect, beforeEach, vi } from 'vitest'
import WebSocket from 'ws'
import { Prisma } from '@prisma/client'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { getOfficeHub } from '../lib/office-hub'
import { OFFICE_HEARTBEAT_INTERVAL_MS } from './office-ws'
import { createEmptyMapDocumentV1, isWalkable, DEFAULT_COMPANY_ID, type OfficeServerMessage } from '@legends/shared'

function waitOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
}
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// Todos os testes deste arquivo, exceto o describe de isolamento entre
// empresas ao final, operam na empresa default — resolve o hub uma vez para
// manter os `officeHub.*` do arquivo inteiro sem reescrever cada chamada.
const officeHub = getOfficeHub(DEFAULT_COMPANY_ID)

// O hub é um singleton em memória por empresa: o truncate do Postgres não o limpa.
let activeMapId: string

beforeEach(async () => {
  officeHub.reset()
  const document = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
  const map = await prisma.officeMap.create({ data: { name: 'Mapa de teste', companyId: DEFAULT_COMPANY_ID } })
  activeMapId = map.id
  const publication = await prisma.officeMapPublication.create({
    data: {
      mapId: map.id,
      version: 1,
      schemaVersion: document.schemaVersion,
      mapData: document as unknown as Prisma.InputJsonValue,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  await prisma.officeSetting.create({ data: { companyId: DEFAULT_COMPANY_ID, activeMapPublicationId: publication.id } })
})

describe('office websocket', () => {
  it('entrega welcome ao conectar e propaga o movimento para os outros', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const bruno = await prisma.user.create({
      data: { name: 'Bruno', email: 'bruno@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const anaTk = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const brunoTk = app.jwt.sign({ sub: bruno.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })

    const anaWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${anaTk}`)
    const anaMsgs: OfficeServerMessage[] = []
    anaWs.on('message', (d) => anaMsgs.push(JSON.parse(d.toString())))
    await waitOpen(anaWs)

    const brunoWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${brunoTk}`)
    const brunoMsgs: OfficeServerMessage[] = []
    brunoWs.on('message', (d) => brunoMsgs.push(JSON.parse(d.toString())))
    await waitOpen(brunoWs)
    await delay(100)

    const welcome = brunoMsgs.find((m) => m.type === 'welcome')
    expect(welcome).toMatchObject({ type: 'welcome', youId: bruno.id })
    expect(anaMsgs.some((m) => m.type === 'joined' && m.occupant.userId === bruno.id)).toBe(true)

    // Ana anda numa direção que sabemos ser livre a partir do spawn dela. O
    // movimento agora é intenção contínua (`input`), e o que chega em Bruno é o
    // snapshot autoritativo — não um evento por passo.
    const spawn = officeHub.occupants().find((o) => o.userId === ana.id)!
    const tile = { x: Math.floor(spawn.x / 32), y: Math.floor(spawn.y / 32) }
    const dy = isWalkable(tile.x, tile.y - 1) ? -1 : 1
    for (let seq = 1; seq <= 6; seq += 1) {
      anaWs.send(JSON.stringify({ type: 'input', input: { seq, dx: 0, dy, dtMs: 33 } }))
    }
    await delay(300)

    const andou = brunoMsgs.some(
      (m) =>
        m.type === 'snapshot' &&
        m.players.some((p) => p.userId === ana.id && Math.abs(p.y - spawn.y) > 1),
    )
    expect(andou).toBe(true)

    // Período de graça de reconexão (RECONNECT_GRACE_MS, 45s): fechar a última
    // aba não emite 'left' na hora — só depois do período sem reconectar (ver
    // cobertura de tempo com fake timers em office-hub.test.ts, describe 'leave').
    anaWs.close()
    await delay(100)
    expect(brunoMsgs.some((m) => m.type === 'left' && m.userId === ana.id)).toBe(false)

    brunoWs.close()
    await app.close()
  })

  it('propaga o atalho de girar (face) sem mover ninguém', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const bruno = await prisma.user.create({
      data: { name: 'Bruno', email: 'bruno@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const anaTk = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const brunoTk = app.jwt.sign({ sub: bruno.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })

    const anaWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${anaTk}`)
    await waitOpen(anaWs)

    const brunoWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${brunoTk}`)
    const brunoMsgs: OfficeServerMessage[] = []
    brunoWs.on('message', (d) => brunoMsgs.push(JSON.parse(d.toString())))
    await waitOpen(brunoWs)
    await delay(100)

    const before = officeHub.occupants().find((o) => o.userId === ana.id)!
    const dir = before.dir === 'up' ? 'down' : 'up'
    anaWs.send(JSON.stringify({ type: 'face', dir }))
    await delay(150)

    expect(brunoMsgs).toContainEqual({ type: 'faced', userId: ana.id, dir })
    const after = officeHub.occupants().find((o) => o.userId === ana.id)!
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)

    anaWs.close()
    brunoWs.close()
    await app.close()
  })

  it('mensagem malformada não derruba a conexão', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    ws.send('isso não é json')
    ws.send(JSON.stringify({ type: 'move', dir: 'diagonal' }))
    ws.send(JSON.stringify({ type: 'teleport', x: 0, y: 0 }))
    await delay(150)

    expect(ws.readyState).toBe(WebSocket.OPEN)
    expect(officeHub.occupants()).toHaveLength(1)

    ws.close()
    await app.close()
  })

  it('recusa conexão sem token válido', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=invalido`)
    const failed = await new Promise<boolean>((resolve) => {
      ws.on('error', () => resolve(true))
      ws.on('open', () => resolve(false))
    })

    expect(failed).toBe(true)
    await app.close()
  })

  it('aceita a conexão quando mapId bate com o mapa ativo', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-mapid-ok@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })

    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}&mapId=${activeMapId}`)
    const msgs: OfficeServerMessage[] = []
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())))
    await waitOpen(ws)
    await delay(50)

    expect(msgs.some((m) => m.type === 'welcome')).toBe(true)

    ws.close()
    await app.close()
  })

  it('recusa (409) quando mapId aponta para outro mapa', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-mapid-bad@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })

    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}&mapId=outro-map-id`)
    const statusCode = await new Promise<number | undefined>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode))
      ws.on('error', () => resolve(undefined))
      ws.on('open', () => resolve(undefined))
    })

    expect(statusCode).toBe(409)
    await app.close()
  })

  it('mantém um heartbeat por conexão e limpa o interval ao fechar (sem vazar timer)', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })

    // Espiona os setInterval/clearInterval globais em vez de esperar 30s de
    // verdade: o que importa aqui é que a conexão registra UM interval nesse
    // período e o desregistra ao fechar — não o comportamento do ping em si.
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)
    await delay(50)

    const heartbeatCallIndex = setIntervalSpy.mock.calls.findIndex(
      (call) => call[1] === OFFICE_HEARTBEAT_INTERVAL_MS,
    )
    expect(heartbeatCallIndex).not.toBe(-1)
    const heartbeatId = setIntervalSpy.mock.results[heartbeatCallIndex]!.value

    ws.close()
    await delay(50)

    expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeatId)

    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
    await app.close()
  })

  it('recusa conexão de usuário inativo mesmo com token válido', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const exLenda = await prisma.user.create({
      data: { name: 'Ex Lenda', email: 'exlenda@x.com', passwordHash: 'x', role: 'LEGEND', active: false },
    })
    const token = app.jwt.sign({ sub: exLenda.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })

    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    const failed = await new Promise<boolean>((resolve) => {
      ws.on('error', () => resolve(true))
      ws.on('open', () => resolve(false))
    })

    expect(failed).toBe(true)
    expect(officeHub.occupants()).toHaveLength(0)
    await app.close()
  })

  it('chamada: alvo recebe incoming-call e o chamador recebe call-result', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-call@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const bruno = await prisma.user.create({
      data: { name: 'Bruno', email: 'bruno-call@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const anaTk = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const brunoTk = app.jwt.sign({ sub: bruno.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })

    const anaWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${anaTk}`)
    const anaMsgs: OfficeServerMessage[] = []
    anaWs.on('message', (d) => anaMsgs.push(JSON.parse(d.toString())))
    await waitOpen(anaWs)

    const brunoWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${brunoTk}`)
    const brunoMsgs: OfficeServerMessage[] = []
    brunoWs.on('message', (d) => brunoMsgs.push(JSON.parse(d.toString())))
    await waitOpen(brunoWs)
    await delay(100)

    anaWs.send(JSON.stringify({ type: 'call', targetUserId: bruno.id }))
    await delay(100)
    expect(brunoMsgs.some((m) => m.type === 'incoming-call' && m.from.userId === ana.id)).toBe(true)

    brunoWs.send(JSON.stringify({ type: 'call-response', callerId: ana.id, accepted: true }))
    await delay(100)
    expect(anaMsgs.some((m) => m.type === 'call-result' && m.targetUserId === bruno.id && m.accepted === true)).toBe(true)

    anaWs.close()
    brunoWs.close()
    await app.close()
  })

  it('mensagem de chamada malformada não derruba a conexão', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-bad@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    ws.send(JSON.stringify({ type: 'call' })) // sem targetUserId
    ws.send(JSON.stringify({ type: 'call-response', callerId: 42 })) // shape errado
    await delay(120)

    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
    await app.close()
  })

  it('propaga reação/chat nearby para todos no escritório', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-nearby@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const bruno = await prisma.user.create({
      data: { name: 'Bruno', email: 'bruno-nearby@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const carlos = await prisma.user.create({
      data: { name: 'Carlos', email: 'carlos-nearby@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const anaTk = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const brunoTk = app.jwt.sign({ sub: bruno.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const carlosTk = app.jwt.sign({ sub: carlos.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })

    const anaWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${anaTk}`)
    const anaMsgs: OfficeServerMessage[] = []
    anaWs.on('message', (d) => anaMsgs.push(JSON.parse(d.toString())))
    await waitOpen(anaWs)

    const brunoWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${brunoTk}`)
    const brunoMsgs: OfficeServerMessage[] = []
    brunoWs.on('message', (d) => brunoMsgs.push(JSON.parse(d.toString())))
    await waitOpen(brunoWs)
    await delay(100)

    anaWs.send(JSON.stringify({ type: 'nearby-message', text: ' 👋 ' }))
    await delay(100)

    expect(
      anaMsgs.some(
        (m) => m.type === 'nearby-message' && m.userId === ana.id && m.text === '👋' && m.kind === 'speech',
      ),
    ).toBe(true)
    expect(
      brunoMsgs.some(
        (m) => m.type === 'nearby-message' && m.userId === ana.id && m.text === '👋' && m.kind === 'speech',
      ),
    ).toBe(true)

    anaWs.send(JSON.stringify({ type: 'nearby-message', text: ' pensando ', kind: 'thought' }))
    await delay(100)

    expect(
      brunoMsgs.some(
        (m) => m.type === 'nearby-message' && m.userId === ana.id && m.text === 'pensando' && m.kind === 'thought',
      ),
    ).toBe(true)

    anaWs.send(JSON.stringify({ type: 'nearby-message', text: ' 🤩 ', kind: 'reaction' }))
    await delay(100)

    expect(
      brunoMsgs.some(
        (m) => m.type === 'nearby-message' && m.userId === ana.id && m.text === '🤩' && m.kind === 'reaction',
      ),
    ).toBe(true)

    const carlosWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${carlosTk}`)
    const carlosMsgs: OfficeServerMessage[] = []
    carlosWs.on('message', (d) => carlosMsgs.push(JSON.parse(d.toString())))
    await waitOpen(carlosWs)
    await delay(100)

    const carlosWelcome = carlosMsgs.find((m) => m.type === 'welcome')
    expect(carlosWelcome?.occupants.find((o) => o.userId === ana.id)?.thoughtText).toBe('pensando')

    // Andar limpa o pensamento — só que "andar" agora é intenção contínua, e
    // quem a aplica é o tick.
    const anaPosition = officeHub.occupantOf(ana.id)!
    const tile = { x: Math.floor(anaPosition.x / 32), y: Math.floor(anaPosition.y / 32) }
    const dy = isWalkable(tile.x, tile.y - 1) ? -1 : 1
    for (let seq = 1; seq <= 6; seq += 1) {
      anaWs.send(JSON.stringify({ type: 'input', input: { seq, dx: 0, dy, dtMs: 33 } }))
    }
    await delay(300)
    expect(officeHub.occupantOf(ana.id)?.thoughtText).toBeUndefined()

    anaWs.close()
    brunoWs.close()
    carlosWs.close()
    await app.close()
  })

  it('despacha room-chat-message pro hub com os parâmetros certos', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-roomchat@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    const spy = vi.spyOn(officeHub, 'roomChatMessage')
    ws.send(JSON.stringify({ type: 'room-chat-message', text: 'oi' }))
    await delay(100)

    expect(spy).toHaveBeenCalledWith(expect.anything(), ana.id, 'oi')

    spy.mockRestore()
    ws.close()
    await app.close()
  })

  it('mensagem de chat de sala malformada não derruba a conexão', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-roomchat-bad@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    ws.send(JSON.stringify({ type: 'room-chat-message' })) // sem text
    await delay(100)

    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
    await app.close()
  })

  it('despacha confetti pro hub com os parâmetros certos', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-confetti@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    const spy = vi.spyOn(officeHub, 'confetti')
    ws.send(JSON.stringify({ type: 'confetti', active: true }))
    await delay(100)

    expect(spy).toHaveBeenCalledWith(expect.anything(), ana.id, true)

    spy.mockRestore()
    ws.close()
    await app.close()
  })

  it('mensagem de confetti malformada não derruba a conexão', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-confetti-bad@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    ws.send(JSON.stringify({ type: 'confetti' })) // sem active
    ws.send(JSON.stringify({ type: 'confetti', active: 'sim' })) // shape errado
    await delay(120)

    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
    await app.close()
  })

  it('despacha raise-hand pro hub com os parâmetros certos', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-raise-hand@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    const spy = vi.spyOn(officeHub, 'raiseHand')
    ws.send(JSON.stringify({ type: 'raise-hand', active: true }))
    await delay(100)

    expect(spy).toHaveBeenCalledWith(expect.anything(), ana.id, true)

    spy.mockRestore()
    ws.close()
    await app.close()
  })

  it('mensagem de raise-hand malformada não derruba a conexão', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-raise-hand-bad@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    ws.send(JSON.stringify({ type: 'raise-hand' })) // sem active
    ws.send(JSON.stringify({ type: 'raise-hand', active: 'sim' })) // shape errado
    await delay(120)

    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
    await app.close()
  })

  it('despacha start-room-audio e stop-room-audio pro hub, e ignora shape errado', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-room-audio@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    const startSpy = vi.spyOn(officeHub, 'startRoomAudio')
    const stopSpy = vi.spyOn(officeHub, 'stopRoomAudio')
    const pauseSpy = vi.spyOn(officeHub, 'setRoomAudioPaused')
    ws.send(JSON.stringify({ type: 'start-room-audio', videoId: 'dQw4w9WgXcQ' }))
    ws.send(JSON.stringify({ type: 'stop-room-audio' }))
    ws.send(JSON.stringify({ type: 'set-room-audio-paused', paused: true }))
    ws.send(JSON.stringify({ type: 'start-room-audio' })) // sem videoId
    ws.send(JSON.stringify({ type: 'start-room-audio', videoId: 42 })) // shape errado
    ws.send(JSON.stringify({ type: 'set-room-audio-paused', paused: 'sim' })) // shape errado
    await delay(120)

    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(startSpy).toHaveBeenCalledWith(expect.anything(), ana.id, 'dQw4w9WgXcQ', null)
    expect(stopSpy).toHaveBeenCalledWith(expect.anything(), ana.id)
    expect(pauseSpy).toHaveBeenCalledTimes(1)
    expect(pauseSpy).toHaveBeenCalledWith(expect.anything(), ana.id, true)
    expect(ws.readyState).toBe(WebSocket.OPEN)

    startSpy.mockRestore()
    stopSpy.mockRestore()
    pauseSpy.mockRestore()
    ws.close()
    await app.close()
  })

  it('despacha set-status pro hub com os parâmetros certos', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-status@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    const spy = vi.spyOn(officeHub, 'setStatus')
    ws.send(JSON.stringify({ type: 'set-status', status: 'away' }))
    await delay(100)

    expect(spy).toHaveBeenCalledWith(expect.anything(), ana.id, 'away')

    spy.mockRestore()
    ws.close()
    await app.close()
  })

  it('mensagem de set-status com status inválido não derruba a conexão nem despacha', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-status-bad@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    const spy = vi.spyOn(officeHub, 'setStatus')
    ws.send(JSON.stringify({ type: 'set-status', status: 'sonhando' })) // fora do enum
    ws.send(JSON.stringify({ type: 'set-status' })) // sem status
    await delay(120)

    expect(spy).not.toHaveBeenCalled()
    expect(ws.readyState).toBe(WebSocket.OPEN)

    spy.mockRestore()
    ws.close()
    await app.close()
  })

  it('despacha set-character-name pro hub e persiste só o alias do escritório', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-character-name@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    const spy = vi.spyOn(officeHub, 'setCharacterName')
    ws.send(JSON.stringify({ type: 'set-character-name', name: '  Nina  ' }))
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith(expect.anything(), ana.id, 'Nina'))

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: ana.id } })
    expect(updated.name).toBe('Ana')
    expect(updated.officeCharacterName).toBe('Nina')

    spy.mockRestore()
    ws.close()
    await app.close()
  })

  it('mensagem de set-character-name malformada não derruba a conexão nem despacha', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-character-name-bad@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    const spy = vi.spyOn(officeHub, 'setCharacterName')
    ws.send(JSON.stringify({ type: 'set-character-name', name: 123 }))
    ws.send(JSON.stringify({ type: 'set-character-name' }))
    await delay(120)

    expect(spy).not.toHaveBeenCalled()
    expect(ws.readyState).toBe(WebSocket.OPEN)

    spy.mockRestore()
    ws.close()
    await app.close()
  })

  it('roteia screen-annotation para os outros conectados', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-annotation@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const bruno = await prisma.user.create({
      data: { name: 'Bruno', email: 'bruno-annotation@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const anaTk = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
    const brunoTk = app.jwt.sign({ sub: bruno.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })

    const anaWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${anaTk}`)
    await waitOpen(anaWs)

    const brunoWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${brunoTk}`)
    const brunoMsgs: OfficeServerMessage[] = []
    brunoWs.on('message', (d) => brunoMsgs.push(JSON.parse(d.toString())))
    await waitOpen(brunoWs)
    await delay(100)

    anaWs.send(
      JSON.stringify({
        type: 'screen-annotation',
        sharerId: bruno.id,
        strokeId: 's1',
        points: [{ x: 0.25, y: 0.75 }],
        done: true,
      }),
    )
    await delay(150)

    expect(brunoMsgs).toContainEqual({
      type: 'screen-annotation',
      userId: ana.id,
      sharerId: bruno.id,
      strokeId: 's1',
      points: [{ x: 0.25, y: 0.75 }],
      done: true,
    })

    anaWs.close()
    brunoWs.close()
    await app.close()
  })

  it('usuários de empresas diferentes não veem presença nem broadcast um do outro', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa WS', slug: 'outra-empresa-ws-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa WS', slug: 'setor-outra-empresa-ws-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherDocument = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
    const otherMap = await prisma.officeMap.create({ data: { name: 'Mapa Outra Empresa', companyId: otherCompany.id } })
    const otherPublication = await prisma.officeMapPublication.create({
      data: {
        mapId: otherMap.id, version: 1, schemaVersion: otherDocument.schemaVersion,
        mapData: otherDocument as unknown as Prisma.InputJsonValue, companyId: otherCompany.id,
      },
    })
    await prisma.officeSetting.create({ data: { companyId: otherCompany.id, activeMapPublicationId: otherPublication.id } })

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-multi-empresa-ws@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const outraUser = await prisma.user.create({
      data: {
        name: 'Zeca', email: 'zeca-outra-empresa-ws@x.com', passwordHash: 'x', role: 'LEGEND',
        companyId: otherCompany.id, sectorId: otherSector.id,
      },
    })
    const anaTk = app.jwt.sign({ sub: ana.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: DEFAULT_COMPANY_ID, features: ['escritorio'] })
    const outraTk = app.jwt.sign({ sub: outraUser.id, role: 'LEGEND', sectorId: otherSector.id, companyId: otherCompany.id, features: ['escritorio'] })

    const anaWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${anaTk}`)
    const anaMsgs: OfficeServerMessage[] = []
    anaWs.on('message', (d) => anaMsgs.push(JSON.parse(d.toString())))
    await waitOpen(anaWs)

    const outraWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${outraTk}`)
    const outraMsgs: OfficeServerMessage[] = []
    outraWs.on('message', (d) => outraMsgs.push(JSON.parse(d.toString())))
    await waitOpen(outraWs)
    await delay(100)

    // 'joined' de uma empresa nunca chega pra quem está na outra
    expect(anaMsgs.some((m) => m.type === 'joined' && m.occupant.userId === outraUser.id)).toBe(false)
    expect(outraMsgs.some((m) => m.type === 'joined' && m.occupant.userId === ana.id)).toBe(false)

    const otherHub = getOfficeHub(otherCompany.id)
    expect(otherHub.occupants().map((o) => o.userId)).toEqual([outraUser.id])
    expect(officeHub.occupants().map((o) => o.userId)).not.toContain(outraUser.id)

    // movimento de uma empresa não propaga pra outra
    const spawn = otherHub.occupantOf(outraUser.id)!
    const tile = { x: Math.floor(spawn.x / 32), y: Math.floor(spawn.y / 32) }
    const dy = isWalkable(tile.x, tile.y - 1) ? -1 : 1
    for (let seq = 1; seq <= 6; seq += 1) {
      outraWs.send(JSON.stringify({ type: 'input', input: { seq, dx: 0, dy, dtMs: 33 } }))
    }
    await delay(300)
    expect(
      anaMsgs.some(
        (m) => m.type === 'snapshot' && m.players.some((p) => p.userId === outraUser.id),
      ),
    ).toBe(false)

    anaWs.close()
    outraWs.close()
    await app.close()
  })
})
