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
 *
 * `tileWidth`/`tileHeight` são obrigatórios porque o grafo raciocina em TILE
 * (`computeGain` cai a zero em `PROXIMITY_RADIUS * √2` ≈ 4,24) e o occupant
 * fala PIXEL desde o movimento livre. Sem a conversão, um tile de distância
 * vira `dx = 32` e o ganho zera a menos de um oitavo de tile: o vizinho
 * aparece verde no radar, a track é assinada, e não sai som nenhum.
 */
export function SpatialRemoteAudio({
  track,
  you,
  occupant,
  tileWidth,
  tileHeight,
  outputDeviceId = null,
  volume = 1,
}: {
  track: RemoteAudioTrack
  you: OfficeOccupant
  occupant: OfficeOccupant
  /** Tamanho do tile do mapa ativo, em pixels — a régua da conversão. */
  tileWidth: number
  tileHeight: number
  outputDeviceId?: string | null
  volume?: number
}) {
  const graphRef = useRef<SpatialAudioGraph | null>(null)
  const [available, setAvailable] = useState(true)

  // Delta em tiles, FRACIONÁRIO de propósito: arredondar para o tile (como faz
  // `tileOfPixel`, que responde "em que sala estou") devolveria o degrau que o
  // movimento livre veio tirar — o ganho e o pan são contínuos, e agora a
  // aproximação também é.
  const dx = (occupant.x - you.x) / tileWidth
  const dy = (occupant.y - you.y) / tileHeight

  useEffect(() => {
    const graph = createSpatialAudioGraph(track.mediaStreamTrack, outputDeviceId)
    graphRef.current = graph
    setAvailable(graph !== null)
    // Grafo novo nasce com ganho e volume cheios (`spatialAudio.ts`), e os
    // effects de posição e de volume abaixo não rodam de novo — as deps deles
    // não mudaram só porque a track trocou. Sem isto, quem estava longe ou com
    // o volume baixado voltava a tocar alto até se mexer.
    graph?.update(dx, dy)
    graph?.setUserVolume(volume)
    return () => {
      graph?.dispose()
      graphRef.current = null
    }
    // outputDeviceId só é usado como valor INICIAL do grafo aqui — trocas
    // subsequentes são aplicadas pelo effect abaixo via setOutputDevice, sem
    // recriar o grafo (senão o áudio piscaria a cada troca de dispositivo).
    // Posição e volume idem: entram como valor inicial, e os effects seguintes
    // cuidam das trocas.
  }, [track])

  useEffect(() => {
    graphRef.current?.update(dx, dy)
  }, [dx, dy])

  useEffect(() => {
    graphRef.current?.setOutputDevice(outputDeviceId)
  }, [outputDeviceId])

  useEffect(() => {
    graphRef.current?.setUserVolume(volume)
  }, [volume])

  if (!available) return <RemoteAudio track={track} outputDeviceId={outputDeviceId} volume={volume} />
  return null
}
