import { describe, it, expect, vi } from 'vitest'
import { gifsEnabled, searchGifs, GifError } from './giphy-client'

const giphyPayload = {
  data: [
    {
      id: 'abc',
      title: 'happy cat',
      images: {
        original: { url: 'https://media1.giphy.com/media/abc/giphy.gif?cid=1', width: '320', height: '240' },
        fixed_width: { url: 'https://media1.giphy.com/media/abc/200w.gif?cid=1', width: '200', height: '150' },
      },
    },
  ],
  pagination: { total_count: 100, count: 24, offset: 0 },
}

function fakeFetch(payload: unknown, ok = true) {
  return vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => payload })) as unknown as typeof fetch
}

describe('giphy-client', () => {
  it('gifsEnabled reflete a presença da chave', () => {
    expect(gifsEnabled({})).toBe(false)
    expect(gifsEnabled({ GIPHY_API_KEY: 'k' })).toBe(true)
  })

  it('mapeia a resposta do Giphy para GifSearchResponse', async () => {
    const fetchImpl = fakeFetch(giphyPayload)
    const res = await searchGifs({ query: 'cat', env: { GIPHY_API_KEY: 'k' }, fetchImpl })
    expect(res.next).toBe('24') // offset(0) + count(24) < total(100)
    expect(res.results).toEqual([
      {
        id: 'abc',
        url: 'https://media1.giphy.com/media/abc/giphy.gif?cid=1',
        previewUrl: 'https://media1.giphy.com/media/abc/200w.gif?cid=1',
        width: 320,
        height: 240,
        description: 'happy cat',
      },
    ])
  })

  it('next é null quando não há mais páginas', async () => {
    const fetchImpl = fakeFetch({ data: [], pagination: { total_count: 10, count: 10, offset: 0 } })
    const res = await searchGifs({ query: 'x', env: { GIPHY_API_KEY: 'k' }, fetchImpl })
    expect(res.next).toBeNull()
  })

  it('lança GifError 503 sem chave configurada', async () => {
    await expect(searchGifs({ query: 'cat', env: {}, fetchImpl: fakeFetch(giphyPayload) })).rejects.toMatchObject({
      status: 503,
    })
  })

  it('usa o endpoint trending quando a query é vazia', async () => {
    const fetchImpl = fakeFetch({ data: [], pagination: { total_count: 0, count: 0, offset: 0 } })
    await searchGifs({ query: '', env: { GIPHY_API_KEY: 'k' }, fetchImpl })
    const calledUrl = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string
    expect(calledUrl).toContain('/gifs/trending')
  })
})
