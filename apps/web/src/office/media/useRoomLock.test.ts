import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { OfficeBridge } from '../OfficeBridge'

const beepMock = vi.fn()
vi.mock('../../lib/beep', () => ({ playKnockBeep: () => beepMock() }))

import { useRoomLock } from './useRoomLock'

interface Props {
  roomId: string | null
  youId: string | null
  connected: boolean
  canControlRoomLock?: boolean
}

function renderRoomLock(overrides: Partial<Props> = {}) {
  const props: Props = { roomId: 'room-1', youId: 'ana', connected: true, canControlRoomLock: true, ...overrides }
  const bridge = new OfficeBridge()
  const hook = renderHook((p: Props) => useRoomLock(bridge, p.roomId, p.youId, p.connected, p.canControlRoomLock), {
    initialProps: props,
  })
  return { bridge, ...hook }
}

beforeEach(() => {
  beepMock.mockClear()
})

describe('useRoomLock', () => {
  it('toggle() tranca quando a sala está aberta', () => {
    const { bridge, result } = renderRoomLock()
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => result.current.toggle())

    expect(sent).toEqual([{ type: 'set-room-lock', locked: true }])
  })

  it('toggle() destranca quando a sala já está trancada', () => {
    const { bridge, result } = renderRoomLock()
    act(() => {
      bridge.emitServerMessage({ type: 'room-lock-changed', roomId: 'room-1', locked: true, byUserId: 'bruno' })
    })
    expect(result.current.locked).toBe(true)

    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))
    act(() => result.current.toggle())

    expect(sent).toEqual([{ type: 'set-room-lock', locked: false }])
  })

  it('a tranca de outra sala não afeta a sua', () => {
    const { bridge, result } = renderRoomLock()
    act(() => {
      bridge.emitServerMessage({ type: 'room-lock-changed', roomId: 'room-2', locked: true, byUserId: 'bruno' })
    })
    expect(result.current.locked).toBe(false)
  })

  it('welcome traz as salas já trancadas (reconexão)', () => {
    const { bridge, result } = renderRoomLock()
    act(() => {
      bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [], lockedRoomIds: ['room-1'] })
    })
    expect(result.current.locked).toBe(true)
  })

  it('fora de sala de reunião não dá pra mexer no cadeado', () => {
    const { bridge, result } = renderRoomLock({ roomId: null })
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    expect(result.current.canLock).toBe(false)
    act(() => result.current.toggle())

    expect(sent).toEqual([])
  })

  it('desconectado não dá pra mexer no cadeado', () => {
    const { result } = renderRoomLock({ connected: false })
    expect(result.current.canLock).toBe(false)
  })

  it('sem controle da sala não envia comando de cadeado', () => {
    const { bridge, result } = renderRoomLock({ canControlRoomLock: false })
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    expect(result.current.canLock).toBe(false)
    act(() => result.current.toggle())

    expect(sent).toEqual([])
  })

  it('pedido para entrar entra na lista e toca o som', () => {
    const { bridge, result } = renderRoomLock()
    act(() => {
      bridge.emitServerMessage({ type: 'knock-request', roomId: 'room-1', userId: 'bruno', name: 'Bruno' })
    })

    expect(result.current.knocks).toEqual([{ userId: 'bruno', name: 'Bruno' }])
    expect(beepMock).toHaveBeenCalledTimes(1)
  })

  it('pedido de outra sala é ignorado, sem som', () => {
    const { bridge, result } = renderRoomLock()
    act(() => {
      bridge.emitServerMessage({ type: 'knock-request', roomId: 'room-2', userId: 'bruno', name: 'Bruno' })
    })

    expect(result.current.knocks).toEqual([])
    expect(beepMock).not.toHaveBeenCalled()
  })

  it('pedido repetido do mesmo usuário não duplica o card', () => {
    const { bridge, result } = renderRoomLock()
    act(() => {
      bridge.emitServerMessage({ type: 'knock-request', roomId: 'room-1', userId: 'bruno', name: 'Bruno' })
      bridge.emitServerMessage({ type: 'knock-request', roomId: 'room-1', userId: 'bruno', name: 'Bruno' })
    })

    expect(result.current.knocks).toHaveLength(1)
  })

  it('knock-cleared tira o pedido da lista — outra pessoa da sala respondeu', () => {
    const { bridge, result } = renderRoomLock()
    act(() => {
      bridge.emitServerMessage({ type: 'knock-request', roomId: 'room-1', userId: 'bruno', name: 'Bruno' })
      bridge.emitServerMessage({ type: 'knock-cleared', roomId: 'room-1', userId: 'bruno' })
    })

    expect(result.current.knocks).toEqual([])
  })

  it('respond() manda a resposta e tira o card na hora', () => {
    const { bridge, result } = renderRoomLock()
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))
    act(() => {
      bridge.emitServerMessage({ type: 'knock-request', roomId: 'room-1', userId: 'bruno', name: 'Bruno' })
    })

    act(() => result.current.respond('bruno', true))

    expect(sent).toEqual([{ type: 'knock-response', userId: 'bruno', accepted: true }])
    expect(result.current.knocks).toEqual([])
  })

  it('sair da sala zera os pedidos pendentes', () => {
    const { bridge, result, rerender } = renderRoomLock()
    act(() => {
      bridge.emitServerMessage({ type: 'knock-request', roomId: 'room-1', userId: 'bruno', name: 'Bruno' })
    })
    expect(result.current.knocks).toHaveLength(1)

    rerender({ roomId: null, youId: 'ana', connected: true })

    expect(result.current.knocks).toEqual([])
    expect(result.current.locked).toBe(false)
  })
})
