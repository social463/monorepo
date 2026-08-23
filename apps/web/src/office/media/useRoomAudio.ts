import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  parseYouTubePlaylistId,
  parseYouTubeVideoId,
  type OfficeRoomAudioDeniedReason,
  type OfficeRoomAudioTrack,
} from '@legends/shared'
import type { OfficeBridge } from '../OfficeBridge'

/** O que a sala está tocando agora, na visão de quem ouve. */
export interface RoomAudioTrack extends OfficeRoomAudioTrack {
  /** Você iniciou esta faixa — só quem iniciou pausa e para. */
  isMine: boolean
  /**
   * Identidade desta faixa nesta sessão: muda a cada `room-audio-changed` que
   * traz uma faixa nova (inclusive o MESMO vídeo em outra sala, ou reiniciado
   * do zero). É por ela que o player sabe quando recriar e ressincronizar —
   * olhar só o `videoId` deixaria o player preso na linha do tempo anterior.
   */
  key: string
  /**
   * Instante local (ms) equivalente ao segundo zero do vídeo. Enquanto
   * pausada, é o instante em que a pausa começou. O player calcula a posição
   * a partir daqui, então esperar o iframe carregar não atrasa ninguém.
   */
  originMs: number
}

export interface RoomAudioState {
  /** Faixa da sala em que você está, ou `null` quando não há áudio nenhum. */
  track: RoomAudioTrack | null
  isMine: boolean
  /** Dá pra iniciar agora: dentro de sala, identificado, conectado, não convidado e nada tocando. */
  canStart: boolean
  /** Valida o link e pede o início ao servidor. */
  start: (rawUrl: string) => void
  /** Encerra a SUA faixa. */
  stop: () => void
  /** Pausa/retoma a SUA faixa, para a sala inteira. No-op para quem só ouve. */
  setPaused: (paused: boolean) => void
  /**
   * Avisa que o SEU player passou para outro item da playlist — é o que leva a
   * sala junto. No-op para quem só ouve e fora de playlist.
   */
  advanceItem: (playlistIndex: number, videoId: string) => void
  /** Última recusa (do servidor ou do próprio link), em português. */
  error: string | null
  clearError: () => void
}

const DENIED_MESSAGES: Record<OfficeRoomAudioDeniedReason, string> = {
  busy: 'Esta sala já tem um áudio tocando.',
  'not-in-room': 'Entre numa sala de reunião para compartilhar áudio.',
  guest: 'Convidado pode ouvir, mas não iniciar um áudio.',
  cooldown: 'Espere alguns segundos antes de tocar outro áudio.',
  invalid: 'Cole um link de vídeo do YouTube.',
}

/** Faixa como chegou do servidor, com o instante local da recepção. */
interface StoredTrack {
  track: OfficeRoomAudioTrack
  receivedAt: number
  /**
   * Identidade da faixa. Nasce aqui, e não no render, porque pausar e retomar
   * são a MESMA faixa: se a identidade mudasse a cada mensagem, o player seria
   * recriado a cada pausa e o vídeo recarregaria do zero.
   */
  key: string
}

/** Mesma faixa continuando (pausa, retomada) ou uma faixa nova de verdade? */
function sameTrack(previous: StoredTrack | undefined, next: OfficeRoomAudioTrack): previous is StoredTrack {
  return (
    previous !== undefined &&
    previous.track.startedByUserId === next.startedByUserId &&
    // Numa playlist, virar de faixa continua sendo a MESMA sessão de áudio:
    // quem manda na identidade é a playlist, não o vídeo do momento.
    (next.playlistId !== null
      ? previous.track.playlistId === next.playlistId
      : previous.track.videoId === next.videoId)
  )
}

function storeTrack(previous: StoredTrack | undefined, track: OfficeRoomAudioTrack, receivedAt: number): StoredTrack {
  return {
    track,
    receivedAt,
    key: sameTrack(previous, track)
      ? previous.key
      : `${track.playlistId ?? track.videoId}:${track.startedByUserId}:${receivedAt}`,
  }
}

