import type * as TrackProcessors from '@livekit/track-processors'

/**
 * Carrega o @livekit/track-processors sob demanda. O pacote puxa o MediaPipe
 * (WASM pesado) — só é baixado quando alguém aplica um efeito de fundo pela
 * primeira vez; nada dele entra no bundle principal.
 */
let cached: typeof TrackProcessors | null = null

export async function loadTrackProcessors(): Promise<typeof TrackProcessors> {
  if (!cached) cached = await import('@livekit/track-processors')
  return cached
}
