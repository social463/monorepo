import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { loadYouTubeApi, type YouTubePlayer } from './youtube-iframe-loader'
import { useRoomAudioVolumePreference } from './roomAudioVolumePreference'
import type { RoomAudioTrack } from './useRoomAudio'

const COLLAPSED_KEY = 'office:room-audio-collapsed'
/** Margem para o player sair de UNSTARTED sozinho antes de pedirmos um clique. */
const AUTOPLAY_GRACE_MS = 1200

/** Códigos da IFrame API que o ouvinte precisa entender. */
const ERROR_MESSAGES: Record<number, string> = {
  2: 'O link do vídeo é inválido.',
  5: 'Este vídeo não pode ser tocado aqui.',
  100: 'O vídeo foi removido ou é privado.',
  101: 'Este vídeo não permite reprodução fora do YouTube.',
  150: 'Este vídeo não permite reprodução fora do YouTube.',
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed))
  } catch {
    // Preferência visual best-effort.
  }
}

/**
 * Mini player do áudio compartilhado da sala. Vive no provider da sessão
 * (junto dos `RemoteAudio`), para continuar tocando com o escritório
 * minimizado e nunca duplicar.
 *
 * Fica VISÍVEL de propósito: o ToS do embed do YouTube não admite player
 * escondido, e a miniatura ainda mostra o que está tocando. Recolhido, some a
 * imagem e ficam título, quem iniciou e volume.
 *
 * O volume é local de quem ouve (`useRoomAudioVolumePreference`) — mexer aqui
 * não muda o som de mais ninguém.
 */
