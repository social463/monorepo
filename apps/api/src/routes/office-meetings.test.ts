import { describe, expect, it, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { DEFAULT_COMPANY_ID, createEmptyMapDocumentV1 } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

// Guardada para o helper `createRoom`, que outros describes usam para materializar
// salas extras (ex.: sala-1/sala-2) na mesma publicação ativa sem duplicar mapa/setting.
let activePublicationId: string

beforeEach(async () => {
  const document = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
  document.objects.push({
    id: 'room-aurora',
    type: 'meeting-room',
    geometry: { kind: 'rectangle', x: 64, y: 64, width: 160, height: 128 },
    properties: { externalKey: 'aurora', name: 'Aurora', status: 'OPEN', voiceEnabled: true, accessPolicy: 'OPEN' },
  } as never)
  const map = await prisma.officeMap.create({ data: { name: 'Mapa', companyId: DEFAULT_COMPANY_ID } })
  const publication = await prisma.officeMapPublication.create({
    data: {
      mapId: map.id, version: 1, schemaVersion: document.schemaVersion,
      mapData: document as unknown as Prisma.InputJsonValue, companyId: DEFAULT_COMPANY_ID,
    },
  })
  activePublicationId = publication.id
  await prisma.officeSetting.create({ data: { companyId: DEFAULT_COMPANY_ID, activeMapPublicationId: publication.id } })
  // getActiveOfficeMap lê salas da tabela OfficeRoom, não do JSON do documento — o publish de
  // verdade (publishMap) materializa essa linha, mas aqui o mapa nasce direto via prisma.create,
  // então precisa criar a sala manualmente (mesmo padrão de office-meeting-service.test.ts).
  await prisma.officeRoom.create({
    data: { mapPublicationId: publication.id, name: 'Aurora', externalKey: 'aurora', companyId: DEFAULT_COMPANY_ID },
  })
})

/** Sala extra na mesma publicação ativa — para testes que precisam de mais de uma sala. */
async function createRoom(externalKey: string, name: string) {
  await prisma.officeRoom.create({
    data: { mapPublicationId: activePublicationId, name, externalKey, companyId: DEFAULT_COMPANY_ID },
  })
}

async function makeUserToken(app: ReturnType<typeof buildApp>, name: string) {
  const user = await prisma.user.create({
    data: { name, email: `${name.toLowerCase()}-${Date.now()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
  })
  const token = app.jwt.sign({ sub: user.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: DEFAULT_COMPANY_ID, features: [] })
  return { user, token }
}

const futuro = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

describe('POST /office/meetings', () => {
  it('cria e devolve 201 com o DTO', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUserToken(app, 'Ana')

    const res = await app.inject({
      method: 'POST',
      url: '/office/meetings',
      headers: { authorization: `Bearer ${token}` },
      payload: { roomExternalKey: 'aurora', title: 'Planning', startsAt: futuro, durationMinutes: 30, participantIds: [] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().roomName).toBe('Aurora')
    expect(res.json().googleCalendarUrl).toContain('calendar.google.com')
  })

  it('rejeita duração fora da lista com 400 e issues', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUserToken(app, 'Ana')

    const res = await app.inject({
      method: 'POST',
      url: '/office/meetings',
      headers: { authorization: `Bearer ${token}` },
      payload: { roomExternalKey: 'aurora', title: 'X', startsAt: futuro, durationMinutes: 17, participantIds: [] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().issues).toBeDefined()
  })

  it('devolve 409 com os conflitos quando a sala já está ocupada', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUserToken(app, 'Ana')
    const payload = { roomExternalKey: 'aurora', title: 'Planning', startsAt: futuro, durationMinutes: 60, participantIds: [] }

    await app.inject({ method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${token}` }, payload })
    const conflito = await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, title: 'Outra' },
    })

    expect(conflito.statusCode).toBe(409)
    expect(conflito.json().conflicts).toHaveLength(1)

    const forcada = await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, title: 'Outra', force: true },
    })
    expect(forcada.statusCode).toBe(201)
  })

  it('convidado (GUEST) não agenda', async () => {
    const app = buildApp()
    await app.ready()
    // Payload de convidado tem campos além do FastifyJWT padrão (guest/name/presetId/inviteId).
    // Assinar via variável tipada (em vez de literal inline) evita o excess-property check do TS
    // contra o tipo estreito de FastifyJWT.payload — mesmo padrão de office-guest-service.ts.
    const guestPayload: {
      sub: string
      role: string
      sectorId: string
      companyId: string
      features: string[]
      guest: boolean
      name: string
      presetId: string
      inviteId: string
    } = {
      sub: 'guest-1', role: 'GUEST', sectorId: '', companyId: DEFAULT_COMPANY_ID,
      features: [], guest: true, name: 'Visita', presetId: 'p1', inviteId: 'i1',
    }
    const guestToken = app.jwt.sign(guestPayload)

    const res = await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${guestToken}` },
      payload: { roomExternalKey: 'aurora', title: 'X', startsAt: futuro, durationMinutes: 30, participantIds: [] },
    })
    expect(res.statusCode).toBe(403)
  })

  it('participantIds duplicados não estoura a PK composta — dedupe e 201', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUserToken(app, 'Ana')
    const { user: carla } = await makeUserToken(app, 'Carla')

    const res = await app.inject({
      method: 'POST',
      url: '/office/meetings',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        roomExternalKey: 'aurora',
        title: 'Planning',
        startsAt: futuro,
        durationMinutes: 30,
        participantIds: [carla.id, carla.id],
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().participants).toHaveLength(1)
  })
})

describe('GET /office/meetings', () => {
  it('lista a agenda da sala', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUserToken(app, 'Ana')
    await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${token}` },
      payload: { roomExternalKey: 'aurora', title: 'Planning', startsAt: futuro, durationMinutes: 30, participantIds: [] },
    })

    const res = await app.inject({
      method: 'GET', url: '/office/meetings?room=aurora', headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })
})

