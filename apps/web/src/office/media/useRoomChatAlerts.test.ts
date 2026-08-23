import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRoomChatAlerts, ROOM_CHAT_PREVIEW_MS, ROOM_CHAT_BEEP_COOLDOWN_MS } from './useRoomChatAlerts'
import type { RoomChatMessage } from './useRoomChat'

const playChatMessageBeep = vi.hoisted(() => vi.fn())
vi.mock('../../lib/beep', () => ({ playChatMessageBeep }))

function message(userId: string, text: string, sentAt = '2026-01-01T10:00:00.000Z'): RoomChatMessage {
  return { userId, name: userId === 'ana' ? 'Ana' : 'Você', text, sentAt }
}

/** Mesma assinatura do call site: a lista cresce, o resto é estável. */
function renderAlerts(initial: { messages: RoomChatMessage[]; youId?: string | null; chatOpen?: boolean }) {
  return renderHook(
    ({ messages, youId = 'eu', chatOpen = false }) => useRoomChatAlerts({ messages, youId, chatOpen }),
    { initialProps: initial },
  )
}

describe('useRoomChatAlerts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    playChatMessageBeep.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('mostra a prévia e toca o bipe quando chega mensagem de outra pessoa', () => {
    const { result, rerender } = renderAlerts({ messages: [] })

    rerender({ messages: [message('ana', 'bora começar?')] })

    expect(result.current.preview?.text).toBe('bora começar?')
    expect(playChatMessageBeep).toHaveBeenCalledOnce()
  })

  it('não avisa da própria mensagem', () => {
    const { result, rerender } = renderAlerts({ messages: [] })

    rerender({ messages: [message('eu', 'to indo')] })

    expect(result.current.preview).toBeNull()
    expect(playChatMessageBeep).not.toHaveBeenCalled()
  })

  it('não avisa com o chat aberto', () => {
    const { result, rerender } = renderAlerts({ messages: [], chatOpen: true })

    rerender({ messages: [message('ana', 'oi')], chatOpen: true })

    expect(result.current.preview).toBeNull()
    expect(playChatMessageBeep).not.toHaveBeenCalled()
  })

  it('some sozinha depois da janela da prévia', () => {
    const { result, rerender } = renderAlerts({ messages: [] })
    rerender({ messages: [message('ana', 'oi')] })
    expect(result.current.preview).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(ROOM_CHAT_PREVIEW_MS)
    })

    expect(result.current.preview).toBeNull()
  })

  it('atualiza a prévia a cada mensagem, mas segura o bipe no intervalo', () => {
    const { result, rerender } = renderAlerts({ messages: [] })
    const first = [message('ana', 'primeira')]

    rerender({ messages: first })
    rerender({ messages: [...first, message('ana', 'segunda')] })

    expect(result.current.preview?.text).toBe('segunda')
    expect(playChatMessageBeep).toHaveBeenCalledOnce()
  })

  it('volta a tocar depois do intervalo do bipe', () => {
    const { rerender } = renderAlerts({ messages: [] })
    const first = [message('ana', 'primeira')]
    rerender({ messages: first })

    act(() => {
      vi.advanceTimersByTime(ROOM_CHAT_BEEP_COOLDOWN_MS)
    })
    rerender({ messages: [...first, message('ana', 'segunda')] })

    expect(playChatMessageBeep).toHaveBeenCalledTimes(2)
  })

  it('trocar de sala zera o histórico sem disparar aviso', () => {
    const { result, rerender } = renderAlerts({ messages: [] })
    rerender({ messages: [message('ana', 'oi'), message('ana', 'tudo bem?')] })
    act(() => {
      result.current.dismissPreview()
    })
    playChatMessageBeep.mockClear()

    rerender({ messages: [] })

    expect(result.current.preview).toBeNull()
    expect(playChatMessageBeep).not.toHaveBeenCalled()
  })

  it('abrir o chat dispensa a prévia que estava na tela', () => {
    const { result, rerender } = renderAlerts({ messages: [] })
    rerender({ messages: [message('ana', 'oi')] })
    expect(result.current.preview).not.toBeNull()

    rerender({ messages: [message('ana', 'oi')], chatOpen: true })

    expect(result.current.preview).toBeNull()
  })

  it('não re-avisa quando a lista é a mesma em outra identidade de array', () => {
    const { result, rerender } = renderAlerts({ messages: [] })
    rerender({ messages: [message('ana', 'oi')] })
    act(() => {
      result.current.dismissPreview()
    })

    rerender({ messages: [message('ana', 'oi')] })

    expect(result.current.preview).toBeNull()
    expect(playChatMessageBeep).toHaveBeenCalledOnce()
  })
})
