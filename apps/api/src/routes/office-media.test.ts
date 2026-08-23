import { describe, it, expect, beforeEach } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { getOfficeHub, type OfficeSocket } from '../lib/office-hub'
import { OFFICE_BROADCAST_ROOM, createEmptyMapDocumentV1, officeRoomForMapPosition, DEFAULT_COMPANY_ID } from '@legends/shared'
import { setBroadcastEnabled } from '../services/office-setting-service'
import { legacyOfficeRuntimeFixture } from '../test/office-map-fixture'
import {
  createOfficeMap,
  acquireOfficeMapLock,
  saveOfficeMapDraft,
  publishOfficeMap,
  getActiveOfficeMap,
  saveOfficeDecorationDraft,
  publishOfficeDecoration,
} from '../services/office-map-service'

// Todos os testes deste arquivo operam na empresa default.
const officeHub = getOfficeHub(DEFAULT_COMPANY_ID)

const sink: OfficeSocket = { send: () => {} }
const TEST_OPEN_ROOM = 'office-map-legacy-test-map-open'
const TEST_MEETING_ROOM = 'office-map-legacy-test-map-zone-reuniao-2'

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
}

beforeEach(() => {
  officeHub.reset()
  officeHub.configure(legacyOfficeRuntimeFixture())
})

let userCounter = 0

async function createUserAndToken(app: ReturnType<typeof buildApp>, role: 'LEGEND' | 'LEAD' = 'LEGEND') {
  userCounter += 1
  const user = await prisma.user.create({
    data: { name: 'Ana', email: `ana-${userCounter}@x.com`, passwordHash: 'x', role },
  })
  const token = app.jwt.sign({ sub: user.id, role, sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] })
  return { user, token }
}

async function createActorId(): Promise<string> {
  userCounter += 1
  const user = await prisma.user.create({
    data: { name: 'Admin', email: `admin-${userCounter}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  return user.id
}

describe('POST /office/media-token', () => {
  it('recusa sem autenticação', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      payload: { room: TEST_OPEN_ROOM },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('409 se a pessoa não está no escritório', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await createUserAndToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: TEST_OPEN_ROOM },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('403 se a sala pedida não corresponde à posição real', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await createUserAndToken(app)
    officeHub.join(sink, { id: user.id, name: user.name, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })
    // spawn é espaço aberto — pedir sala de reunião é mentira
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: TEST_MEETING_ROOM },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('200 no espaço aberto: token com grant para office-open e identity = userId', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await createUserAndToken(app)
    officeHub.join(sink, { id: user.id, name: user.name, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })

    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: TEST_OPEN_ROOM },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { token: string; url: string }
    expect(body.url).toBeTruthy()
    const payload = decodeJwtPayload(body.token)
    expect(payload.sub).toBe(user.id)
    expect(payload.video).toMatchObject({ roomJoin: true, room: TEST_OPEN_ROOM })
    await app.close()
  })

  it('200 dentro da sala: andar até a reunião-2 autoriza a sala dela', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await createUserAndToken(app)
    officeHub.join(sink, { id: user.id, name: user.name, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })

    // do spawn (linhas 14-15, colunas 11-13) até dentro da sala 2: desce à
    // linha 15 se preciso e anda pra direita atravessando a porta (16,15).
    // Burst do rate limit é 10 — cabem os ≤ 7 passos sem esperar relógio.
    let occ = officeHub.occupantOf(user.id)!
    if (occ.y === 14) officeHub.move(sink, user.id, 'down')
    for (let i = 0; i < 8 && officeHub.occupantOf(user.id)!.x < 17; i += 1) {
      officeHub.move(sink, user.id, 'right')
    }
    occ = officeHub.occupantOf(user.id)!
    expect(occ.x).toBeGreaterThanOrEqual(17) // realmente entrou na sala

    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: TEST_MEETING_ROOM },
    })
    expect(res.statusCode).toBe(200)
    const payload = decodeJwtPayload((res.json() as { token: string }).token)
    expect(payload.video).toMatchObject({ roomJoin: true, room: TEST_MEETING_ROOM })

    // e o aberto agora é negado — a pessoa não está mais lá
    const open = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: TEST_OPEN_ROOM },
    })
    expect(open.statusCode).toBe(403)
    await app.close()
  })

  it('400 com body inválido', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await createUserAndToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { sala: 'x' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('alto-falante ligado em uma empresa não libera em outra', async () => {
    await setBroadcastEnabled(true, await createActorId(), DEFAULT_COMPANY_ID)
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Media', slug: 'outra-empresa-media-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Media', slug: 'setor-outra-empresa-media-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherUser = await prisma.user.create({
      data: { name: 'OutraEmpresaMedia', email: 'outra-empresa-media@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id, sectorId: otherSector.id },
    })
    const otherToken = app.jwt.sign({ sub: otherUser.id, role: 'LEAD', sectorId: otherSector.id, companyId: otherCompany.id, features: ['escritorio'] })
    officeHub.join(sink, { id: otherUser.id, name: otherUser.name, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })

    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { room: OFFICE_BROADCAST_ROOM },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('POST /office/media-token — office-broadcast', () => {
  it('403 quando o alto-falante está desligado (default), mesmo para líder no escritório', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await createUserAndToken(app, 'LEAD')
    officeHub.join(sink, { id: user.id, name: user.name, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: OFFICE_BROADCAST_ROOM },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('ligado: líder recebe canPublish true; lenda recebe canPublish false', async () => {
    await setBroadcastEnabled(true, await createActorId(), DEFAULT_COMPANY_ID)
    const app = buildApp()
    await app.ready()

    const lead = await createUserAndToken(app, 'LEAD')
    officeHub.join(sink, { id: lead.user.id, name: lead.user.name, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })
    const leadRes = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { room: OFFICE_BROADCAST_ROOM },
    })
    expect(leadRes.statusCode).toBe(200)
    const leadGrant = decodeJwtPayload((leadRes.json() as { token: string }).token)
    expect(leadGrant.video).toMatchObject({
      roomJoin: true,
      room: OFFICE_BROADCAST_ROOM,
      canPublish: true,
      canSubscribe: true,
    })

    const legend = await createUserAndToken(app, 'LEGEND')
    officeHub.join(sink, { id: legend.user.id, name: legend.user.name, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })
    const legendRes = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${legend.token}` },
      payload: { room: OFFICE_BROADCAST_ROOM },
    })
    expect(legendRes.statusCode).toBe(200)
    const legendGrant = decodeJwtPayload((legendRes.json() as { token: string }).token)
    expect(legendGrant.video).toMatchObject({ canPublish: false, canSubscribe: true })
    await app.close()
  })

  it('ligado mas fora do escritório: 409', async () => {
    await setBroadcastEnabled(true, await createActorId(), DEFAULT_COMPANY_ID)
    const app = buildApp()
    await app.ready()
    const { token } = await createUserAndToken(app, 'LEAD')
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: OFFICE_BROADCAST_ROOM },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })
})

