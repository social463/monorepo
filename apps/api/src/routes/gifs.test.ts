import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildApp } from '../app'

// Mesmo padrão de auth de review.test.ts: registrar devolve accessToken.
async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Gi', email: 'gi@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  return { app, token }
}
function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('rotas de GIF', () => {
  const original = process.env.GIPHY_API_KEY
  afterEach(() => {
    if (original === undefined) delete process.env.GIPHY_API_KEY
    else process.env.GIPHY_API_KEY = original
    vi.restoreAllMocks()
  })

  it('/gifs/config reflete a flag', async () => {
    process.env.GIPHY_API_KEY = 'k'
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/gifs/config' })
    expect(res.json()).toEqual({ enabled: true })
    await app.close()
  })

  it('/gifs/search devolve resultados (auth)', async () => {
    process.env.GIPHY_API_KEY = 'k'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: '1',
            title: 'oi',
            images: {
              original: { url: 'https://media.giphy.com/a.gif', width: '10', height: '20' },
              fixed_width: { url: 'https://media.giphy.com/a-w.gif', width: '5', height: '10' },
            },
          },
        ],
        pagination: { total_count: 100, count: 24, offset: 0 },
      }),
    } as Response)
    const { app, token } = await setup()
    const res = await app.inject({ method: 'GET', url: '/gifs/search?q=oi', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    expect(res.json().results[0].url).toBe('https://media.giphy.com/a.gif')
    expect(res.json().next).toBe('24')
    await app.close()
  })

  it('/gifs/search sem chave responde 503', async () => {
    delete process.env.GIPHY_API_KEY
    const { app, token } = await setup()
    const res = await app.inject({ method: 'GET', url: '/gifs/search?q=oi', headers: auth(token) })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('/gifs/search sem auth responde 401', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/gifs/search?q=oi' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
