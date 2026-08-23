import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'
import { OfficeBridge } from './OfficeBridge'
import { useOfficeFloatingReactions } from './useOfficeFloatingReactions'
import { OFFICE_FLOAT_REACTION_TTL_MS } from './office-floating-reactions'

function occ(userId: string, name = userId): OfficeOccupant {
  return { userId, name, x: 5, y: 5, dir: 'down', avatarSeed: null, avatarOptions: null }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useOfficeFloatingReactions', () => {
  it('ignora nearby-message que não é reação (fala/pensamento)', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeFloatingReactions(bridge, [occ('ana')], null, null))

    act(() => {
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'ana', text: 'oi', kind: 'speech' })
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'ana', text: 'hmm', kind: 'thought' })
    })

    expect(result.current).toHaveLength(0)
  })

  it('reação vira item na fila, com nome resolvido pelo occupant', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeFloatingReactions(bridge, [occ('ana', 'Ana Silva')], null, null))

    act(() => {
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'ana', text: '👋', kind: 'reaction' })
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ userId: 'ana', name: 'Ana Silva', emoji: '👋' })
  })

  it('ignora reações enquanto está desabilitado e limpa a fila ao desabilitar', () => {
    const bridge = new OfficeBridge()
    const { result, rerender } = renderHook(
      ({ enabled }) => useOfficeFloatingReactions(bridge, [occ('ana', 'Ana Silva')], null, null, enabled),
      { initialProps: { enabled: false } },
    )

    act(() => {
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'ana', text: '👋', kind: 'reaction' })
    })
    expect(result.current).toHaveLength(0)

    rerender({ enabled: true })
    act(() => {
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'ana', text: '🎉', kind: 'reaction' })
    })
    expect(result.current).toHaveLength(1)

    rerender({ enabled: false })
    expect(result.current).toHaveLength(0)
  })

  it('some sozinho depois do TTL', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeFloatingReactions(bridge, [occ('ana')], null, null))

    act(() => {
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'ana', text: '👋', kind: 'reaction' })
    })
    expect(result.current).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(OFFICE_FLOAT_REACTION_TTL_MS + 10)
    })
    expect(result.current).toHaveLength(0)
  })

  it('duas reações seguidas empilham (não substituem uma a outra)', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeFloatingReactions(bridge, [occ('ana'), occ('bruno')], null, null))

    act(() => {
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'ana', text: '👋', kind: 'reaction' })
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'bruno', text: '🎉', kind: 'reaction' })
    })

    expect(result.current).toHaveLength(2)
    expect(result.current.map((r) => r.userId)).toEqual(['ana', 'bruno'])
  })

  it('userId sem occupant conhecido ainda vira reação, com nome vazio', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeFloatingReactions(bridge, [], null, null))

    act(() => {
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'fantasma', text: '👋', kind: 'reaction' })
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ userId: 'fantasma', name: '' })
  })

  it('dentro de uma sala, ignora reação de quem está em outra zona do mapa', () => {
    const bridge = new OfficeBridge()
    const you = occ('voce')
    const zoneOccupantIds = new Set(['voce', 'ana'])
    const { result } = renderHook(() =>
      useOfficeFloatingReactions(bridge, [you, occ('ana'), occ('longe')], you, zoneOccupantIds),
    )

    act(() => {
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'ana', text: '👋', kind: 'reaction' })
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'longe', text: '🎉', kind: 'reaction' })
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ userId: 'ana' })
  })

  it('no espaço aberto (sem zona), filtra reação por proximidade', () => {
    const bridge = new OfficeBridge()
    const you: OfficeOccupant = { ...occ('voce'), x: 0, y: 0 }
    const perto: OfficeOccupant = { ...occ('perto'), x: 1, y: 1 }
    const longe: OfficeOccupant = { ...occ('longe'), x: 500, y: 500 }
    const { result } = renderHook(() => useOfficeFloatingReactions(bridge, [you, perto, longe], you, null))

    act(() => {
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'perto', text: '👋', kind: 'reaction' })
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'longe', text: '🎉', kind: 'reaction' })
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ userId: 'perto' })
  })
})