describe('GET /office/meetings sem sala', () => {
  // Ana organiza "Planning" na sala-1 e convida Bruno; Carla organiza "Review" na
  // sala-2 sozinha (sem Bruno). `from`/`to` cobrem `futuro` (usado como startsAt).
  let anaToken: string
  let brunoToken: string
  let carlaToken: string
  let planningId: string
  const from = new Date(Date.now()).toISOString()
  const to = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

  beforeEach(async () => {
    const app = buildApp()
    await app.ready()
    await createRoom('sala-1', 'Sala 1')
    await createRoom('sala-2', 'Sala 2')

    const { user: ana, token: anaTok } = await makeUserToken(app, 'Ana')
    const { user: bruno, token: brunoTok } = await makeUserToken(app, 'Bruno')
    const { token: carlaTok } = await makeUserToken(app, 'Carla')
    anaToken = anaTok
    brunoToken = brunoTok
    carlaToken = carlaTok

    const planning = await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${anaToken}` },
      payload: { roomExternalKey: 'sala-1', title: 'Planning', startsAt: futuro, durationMinutes: 30, participantIds: [bruno.id] },
    })
    planningId = planning.json().id

    await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${carlaTok}` },
      payload: { roomExternalKey: 'sala-2', title: 'Review', startsAt: futuro, durationMinutes: 30, participantIds: [] },
    })
  })

  it('traz só as reuniões em que o usuário está envolvido', async () => {
    const app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: `/office/meetings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization: `Bearer ${brunoToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((m: { title: string }) => m.title)).toEqual(['Planning'])
  })

  it('organizador vê a própria reunião mesmo sem estar entre os participantes', async () => {
    // "Review" é da Carla sozinha: withoutOrganizer tira o organizador da tabela
    // OfficeMeetingParticipant na criação, então zero linhas ali para ela. Só o
    // braço `organizerId` do OR (não o `participants.some`) pode trazer essa
    // reunião pra agenda padrão da Carla — exercita esse braço de propósito.
    const app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: `/office/meetings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization: `Bearer ${carlaToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((m: { title: string }) => m.title)).toEqual(['Review'])
  })

  it('com mine=false traz as reuniões de todas as salas', async () => {
    const app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: `/office/meetings?mine=false&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization: `Bearer ${brunoToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((m: { title: string }) => m.title).sort()).toEqual(['Planning', 'Review'])
  })

  it('não traz reunião cancelada', async () => {
    const app = buildApp()
    await app.ready()

    await app.inject({ method: 'DELETE', url: `/office/meetings/${planningId}`, headers: { authorization: `Bearer ${anaToken}` } })
    const res = await app.inject({
      method: 'GET',
      url: `/office/meetings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization: `Bearer ${brunoToken}` },
    })
    expect(res.json()).toEqual([])
  })

  it('recusa intervalo maior que 62 dias (400)', async () => {
    const app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/office/meetings?from=2026-01-01T00:00:00.000Z&to=2026-06-01T00:00:00.000Z',
      headers: { authorization: `Bearer ${brunoToken}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('aceita intervalo de exatamente 62 dias e recusa 63', async () => {
    const app = buildApp()
    await app.ready()
    const base = new Date('2026-01-01T00:00:00.000Z')
    const at62Days = new Date(base.getTime() + 62 * 24 * 60 * 60 * 1000)
    const at63Days = new Date(base.getTime() + 63 * 24 * 60 * 60 * 1000)

    const dentroDoTeto = await app.inject({
      method: 'GET',
      url: `/office/meetings?from=${encodeURIComponent(base.toISOString())}&to=${encodeURIComponent(at62Days.toISOString())}`,
      headers: { authorization: `Bearer ${brunoToken}` },
    })
    expect(dentroDoTeto.statusCode).toBe(200)

    const acimaDoTeto = await app.inject({
      method: 'GET',
      url: `/office/meetings?from=${encodeURIComponent(base.toISOString())}&to=${encodeURIComponent(at63Days.toISOString())}`,
      headers: { authorization: `Bearer ${brunoToken}` },
    })
    expect(acimaDoTeto.statusCode).toBe(400)
  })

  it('com room continua listando a agenda da sala inteira', async () => {
    const app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/office/meetings?room=sala-2',
      headers: { authorization: `Bearer ${brunoToken}` },
    })
    expect(res.json().map((m: { title: string }) => m.title)).toEqual(['Review'])
  })
})

