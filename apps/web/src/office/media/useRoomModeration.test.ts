import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { OfficeRoomManager } from '@legends/shared'
import { OfficeBridge } from '../OfficeBridge'
import { useRoomModeration } from './useRoomModeration'

interface Props {
  roomId: string | null
  youId: string | null
  connected: boolean
  isAdmin?: boolean
}

function renderModeration(overrides: Partial<Props> = {}) {
  const props: Props = { roomId: 'room-1', youId: 'ana', connected: true, isAdmin: false, ...overrides }
  const bridge = new OfficeBridge()
  const hook = renderHook(
    (p: Props) => useRoomModeration(bridge, p.roomId, p.youId, p.connected, p.isAdmin),
    { initialProps: props },
  )
  return { bridge, ...hook }
}

function managers(...entries: Array<[string, string]>): OfficeRoomManager[] {
  return entries.map(([roomId, userId]) => ({ roomId, userId, byDeskOwner: false }))
}

describe('useRoomModeration', () => {
  it('quem manda na sala atual pode remover', () => {
    const { bridge, result } = renderModeration()

    act(() => bridge.emitServerMessage({ type: 'room-managers-changed', managers: managers(['room-1', 'ana']) }))

    expect(result.current.currentManager?.userId).toBe('ana')
    expect(result.current.canRemove).toBe(true)
  })

  it('quem não manda não pode remover', () => {
    const { bridge, result } = renderModeration()

    act(() => bridge.emitServerMessage({ type: 'room-managers-changed', managers: managers(['room-1', 'bruno']) }))

    expect(result.current.canRemove).toBe(false)
  })

  it('ADMIN remove mesmo sem mandar na sala', () => {
    const { bridge, result } = renderModeration({ isAdmin: true })

    act(() => bridge.emitServerMessage({ type: 'room-managers-changed', managers: managers(['room-1', 'bruno']) }))

    expect(result.current.canRemove).toBe(true)
  })

  it('fora de sala não há o que moderar', () => {
    const { bridge, result } = renderModeration({ roomId: null, isAdmin: true })

    act(() => bridge.emitServerMessage({ type: 'room-managers-changed', managers: managers(['room-1', 'ana']) }))

    expect(result.current.currentManager).toBeNull()
    expect(result.current.canRemove).toBe(false)
  })

  it('remove() manda a mensagem; sem permissão, não manda nada', () => {
    const { bridge, result } = renderModeration()
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => result.current.remove('bruno')) // ainda sem manager: no-op
    expect(sent).toEqual([])

    act(() => bridge.emitServerMessage({ type: 'room-managers-changed', managers: managers(['room-1', 'ana']) }))
    act(() => result.current.remove('bruno'))

    expect(sent).toEqual([{ type: 'remove-from-room', userId: 'bruno' }])
  })

  it('nunca remove a si mesmo', () => {
    const { bridge, result } = renderModeration()
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))
    act(() => bridge.emitServerMessage({ type: 'room-managers-changed', managers: managers(['room-1', 'ana']) }))

    act(() => result.current.remove('ana'))

    expect(sent).toEqual([])
  })

  it('welcome traz os managers de todas as salas', () => {
    const { bridge, result } = renderModeration()

    act(() =>
      bridge.emitServerMessage({
        type: 'welcome',
        youId: 'ana',
        occupants: [],
        roomManagers: managers(['room-1', 'ana'], ['room-2', 'bruno']),
      }),
    )

    expect(result.current.managers).toHaveLength(2)
    expect(result.current.currentManager?.userId).toBe('ana')
  })

  it('ser removido vira aviso; sair da sala limpa', () => {
    const { bridge, result, rerender } = renderModeration()

    act(() =>
      bridge.emitServerMessage({
        type: 'removed-from-room',
        roomId: 'room-1',
        userId: 'ana',
        byUserId: 'bruno',
        byName: 'Bruno',
      }),
    )
    expect(result.current.removedFrom).toEqual({ roomId: 'room-1', byName: 'Bruno' })

    rerender({ roomId: null, youId: 'ana', connected: true, isAdmin: false })

    expect(result.current.removedFrom).toBeNull()
  })

  it('remoção de outra pessoa não vira aviso seu', () => {
    const { bridge, result } = renderModeration()

    act(() =>
      bridge.emitServerMessage({
        type: 'removed-from-room',
        roomId: 'room-1',
        userId: 'bruno',
        byUserId: 'ana',
        byName: 'Ana',
      }),
    )

    expect(result.current.removedFrom).toBeNull()
  })
})
