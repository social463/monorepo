/**
 * Áudio compartilhado numa sala do escritório: contrato do que toca e de onde
 * o cliente tira o id do vídeo.
 *
 * Nenhum byte de mídia trafega pelo servidor — o hub sincroniza só o `videoId`
 * e a posição, e cada cliente na sala roda o próprio player do YouTube (ver
 * `docs/superpowers/specs/2026-08-06-compartilhar-audio-sala-design.md`).
 */

/** Hosts que servem vídeo do YouTube, por igualdade EXATA (sem `www.`). */
const YOUTUBE_HOSTS = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com']

/** O id do YouTube tem 11 caracteres de `[A-Za-z0-9_-]`. */
const VIDEO_ID = /^[\w-]{11}$/

/** Caminhos que carregam o id no próprio path: /embed/ID, /shorts/ID, /live/ID, /v/ID. */
const PATH_ID = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/

/**
 * Onde mora o id num link do YouTube — `watch?v=`, `youtu.be/`, `/shorts/`,
 * `/live/`, `/embed/`, `/v/` — SEM julgar o formato do que achou.
 *
 * Existe separado de `parseYouTubeVideoId` porque `toVideoEmbedUrl` (o player
 * de aula) é deliberadamente tolerante: lá o link vem de um admin e um id
 * estranho vira um iframe que falha sozinho. Aqui o link vem pelo socket e
 * precisa de validação de verdade. A regra de host/path é a mesma nos dois.
 *
 * A comparação de host é por igualdade, nunca por sufixo: `youtube.com.evil.com`
 * termina em `youtube.com` e não pode passar (mesmo cuidado de
 * `assertEmbedUrlAllowed`, na api).
 */
export function extractYouTubeId(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')

  if (host === 'youtu.be') {
    return parsed.pathname.replace(/^\//, '') || null
  }
  if (!YOUTUBE_HOSTS.includes(host)) return null

  return parsed.searchParams.get('v') || parsed.pathname.match(PATH_ID)?.[1] || null
}

/**
 * Id do vídeo a partir de um link do YouTube ou do próprio id colado cru —
 * `null` para qualquer outra coisa. É o que o hub aceita: nada que chega pelo
 * socket entra sem passar por aqui.
 */
export function parseYouTubeVideoId(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (VIDEO_ID.test(value)) return value

  const candidate = extractYouTubeId(value)
  return candidate && VIDEO_ID.test(candidate) ? candidate : null
}

/**
 * Prefixos de playlist que o embed do YouTube realmente toca.
 *
 * Fora daqui ficam justamente os que mais aparecem em link copiado do
 * navegador: `RD…` (as "Mixes"/rádio que o YouTube gera sozinho, e que o embed
 * não carrega), `WL` (Assistir mais tarde) e `LL` (curtidos) — as duas últimas
 * são privadas da conta de quem copiou e nunca abririam para a sala.
 * Link com uma dessas cai para o vídeo sozinho, que é o que a pessoa está
 * ouvindo de fato.
 */
const EMBEDDABLE_PLAYLIST_PREFIXES = ['PL', 'OLAK5uy_', 'UU', 'FL', 'RDCLAK5uy_']

/** O id de playlist é `[A-Za-z0-9_-]`, mais longo que o de vídeo. */
const PLAYLIST_ID = /^[\w-]{12,60}$/

/**
 * Id da playlist de um link do YouTube, quando ela puder ser embutida.
 * Devolve `null` para link sem `list=`, para mix/rádio e para as listas
 * privadas da conta — nesses casos o chamador toca só o vídeo.
 */
export function parseYouTubePlaylistId(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  // Id cru — é o que o cliente manda ao hub, que revalida antes de guardar.
  if (PLAYLIST_ID.test(value)) return embeddablePlaylist(value)

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'youtu.be' && !YOUTUBE_HOSTS.includes(host)) return null

  const list = parsed.searchParams.get('list')
  if (!list || !PLAYLIST_ID.test(list)) return null
  return embeddablePlaylist(list)
}

function embeddablePlaylist(list: string): string | null {
  // `RDCLAK5uy_` (playlists curadas) passa; o `RD` genérico do mix, não.
  if (list.startsWith('RD') && !list.startsWith('RDCLAK5uy_')) return null
  return EMBEDDABLE_PLAYLIST_PREFIXES.some((prefix) => list.startsWith(prefix)) ? list : null
}

/** Anti-spam de "iniciar áudio", por pessoa — mesmo papel do KNOCK_COOLDOWN_MS. */
export const ROOM_AUDIO_START_COOLDOWN_MS = 3000

/**
 * O que está tocando numa sala. `positionSeconds` é o ponto do vídeo NO
 * INSTANTE EM QUE O SERVIDOR ENVIOU — o cliente soma a própria espera desde a
 * recepção. Mandar um epoch em vez disso exigiria que o relógio das máquinas
 * batesse com o do servidor, o que não se pode supor.
 */
export interface OfficeRoomAudioTrack {
  /** Vídeo tocando AGORA — numa playlist, o item da vez. */
  videoId: string
  /**
   * Playlist de onde o item saiu, ou `null` num vídeo sozinho.
   *
   * Cada cliente carrega a playlist no próprio player, mas quem avança é
   * SEMPRE quem iniciou: o player dele troca de faixa, avisa o hub
   * (`set-room-audio-item`) e a sala pula junto. Deixar cada player avançar
   * por conta própria colocaria as pessoas em músicas diferentes já na
   * segunda faixa.
   */
  playlistId: string | null
  /** Posição do item dentro da playlist; `0` no vídeo sozinho. */
  playlistIndex: number
  startedByUserId: string
  startedByName: string
  positionSeconds: number
  /**
   * Faixa pausada por quem a iniciou. Pausa é da SALA: enquanto `true`,
   * `positionSeconds` não avança e quem chega nasce parado no mesmo ponto.
   * Ouvinte não pausa nada — quem não iniciou só mexe no próprio volume.
   */
  paused: boolean
}

/** Faixa de uma sala específica — formato do `welcome`, que traz todas as salas. */
export interface OfficeRoomAudioEntry extends OfficeRoomAudioTrack {
  roomId: string
}

/** Por que o servidor recusou o `start-room-audio`. */
export type OfficeRoomAudioDeniedReason =
  /** A sala já tem áudio tocando — um por sala. */
  | 'busy'
  /** Quem pediu não está dentro de uma sala de reunião. */
  | 'not-in-room'
  /** Convidado ouve, mas não inicia. */
  | 'guest'
  | 'cooldown'
  | 'invalid'