export function RoomAudioPlayer({
  track,
  onStop,
  onSetPaused,
  onAdvanceItem,
  outsideOffice = false,
}: {
  track: RoomAudioTrack
  onStop: () => void
  /** Pausar/retomar para a sala — só chamado por quem iniciou a faixa. */
  onSetPaused: (paused: boolean) => void
  /** Playlist virou de item no player de quem iniciou — leva a sala junto. */
  onAdvanceItem: (playlistIndex: number, videoId: string) => void
  /**
   * Fora da página do escritório, onde o `OfficePipWindow` ocupa esta mesma
   * quina inferior direita (e por cima, em `z-50`). Quem decide é o provider,
   * que conhece a rota — o player continua sem saber de roteador.
   */
  outsideOffice?: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [title, setTitle] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsGesture, setNeedsGesture] = useState(false)
  const volume = useRoomAudioVolumePreference()

  // Refs para o efeito não recriar o player a cada render.
  const trackRef = useRef(track)
  trackRef.current = track
  const onStopRef = useRef(onStop)
  onStopRef.current = onStop
  const onAdvanceItemRef = useRef(onAdvanceItem)
  onAdvanceItemRef.current = onAdvanceItem
  const volumeRef = useRef(volume.effectiveVolume)
  volumeRef.current = volume.effectiveVolume

  /**
   * Onde a SALA está agora, em segundos. Sai de `originMs` (o instante local
   * do segundo zero), então esperar o iframe carregar não deixa ninguém para
   * trás — e é a mesma conta que devolve o ouvinte ao lugar certo depois de
   * uma pausa que ele não deveria ter conseguido dar.
   */
  const roomPosition = useCallback(() => {
    const current = trackRef.current
    if (current.paused) return current.positionSeconds
    return Math.max(0, (Date.now() - current.originMs) / 1000)
  }, [])

  useEffect(() => {
    let cancelled = false
    let gestureTimer: ReturnType<typeof setTimeout> | null = null
    setTitle(null)
    setError(null)
    setNeedsGesture(false)

    void loadYouTubeApi()
      .then((api) => {
        if (cancelled || !frameRef.current) return
        playerRef.current = new api.Player(frameRef.current, {
          videoId: track.videoId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            // Numa playlist, o player carrega a lista inteira e entra no item
            // em que a sala está. Quem avança é só quem iniciou (ver abaixo).
            ...(track.playlistId
              ? { list: track.playlistId, listType: 'playlist', index: track.playlistIndex }
              : {}),
          },
          events: {
            onReady: ({ target }: { target: YouTubePlayer }) => {
              target.setVolume(volumeRef.current)
              target.seekTo(roomPosition(), true)
              if (trackRef.current.paused) target.pauseVideo()
              else target.playVideo()
              setTitle(target.getVideoData?.()?.title ?? null)
              // Sem gesto recente, o navegador engole o play e o player fica
              // parado em UNSTARTED — aí pedimos o clique explicitamente.
              gestureTimer = setTimeout(() => {
                if (cancelled || trackRef.current.paused) return
                if (target.getPlayerState() !== api.PlayerState.PLAYING) setNeedsGesture(true)
              }, AUTOPLAY_GRACE_MS)
            },
            onStateChange: ({ data, target }: { data: number; target: YouTubePlayer }) => {
              if (data === api.PlayerState.PLAYING) {
                setNeedsGesture(false)
                setTitle(target.getVideoData?.()?.title ?? null)
                // Playlist virou de faixa no player de quem iniciou: o hub
                // precisa saber para levar a sala junto. Ouvinte não reporta
                // nada — o player dele é movido por `playVideoAt`.
                const current = trackRef.current
                if (current.isMine && current.playlistId) {
                  const index = target.getPlaylistIndex?.() ?? -1
                  const videoId = target.getVideoData?.()?.video_id
                  if (index >= 0 && videoId && (index !== current.playlistIndex || videoId !== current.videoId)) {
                    onAdvanceItemRef.current(index, videoId)
                  }
                }
                return
              }
              // O fim do vídeo é sabido só por quem toca; quem iniciou avisa o
              // servidor, e o servidor encerra a faixa para a sala inteira.
              // Numa playlist, porém, o fim de um item é só a virada para o
              // próximo — quem encerra é o fim do ÚLTIMO.
              if (data === api.PlayerState.ENDED && trackRef.current.isMine) {
                const playlist = trackRef.current.playlistId ? (target.getPlaylist?.() ?? null) : null
                const isLastItem = !playlist || (target.getPlaylistIndex?.() ?? 0) >= playlist.length - 1
                if (isLastItem) onStopRef.current()
                return
              }
              // Pausa é da sala e só de quem iniciou. Se o player parou sem o
              // servidor ter mandado (clique no iframe, tecla de mídia do
              // sistema, gesto do celular), desfazemos: volta a tocar no ponto
              // em que a sala está, não naquele em que ele parou.
              if (data === api.PlayerState.PAUSED && !trackRef.current.paused) {
                target.seekTo(roomPosition(), true)
                target.playVideo()
              }
            },
            onError: ({ data }: { data: number }) => {
              setError(ERROR_MESSAGES[data] ?? 'Não foi possível tocar este vídeo.')
              // Vídeo que o dono bloqueou (101/150), removeu (100) ou que nem
              // existe não vai passar a tocar sozinho: sem encerrar aqui, a
              // sala fica com um player mudo até quem iniciou reparar e clicar
              // em parar — e ninguém mais consegue tocar nada (`busy`).
              // Numa playlist não encerramos nada: o item seguinte ainda pode
              // tocar, e quem avança é o player de quem iniciou.
              if (trackRef.current.isMine && !trackRef.current.playlistId) onStopRef.current()
            },
          },
        })
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar o player do YouTube.')
      })

    return () => {
      cancelled = true
      if (gestureTimer) clearTimeout(gestureTimer)
      playerRef.current?.destroy()
      playerRef.current = null
    }
    // `key` (e não `videoId`) porque a MESMA música em outra sala é outra
    // faixa, e o player precisa nascer de novo no ponto daquela sala.
  }, [track.key, roomPosition])

  useEffect(() => {
    playerRef.current?.setVolume(volume.effectiveVolume)
  }, [volume.effectiveVolume])

  // Item da playlist mandado pelo servidor. Vale para QUEM OUVE: o player de
  // quem iniciou já virou sozinho (e foi ele quem avisou), então mexer nele de
  // novo cortaria o começo da música que acabou de entrar.
  useEffect(() => {
    const player = playerRef.current
    if (!player || !track.playlistId || track.isMine) return
    if ((player.getPlaylistIndex?.() ?? -1) === track.playlistIndex) return
    player.playVideoAt?.(track.playlistIndex)
  }, [track.playlistIndex, track.playlistId, track.isMine])

  // Pausa/retomada vinda do servidor. Não recria o player — recriar
  // recarregaria o vídeo inteiro a cada pausa. Ao retomar, ressincroniza:
  // o tempo que a faixa ficou parada não pode virar atraso permanente.
  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    if (track.paused) {
      player.pauseVideo()
      return
    }
    player.seekTo(roomPosition(), true)
    player.playVideo()
  }, [track.paused, track.key, roomPosition])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      writeCollapsed(!current)
      return !current
    })
  }, [])

  return (
    // No escritório, `bottom-28` livra a `MediaBar`. Fora dele, quem manda na
    // quina é o escritório em miniatura (`bottom-4`, até ~266px de altura,
    // `z-50`): subir acima dele evita que o player fique escondido atrás.
    <div
      className={`fixed right-4 z-40 w-60 rounded-2xl bg-surface-container-high/95 p-3 shadow-lg backdrop-blur ${
        outsideOffice ? 'bottom-[17.5rem]' : 'bottom-28'
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon name="music_note" className="text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-label text-label-md text-on-surface">{title ?? 'Áudio da sala'}</p>
          <p className="truncate font-body text-body-sm text-on-surface-variant">
            {track.startedByName} {track.paused ? 'pausou o áudio' : 'está tocando'}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expandir player' : 'Recolher player'}
          className="rounded-lg p-1 text-on-surface-variant transition-all hover:bg-surface-container-highest/40 hover:text-primary"
        >
          <Icon name={collapsed ? 'expand_less' : 'expand_more'} />
        </button>
        {/* Pausar e parar são de quem iniciou. Quem só ouve mexe no volume. */}
        {track.isMine && (
          <button
            type="button"
            onClick={() => onSetPaused(!track.paused)}
            aria-label={track.paused ? 'Retomar áudio' : 'Pausar áudio'}
            className="rounded-lg p-1 text-on-surface-variant transition-all hover:bg-surface-container-highest/40 hover:text-primary"
          >
            <Icon name={track.paused ? 'play_arrow' : 'pause'} />
          </button>
        )}
        {track.isMine && (
          <button
            type="button"
            onClick={onStop}
            aria-label="Parar áudio"
            className="rounded-lg p-1 text-error transition-all hover:bg-error-container/40"
          >
            <Icon name="stop_circle" />
          </button>
        )}
      </div>

      {/* Recolher esconde a imagem, nunca desmonta o player — desmontar cortaria o áudio. */}
      <div
        data-testid="room-audio-frame"
        data-collapsed={collapsed}
        className={collapsed ? 'sr-only' : 'mt-2 overflow-hidden rounded-lg'}
      >
        {/* `pointer-events-none` é o que impede o ouvinte de pausar clicando no
            vídeo: o controle da faixa é de quem iniciou. O watchdog em
            `onStateChange` cobre o resto (tecla de mídia do sistema). */}
        <div ref={frameRef} className="pointer-events-none aspect-video w-full select-none" />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => volume.setMuted(!volume.muted)}
          aria-label={volume.muted ? 'Reativar áudio da sala' : 'Silenciar áudio da sala'}
          className="rounded-lg p-1 text-on-surface-variant transition-all hover:bg-surface-container-highest/40 hover:text-primary"
        >
          <Icon name={volume.muted ? 'volume_off' : 'volume_up'} />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={volume.volume}
          onChange={(event) => volume.setVolume(Number(event.target.value))}
          aria-label="Volume do áudio da sala"
          className="h-1 flex-1 cursor-pointer accent-primary-container"
        />
      </div>

      {needsGesture && (
        <button
          type="button"
          onClick={() => {
            playerRef.current?.playVideo()
            setNeedsGesture(false)
          }}
          aria-label="Clique para ouvir"
          className="mt-2 w-full rounded-lg bg-primary-container/30 px-2 py-1 font-label text-label-sm text-primary"
        >
          Clique para ouvir
        </button>
      )}

      {error && <p className="mt-2 font-body text-body-sm text-error">{error}</p>}
    </div>
  )
}
