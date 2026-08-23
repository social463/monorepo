import { useCallback, useMemo, useState } from 'react'

const STORAGE_KEY = 'office:room-audio-volume'
const DEFAULT_VOLUME = 100

export interface RoomAudioVolumeControls {
  /** Volume escolhido (0-100), independente do mudo. */
  volume: number
  muted: boolean
  /** O que o player deve aplicar: 0 no mudo, `volume` fora dele. */
  effectiveVolume: number
  setVolume(volume: number): void
  setMuted(muted: boolean): void
}

interface StoredPreference {
  volume: number
  muted: boolean
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME
  return Math.min(100, Math.max(0, Math.round(value)))
}

function readStored(): StoredPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { volume: DEFAULT_VOLUME, muted: false }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { volume: DEFAULT_VOLUME, muted: false }
    const { volume, muted } = parsed as Partial<StoredPreference>
    return {
      volume: typeof volume === 'number' ? clampVolume(volume) : DEFAULT_VOLUME,
      muted: muted === true,
    }
  } catch {
    return { volume: DEFAULT_VOLUME, muted: false }
  }
}

function writeStored(preference: StoredPreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preference))
  } catch {
    // Preferência local best-effort: falha de storage não derruba o áudio.
  }
}

/**
 * Volume e mudo do áudio compartilhado da sala — locais de quem ouve, como o
 * volume por pessoa (`useRemoteUserVolumePreferences`). Mexer aqui não muda o
 * som de ninguém mais, e o mudo preserva o volume escolhido para quando ele
 * for desligado.
 */
export function useRoomAudioVolumePreference(): RoomAudioVolumeControls {
  const [preference, setPreference] = useState(readStored)

  const setVolume = useCallback((volume: number) => {
    setPreference((current) => {
      const next = { ...current, volume: clampVolume(volume) }
      writeStored(next)
      return next
    })
  }, [])

  const setMuted = useCallback((muted: boolean) => {
    setPreference((current) => {
      const next = { ...current, muted }
      writeStored(next)
      return next
    })
  }, [])

  return useMemo(
    () => ({
      volume: preference.volume,
      muted: preference.muted,
      effectiveVolume: preference.muted ? 0 : preference.volume,
      setVolume,
      setMuted,
    }),
    [preference, setMuted, setVolume],
  )
}
