// apps/web/src/lib/useRetroSocket.test.tsx — substitua os casos por:
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { RetroRoomDTO } from '@legends/shared'
import { useRetroSocket } from './useRetroSocket'

vi.mock('./api', () => ({ getAccessToken: () => 'tok', refreshAccessToken: vi.fn().mockResolvedValue(true) }))

class FakeWS {
  static OPEN = 1
  static instances: FakeWS[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  readyState = 1
  sent: string[] = []
  constructor(public url: string) { FakeWS.instances.push(this) }
  send(d: string) { this.sent.push(d) }
  close() { this.readyState = 3; this.onclose?.({}) }
  emitOpen() { this.readyState = 1; this.onopen?.({}) }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

const baseRoom: RetroRoomDTO = {
  id: 'r1', title: 'A', sprint: 1, squads: [{ id: 'sq1', name: 'Squad A' }], status: 'OPEN', anonymous: false, votesPerParticipant: 3,
  createdAt: '', concludedAt: null, creator: { id: 'l1', name: 'L' }, participantCount: 1, myRole: 'PARTICIPANT',
  participants: [], myRemainingVotes: 3,
  timer: {
    mode: 'elapsed',
    status: 'idle',
    durationSeconds: null,
    startedAt: null,
    accumulatedSeconds: 0,
    updatedAt: '',
    updatedBy: null,
    serverNow: '',
  },
  cards: [{ id: 'c1', text: 'x', x: 0, y: 0, color: 'yellow', author: null, mine: false, voteCount: 0, myVotes: 0, reactions: [], createdAt: '', updatedAt: '', editedBy: null, editedAt: null }],
}

function setup() {
  const qc = new QueryClient()
  qc.setQueryData(['retro-room', 'r1'], { room: baseRoom })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return { qc, wrapper }
}

describe('useRetroSocket (canvas)', () => {
  beforeEach(() => { FakeWS.instances = []; ;(globalThis as any).WebSocket = FakeWS })

  it('card.moving e card.moved atualizam x/y no cache', async () => {
    const { qc, wrapper } = setup()
    renderHook(() => useRetroSocket('r1'), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())
    act(() => ws.emit({ type: 'card.moving', cardId: 'c1', x: 10, y: 20, byUserId: 'u2' }))
    expect(qc.getQueryData<{ room: RetroRoomDTO }>(['retro-room', 'r1'])!.room.cards[0]).toMatchObject({ x: 10, y: 20 })
    act(() => ws.emit({ type: 'card.moved', cardId: 'c1', x: 30, y: 40 }))
    expect(qc.getQueryData<{ room: RetroRoomDTO }>(['retro-room', 'r1'])!.room.cards[0]).toMatchObject({ x: 30, y: 40 })
  })

  it('expõe cursores e locks; envia mensagens', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useRetroSocket('r1'), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())
    act(() => ws.emit({ type: 'cursor.moved', userId: 'u2', name: 'Bia', x: 5, y: 6 }))
    expect(result.current.cursors).toEqual([{ userId: 'u2', name: 'Bia', x: 5, y: 6 }])
    act(() => ws.emit({ type: 'card.locked', cardId: 'c1', byUserId: 'u2', byName: 'Bia' }))
    expect(result.current.lockOf('c1')).toEqual({ byUserId: 'u2', byName: 'Bia' })
    act(() => ws.emit({ type: 'card.unlocked', cardId: 'c1' }))
    expect(result.current.lockOf('c1')).toBeNull()
    act(() => result.current.grab('c1'))
    expect(ws.sent.some((s) => JSON.parse(s).type === 'card.grab')).toBe(true)
  })

  it('vote.changed e reaction.changed atualizam o card no cache', async () => {
    const { qc, wrapper } = setup()
    renderHook(() => useRetroSocket('r1'), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())

    act(() => ws.emit({ type: 'vote.changed', cardId: 'c1', voteCount: 4 }))
    expect(qc.getQueryData<{ room: RetroRoomDTO }>(['retro-room', 'r1'])!.room.cards[0].voteCount).toBe(4)

    act(() => ws.emit({ type: 'reaction.changed', cardId: 'c1', reactions: [{ emoji: '🔥', count: 1, reactedByMe: true }] }))
    expect(qc.getQueryData<{ room: RetroRoomDTO }>(['retro-room', 'r1'])!.room.cards[0].reactions).toHaveLength(1)
  })

  it('timer.changed atualiza o cronômetro no cache', async () => {
    const { qc, wrapper } = setup()
    renderHook(() => useRetroSocket('r1'), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())

    act(() => ws.emit({
      type: 'timer.changed',
      timer: {
        mode: 'countdown',
        status: 'running',
        durationSeconds: 600,
        startedAt: '2026-08-04T10:00:00.000Z',
        accumulatedSeconds: 0,
        updatedAt: '2026-08-04T10:00:00.000Z',
        updatedBy: { id: 'l1', name: 'Lia' },
        serverNow: '2026-08-04T10:00:00.000Z',
      },
    }))

    expect(qc.getQueryData<{ room: RetroRoomDTO }>(['retro-room', 'r1'])!.room.timer).toMatchObject({
      mode: 'countdown',
      status: 'running',
      durationSeconds: 600,
    })
  })

  it('presence.changed atualiza presentUserIds e poda cursores ausentes', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useRetroSocket('r1'), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())

    act(() => ws.emit({ type: 'cursor.moved', userId: 'u2', name: 'Bia', x: 1, y: 2 }))
    expect(result.current.cursors.some((c) => c.userId === 'u2')).toBe(true)

    act(() => ws.emit({ type: 'presence.changed', userIds: ['l1'] }))
    expect(result.current.presentUserIds).toEqual(['l1'])
    expect(result.current.cursors.some((c) => c.userId === 'u2')).toBe(false)
  })
})

