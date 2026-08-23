import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalAudioTrack, RemoteAudioTrack, Room } from 'livekit-client'
import { OFFICE_BROADCAST_ROOM, type OfficeMediaTokenResponse } from '@legends/shared'
import { getLiveKit, loadLiveKit } from './livekit-loader'
import { apiFetch } from '../../lib/api'

const MAX_RETRY_MS = 15000

export interface OfficeBroadcastState {
  /** Conexão de broadcast de pé (flag do admin ligado + escritório conectado). */
  available: boolean
  speakerEnabled: boolean
  speakerError: boolean
  /** Nomes de quem está no alto-falante agora (inclui você quando no ar). */
  speakers: string[]
  /** Tracks remotos de áudio do broadcast, para a UI anexar. */
  broadcastTracks: RemoteAudioTrack[]
  toggleSpeaker(): Promise<void>
}

/**
 * Conexão PERMANENTE à sala de broadcast (`office-broadcast`) — o alto-falante
 * do escritório. Ciclo de vida independente da sala de localização: sobrevive
 * às trocas por posição, e falha aqui nunca derruba a mídia de proximidade.
 * Com `enabled: false` (interruptor de custo do admin, ou escritório fora),
 * NENHUMA conexão é aberta.
 *
 * A permissão de falar é do SERVIDOR: o token de liderança vem com canPublish
 * e o de todo o resto sem — publicar sem grant é rejeitado pelo LiveKit e
 * vira `speakerError` aqui.
 */
