import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMediaDevices } from './useMediaDevices'

function device(kind: MediaDeviceKind, deviceId: string, label = ''): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: '', toJSON: () => ({}) } as MediaDeviceInfo
}

let listeners: Record<string, () => void> = {}
let enumerateMock = vi.fn()

beforeEach(() => {
  listeners = {}
  enumerateMock = vi.fn().mockResolvedValue([])
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      enumerateDevices: enumerateMock,
      addEventListener: (event: string, cb: () => void) => {
        listeners[event] = cb
      },
      removeEventListener: vi.fn(),
    },
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('useMediaDevices', () => {
  it('separa os dispositivos por tipo', async () => {
    enumerateMock.mockResolvedValue([
      device('audioinput', 'mic1', 'Mic USB'),
      device('audiooutput', 'out1', 'Fone'),
      device('videoinput', 'cam1', 'Webcam'),
    ])
    const { result } = renderHook(() => useMediaDevices())

    await waitFor(() => expect(result.current.audioInputs).toHaveLength(1))
    expect(result.current.audioInputs).toEqual([{ deviceId: 'mic1', label: 'Mic USB' }])
    expect(result.current.audioOutputs).toEqual([{ deviceId: 'out1', label: 'Fone' }])
    expect(result.current.videoInputs).toEqual([{ deviceId: 'cam1', label: 'Webcam' }])
  })

  it('usa rótulo de fallback numerado quando label vem vazio (sem permissão concedida ainda)', async () => {
    enumerateMock.mockResolvedValue([device('audioinput', 'mic1', ''), device('audioinput', 'mic2', '')])
    const { result } = renderHook(() => useMediaDevices())

    await waitFor(() => expect(result.current.audioInputs).toHaveLength(2))
    expect(result.current.audioInputs).toEqual([
      { deviceId: 'mic1', label: 'Microfone 1' },
      { deviceId: 'mic2', label: 'Microfone 2' },
    ])
  })

  it('reenumera quando o navegador dispara devicechange', async () => {
    enumerateMock.mockResolvedValue([])
    const { result } = renderHook(() => useMediaDevices())
    await waitFor(() => expect(enumerateMock).toHaveBeenCalledOnce())

    enumerateMock.mockResolvedValue([device('videoinput', 'cam1', 'Nova câmera')])
    listeners.devicechange()

    await waitFor(() => expect(result.current.videoInputs).toHaveLength(1))
  })

  it('reflete se o navegador suporta trocar a saída de áudio (setSinkId)', () => {
    const original = (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId
    ;(HTMLMediaElement.prototype as unknown as { setSinkId: () => Promise<void> }).setSinkId = () =>
      Promise.resolve()
    try {
      const { result } = renderHook(() => useMediaDevices())
      expect(result.current.supportsAudioOutputSelection).toBe(true)
    } finally {
      if (original === undefined) delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId
      else (HTMLMediaElement.prototype as unknown as { setSinkId: unknown }).setSinkId = original
    }
  })
})
