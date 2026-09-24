import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ARENA_LOBBY_ID, arenaMediaRoom } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { getArenaHub, __resetArenaHubs, type ArenaSocket } from '../lib/arena-hub'
import { getArenaLobbyHub, __resetArenaLobbyHubs } from '../lib/arena-lobby-hub'

const COMPANY = 'company-emr'
const sink: ArenaSocket = { send: () => {} }
/** Quem entrou na arena durante o teste — sai no fim para o loop de tick parar. */
const sair: Array<() => void> = []

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
}

let userCounter = 0

async function createUserAndToken(app: ReturnType<typeof buildApp>) {
  userCounter += 1
  const user = await prisma.user.create({
    data: { name: 'Ana', email: `ana-arena-${userCounter}@x.com`, passwordHash: 'x', role: 'LEGEND' },
  })
  const token = app.jwt.sign({
    sub: user.id,
    role: 'LEGEND',
    sectorId: 'sector-dev-produto',
    companyId: COMPANY,
    features: ['escritorio'],
  })
  return { user, token }
}

function entrarNaArena(userId: string, name: string, arenaId = 'mata-mata') {
  const hub = getArenaHub(COMPANY, arenaId)
  hub.configure()
  hub.join(sink, { id: userId, name, avatarSeed: null, avatarOptions: null }, arenaId)
  sair.push(() => hub.leave(sink, userId))
}

beforeEach(() => {
  __resetArenaHubs()
  __resetArenaLobbyHubs()
})
afterEach(() => {
  for (const fim of sair.splice(0)) fim()
})

describe('POST /arena/media-token', () => {
  it('recusa sem autenticação', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/arena/media-token',
      payload: { arenaId: 'mata-mata' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('recusa quem não está na arena — a presença no hub é a credencial', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await createUserAndToken(app)

    const res = await app.inject({
      method: 'POST',
      url: '/arena/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { arenaId: 'mata-mata' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('recusa arena inventada — sala LiveKit livre seria canal privado de graça', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await createUserAndToken(app)
    entrarNaArena(user.id, user.name)

    const res = await app.inject({
      method: 'POST',
      url: '/arena/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { arenaId: 'sala-secreta' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('assina o token da arena onde a pessoa está', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await createUserAndToken(app)
    entrarNaArena(user.id, user.name)

    const res = await app.inject({
      method: 'POST',
      url: '/arena/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { arenaId: 'mata-mata' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { token: string; url: string; room: string }
    expect(body.room).toBe(arenaMediaRoom(COMPANY, 'mata-mata'))
    const payload = decodeJwtPayload(body.token)
    expect(payload.sub).toBe(user.id)
    // O nome vem do hub: o access token não carrega nome.
    expect(payload.name).toBe('Ana')
    expect((payload.video as { room?: string }).room).toBe(arenaMediaRoom(COMPANY, 'mata-mata'))
  })

  it('recusa o token de um modo em que a pessoa não está', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await createUserAndToken(app)
    entrarNaArena(user.id, user.name, 'mata-mata')

    const res = await app.inject({
      method: 'POST',
      url: '/arena/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { arenaId: 'bandeira' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('o saguão tem sala própria, e exige estar nele', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await createUserAndToken(app)

    const antes = await app.inject({
      method: 'POST',
      url: '/arena/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { arenaId: ARENA_LOBBY_ID },
    })
    expect(antes.statusCode).toBe(409)

    getArenaLobbyHub(COMPANY).join(sink, { userId: user.id, name: user.name })
    const depois = await app.inject({
      method: 'POST',
      url: '/arena/media-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { arenaId: ARENA_LOBBY_ID },
    })
    expect(depois.statusCode).toBe(200)
    expect((depois.json() as { room: string }).room).toBe(arenaMediaRoom(COMPANY, ARENA_LOBBY_ID))
  })

  it('a sala carrega a empresa — o modo é igual em todo tenant', () => {
    expect(arenaMediaRoom('empresa-1', 'mata-mata')).not.toBe(
      arenaMediaRoom('empresa-2', 'mata-mata'),
    )
  })
})