export function useOfficeBroadcast(opts: {
  enabled: boolean
  micEnabled: boolean
  setMicEnabled: (enabled: boolean) => Promise<void>
  youName: string | null
}): OfficeBroadcastState {
  const { enabled } = opts
  const [available, setAvailable] = useState(false)
  const [speakerEnabled, setSpeakerEnabled] = useState(false)
  const [speakerError, setSpeakerError] = useState(false)
  const [speakers, setSpeakers] = useState<string[]>([])
  const [broadcastTracks, setBroadcastTracks] = useState<RemoteAudioTrack[]>([])

  const roomRef = useRef<Room | null>(null)
  const trackRef = useRef<LocalAudioTrack | null>(null)
  /** Estado do mic local ANTES de ligar o alto-falante — restaurado ao desligar. */
  const prevMicRef = useRef(false)
  const speakerEnabledRef = useRef(false)
  /** Trava de reentrância: evita duas execuções concorrentes de toggleSpeaker. */
  const busyRef = useRef(false)
  const generationRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Refs-espelho: toggleSpeaker lê valores atuais sem virar dependência de efeito.
  const micEnabledRef = useRef(opts.micEnabled)
  micEnabledRef.current = opts.micEnabled
  const setMicEnabledRef = useRef(opts.setMicEnabled)
  setMicEnabledRef.current = opts.setMicEnabled
  const youNameRef = useRef(opts.youName)
  youNameRef.current = opts.youName

  /** Reconstrói speakers/tracks do que está publicado na sala agora. */
  const syncBroadcast = useCallback(() => {
    const room = roomRef.current
    if (!room) {
      setSpeakers([])
      setBroadcastTracks([])
      return
    }
    const lk = getLiveKit()
    if (!lk) {
      setSpeakers([])
      setBroadcastTracks([])
      return
    }
    const names: string[] = []
    const tracks: RemoteAudioTrack[] = []
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) {
        if (pub.source !== lk.Track.Source.Microphone) continue
        names.push(participant.name ?? participant.identity)
        if (pub.isSubscribed && pub.track) tracks.push(pub.track as RemoteAudioTrack)
      }
    }
    if (speakerEnabledRef.current && youNameRef.current) names.push(youNameRef.current)
    setSpeakers(names)
    setBroadcastTracks(tracks)
  }, [])

  useEffect(() => {
    if (!enabled) return

    let attempts = 0
    const connect = async () => {
      const gen = ++generationRef.current
      try {
        const { Room: LiveKitRoom, RoomEvent } = await loadLiveKit()
        if (generationRef.current !== gen) return
        const { token, url } = await apiFetch<OfficeMediaTokenResponse>('/office/media-token', {
          method: 'POST',
          body: JSON.stringify({ room: OFFICE_BROADCAST_ROOM }),
        })
        if (generationRef.current !== gen) return
        const room = new LiveKitRoom()
        room
          .on(RoomEvent.ParticipantConnected, syncBroadcast)
          .on(RoomEvent.ParticipantDisconnected, syncBroadcast)
          .on(RoomEvent.TrackPublished, syncBroadcast)
          .on(RoomEvent.TrackUnpublished, syncBroadcast)
          .on(RoomEvent.TrackSubscribed, syncBroadcast)
          .on(RoomEvent.TrackUnsubscribed, syncBroadcast)
        await room.connect(url, token, { autoSubscribe: true })
        if (generationRef.current !== gen) {
          void room.disconnect()
          return
        }
        roomRef.current = room
        attempts = 0
        setAvailable(true)
        setSpeakerError(false)
        syncBroadcast()
      } catch {
        if (generationRef.current !== gen) return
        setAvailable(false)
        attempts += 1
        retryTimerRef.current = setTimeout(() => {
          if (generationRef.current !== gen) return
          void connect()
        }, Math.min(1000 * 2 ** attempts, MAX_RETRY_MS))
      }
    }
    void connect()

    return () => {
      // Invalida continuações em voo e retries agendados antes de derrubar.
      generationRef.current += 1
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      void roomRef.current?.disconnect()
      roomRef.current = null
      // Se o teardown pegar o alto-falante ligado (kill switch do admin,
      // unmount), para a captura antes de descartar a ref — senão o mic
      // fica preso mesmo com a sala já desconectada.
      trackRef.current?.stop()
      trackRef.current = null
      speakerEnabledRef.current = false
      setSpeakerEnabled(false)
      setAvailable(false)
      setSpeakers([])
      setBroadcastTracks([])
    }
  }, [enabled, syncBroadcast])

  const toggleSpeaker = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    // Trava de reentrância: um segundo toggle disparado antes do primeiro
    // resolver (duplo clique, duplo evento) não pode publicar duas tracks
    // na sala compartilhada nem pisar na ref da primeira.
    if (busyRef.current) return
    busyRef.current = true
    try {
      if (!speakerEnabledRef.current) {
        // Declarada fora do try interno para poder liberar a captura no catch.
        let track: LocalAudioTrack | undefined
        try {
          const { createLocalAudioTrack } = await loadLiveKit()
          track = await createLocalAudioTrack()
          // Publica DESMUTADO — ligar o alto-falante é o ato de falar. Se o
          // token não tem canPublish (não-liderança adulterada), o servidor
          // rejeita e caímos no catch sem tocar no mic local.
          await room.localParticipant.publishTrack(track)
          trackRef.current = track
          prevMicRef.current = micEnabledRef.current
          await setMicEnabledRef.current(false)
          speakerEnabledRef.current = true
          setSpeakerEnabled(true)
          setSpeakerError(false)
          syncBroadcast()
        } catch {
          // Publish rejeitado (ou falha na captura): a track já tomou o mic
          // do navegador — para agora, senão o indicador de gravação fica
          // aceso e ninguém mais consegue liberar essa captura.
          track?.stop()
          setSpeakerError(true)
        }
        return
      }
      const track = trackRef.current
      if (track) {
        await room.localParticipant.unpublishTrack(track)
        track.stop()
        trackRef.current = null
      }
      speakerEnabledRef.current = false
      setSpeakerEnabled(false)
      await setMicEnabledRef.current(prevMicRef.current)
      syncBroadcast()
    } finally {
      busyRef.current = false
    }
  }, [syncBroadcast])

  return { available, speakerEnabled, speakerError, speakers, broadcastTracks, toggleSpeaker }
}
