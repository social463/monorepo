import { useEffect, useRef, useState } from 'react'
import type { RemoteAudioTrack } from 'livekit-client'
import { createSpatialAudioGraph, type SpatialAudioGraph } from '../../office/media/spatialAudio'
import { RemoteAudio } from '../../office/media/RemoteAudio'
import type { ArenaPresenceInfo } from '../ArenaScene'

/** Com que frequência ganho e pan são recalculados. */
const UPDATE_INTERVAL_MS = 100

/**
 * Voz de um jogador remoto.
 *
 * Com `readPresence`, toca pelo grafo espacial (ganho + pan por distância, o
 * MESMO de `spatialAudio.ts` que o escritório usa) — e as posições são PUXADAS
 * da cena a cada 100ms, sem passar por estado React: elas mudam a cada quadro,
 * e um `setState` por quadro re-renderizaria a árvore inteira a 60Hz. Ouvido
 * humano não nota a diferença entre 10 e 60 atualizações de ganho por segundo.
 *
 * Sem `readPresence` (o saguão, onde não há posição) toca por `<audio>`
 * simples, com todos se ouvindo por igual. Sem Web Audio disponível, o
 * espacial cai para o mesmo `<audio>` — nunca os dois ao mesmo tempo, senão o
 * áudio sairia em dobro.
 */
export function ArenaRemoteAudio({
  track,
  userId,
  readPresence,
}: {
  track: RemoteAudioTrack
  userId: string
  readPresence?: () => ArenaPresenceInfo | null
}) {
  const graphRef = useRef<SpatialAudioGraph | null>(null)
  const [spatialOk, setSpatialOk] = useState(true)
  const readPresenceRef = useRef(readPresence)
  readPresenceRef.current = readPresence
  const spatial = readPresence !== undefined

  useEffect(() => {
    if (!spatial) return
    const graph = createSpatialAudioGraph(track.mediaStreamTrack)
    graphRef.current = graph
    setSpatialOk(graph !== null)
    if (!graph) return

    const tick = () => {
      const presence = readPresenceRef.current?.()
      const you = presence?.you
      const outro = presence?.outros.find((player) => player.userId === userId)
      // Enquanto não se sabe onde os dois estão, o ganho fica no máximo (0,0):
      // estrear mudo por falta de posição é pior do que ouvir de mais por um
      // instante.
      if (you && outro) graph.update(outro.x - you.x, outro.y - you.y)
      else graph.update(0, 0)
    }
    tick()
    const timer = setInterval(tick, UPDATE_INTERVAL_MS)
    return () => {
      clearInterval(timer)
      graph.dispose()
      graphRef.current = null
    }
  }, [track, userId, spatial])

  if (spatial && spatialOk) return null
  return <RemoteAudio track={track} />
}