describe('useRetroSocket — reações flutuantes', () => {
  beforeEach(() => { FakeWS.instances = []; ;(globalThis as any).WebSocket = FakeWS })
  afterEach(() => { vi.useRealTimers() })

  it('reaction.floated entra na lista e sai após o TTL', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useRetroSocket('r1'), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())

    vi.useFakeTimers()
    act(() => ws.emit({ type: 'reaction.floated', userId: 'u1', name: 'Dan', emoji: '❤️' }))
    expect(result.current.floatingReactions).toHaveLength(1)
    expect(result.current.floatingReactions[0]).toMatchObject({ userId: 'u1', emoji: '❤️' })

    act(() => { vi.advanceTimersByTime(2600) })
    expect(result.current.floatingReactions).toHaveLength(0)
  })

  it('socket obsoleto (após reconexão) não duplica reações nem reconecta de novo', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useRetroSocket('r1'), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const a = FakeWS.instances[0]
    act(() => a.emitOpen())

    vi.useFakeTimers()
    // A cai → o hook agenda uma reconexão
    act(() => { a.onclose?.({}) })
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(FakeWS.instances.length).toBe(2)
    const b = FakeWS.instances[1]
    act(() => b.emitOpen())

    // O servidor transmite a MESMA reação para todos os sockets ainda vivos.
    // Se A (obsoleto) e B (atual) estiverem abertos, só o atual deve contar — senão duplica.
    act(() => a.emit({ type: 'reaction.floated', userId: 'u1', name: 'Dan', emoji: '❤️' }))
    act(() => b.emit({ type: 'reaction.floated', userId: 'u1', name: 'Dan', emoji: '❤️' }))
    expect(result.current.floatingReactions).toHaveLength(1)

    // E um socket obsoleto que fecha não pode disparar nova reconexão.
    act(() => { a.onclose?.({}) })
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(FakeWS.instances.length).toBe(2)
  })
})
