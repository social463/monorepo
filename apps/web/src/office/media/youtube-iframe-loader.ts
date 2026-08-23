/** O pedaço da IFrame API do YouTube que o player da sala usa. */
export interface YouTubePlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  setVolume(volume: number): void
  mute(): void
  unMute(): void
  getPlayerState(): number
  getVideoData?(): { title?: string; video_id?: string }
  /** Índice do item da playlist tocando agora; `-1` fora de playlist. */
  getPlaylistIndex?(): number
  /** Ids da playlist carregada, na ordem. */
  getPlaylist?(): string[] | null
  /** Pula para um item da playlist (usado pelos ouvintes, que não avançam sozinhos). */
  playVideoAt?(index: number): void
  destroy(): void
}

export interface YouTubeApi {
  Player: new (element: HTMLElement, options: unknown) => YouTubePlayer
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; UNSTARTED: number }
}

declare global {
  interface Window {
    YT?: YouTubeApi
    onYouTubeIframeAPIReady?: () => void
  }
}

const SCRIPT_SRC = 'https://www.youtube.com/iframe_api'

let pending: Promise<YouTubeApi> | null = null

/**
 * Carrega a IFrame API do YouTube sob demanda — só quando alguma sala vai
 * tocar de verdade. Mesmo motivo do `livekit-loader`: o provider da sessão
 * vive no bundle principal e não pode arrastar um script de terceiro junto.
 *
 * A API avisa que está pronta por uma global (`onYouTubeIframeAPIReady`), não
 * pelo `onload` do script — por isso a promessa fica pendurada nela.
 */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (pending) return pending

  pending = new Promise<YouTubeApi>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.()
      if (window.YT?.Player) resolve(window.YT)
      else reject(new Error('IFrame API do YouTube carregou sem Player'))
    }

    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onerror = () => {
      pending = null
      reject(new Error('Não foi possível carregar o player do YouTube'))
    }
    document.head.appendChild(script)
  })

  return pending
}

/** Só para testes: esquece a carga em andamento. */
export function resetYouTubeApiLoaderForTests(): void {
  pending = null
}
