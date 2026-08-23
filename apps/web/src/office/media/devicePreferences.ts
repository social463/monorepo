const STORAGE_KEYS = {
  audioInput: 'office:preferred-audio-input',
  audioOutput: 'office:preferred-audio-output',
  videoInput: 'office:preferred-video-input',
} as const

export type DevicePreferenceKind = keyof typeof STORAGE_KEYS

export function readDevicePreference(kind: DevicePreferenceKind): string | null {
  return localStorage.getItem(STORAGE_KEYS[kind])
}

export function writeDevicePreference(kind: DevicePreferenceKind, deviceId: string | null): void {
  if (deviceId) localStorage.setItem(STORAGE_KEYS[kind], deviceId)
  else localStorage.removeItem(STORAGE_KEYS[kind])
}
