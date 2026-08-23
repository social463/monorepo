import { describe, expect, it } from 'vitest'
import { characterSignature, defaultCharacterFromSeed } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function makeApp() {
  const app = buildApp()
  await app.ready()
  return app
}

async function register(app: Awaited<ReturnType<typeof makeApp>>, email = 'ana@empresa.com') {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email, password: 'changeme123' },
  })
  return res.json() as { accessToken: string; user: { id: string } }
}

const options = defaultCharacterFromSeed('slot-um')
const otherOptions = defaultCharacterFromSeed('slot-dois')

describe('character favorite routes', () => {
  it('creates and lists a character slot for the authenticated user', async () => {
    const app = await makeApp()
    const { accessToken } = await register(app)

    const create = await app.inject({
      method: 'PUT',
      url: '/character-favorites/1',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { seed: 'slot-um', options },
    })

    expect(create.statusCode).toBe(200)
    expect(create.json().favorite).toMatchObject({
      slot: 1,
      seed: 'slot-um',
      options,
      signature: characterSignature(options),
    })

    const list = await app.inject({
      method: 'GET',
      url: '/character-favorites',
      headers: { authorization: `Bearer ${accessToken}` },
    })

    expect(list.statusCode).toBe(200)
    expect(list.json().favorites).toHaveLength(1)
    expect(list.json().favorites[0].slot).toBe(1)
    await app.close()
  })

  it('replaces an occupied slot', async () => {
    const app = await makeApp()
    const { accessToken } = await register(app)

    await app.inject({
      method: 'PUT',
      url: '/character-favorites/1',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { seed: 'slot-um', options },
    })
    const replace = await app.inject({
      method: 'PUT',
      url: '/character-favorites/1',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { seed: 'slot-dois', options: otherOptions },
    })

    expect(replace.statusCode).toBe(200)
    expect(replace.json().favorite).toMatchObject({
      slot: 1,
      seed: 'slot-dois',
      options: otherOptions,
      signature: characterSignature(otherOptions),
    })
    expect(await prisma.characterFavorite.count()).toBe(1)
    await app.close()
  })

  it('rejects invalid slots and invalid character payloads', async () => {
    const app = await makeApp()
    const { accessToken } = await register(app)

    const invalidSlot = await app.inject({
      method: 'PUT',
      url: '/character-favorites/6',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { seed: 'slot-seis', options },
    })
    expect(invalidSlot.statusCode).toBe(400)

    const invalidPayload = await app.inject({
      method: 'PUT',
      url: '/character-favorites/1',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { seed: 'slot-um', options: { bodyType: 'alien', items: {} } },
    })
    expect(invalidPayload.statusCode).toBe(400)
    await app.close()
  })

  it('lists and deletes only slots owned by the authenticated user', async () => {
    const app = await makeApp()
    const ana = await register(app, 'ana@empresa.com')
    const bia = await register(app, 'bia@empresa.com')

    await app.inject({
      method: 'PUT',
      url: '/character-favorites/1',
      headers: { authorization: `Bearer ${ana.accessToken}` },
      payload: { seed: 'ana-slot', options },
    })
    await app.inject({
      method: 'PUT',
      url: '/character-favorites/1',
      headers: { authorization: `Bearer ${bia.accessToken}` },
      payload: { seed: 'bia-slot', options: otherOptions },
    })

    const listAna = await app.inject({
      method: 'GET',
      url: '/character-favorites',
      headers: { authorization: `Bearer ${ana.accessToken}` },
    })
    expect(listAna.json().favorites).toHaveLength(1)
    expect(listAna.json().favorites[0].seed).toBe('ana-slot')

    const removeAna = await app.inject({
      method: 'DELETE',
      url: '/character-favorites/1',
      headers: { authorization: `Bearer ${ana.accessToken}` },
    })
    expect(removeAna.statusCode).toBe(204)

    const listBia = await app.inject({
      method: 'GET',
      url: '/character-favorites',
      headers: { authorization: `Bearer ${bia.accessToken}` },
    })
    expect(listBia.json().favorites).toHaveLength(1)
    expect(listBia.json().favorites[0].seed).toBe('bia-slot')
    await app.close()
  })
})
