import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { defaultCharacterFromSeed, migrateCharacterOptions, DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { getOfficeHub } from '../lib/office-hub'
import { legacyOfficeRuntimeFixture } from '../test/office-map-fixture'
import { createSector } from '../services/sector-service'

// Todos os testes deste arquivo operam na empresa default.
const officeHub = getOfficeHub(DEFAULT_COMPANY_ID)

async function makeApp() {
  const app = buildApp()
  await app.ready()
  return app
}

// Fixture v2 canônica (catálogo real) — reusada nos testes de borda avatarOptions.
const CHARACTER_V2 = {
  bodyType: 'male' as const,
  items: {
    body: { item: 'body', variant: 'light' },
    head: { item: 'heads_human_male', variant: 'light' },
    clothes: { item: 'torso_clothes_shortsleeve', variant: 'navy' },
    legs: { item: 'legs_pants', variant: 'black' },
    shoes: { item: 'feet_shoes', variant: 'brown' },
  },
}

// Fixture v1 (shape da curadoria antiga, persistida no banco antes da migração para o catálogo LPC).
const CHARACTER_V1 = {
  bodyType: 'male' as const,
  skinTone: 'olive',
  hair: { style: 'buzzcut', color: 'black' },
  beard: null,
  torso: { item: 'shortsleeve', color: 'blue' },
  legs: { item: 'pants', color: 'black' },
  feet: { item: 'boots', color: 'brown' },
  glasses: null,
  hat: null,
}

describe('auth routes', () => {
  // O hub é um singleton em memória: precisa de reset/config por teste (não
  // é limpo pelo truncate do Postgres nem entre arquivos de teste).
  beforeEach(() => {
    officeHub.reset()
    officeHub.configure(legacyOfficeRuntimeFixture())
  })

  it('registers a user and returns a token', async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.accessToken).toBeTruthy()
    expect(body.user.email).toBe('ana@empresa.com')
    expect(body.user).not.toHaveProperty('passwordHash')
    await app.close()
  })

  it('rejects registration with invalid payload', async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'not-an-email', password: '123' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects duplicate registration with 409', async () => {
    const app = await makeApp()
    const payload = { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' }
    await app.inject({ method: 'POST', url: '/auth/register', payload })
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('logs in with correct credentials', async () => {
    const app = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ana@empresa.com', password: 'changeme123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeTruthy()
    await app.close()
  })

  it('POST /auth/login devolve companyId e companyName no user', async () => {
    const app = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Empresa Teste', email: 'empresa-teste-login@x.com', password: 'changeme123' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'empresa-teste-login@x.com', password: 'changeme123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.companyId).toBe(DEFAULT_COMPANY_ID)
    expect(res.json().user.companyName).toBe('EMR')
    await app.close()
  })

  it('rejects login with wrong password (401)', async () => {
    const app = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ana@empresa.com', password: 'wrong-password' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns the current user from /auth/me with a valid token', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token } = reg.json()
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.email).toBe('ana@empresa.com')
    await app.close()
  })

  it('rejects /auth/me without a token (401)', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('updates the current user avatarSeed via PATCH /auth/me', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token } = reg.json()
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarSeed: 'Felix' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.avatarSeed).toBe('Felix')

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.json().user.avatarSeed).toBe('Felix')
    await app.close()
  })

  it('rejects an unknown avatar style with 400', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token } = reg.json()
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'avataaars', avatarSeed: 'Felix' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects PATCH /auth/me without a token (401)', async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      payload: { avatarSeed: 'Felix' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('saves lpc character options via PATCH /auth/me', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token } = reg.json()
    const options = defaultCharacterFromSeed('felix')
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'lpc', avatarSeed: 'felix', avatarOptions: options },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.avatarStyle).toBe('lpc')
    expect(res.json().user.avatarOptions).toEqual(options)

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.json().user.avatarOptions).toEqual(options)
    await app.close()
  })

  it('rejects lpc options with an unknown item (400)', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token } = reg.json()
    const base = defaultCharacterFromSeed('felix')
    const options = { ...base, items: { ...base.items, clothes: { item: 'jaqueta-inventada', variant: 'blue' } } }
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'lpc', avatarSeed: 'felix', avatarOptions: options },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects lpc options with a color outside the item palette (400)', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token } = reg.json()
    const base = defaultCharacterFromSeed('felix')
    const options = {
      ...base,
      items: { ...base.items, hat: { item: 'hat_formal_bowler', variant: 'ultraviolet' } },
    }
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'lpc', avatarSeed: 'felix', avatarOptions: options },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('discards unknown keys from lpc options before persisting', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token } = reg.json()
    const options = { ...defaultCharacterFromSeed('felix'), junk: 'nope' }
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'lpc', avatarSeed: 'felix', avatarOptions: options },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.avatarOptions).not.toHaveProperty('junk')
    await app.close()
  })

  it('rejects lpc without options (400)', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token } = reg.json()
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'lpc', avatarSeed: 'felix' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects open-peeps writes after the migration (400)', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token } = reg.json()
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'open-peeps', avatarSeed: 'x', avatarOptions: null },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('saves a v2 character options fixture as-is via PATCH /auth/me', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token } = reg.json()
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'lpc', avatarSeed: 'felix', avatarOptions: CHARACTER_V2 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.avatarOptions).toEqual(CHARACTER_V2)
    await app.close()
  })

  it('discards a hacked extra key on v2 character options before persisting', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token } = reg.json()
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'lpc', avatarSeed: 'felix', avatarOptions: { ...CHARACTER_V2, hacked: true } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.avatarOptions).toEqual(CHARACTER_V2)
    expect(res.json().user.avatarOptions).not.toHaveProperty('hacked')
    await app.close()
  })

  it('rejects a v1-shaped avatarOptions via PATCH /auth/me (400) — só v2 é aceito na escrita', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token } = reg.json()
    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarStyle: 'lpc', avatarSeed: 'felix', avatarOptions: CHARACTER_V1 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('broadcasta avatarOptions migrado (não null) ao atualizar só o avatarSeed com v1 legado persistido', async () => {
    const app = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
    })
    const { accessToken: token, user: registered } = reg.json()

    // Simula um usuário com avatarOptions v1 persistido antes da migração para
    // o catálogo LPC — a API não aceita mais escrever esse shape (ver teste
    // acima), então o fixture vai direto no banco.
    await prisma.user.update({
      where: { id: registered.id },
      data: { avatarOptions: CHARACTER_V1 as unknown as Prisma.InputJsonValue },
    })

    officeHub.join(
      { send: () => {} },
      {
        id: registered.id,
        name: registered.name,
        photoUrl: null,
        avatarStyle: null,
        avatarSeed: registered.avatarSeed,
        avatarOptions: null,
      },
    )

    const res = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarSeed: 'Felix' },
    })
    expect(res.statusCode).toBe(200)

    const occupant = officeHub.occupantOf(registered.id)
    expect(occupant?.avatarOptions).not.toBeNull()
    expect(occupant?.avatarOptions).toEqual(migrateCharacterOptions(CHARACTER_V1))
    await app.close()
  })

  it('lenda sem "votar" habilitado no setor recebe 403 em rota gated por feature', async () => {
    const app = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Sem Voto', email: 'semvoto@empresa.com', password: 'changeme123' },
    })
    const created = await prisma.user.findUniqueOrThrow({ where: { email: 'semvoto@empresa.com' } })
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-auth-sector@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sector = await createSector({ name: 'Sem Votação', enabledFeatures: [], roles: ['LEGEND'] }, actor.id, DEFAULT_COMPANY_ID)
    await prisma.user.update({ where: { id: created.id }, data: { sectorId: sector.id } })

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'semvoto@empresa.com', password: 'changeme123' },
    })
    const token = login.json().accessToken as string

    const res = await app.inject({
      method: 'GET',
      url: '/votes/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
