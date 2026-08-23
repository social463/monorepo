import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { OfficeServerMessage } from '@legends/shared'
import { OfficeBridge } from './OfficeBridge'
import { useOfficeSocket } from './useOfficeSocket'
import { getAccessToken, refreshAccessToken } from '../lib/api'

vi.mock('../lib/api', () => ({
  getAccessToken: vi.fn(() => 'token-de-teste'),
  refreshAccessToken: vi.fn(async () => true),
}))

/** WebSocket falso controlável pelo teste. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 1
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  serverSends(message: OfficeServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.mocked(getAccessToken).mockReturnValue('token-de-teste')
  vi.mocked(refreshAccessToken).mockResolvedValue(true)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** Última URL usada para abrir o WebSocket (mock). */
function lastWsUrl(): string {
  return FakeWebSocket.instances.at(-1)!.url
}
/** Quantas vezes o construtor de WebSocket foi chamado até agora (mock). */
function wsConstructorCallCount(): number {
  return FakeWebSocket.instances.length
}

const ana = {
  userId: 'ana',
  name: 'Ana',
  x: 11,
  y: 14,
  dir: 'down' as const,
  avatarSeed: null,
  avatarOptions: null,
}

describe('useOfficeSocket', () => {
  it('conecta com o token e expõe os ocupantes do welcome', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeSocket(bridge))

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toContain('/api/office/ws?token=token-de-teste')

    act(() => {
      ws.onopen?.()
      ws.serverSends({ type: 'welcome', youId: 'ana', occupants: [ana] })
    })

    await waitFor(() => {
      expect(result.current.connected).toBe(true)
      expect(result.current.youId).toBe('ana')
      expect(result.current.occupants).toEqual([ana])
    })
  })

  it('mantém a lista de ocupantes em dia com joined/moved/left', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.onopen?.()
      ws.serverSends({ type: 'welcome', youId: 'ana', occupants: [ana] })
      ws.serverSends({
        type: 'joined',
        occupant: { ...ana, userId: 'bruno', name: 'Bruno', x: 12, y: 14 },
      })
    })
    await waitFor(() => expect(result.current.occupants).toHaveLength(2))

    act(() => {
      ws.serverSends({ type: 'moved', userId: 'bruno', x: 12, y: 13, dir: 'up' })
    })
    await waitFor(() =>
      expect(result.current.occupants.find((o) => o.userId === 'bruno')).toMatchObject({ x: 12, y: 13, dir: 'up' }),
    )

    act(() => {
      ws.serverSends({ type: 'left', userId: 'bruno' })
    })
    await waitFor(() => expect(result.current.occupants.map((o) => o.userId)).toEqual(['ana']))
  })

  it('espelha o estado da conexão no bridge (a cena só prevê movimento conectada)', async () => {
    const bridge = new OfficeBridge()
    renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    expect(bridge.isConnected()).toBe(false)

    act(() => ws.onopen?.())
    expect(bridge.isConnected()).toBe(true)

    act(() => ws.onclose?.())
    expect(bridge.isConnected()).toBe(false)
  })

  it('repassa as mensagens do servidor para o bridge (a cena escuta ali)', async () => {
    const bridge = new OfficeBridge()
    const seen: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => seen.push(m))

    renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.onopen?.()
      ws.serverSends({ type: 'welcome', youId: 'ana', occupants: [ana] })
    })

    expect(seen).toEqual([{ type: 'welcome', youId: 'ana', occupants: [ana] }])
  })

  it('envia a intenção de movimento emitida pela cena', async () => {
    const bridge = new OfficeBridge()
    renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    act(() => ws.onopen?.())

    act(() => bridge.emitMoveIntent({ dir: 'right', sprint: false }))

    expect(ws.sent).toContain(JSON.stringify({ type: 'move', dir: 'right' }))
  })

  it('envia sprint:true quando a intenção de movimento vem correndo', async () => {
    const bridge = new OfficeBridge()
    renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    act(() => ws.onopen?.())

    act(() => bridge.emitMoveIntent({ dir: 'right', sprint: true }))

    expect(ws.sent).toContain(JSON.stringify({ type: 'move', dir: 'right', sprint: true }))
  })

  it('envia pelo WS o que for emitido em emitClientMessage', async () => {
    const bridge = new OfficeBridge()
    renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    ws.onopen?.()

    bridge.emitClientMessage({ type: 'call', targetUserId: 'bruno' })
    expect(ws.sent).toContainEqual(JSON.stringify({ type: 'call', targetUserId: 'bruno' }))
  })

  it('avisa saída imediata ao fechar a aba, sem depender do timeout de reconexão', async () => {
    const bridge = new OfficeBridge()
    renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    act(() => ws.onopen?.())

    window.dispatchEvent(new PageTransitionEvent('pagehide'))

    expect(ws.sent).toContainEqual(JSON.stringify({ type: 'leave-office' }))
  })

  it('não avisa saída imediata no cleanup normal do React', async () => {
    const bridge = new OfficeBridge()
    const { unmount } = renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    act(() => ws.onopen?.())

    unmount()

    expect(ws.sent).not.toContainEqual(JSON.stringify({ type: 'leave-office' }))
  })

  it('serializa a mensagem do chat da sala no WebSocket aberto', async () => {
    const bridge = new OfficeBridge()
    renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    act(() => ws.onopen?.())

    act(() => bridge.emitClientMessage({ type: 'room-chat-message', text: 'oi pessoal' }))

    expect(ws.sent).toContainEqual(JSON.stringify({ type: 'room-chat-message', text: 'oi pessoal' }))
  })

  it('continua tentando reconectar mesmo quando o refresh falha (API fora do ar)', async () => {
    vi.useFakeTimers()
    try {
      const bridge = new OfficeBridge()
      const { result, unmount } = renderHook(() => useOfficeSocket(bridge))

      // Conecta normalmente na primeira vez (síncrono: token já disponível,
      // sem await no caminho até o `new WebSocket`).
      expect(FakeWebSocket.instances).toHaveLength(1)
      const first = FakeWebSocket.instances[0]
      act(() => first.onopen?.())
      expect(result.current.connected).toBe(true)

      // A API cai: fecha o socket e, dali em diante, nem token nem refresh
      // funcionam mais (deploy em andamento, por exemplo).
      vi.mocked(getAccessToken).mockReturnValue(null)
      vi.mocked(refreshAccessToken).mockResolvedValue(false)
      act(() => first.onclose?.())
      expect(result.current.connected).toBe(false)

      // Primeiro backoff (attempts=1 => ~2s): o refresh falha, sem token.
      // Sem a correção, o hook desiste aqui e nunca mais tenta de novo.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100)
      })
      expect(FakeWebSocket.instances).toHaveLength(1) // ainda não conseguiu socket novo

      // A API volta a responder.
      vi.mocked(getAccessToken).mockReturnValue('token-novo')
      vi.mocked(refreshAccessToken).mockResolvedValue(true)

      // Próximo backoff (attempts=2 => ~4s) deve produzir uma NOVA tentativa
      // de conexão — prova de que o loop de retry continuou vivo.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4100)
      })
      expect(FakeWebSocket.instances).toHaveLength(2)

      // Desmontar deve parar de vez os retries (não deixar timer vazando).
      const second = FakeWebSocket.instances[1]
      act(() => second.onclose?.())
      unmount()
      const attemptsBeforeUnmount = FakeWebSocket.instances.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000)
      })
      expect(FakeWebSocket.instances).toHaveLength(attemptsBeforeUnmount)
    } finally {
      vi.useRealTimers()
    }
  })

  it('coloca mapId na URL do WS', async () => {
    const bridge = new OfficeBridge()
    renderHook(() => useOfficeSocket(bridge, 'map-1'))
    await waitFor(() => expect(wsConstructorCallCount()).toBe(1))
    expect(lastWsUrl()).toContain('&mapId=map-1')
  })

  it('não reabre o socket quando o mapId não muda (rerender com nova publication)', async () => {
    const bridge = new OfficeBridge()
    const { rerender } = renderHook(({ id }: { id: string }) => useOfficeSocket(bridge, id), {
      initialProps: { id: 'map-1' },
    })
    await waitFor(() => expect(wsConstructorCallCount()).toBe(1))
    const created = wsConstructorCallCount()
    rerender({ id: 'map-1' }) // mesma prop (ex.: nova publicação, mesmo mapa) → sem reconexão
    expect(wsConstructorCallCount()).toBe(created)
  })

  it('zera occupants e youId ao trocar de bridge (sessão nova)', () => {
    const bridgeA = new OfficeBridge()
    const { result, rerender } = renderHook(
      ({ bridge }: { bridge: OfficeBridge }) => useOfficeSocket(bridge, null),
      { initialProps: { bridge: bridgeA } },
    )

    act(() => {
      bridgeA.emitServerMessage({
        type: 'welcome',
        youId: 'u1',
        occupants: [{ userId: 'u1', name: 'Ana', x: 1, y: 1, dir: 'down' }],
      } as never)
    })
    expect(result.current.youId).toBe('u1')
    expect(result.current.occupants).toHaveLength(1)

    rerender({ bridge: new OfficeBridge() })
    expect(result.current.youId).toBeNull()
    expect(result.current.occupants).toHaveLength(0)
  })
})
