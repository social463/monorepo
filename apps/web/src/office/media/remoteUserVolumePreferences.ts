import { useCallback, useMemo, useState } from 'react'

const STORAGE_KEY = 'office:remote-user-volumes'
const DEFAULT_VOLUME = 100

export interface RemoteUserVolumeControls {
  getUserVolume(userId: string): number
  setUserVolume(userId: string, volume: number): void
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME
  return Math.min(100, Math.max(0, Math.round(value)))
}

function readStoredVolumes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const next: Record<string, number> = {}
    for (const [userId, value] of Object.entries(parsed)) {
      if (typeof value === 'number') next[userId] = clampVolume(value)
    }
    return next
  } catch {
    return {}
  }
}

function writeStoredVolumes(volumes: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(volumes))
  } catch {
    // Preferencia local best-effort: falha de storage nao deve quebrar o escritorio.
  }
}

export function useRemoteUserVolumePreferences(): RemoteUserVolumeControls {
  const [volumes, setVolumes] = useState(readStoredVolumes)

  const setUserVolume = useCallback((userId: string, volume: number) => {
    setVolumes((current) => {
      const nextVolume = clampVolume(volume)
      const next = { ...current, [userId]: nextVolume }
      writeStoredVolumes(next)
      return next
    })
  }, [])

  return useMemo(
    () => ({
      getUserVolume: (userId: string) => volumes[userId] ?? DEFAULT_VOLUME,
      setUserVolume,
    }),
    [setUserVolume, volumes],
  )
}

