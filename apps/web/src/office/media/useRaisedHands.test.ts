import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { OfficeBridge } from '../OfficeBridge'

const beepMock = vi.fn()
vi.mock('../../lib/beep', () => ({ playRaiseHandBeep: () => beepMock() }))

import { useRaisedHands } from './useRaisedHands'

interface Props {
  roomId: string | null
  youId: string | null
  connected: boolean
  localSpeaking: boolean
}

function renderRaisedHands(overrides: Partial<Props> = {}) {
  const props: Props = { roomId: 'room-1', youId: 'ana', connected: true, localSpeaking: false, ...overrides }
  const bridge = new OfficeBridge()
  const hook = renderHook((p: Props) => useRaisedHands(bridge, p.roomId, p.youId, p.connected, p.localSpeaking), {
    initialProps: props,
  })
  return { bridge, ...hook }
}

beforeEach(() => {
  beepMock.mockClear()
})

describe('useRaisedHands', () => {
  it('toggle() levanta a mão quando abaixada', () => {
    const { bridge, result } = renderRaisedHands()
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => result.current.toggle())

    expect(sent).toEqual([{ type: 'raise-hand', active: true }])
  })

  it('toggle() abaixa a mão quando já está com a mão levantada (estado global)', () => {
    const { bridge, result } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({ type: 'hand-raised', userId: 'ana', active: true })
    })
    expect(result.current.raised).toBe(true)

    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))
    act(() => result.current.toggle())

    expect(sent).toEqual([{ type: 'raise-hand', active: false }])
  })

  it('raised é global — não depende do próprio userId estar na fila de sala nenhuma', () => {
    const { bridge, result } = renderRaisedHands({ roomId: null })
    act(() => {
      bridge.emitServerMessage({ type: 'hand-raised', userId: 'ana', active: true })
    })
    expect(result.current.raised).toBe(true)
    expect(result.current.queue).toEqual([])
  })

  it('ignora hand-raised de outro usuário — raised só reflete o próprio', () => {
    const { bridge, result } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({ type: 'hand-raised', userId: 'bruno', active: true })
    })
    expect(result.current.raised).toBe(false)
  })

  it('welcome (inicial ou replay sintético) já traz o próprio estado global via handRaisedUserIds', () => {
    const { bridge, result } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [], handRaisedUserIds: ['ana'] })
    })
    expect(result.current.raised).toBe(true)
  })

  it('acumula a fila da sala atual e ignora mensagens de outra sala', () => {
    const { bridge, result } = renderRaisedHands()

    act(() => {
      bridge.emitServerMessage({ type: 'raised-hands', roomId: 'room-2', queue: ['outra'] })
      bridge.emitServerMessage({
        type: 'raised-hands',
        roomId: 'room-1',
        queue: ['ana', 'bruno'],
        event: { kind: 'raised', userId: 'bruno' },
      })
    })

    expect(result.current.queue).toEqual(['ana', 'bruno'])
  })

  it('zera a fila ao trocar de sala, mas não mexe no estado global de raised', () => {
    const { bridge, result, rerender } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({ type: 'raised-hands', roomId: 'room-1', queue: ['ana'] })
      bridge.emitServerMessage({ type: 'hand-raised', userId: 'ana', active: true })
    })
    expect(result.current.queue).toEqual(['ana'])
    expect(result.current.raised).toBe(true)

    rerender({ roomId: 'room-2', youId: 'ana', connected: true, localSpeaking: false })
    expect(result.current.queue).toEqual([])
    expect(result.current.raised).toBe(true)
  })

  it('event.kind "raised" toca o som', () => {
    const { bridge } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({
        type: 'raised-hands',
        roomId: 'room-1',
        queue: ['ana'],
        event: { kind: 'raised', userId: 'ana' },
      })
    })
    expect(beepMock).toHaveBeenCalledTimes(1)
  })

  it('snapshot sem event não toca som', () => {
    const { bridge } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({ type: 'raised-hands', roomId: 'room-1', queue: ['ana'] })
    })
    expect(beepMock).not.toHaveBeenCalled()
  })

  it('event.kind "lowered" não toca som', () => {
    const { bridge } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({
        type: 'raised-hands',
        roomId: 'room-1',
        queue: [],
        event: { kind: 'lowered', userId: 'ana' },
      })
    })
    expect(beepMock).not.toHaveBeenCalled()
  })

  it('hand-raised (sinal global) nunca toca som — só o evento de fila da sala toca', () => {
    const { bridge } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({ type: 'hand-raised', userId: 'ana', active: true })
    })
    expect(beepMock).not.toHaveBeenCalled()
  })

  it('abaixa sozinha quando começa a falar com a mão levantada', () => {
    const { bridge, rerender } = renderRaisedHands({ localSpeaking: false })
    act(() => {
      bridge.emitServerMessage({ type: 'hand-raised', userId: 'ana', active: true })
    })
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    rerender({ roomId: 'room-1', youId: 'ana', connected: true, localSpeaking: true })

    expect(sent).toEqual([{ type: 'raise-hand', active: false }])
  })

  it('não abaixa se já estava falando antes de levantar a mão (sem borda de subida)', () => {
    const { bridge, rerender } = renderRaisedHands({ localSpeaking: true })
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => {
      bridge.emitServerMessage({ type: 'hand-raised', userId: 'ana', active: true })
    })
    rerender({ roomId: 'room-1', youId: 'ana', connected: true, localSpeaking: true })

    expect(sent).toEqual([])
  })

  it('canRaise exige estar em sala/zona (roomId), identificação e conexão', () => {
    expect(renderRaisedHands({ roomId: null }).result.current.canRaise).toBe(false)
    expect(renderRaisedHands({ youId: null }).result.current.canRaise).toBe(false)
    expect(renderRaisedHands({ connected: false }).result.current.canRaise).toBe(false)
    expect(renderRaisedHands({}).result.current.canRaise).toBe(true)
  })

  it('toggle() é no-op fora de sala/zona (sem roomId)', () => {
    const { bridge, result } = renderRaisedHands({ roomId: null })
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => result.current.toggle())

    expect(sent).toEqual([])
  })

  it('toggle() é no-op sem identificação', () => {
    const { bridge, result } = renderRaisedHands({ youId: null })
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => result.current.toggle())

    expect(sent).toEqual([])
  })
})
