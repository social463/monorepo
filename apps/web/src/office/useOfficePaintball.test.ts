import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAINTBALL_COOLDOWN_MS, type OfficeOccupant } from '@legends/shared'
import { OfficeBridge } from './OfficeBridge'
import { useOfficePaintball } from './useOfficePaintball'

function occupant(overrides: Partial<OfficeOccupant> & { userId: string }): OfficeOccupant {
  return {
    name: overrides.userId,
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    characterName: null,
    status: 'online',
    x: 4,
    y: 4,
    dir: 'down',
    ...overrides,
  }
}

const you = occupant({ userId: 'ana' })
const youArmed = occupant({ userId: 'ana', paintMarker: true })


afterEach(() => vi.useRealTimers())

describe('useOfficePaintball', () => {
  it('Q equipa e Q de novo guarda — o pedido reflete o estado autoritativo', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    const { rerender } = renderHook(({ me }) => useOfficePaintball(bridge, me), {
      initialProps: { me: you },
    })

    fireEvent.keyDown(window, { key: 'q' })
    expect(emit).toHaveBeenCalledWith({ type: 'set-paint-marker', active: true })

    rerender({ me: youArmed })
    fireEvent.keyDown(window, { key: 'q' })
    expect(emit).toHaveBeenCalledWith({ type: 'set-paint-marker', active: false })
  })

  it('desarmado, V não atira: pegar a arma é o primeiro gesto', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    const { result } = renderHook(() => useOfficePaintball(bridge, you))

    expect(result.current.armed).toBe(false)
    fireEvent.keyDown(window, { key: 'v' })
    expect(emit).not.toHaveBeenCalledWith({ type: 'fire-paintball' })
  })

  it('armado, V atira — sem direção nem alvo no payload', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    const { result } = renderHook(() => useOfficePaintball(bridge, youArmed))

    expect(result.current.armed).toBe(true)
    fireEvent.keyDown(window, { key: 'v' })
    expect(emit).toHaveBeenCalledWith({ type: 'fire-paintball' })
  })

  it('a cadência local só apaga o botão, e volta sozinha', () => {
    vi.useFakeTimers()
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    const { result } = renderHook(() => useOfficePaintball(bridge, youArmed))

    act(() => result.current.fire())
    act(() => result.current.fire())
    expect(emit).toHaveBeenCalledTimes(1)
    expect(result.current.canFire).toBe(false)

    act(() => vi.advanceTimersByTime(PAINTBALL_COOLDOWN_MS + 10))
    expect(result.current.canFire).toBe(true)
    act(() => result.current.fire())
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('segurar a tecla (repeat) não vira rajada', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    renderHook(() => useOfficePaintball(bridge, youArmed))

    fireEvent.keyDown(window, { key: 'v', repeat: true })
    expect(emit).not.toHaveBeenCalled()
  })

  it('não rouba a tecla de campos de texto', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    renderHook(() => useOfficePaintball(bridge, youArmed))

    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'v' })
    fireEvent.keyDown(input, { key: 'q' })
    expect(emit).not.toHaveBeenCalled()
    input.remove()
  })

  it('em modo de edição o gesto inteiro fica desarmado (o V é do editor lá)', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    const { result } = renderHook(() => useOfficePaintball(bridge, youArmed, false))

    expect(result.current.armed).toBe(false)
    fireEvent.keyDown(window, { key: 'v' })
    fireEvent.keyDown(window, { key: 'q' })
    expect(emit).not.toHaveBeenCalled()
  })

})
