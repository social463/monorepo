import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRoomAudioVolumePreference } from './roomAudioVolumePreference'

const STORAGE_KEY = 'office:room-audio-volume'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useRoomAudioVolumePreference', () => {
  it('começa em 100% sem mudo', () => {
    const { result } = renderHook(() => useRoomAudioVolumePreference())

    expect(result.current.volume).toBe(100)
    expect(result.current.muted).toBe(false)
    expect(result.current.effectiveVolume).toBe(100)
  })

  it('guarda volume e mudo entre sessões', () => {
    const first = renderHook(() => useRoomAudioVolumePreference())
    act(() => first.result.current.setVolume(35))
    act(() => first.result.current.setMuted(true))

    const second = renderHook(() => useRoomAudioVolumePreference())
    expect(second.result.current.volume).toBe(35)
    expect(second.result.current.muted).toBe(true)
    // Mudo não apaga o volume escolhido: desligar o mudo devolve os 35%.
    expect(second.result.current.effectiveVolume).toBe(0)
  })

  it('prende o volume entre 0 e 100 e arredonda', () => {
    const { result } = renderHook(() => useRoomAudioVolumePreference())

    act(() => result.current.setVolume(180))
    expect(result.current.volume).toBe(100)
    act(() => result.current.setVolume(-20))
    expect(result.current.volume).toBe(0)
    act(() => result.current.setVolume(42.6))
    expect(result.current.volume).toBe(43)
    act(() => result.current.setVolume(Number.NaN))
    expect(result.current.volume).toBe(100)
  })

  it('lixo no storage não quebra e falha de escrita é engolida', () => {
    localStorage.setItem(STORAGE_KEY, '{ isso não é json')
    const { result } = renderHook(() => useRoomAudioVolumePreference())
    expect(result.current.volume).toBe(100)

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cheio')
    })
    act(() => result.current.setVolume(10))
    expect(result.current.volume).toBe(10)
  })
})
