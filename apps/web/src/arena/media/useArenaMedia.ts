import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LocalAudioTrack,
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteVideoTrack,
  Room,
} from 'livekit-client'
import { isWithinArenaVoiceRange, type ArenaMediaTokenResponse } from '@legends/shared'
import { getLiveKit, loadLiveKit } from '../../office/media/livekit-loader'
import { readDevicePreference, writeDevicePreference } from '../../office/media/devicePreferences'
import { apiFetch } from '../../lib/api'
import type { ArenaPresenceInfo } from '../ArenaScene'

const MAX_RETRY_MS = 15000
/** Com que frequência a assinatura por distância é reavaliada. */
const PROXIMITY_INTERVAL_MS = 400

export type ArenaMediaStatus = 'off' | 'connecting' | 'connected' | 'error'

export interface ArenaRemoteMedia {
  userId: string
  name: string
  audioTrack: RemoteAudioTrack | null
  cameraTrack: RemoteVideoTrack | null
  /** Mic publicado e não mutado — independente de estar falando agora. */
  micOpen: boolean
  /** Ativo no `ActiveSpeakersChanged` do LiveKit agora mesmo. */
  speaking: boolean
}

/** Mesmo motivo de `sameRemotes` no escritório: array novo a cada sync mata o React. */
function sameRemotes(a: readonly ArenaRemoteMedia[], b: readonly ArenaRemoteMedia[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (
      x.userId !== y.userId ||
      x.name !== y.name ||
      x.audioTrack !== y.audioTrack ||
      x.cameraTrack !== y.cameraTrack ||
      x.micOpen !== y.micOpen
    ) {
      return false
    }
  }
  return true
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

export interface ArenaMediaState {
  status: ArenaMediaStatus
  micEnabled: boolean
  micError: boolean
  cameraEnabled: boolean
  cameraError: boolean
  remotes: ArenaRemoteMedia[]
  localCameraTrack: LocalVideoTrack | null
  localSpeaking: boolean
  toggleMic(): Promise<void>
  toggleCamera(): Promise<void>
  audioInputDeviceId: string | null
  videoInputDeviceId: string | null
  setAudioInputDevice(deviceId: string | null): Promise<void>
  setVideoInputDevice(deviceId: string | null): Promise<void>
}

export interface ArenaMediaOptions {
  /** `null` = não conectar. O modo em campo, ou `ARENA_LOBBY_ID` no saguão. */
  arenaId: string | null
  /**
   * Em campo, a assinatura segue a DISTÂNCIA (o ganho espacial é aplicado por
   * `ArenaVoice`); no saguão não há posição, e todo mundo se ouve por igual.
   */
  spatial: boolean
  /** Posições em tiles, puxadas da cena (ver `ArenaScene.presence`). */
  readPresence?: () => ArenaPresenceInfo | null
}

/**
 * Sessão de voz e vídeo da arena.
 *
 * É primo do `useOfficeMedia`, não uma extensão dele, e de propósito: lá a
 * sala é resolvida pela ZONA do mapa a cada passo (com janela de estabilidade
 * para não flapar na porta), há alto-falante, tela compartilhada, trava de
 * sala e convidado. Aqui a sala é UMA por instância e só muda quando a pessoa
 * troca de modo — um evento explícito, não um tile pisado. Enfiar os dois no
 * mesmo hook custaria mais em condicionais do que o que se economizaria de
 * linha, num arquivo que já é o mais delicado do escritório.
 *
 * O que é reaproveitado de verdade são as peças: `livekit-loader`,
 * `devicePreferences`, `spatialAudio` (o grafo de ganho/pan) e o `RemoteAudio`.
 */
export function useArenaMedia({ arenaId, spatial, readPresence }: ArenaMediaOptions): ArenaMediaState {
  const [status, setStatus] = useState<ArenaMediaStatus>('off')
  // Sempre nasce MUTADO, em campo e no saguão. Entrar numa partida com o mic
  // aberto vaza a sala de quem está jogando em casa, e é o mesmo cuidado do
  // spawn do escritório — só que aqui vale sempre, porque toda entrada na
  // arena é um spawn.
  const [micEnabled, setMicEnabled] = useState(false)
  const [micError, setMicError] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [remotes, setRemotes] = useState<ArenaRemoteMedia[]>([])
  const [speakingIds, setSpeakingIds] = useState<ReadonlySet<string>>(new Set())
  const [localCameraTrack, setLocalCameraTrack] = useState<LocalVideoTrack | null>(null)
  const [audioInputDeviceId, setAudioInputDeviceIdState] = useState<string | null>(() =>
    readDevicePreference('audioInput'),
  )
  const [videoInputDeviceId, setVideoInputDeviceIdState] = useState<string | null>(() =>
    readDevicePreference('videoInput'),
  )
  const [youId, setYouId] = useState<string | null>(null)

  const roomRef = useRef<Room | null>(null)
  const micTrackRef = useRef<LocalAudioTrack | null>(null)
  const retryRef = useRef<{ attempts: number; timer: ReturnType<typeof setTimeout> | null }>({
    attempts: 0,
    timer: null,
  })
  /** Mesma guarda de geração do escritório: continuação superada não escreve estado. */
  const generationRef = useRef(0)
  const audioInputDeviceIdRef = useRef(audioInputDeviceId)
  audioInputDeviceIdRef.current = audioInputDeviceId
  const videoInputDeviceIdRef = useRef(videoInputDeviceId)
  videoInputDeviceIdRef.current = videoInputDeviceId
  const readPresenceRef = useRef(readPresence)
  readPresenceRef.current = readPresence
  const spatialRef = useRef(spatial)
  spatialRef.current = spatial

  const commitRemotes = useCallback((next: ArenaRemoteMedia[]) => {
    setRemotes((prev) => (sameRemotes(prev, next) ? prev : next))
  }, [])
  const commitSpeaking = useCallback((next: ReadonlySet<string>) => {
    setSpeakingIds((prev) => (sameIds(prev, next) ? prev : next))
  }, [])

  const syncRemotes = useCallback(() => {
    const room = roomRef.current
    const lk = getLiveKit()
    if (!room || !lk) {
      commitRemotes([])
      return
    }
    const next: ArenaRemoteMedia[] = []
    for (const participant of room.remoteParticipants.values()) {
      const media: ArenaRemoteMedia = {
        userId: participant.identity,
        name: participant.name ?? participant.identity,
        audioTrack: null,
        cameraTrack: null,
        micOpen: false,
        speaking: false,
      }
      for (const pub of participant.trackPublications.values()) {
        // Mic aberto/mudo é sinalização: vale mesmo sem a track assinada,
        // senão o indicador ficaria preso em "mudo" enquanto a distância não
        // assina o áudio.
        if (pub.source === lk.Track.Source.Microphone) media.micOpen = !pub.isMuted
        if (!pub.isSubscribed || !pub.track || pub.isMuted) continue
        if (pub.source === lk.Track.Source.Microphone) media.audioTrack = pub.track as RemoteAudioTrack
        else if (pub.source === lk.Track.Source.Camera) media.cameraTrack = pub.track as RemoteVideoTrack
      }
      next.push(media)
    }
    commitRemotes(next)
  }, [commitRemotes])

  /**
   * Em campo, assina só quem está ao alcance (raio de assinatura, maior que o
   * da voz — ver `arena-media.ts`); no saguão, assina todo mundo. Sem posição
   * ainda (entrando na arena), assina: melhor ouvir de mais do que estrear
   * mudo.
   */
  const applyProximity = useCallback(() => {
    const room = roomRef.current
    if (!room) return
    const presence = spatialRef.current ? (readPresenceRef.current?.() ?? null) : null
    for (const participant of room.remoteParticipants.values()) {
      let within = true
      if (presence?.you) {
        const outro = presence.outros.find((p) => p.userId === participant.identity)
        within = outro
          ? isWithinArenaVoiceRange(outro.x - presence.you.x, outro.y - presence.you.y)
          : false
      }
      for (const pub of participant.trackPublications.values()) {
        if (pub.isSubscribed !== within) pub.setSubscribed(within)
      }
    }
  }, [])

  const connectTo = useCallback(
    async (target: string) => {
      const gen = ++generationRef.current
      void roomRef.current?.disconnect()
      roomRef.current = null
      micTrackRef.current = null
      commitRemotes([])
      commitSpeaking(new Set())
      setLocalCameraTrack(null)
      setMicEnabled(false)
      setCameraEnabled(false)
      setStatus('connecting')
      let room: Room | null = null
      try {
        const { Room: LiveKitRoom, RoomEvent, Track, createLocalAudioTrack } = await loadLiveKit()
        if (generationRef.current !== gen) return
        const { token, url } = await apiFetch<ArenaMediaTokenResponse>('/arena/media-token', {
          method: 'POST',
          body: JSON.stringify({ arenaId: target }),
        })
        if (generationRef.current !== gen) return

        room = new LiveKitRoom()
        room
          .on(RoomEvent.ParticipantConnected, () => {
            applyProximity()
            syncRemotes()
          })
          .on(RoomEvent.ParticipantDisconnected, syncRemotes)
          .on(RoomEvent.TrackPublished, () => {
            applyProximity()
            syncRemotes()
          })
          .on(RoomEvent.TrackUnpublished, syncRemotes)
          .on(RoomEvent.TrackSubscribed, syncRemotes)
          .on(RoomEvent.TrackUnsubscribed, syncRemotes)
          // Desligar mic/câmera depois da primeira publicação MUTA a track em
          // vez de despublicá-la — sem estes dois, o balão de vídeo do outro
          // ficaria preso num quadro preto.
          .on(RoomEvent.TrackMuted, syncRemotes)
          .on(RoomEvent.TrackUnmuted, syncRemotes)
          .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
            commitSpeaking(new Set(speakers.map((p) => p.identity)))
          })
          // Mesma causa raiz do escritório (ver useOfficeMedia.ts): o LiveKit
          // reconecta sozinho no nível de rede sem refazer esta invocação de
          // `connectTo` — sem isto, `remotes` fica preso no estado de antes
          // da queda até algum evento de track não relacionado acontecer.
          .on(RoomEvent.Reconnected, () => {
            applyProximity()
            syncRemotes()
          })
          // A recuperação automática pode desistir de vez — sem isto, o hook
          // ficava em `status: 'connected'` para sempre, sem tentar de novo.
          // `roomRef.current === room` distingue de uma desconexão NOSSA
          // (troca de arena, teardown), que já trocou `roomRef.current`
          // antes deste evento tardio chegar.
          .on(RoomEvent.Disconnected, () => {
            if (roomRef.current !== room) return
            roomRef.current = null
            void connectTo(target)
          })
          .on(RoomEvent.LocalTrackPublished, (pub) => {
            if (pub.source === Track.Source.Camera) {
              setLocalCameraTrack((pub.track as LocalVideoTrack | undefined) ?? null)
            }
          })
          .on(RoomEvent.LocalTrackUnpublished, (pub) => {
            if (pub.source === Track.Source.Camera) setLocalCameraTrack(null)
          })
        // `autoSubscribe` só no saguão: em campo quem manda é a distância.
        await room.connect(url, token, { autoSubscribe: !spatialRef.current })
        if (generationRef.current !== gen) {
          void room.disconnect()
          return
        }

        roomRef.current = room
        retryRef.current.attempts = 0
        setYouId(room.localParticipant.identity)
        setStatus('connected')

        // Mic publicado já mutado: a barra é que abre (ver o comentário do
        // estado inicial). Publicar desde já — em vez de só ao desmutar —
        // deixa o "abrir o mic" instantâneo, sem esperar permissão no meio de
        // uma partida.
        try {
          const track = await createLocalAudioTrack({
            deviceId: audioInputDeviceIdRef.current ?? undefined,
          })
          if (generationRef.current !== gen) {
            void room.disconnect()
            return
          }
          await track.mute()
          await room.localParticipant.publishTrack(track)
          if (generationRef.current !== gen) {
            void room.disconnect()
            return
          }
          micTrackRef.current = track
          setMicError(false)
        } catch {
          if (generationRef.current === gen) setMicError(true)
        }

        if (generationRef.current !== gen) return
        applyProximity()
        syncRemotes()
      } catch {
        if (generationRef.current !== gen) {
          if (room) void room.disconnect()
          return
        }
        setStatus('error')
        const attempts = (retryRef.current.attempts += 1)
        retryRef.current.timer = setTimeout(() => {
          if (generationRef.current !== gen) return
          void connectTo(target)
        }, Math.min(1000 * 2 ** attempts, MAX_RETRY_MS))
      }
    },
    [applyProximity, commitRemotes, commitSpeaking, syncRemotes],
  )

  useEffect(() => {
    if (retryRef.current.timer) {
      clearTimeout(retryRef.current.timer)
      retryRef.current.timer = null
    }
    retryRef.current.attempts = 0
    if (!arenaId) {
      // Ninguém vai chamar `connectTo` para invalidar uma conexão em voo:
      // a geração é incrementada aqui, senão uma continuação pendente
      // reconectaria depois do "off".
      generationRef.current += 1
      void roomRef.current?.disconnect()
      roomRef.current = null
      micTrackRef.current = null
      setStatus('off')
      setYouId(null)
      setMicEnabled(false)
      setMicError(false)
      setCameraEnabled(false)
      setCameraError(false)
      setLocalCameraTrack(null)
      commitRemotes([])
      commitSpeaking(new Set())
      return
    }
    void connectTo(arenaId)
  }, [arenaId, connectTo, commitRemotes, commitSpeaking])

  /**
   * A distância muda a cada quadro, mas a assinatura não pode ser reavaliada a
   * cada quadro (renegociação WebRTC): um intervalo curto é o suficiente, e
   * mantém a posição fora do estado React (ver `ArenaScene.presence`).
   */
  useEffect(() => {
    if (!arenaId || !spatial) return
    const timer = setInterval(() => {
      applyProximity()
      syncRemotes()
    }, PROXIMITY_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [arenaId, spatial, applyProximity, syncRemotes])

  useEffect(
    () => () => {
      generationRef.current += 1
      if (retryRef.current.timer) clearTimeout(retryRef.current.timer)
      void roomRef.current?.disconnect()
      roomRef.current = null
    },
    [],
  )

  const toggleMic = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const track = micTrackRef.current
    if (!track) {
      // Permissão negada antes — tentar de novo é o "tentar de novo" da barra.
      try {
        const { createLocalAudioTrack } = await loadLiveKit()
        const fresh = await createLocalAudioTrack({
          deviceId: audioInputDeviceIdRef.current ?? undefined,
        })
        await room.localParticipant.publishTrack(fresh)
        micTrackRef.current = fresh
        setMicError(false)
        setMicEnabled(true)
      } catch {
        setMicError(true)
      }
      return
    }
    if (track.isMuted) {
      await track.unmute()
      setMicEnabled(true)
    } else {
      await track.mute()
      setMicEnabled(false)
    }
  }, [])

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const next = !cameraEnabled
    try {
      await room.localParticipant.setCameraEnabled(
        next,
        next && videoInputDeviceIdRef.current ? { deviceId: videoInputDeviceIdRef.current } : undefined,
      )
      setCameraEnabled(next)
      setCameraError(false)
    } catch {
      setCameraEnabled(false)
      setCameraError(true)
    }
  }, [cameraEnabled])

  /** Persiste sempre; troca ao vivo só se já houver mic publicado (como no escritório). */
  const setAudioInputDevice = useCallback(async (deviceId: string | null) => {
    writeDevicePreference('audioInput', deviceId)
    setAudioInputDeviceIdState(deviceId)
    const room = roomRef.current
    if (!room || !micTrackRef.current) return
    try {
      await room.switchActiveDevice('audioinput', deviceId ?? 'default')
    } catch {
      // A preferência é a INTENÇÃO e fica de pé; a próxima conexão tenta de novo.
    }
  }, [])

  const setVideoInputDevice = useCallback(
    async (deviceId: string | null) => {
      writeDevicePreference('videoInput', deviceId)
      setVideoInputDeviceIdState(deviceId)
      const room = roomRef.current
      if (!room || !cameraEnabled) return
      try {
        await room.switchActiveDevice('videoinput', deviceId ?? 'default')
      } catch {
        // Idem `setAudioInputDevice`.
      }
    },
    [cameraEnabled],
  )

  return {
    status,
    micEnabled,
    micError,
    cameraEnabled,
    cameraError,
    remotes: remotes.map((remote) => ({ ...remote, speaking: speakingIds.has(remote.userId) })),
    localCameraTrack,
    localSpeaking: youId ? speakingIds.has(youId) : false,
    toggleMic,
    toggleCamera,
    audioInputDeviceId,
    videoInputDeviceId,
    setAudioInputDevice,
    setVideoInputDevice,
  }
}
