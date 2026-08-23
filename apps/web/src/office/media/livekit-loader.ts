import type * as LiveKit from 'livekit-client'

/**
 * Carrega o livekit-client sob demanda. O provider de sessão do escritório
 * vive no bundle principal, mas o LiveKit (~110KB gzip) não pode ir junto —
 * só é baixado quando alguma sala realmente vai conectar.
 */
let cached: typeof LiveKit | null = null

export async function loadLiveKit(): Promise<typeof LiveKit> {
  if (!cached) cached = await import('livekit-client')
  return cached
}

/** Acesso síncrono para callbacks que não podem aguardar (ex.: syncRemotes). */
export function getLiveKit(): typeof LiveKit | null {
  return cached
}
