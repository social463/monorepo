import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useReviewSocket } from './useReviewSocket'

vi.mock('./api', () => ({ getAccessToken: () => 'tok', refreshAccessToken: vi.fn().mockResolvedValue(true) }))

class FakeWS {
  static OPEN = 1
  static instances: FakeWS[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  readyState = 1
  constructor(public url: string) { FakeWS.instances.push(this) }
  send() {}
  close() { this.readyState = 3; this.onclose?.({}) }
  emitOpen() { this.readyState = 1; this.onopen?.({}) }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

function setup() {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return { qc, spy, wrapper }
}

describe('useReviewSocket', () => {
  beforeEach(() => { FakeWS.instances = []; ;(globalThis as any).WebSocket = FakeWS })

  it('abre a conexão na rota /api/reviews/ws com token', async () => {
    const { wrapper } = setup()
    renderHook(() => useReviewSocket(), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    expect(FakeWS.instances[0].url).toContain('/api/reviews/ws?token=tok')
  })

  it('feed:changed invalida o feed', async () => {
    const { spy, wrapper } = setup()
    renderHook(() => useReviewSocket(), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())
    spy.mockClear()
    act(() => ws.emit({ type: 'feed:changed' }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['reviews', 'feed'] })
  })

  it('comments:changed invalida os comentários do review e o feed', async () => {
    const { spy, wrapper } = setup()
    renderHook(() => useReviewSocket(), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())
    spy.mockClear()
    act(() => ws.emit({ type: 'comments:changed', reviewId: 'r1' }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['reviews', 'comments', 'r1'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['reviews', 'feed'] })
  })

  it('review:changed invalida o feed e a lista nominal da enquete', async () => {
    const { spy, wrapper } = setup()
    renderHook(() => useReviewSocket(), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())
    spy.mockClear()
    act(() => ws.emit({ type: 'review:changed', reviewId: 'r1' }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['reviews', 'feed'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['reviews', 'poll-votes', 'r1'] })
  })
})
