import { useCallback, useEffect, useState } from 'react'

export interface MediaDeviceOption {
  deviceId: string
  label: string
}

export interface MediaDevicesState {
  audioInputs: MediaDeviceOption[]
  audioOutputs: MediaDeviceOption[]
  videoInputs: MediaDeviceOption[]
  /** `setSinkId` só existe em navegadores baseados em Chromium — Firefox/Safari não suportam trocar a saída de áudio. */
  supportsAudioOutputSelection: boolean
}

const KIND_LABELS: Record<MediaDeviceKind, string> = {
  audioinput: 'Microfone',
  audiooutput: 'Saída de áudio',
  videoinput: 'Câmera',
}

function toOptions(devices: MediaDeviceInfo[], kind: MediaDeviceKind): MediaDeviceOption[] {
  return devices
    .filter((d) => d.kind === kind)
    .map((d, index) => ({ deviceId: d.deviceId, label: d.label || `${KIND_LABELS[kind]} ${index + 1}` }))
}

/**
 * Enumera os dispositivos de mídia disponíveis (mic, câmera, saída de áudio) e
 * mantém a lista em dia sozinha, escutando `devicechange` (plugar/desplugar
 * fone, webcam etc.). Rótulos só vêm preenchidos pelo navegador depois de
 * alguma permissão de mic/câmera já concedida nesta sessão — sem isso, cai no
 * rótulo de fallback numerado.
 */
export function useMediaDevices(): MediaDevicesState {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [supportsAudioOutputSelection] = useState(
    () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype,
  )

  const refresh = useCallback(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    void navigator.mediaDevices
      .enumerateDevices()
      .then(setDevices)
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    if (!navigator.mediaDevices) return
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh)
  }, [refresh])

  return {
    audioInputs: toOptions(devices, 'audioinput'),
    audioOutputs: toOptions(devices, 'audiooutput'),
    videoInputs: toOptions(devices, 'videoinput'),
    supportsAudioOutputSelection,
  }
}
