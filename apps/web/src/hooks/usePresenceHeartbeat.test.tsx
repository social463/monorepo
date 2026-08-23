import { act, render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from '@legends/shared'
import { usePresenceHeartbeat } from './usePresenceHeartbeat'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', () => ({ apiFetch: vi.fn() }))
const mockApiFetch = apiFetch as unknown as Mock

function Probe({ enabled = true }: { enabled?: boolean }) {
  usePresenceHeartbeat(enabled)
  return <p>tela</p>
}

/** Troca o que `document.visibilityState` responde, que é somente-leitura. */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

describe('usePresenceHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockApiFetch.mockReset()
    mockApiFetch.mockResolvedValue(undefined)
    setVisibility('visible')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('bate assim que monta e depois a cada intervalo', () => {
    render(<Probe />)
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
    expect(mockApiFetch).toHaveBeenCalledWith('/me/presence', { method: 'POST' })

    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS * 2)
    })
    expect(mockApiFetch).toHaveBeenCalledTimes(3)
  })

  it('não bate com a aba escondida — janela esquecida não é presença', () => {
    setVisibility('hidden')
    render(<Probe />)
    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS * 3)
    })
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('bate na hora em que a aba volta ao primeiro plano, sem esperar o ciclo', () => {
    setVisibility('hidden')
    render(<Probe />)
    expect(mockApiFetch).not.toHaveBeenCalled()

    setVisibility('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })

  it('não faz nada para visitante sem sessão', () => {
    render(<Probe enabled={false} />)
    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS * 3)
    })
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('para de bater ao desmontar', () => {
    const { unmount } = render(<Probe />)
    mockApiFetch.mockClear()
    unmount()
    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS * 3)
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('falha de rede não vira erro de tela', () => {
    mockApiFetch.mockRejectedValue(new Error('offline'))
    expect(() => render(<Probe />)).not.toThrow()
  })
})
