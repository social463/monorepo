import type { GifResult, GifSearchResponse } from '@legends/shared'

export class GifError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'GifError'
  }
}

/** Há chave do Giphy configurada? (controla a exibição do recurso) */
export function gifsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GIPHY_API_KEY)
}

interface GiphyImage {
  url: string
  width: string
  height: string
}
interface GiphyItem {
  id: string
  title?: string
  images: {
    original: GiphyImage
    fixed_width?: GiphyImage
  }
}
interface GiphyResponse {
  data: GiphyItem[]
  pagination?: { total_count: number; count: number; offset: number }
}

function mapItem(item: GiphyItem): GifResult | null {
  const original = item.images?.original
  if (!original?.url) return null
  const preview = item.images.fixed_width ?? original
  return {
    id: item.id,
    url: original.url,
    previewUrl: preview.url,
    width: Number.parseInt(original.width, 10) || 0,
    height: Number.parseInt(original.height, 10) || 0,
    description: item.title?.trim() || 'GIF',
  }
}

/** Próximo offset para paginação, ou null quando não há mais resultados. */
function nextOffset(p?: { total_count: number; count: number; offset: number }): string | null {
  if (!p) return null
  const next = p.offset + p.count
  return next < p.total_count ? String(next) : null
}

export async function searchGifs(input: {
  query: string
  pos?: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}): Promise<GifSearchResponse> {
  const env = input.env ?? process.env
  const key = env.GIPHY_API_KEY
  if (!key) throw new GifError('Busca de GIFs não está configurada.', 503)
  const doFetch = input.fetchImpl ?? fetch

  // Sem termo de busca, traz os GIFs em alta (trending).
  const endpoint = input.query.trim() ? 'search' : 'trending'
  const params = new URLSearchParams({
    api_key: key,
    limit: '24',
    rating: 'g', // apropriado para ambiente de trabalho
    bundle: 'messaging_non_clips',
  })
  if (input.query.trim()) params.set('q', input.query.trim())
  if (input.pos) params.set('offset', input.pos)

  const res = await doFetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params.toString()}`)
  if (!res.ok) throw new GifError('Falha ao buscar GIFs no Giphy.', 502)
  const data = (await res.json()) as GiphyResponse
  return {
    results: data.data.map(mapItem).filter((r): r is GifResult => r !== null),
    next: nextOffset(data.pagination),
  }
}
