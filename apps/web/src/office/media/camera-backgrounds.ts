export type CameraBackgroundId = 'none' | 'blur-leve' | 'blur-forte' | `img:${string}`

export interface CameraBackgroundImage {
  id: string
  label: string
  src: string
}

/** Galeria fixa — hoje só o fundo institucional; lista para crescer sem mexer no resto. */
export const CAMERA_BACKGROUNDS: CameraBackgroundImage[] = [
  { id: 'emr', label: 'Fundo EMR', src: '/office/camera-backgrounds/emr.jpg' },
]

export const CAMERA_BACKGROUND_STORAGE_KEY = 'legends:camera-background'

export function isCameraBackgroundId(value: string | null): value is CameraBackgroundId {
  if (value === 'none' || value === 'blur-leve' || value === 'blur-forte') return true
  if (value?.startsWith('img:')) {
    return CAMERA_BACKGROUNDS.some((bg) => `img:${bg.id}` === value)
  }
  return false
}