describe('POST /office/media-token — estabilidade da sala após publicar decoração', () => {
  it('mantém a mesma sala autorizada após publicar decoração (mapId estável)', async () => {
    const app = buildApp()
    await app.ready()

    // Sobe um mapa real publicado (fora do fixture legado do hub) para poder
    // republicar decoração de verdade e observar o publication.id mudar.
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const { id: mapId } = await createOfficeMap({ name: 'Mapa', width: 20, height: 20, tileSize: 48 }, admin.id, DEFAULT_COMPANY_ID)
    const doc = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })
    const lock = await acquireOfficeMapLock(mapId, admin.id, DEFAULT_COMPANY_ID)
    const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
    const saved = await saveOfficeMapDraft(mapId, { revision: draft.revision, document: doc }, admin.id, lock.lockToken, DEFAULT_COMPANY_ID)
    await publishOfficeMap(mapId, saved.revision, admin.id, true, DEFAULT_COMPANY_ID)

    const { user, token } = await createUserAndToken(app)
    officeHub.join(sink, { id: user.id, name: user.name, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })
    const occ = officeHub.occupantOf(user.id)!

    const before = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
    const roomBefore = officeRoomForMapPosition(before.map.id, before.document, occ.x, occ.y)

    // publica decoração inócua: mesmo map.id, novo publication.id
    const lock2 = await acquireOfficeMapLock(mapId, admin.id, DEFAULT_COMPANY_ID)
    const decorDoc = JSON.parse(JSON.stringify(before.document))
    const objects = decorDoc.layers.find((l: { key: string }) => l.key === 'objects')
    if (objects) objects.data[0] = null
    const savedDecor = await saveOfficeDecorationDraft(
      { revision: saved.revision, document: decorDoc },
      { id: admin.id, role: 'ADMIN' },
      lock2.lockToken,
      DEFAULT_COMPANY_ID,
    )
    await publishOfficeDecoration(savedDecor.revision, { id: admin.id, role: 'ADMIN' }, DEFAULT_COMPANY_ID)

    const after = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
    expect(after.publication.id).not.toBe(before.publication.id)
    expect(after.map.id).toBe(before.map.id)
    expect(officeRoomForMapPosition(after.map.id, after.document, occ.x, occ.y)).toBe(roomBefore)

    // token continua autorizado para a sala calculada antes de publicar
    const res = await app.inject({
      method: 'POST',
      url: '/office/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { room: roomBefore },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})

describe('GET /office/config', () => {
  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/office/config' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('reflete o flag', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await createUserAndToken(app)
    const off = await app.inject({
      method: 'GET',
      url: '/office/config',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(off.json()).toEqual({ broadcastEnabled: false, activeMapPublicationId: null })

    await setBroadcastEnabled(true, await createActorId(), DEFAULT_COMPANY_ID)
    const on = await app.inject({
      method: 'GET',
      url: '/office/config',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(on.json()).toEqual({ broadcastEnabled: true, activeMapPublicationId: null })
    await app.close()
  })
})
