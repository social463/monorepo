import { useEffect, useRef, useState } from 'react'
import type { RemoteAudioTrack } from 'livekit-client'
import type { OfficeOccupant } from '@legends/shared'
import { createSpatialAudioGraph, type SpatialAudioGraph } from './spatialAudio'
import { RemoteAudio } from './RemoteAudio'

/**
 * Variante de `RemoteAudio` para o espaço aberto: toca via Web Audio API
 * (ganho + pan estéreo por posição relativa) em vez de `<audio>` simples —
 * por isso não renderiza nada quando o grafo existe (a saída já vai pro
 * `<audio>` interno do grafo, ver `spatialAudio.ts`). Sem Web Audio
 * disponível, cai de volta para `RemoteAudio` (nunca os dois ao mesmo tempo,
 * senão o áudio toca em dobro).
 */
export function SpatialRemoteAudio({
  track,
  you,
  occupant,
  outputDeviceId = null,
  volume = 1,
}: {
  track: RemoteAudioTrack
  you: OfficeOccupant
  occupant: OfficeOccupant
  outputDeviceId?: string | null
  volume?: number
}) {
  const graphRef = useRef<SpatialAudioGraph | null>(null)
  const [available, setAvailable] = useState(true)

  useEffect(() => {
    const graph = createSpatialAudioGraph(track.mediaStreamTrack, outputDeviceId)
    graphRef.current = graph
    setAvailable(graph !== null)
    return () => {
      graph?.dispose()
      graphRef.current = null
    }
    // outputDeviceId só é usado como valor INICIAL do grafo aqui — trocas
    // subsequentes são aplicadas pelo effect abaixo via setOutputDevice, sem
    // recriar o grafo (senão o áudio piscaria a cada troca de dispositivo).
  }, [track])

  useEffect(() => {
    graphRef.current?.update(occupant.x - you.x, occupant.y - you.y)
  }, [you.x, you.y, occupant.x, occupant.y])

  useEffect(() => {
    graphRef.current?.setOutputDevice(outputDeviceId)
  }, [outputDeviceId])

  useEffect(() => {
    graphRef.current?.setUserVolume(volume)
  }, [volume])

  if (!available) return <RemoteAudio track={track} outputDeviceId={outputDeviceId} volume={volume} />
  return null
}