describe('PATCH e DELETE /office/meetings/:id', () => {
  it('não-organizador leva 403 e organizador cancela com 200', async () => {
    const app = buildApp()
    await app.ready()
    const { token: anaToken } = await makeUserToken(app, 'Ana')
    const { token: brunoToken } = await makeUserToken(app, 'Bruno')

    const created = await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${anaToken}` },
      payload: { roomExternalKey: 'aurora', title: 'Planning', startsAt: futuro, durationMinutes: 30, participantIds: [] },
    })
    const id = created.json().id

    const alheio = await app.inject({
      method: 'PATCH', url: `/office/meetings/${id}`, headers: { authorization: `Bearer ${brunoToken}` },
      payload: { title: 'Sequestrada' },
    })
    expect(alheio.statusCode).toBe(403)

    const cancelada = await app.inject({
      method: 'DELETE', url: `/office/meetings/${id}`, headers: { authorization: `Bearer ${anaToken}` },
    })
    expect(cancelada.statusCode).toBe(200)
    expect(cancelada.json().canceled).toBe(true)
  })
})

describe('GET /office/meetings/:id/ics', () => {
  it('devolve text/calendar com Content-Disposition de download', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUserToken(app, 'Ana')
    const created = await app.inject({
      method: 'POST', url: '/office/meetings', headers: { authorization: `Bearer ${token}` },
      payload: { roomExternalKey: 'aurora', title: 'Planning', startsAt: futuro, durationMinutes: 30, participantIds: [] },
    })

    const res = await app.inject({
      method: 'GET', url: `/office/meetings/${created.json().id}/ics`, headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/calendar')
    expect(res.headers['content-disposition']).toContain('planning.ics')
    expect(res.body).toContain('BEGIN:VCALENDAR')
  })
})
