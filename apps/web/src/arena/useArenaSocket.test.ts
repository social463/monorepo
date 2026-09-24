import { renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArenaSocket } from './useArenaSocket'

vi.mock('../lib/api', () => ({
  getAccessToken: () => 'token-de-teste',
  refreshAccessToken: () => Promise.resolve(true),
}))

/** Socket falso: registra o que foi enviado e permite disparar os eventos. */
class FakeSocket {
  static instances: FakeSocket[] = []
  static OPEN = 1
  static CLOSED = 3
  readyState = 0
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string | URL) {
    FakeSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
    this.readyState = FakeSocket.CLOSED
    this.onclose?.()
  }
  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const flush = () => act(async () => { await Promise.resolve() })

describe('useArenaSocket', () => {
  it('envia pelo socket aberto', async () => {
    const { result } = renderHook(() => useArenaSocket('padrao', vi.fn()))
    await flush()
    const socket = FakeSocket.instances[0]
    act(() => socket.open())

    await waitFor(() => expect(result.current.connected).toBe(true))
    result.current.send({ type: 'leave-arena' })

    expect(socket.sent).toEqual([JSON.stringify({ type: 'leave-arena' })])
  })

  /**
   * O bug que deixou a arena muda: em StrictMode o efeito monta, desmonta e
   * monta de novo. O `close` do socket DESCARTADO chega depois de o novo já
   * ter se registrado; sem guarda, ele zera o ref do novo — e aí a conexão
   * segue aberta e recebendo, mas nada mais é enviado.
   *
   * O sintoma não parece de rede: a tela diz "conectado", os outros aparecem,
   * e só o seu personagem some para o servidor.
   */
  it('o close do socket descartado não silencia o socket novo', async () => {
    const { result, rerender } = renderHook(({ id }) => useArenaSocket(id, vi.fn()), {
      initialProps: { id: 'a' },
    })
    await flush()
    const primeiro = FakeSocket.instances[0]

    // Troca de arena: o efeito refaz a conexão, como a segunda montagem faria.
    rerender({ id: 'b' })
    await flush()
    const segundo = FakeSocket.instances[1]
    expect(segundo).toBeDefined()

    act(() => segundo.open())
    // …e só AGORA o socket velho avisa que fechou.
    act(() => primeiro.onclose?.())

    result.current.send({ type: 'leave-arena' })
    expect(segundo.sent).toHaveLength(1)
  })

  it('socket que abre depois de ter sido substituído se fecha sozinho', async () => {
    const { rerender } = renderHook(({ id }) => useArenaSocket(id, vi.fn()), {
      initialProps: { id: 'a' },
    })
    await flush()
    const primeiro = FakeSocket.instances[0]
    rerender({ id: 'b' })
    await flush()

    act(() => primeiro.open())

    expect(primeiro.closed).toBe(true)
  })

  it('repassa as mensagens do servidor ao handler', async () => {
    const onMessage = vi.fn()
    renderHook(() => useArenaSocket('padrao', onMessage))
    await flush()
    const socket = FakeSocket.instances[0]
    act(() => socket.open())

    act(() => socket.onmessage?.({ data: JSON.stringify({ type: 'left', userId: 'x' }) }))

    expect(onMessage).toHaveBeenCalledWith({ type: 'left', userId: 'x' })
  })

  it('pacote malformado não derruba a partida', async () => {
    const onMessage = vi.fn()
    renderHook(() => useArenaSocket('padrao', onMessage))
    await flush()
    const socket = FakeSocket.instances[0]
    act(() => socket.open())

    expect(() => act(() => socket.onmessage?.({ data: 'nao é json' }))).not.toThrow()
    expect(onMessage).not.toHaveBeenCalled()
  })
})
