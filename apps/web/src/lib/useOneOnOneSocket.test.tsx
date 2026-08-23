import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useOneOnOneSocket } from './useOneOnOneSocket'

vi.mock('./api', () => ({ getAccessToken: () => 'tok', refreshAccessToken: vi.fn().mockResolvedValue(true) }))

class FakeWS {
  static OPEN = 1
  static instances: FakeWS[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  readyState = 1
  constructor(public url: string) {
    FakeWS.instances.push(this)
  }
  send() {}
  close() {
    this.readyState = 3
    this.onclose?.({})
  }
  emitOpen() {
    this.readyState = 1
    this.onopen?.({})
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

function setup() {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, spy, wrapper }
}

async function conectado(wrapper: ReturnType<typeof setup>['wrapper']) {
  renderHook(() => useOneOnOneSocket(), { wrapper })
  await waitFor(() => expect(FakeWS.instances.length).toBe(1))
  const ws = FakeWS.instances[0]
  act(() => ws.emitOpen())
  return ws
}

describe('useOneOnOneSocket', () => {
  beforeEach(() => {
    FakeWS.instances = []
    ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS
  })

  it('abre a conexão na rota /api/one-on-ones/ws com token', async () => {
    const { wrapper } = setup()
    renderHook(() => useOneOnOneSocket(), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    expect(FakeWS.instances[0].url).toContain('/api/one-on-ones/ws?token=tok')
  })

  it('ao abrir, releva agenda e encontros — nenhum evento perdido volta', async () => {
    const { spy, wrapper } = setup()
    renderHook(() => useOneOnOneSocket(), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    spy.mockClear()
    act(() => FakeWS.instances[0].emitOpen())
    expect(spy).toHaveBeenCalledWith({ queryKey: ['one-on-ones'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['one-on-one'] })
  })

  it('meeting:changed invalida o encontro pelo id e a agenda', async () => {
    const { spy, wrapper } = setup()
    const ws = await conectado(wrapper)
    spy.mockClear()
    act(() => ws.emit({ type: 'meeting:changed', meetingId: 'm1' }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['one-on-one', 'm1'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['one-on-ones'] })
  })

  it('actions:changed invalida todos os encontros em cache, não só um', async () => {
    const { spy, wrapper } = setup()
    const ws = await conectado(wrapper)
    spy.mockClear()
    act(() => ws.emit({ type: 'actions:changed' }))
    // Combinado em aberto é do PAR: aparece em todo encontro entre as duas pessoas.
    expect(spy).toHaveBeenCalledWith({ queryKey: ['one-on-one'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['one-on-ones'] })
  })

  it('agenda:changed invalida a lista e os encontros', async () => {
    const { spy, wrapper } = setup()
    const ws = await conectado(wrapper)
    spy.mockClear()
    act(() => ws.emit({ type: 'agenda:changed' }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['one-on-ones'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['one-on-one'] })
  })

  it('pdi:changed invalida o PDI e o encontro que mostra o bloco do plano', async () => {
    const { spy, wrapper } = setup()
    const ws = await conectado(wrapper)
    spy.mockClear()
    act(() => ws.emit({ type: 'pdi:changed' }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['pdi'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['one-on-one'] })
  })

  it('mensagem que não é JSON não derruba o hook', async () => {
    const { spy, wrapper } = setup()
    const ws = await conectado(wrapper)
    spy.mockClear()
    expect(() => act(() => ws.onmessage?.({ data: 'não é json' }))).not.toThrow()
    expect(spy).not.toHaveBeenCalled()
  })
})