/**
 * Áudio compartilhado da sala: o servidor é a única fonte, e o estado chega
 * para o escritório inteiro (o mesmo desenho de `useRoomLock`) para que ANDAR
 * até uma sala que já está tocando não dependa de nenhum evento novo.
 *
 * `positionSeconds` vem calculado no instante do envio; aqui somamos o tempo
 * que passou DESDE A RECEPÇÃO, medido no relógio local. Como só a diferença
 * entra na conta, um relógio de máquina desajustado não desalinha ninguém.
 */
export function useRoomAudio(
  bridge: OfficeBridge,
  roomId: string | null,
  youId: string | null,
  connected: boolean,
  isGuest = false,
): RoomAudioState {
  const [tracksByRoom, setTracksByRoom] = useState<Record<string, StoredTrack>>({})
  const [error, setError] = useState<string | null>(null)
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId

  // A recusa é sobre a sala em que você estava — trocou de sala, some.
  useEffect(() => {
    setError(null)
  }, [roomId])

  useEffect(
    () =>
      bridge.onServerMessage((message) => {
        if (message.type === 'welcome') {
          const entries = message.roomAudio ?? []
          const receivedAt = Date.now()
          setTracksByRoom((current) =>
            Object.fromEntries(
              entries.map(({ roomId: id, ...track }) => [id, storeTrack(current[id], track, receivedAt)]),
            ),
          )
          return
        }
        if (message.type === 'room-audio-changed') {
          setTracksByRoom((current) => {
            if (!message.track) {
              if (!(message.roomId in current)) return current
              const { [message.roomId]: _removed, ...rest } = current
              return rest
            }
            const stored = storeTrack(current[message.roomId], message.track, Date.now())
            return { ...current, [message.roomId]: stored }
          })
          return
        }
        if (message.type === 'room-audio-denied') {
          setError(DENIED_MESSAGES[message.reason])
        }
      }),
    [bridge],
  )

  const stored = roomId === null ? undefined : tracksByRoom[roomId]

  // `originMs` é o instante local do segundo zero do vídeo — a posição sai de
  // uma subtração no momento em que for usada, e não de um número congelado
  // aqui. É o que faz o player entrar no ponto certo mesmo quando o iframe
  // demora a carregar, e o que deixa o watchdog saber onde a sala está.
  const track = useMemo<RoomAudioTrack | null>(() => {
    if (!stored) return null
    return {
      ...stored.track,
      originMs: stored.receivedAt - stored.track.positionSeconds * 1000,
      key: stored.key,
      isMine: stored.track.startedByUserId === youId,
    }
  }, [stored, youId])

  const canStart = roomId !== null && youId !== null && connected && !isGuest && !stored

  const start = useCallback(
    (rawUrl: string) => {
      const videoId = parseYouTubeVideoId(rawUrl)
      if (!videoId) {
        setError(DENIED_MESSAGES.invalid)
        return
      }
      setError(null)
      // Playlist é opcional: link de mix ou lista privada volta `null` e a
      // sala ouve só o vídeo. O hub valida o id de novo.
      bridge.emitClientMessage({ type: 'start-room-audio', videoId, playlistId: parseYouTubePlaylistId(rawUrl) })
    },
    [bridge],
  )

  const stop = useCallback(() => {
    bridge.emitClientMessage({ type: 'stop-room-audio' })
  }, [bridge])

  // O servidor confere o dono de novo; aqui é só para o ouvinte nem gastar a
  // mensagem — o botão nem aparece para ele.
  const isMine = track?.isMine ?? false
  const setPaused = useCallback(
    (paused: boolean) => {
      if (!isMine) return
      bridge.emitClientMessage({ type: 'set-room-audio-paused', paused })
    },
    [bridge, isMine],
  )

  const advanceItem = useCallback(
    (playlistIndex: number, videoId: string) => {
      if (!isMine) return
      bridge.emitClientMessage({ type: 'set-room-audio-item', playlistIndex, videoId })
    },
    [bridge, isMine],
  )

  const clearError = useCallback(() => setError(null), [])

  return { track, isMine, canStart, start, stop, setPaused, advanceItem, error, clearError }
}
