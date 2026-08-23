import { useEffect, useRef } from 'react'
import type { RemoteAudioTrack } from 'livekit-client'
import { applyAudioSink } from './audioSink'

/** Anexa um track de áudio a um <audio> invisível enquanto montado. */
export function RemoteAudio({
  track,
  outputDeviceId = null,
  volume = 1,
}: {
  track: RemoteAudioTrack
  outputDeviceId?: string | null
  volume?: number
}) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    void applyAudioSink(el, outputDeviceId)
  }, [outputDeviceId])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.volume = Math.min(1, Math.max(0, volume))
  }, [volume])

  return <audio ref={ref} autoPlay className="hidden" />
}
