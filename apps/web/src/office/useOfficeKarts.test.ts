import { fireEvent, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OfficeKart, OfficeOccupant } from '@legends/shared'
import { OfficeBridge } from './OfficeBridge'
import { useOfficeKarts } from './useOfficeKarts'

const you = {
  userId: 'ana',
  name: 'Ana',
  photoUrl: null,
  avatarStyle: null,
  avatarSeed: null,
  avatarOptions: null,
  characterName: null,
  status: 'online',
  x: 4,
  y: 4,
  dir: 'down',
} satisfies OfficeOccupant

const nearbyKart = { id: 'kart-1', x: 5, y: 4, dir: 'up' } satisfies OfficeKart

describe('useOfficeKarts', () => {
  it('oferece o kart livre adjacente e envia a ação com E', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    const { result } = renderHook(() => useOfficeKarts(bridge, you, [nearbyKart]))

    expect(result.current.nearbyKart).toEqual(nearbyKart)
    expect(result.current.canInteract).toBe(true)
    fireEvent.keyDown(window, { key: 'e' })
    expect(emit).toHaveBeenCalledWith({ type: 'ride-kart' })
  })

  it('não oferece kart distante, ocupado ou durante a edição', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() =>
      useOfficeKarts(
        bridge,
        you,
        [
          { ...nearbyKart, riderUserId: 'bruno' },
          { id: 'kart-longe', x: 8, y: 8, dir: 'left' },
        ],
        false,
      ),
    )

    expect(result.current).toMatchObject({ nearbyKart: null, riding: false, canInteract: false })
  })

  it('permite estacionar mesmo depois de se afastar da posição publicada', () => {
    const bridge = new OfficeBridge()
    const mounted = { ...you, x: 9, y: 9, ridingKartId: 'kart-1' }
    const { result } = renderHook(() =>
      useOfficeKarts(bridge, mounted, [{ ...nearbyKart, riderUserId: 'ana' }]),
    )

    expect(result.current).toMatchObject({ nearbyKart: null, riding: true, canInteract: true })
  })

  it('não captura E enquanto a pessoa digita', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    renderHook(() => useOfficeKarts(bridge, you, [nearbyKart]))
    const input = document.createElement('input')
    document.body.append(input)

    fireEvent.keyDown(input, { key: 'e' })

    expect(emit).not.toHaveBeenCalled()
    input.remove()
  })
})
