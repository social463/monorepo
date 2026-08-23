import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRemoteUserVolumePreferences } from './remoteUserVolumePreferences'

describe('useRemoteUserVolumePreferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('usa 100% por padrão e persiste volume por usuário no localStorage', () => {
    const { result, unmount } = renderHook(() => useRemoteUserVolumePreferences())

    expect(result.current.getUserVolume('ana')).toBe(100)

    act(() => {
      result.current.setUserVolume('ana', 35)
    })

    expect(result.current.getUserVolume('ana')).toBe(35)
    expect(localStorage.getItem('office:remote-user-volumes')).toBe('{"ana":35}')

    unmount()
    const restored = renderHook(() => useRemoteUserVolumePreferences())
    expect(restored.result.current.getUserVolume('ana')).toBe(35)
  })

  it('clampa valores fora de 0-100', () => {
    const { result } = renderHook(() => useRemoteUserVolumePreferences())

    act(() => {
      result.current.setUserVolume('ana', -20)
      result.current.setUserVolume('bia', 140)
    })

    expect(result.current.getUserVolume('ana')).toBe(0)
    expect(result.current.getUserVolume('bia')).toBe(100)
  })
})
