/**
 * Sufixo de host de CDN do Giphy aceito ao gravar/exibir um GIF.
 * Cobre media0-4.giphy.com, media.giphy.com, i.giphy.com, etc.
 */
export const GIPHY_HOST_SUFFIX = '.giphy.com'

/** O host (sem porta) pertence ao CDN do Giphy? */
export function isGiphyHost(hostname: string): boolean {
  return hostname === 'giphy.com' || hostname.endsWith(GIPHY_HOST_SUFFIX)
}

/** Resultado de busca devolvido pelo picker. */
export interface GifResult {
  id: string
  url: string // URL do .gif (exibir/gravar)
  previewUrl: string // still/preview leve para a grade do picker
  width: number
  height: number
  description: string // título do GIF no Giphy (alt)
}

/** GIF anexado, como persistido/serializado. */
export interface AttachedGif {
  url: string
  width: number
  height: number
}

export interface GifSearchResponse {
  results: GifResult[]
  next: string | null // cursor de paginação (offset do Giphy)
}
