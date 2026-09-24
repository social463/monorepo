import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ROOM_CHAT_MESSAGE_MAX_LENGTH } from '@legends/shared'
import { useArenaChat } from './useArenaChat'

const ana = { userId: 'ana', name: 'Ana' }

function montar(options: { open?: boolean; connected?: boolean } = {}) {
  const send = vi.fn()
  const hook = renderHook(
    ({ open, connected }) => useArenaChat({ send, sender: ana, connected, open }),
    { initialProps: { open: options.open ?? false, connected: options.connected ?? true } },
  )
  return { hook, send }
}

describe('useArenaChat', () => {
  it('a mensagem própria entra na hora e sai pelo socket', () => {
    const { hook, send } = montar()
    act(() => {
      expect(hook.result.current.sendMessage('cobre a base')).toBe(true)
    })
    expect(send).toHaveBeenCalledWith('cobre a base')
    expect(hook.result.current.messages).toMatchObject([{ userId: 'ana', text: 'cobre a base' }])
  })

  it('não manda vazio nem desconectado', () => {
    const { hook, send } = montar({ connected: false })
    act(() => {
      expect(hook.result.current.sendMessage('oi')).toBe(false)
    })
    expect(send).not.toHaveBeenCalled()

    const conectado = montar()
    act(() => {
      expect(conectado.hook.result.current.sendMessage('   ')).toBe(false)
    })
    expect(conectado.send).not.toHaveBeenCalled()
  })

  it('corta no limite antes de mandar', () => {
    const { hook, send } = montar()
    act(() => {
      hook.result.current.sendMessage('z'.repeat(ROOM_CHAT_MESSAGE_MAX_LENGTH + 20))
    })
    expect(send.mock.calls[0][0]).toHaveLength(ROOM_CHAT_MESSAGE_MAX_LENGTH)
  })

  it('conta como não lida só o que chega com o painel fechado', () => {
    const { hook } = montar({ open: false })
    act(() => {
      hook.result.current.receive({ userId: 'bruno', name: 'Bruno', text: 'a caminho', sentAt: 'x' })
    })
    expect(hook.result.current.unread).toBe(1)

    hook.rerender({ open: true, connected: true })
    act(() => {
      hook.result.current.markRead()
      hook.result.current.receive({ userId: 'bruno', name: 'Bruno', text: 'cheguei', sentAt: 'y' })
    })
    expect(hook.result.current.unread).toBe(0)
    expect(hook.result.current.messages).toHaveLength(2)
  })

  it('trocar de arena zera a conversa', () => {
    const { hook } = montar()
    act(() => {
      hook.result.current.receive({ userId: 'bruno', name: 'Bruno', text: 'oi', sentAt: 'x' })
      hook.result.current.reset()
    })
    expect(hook.result.current.messages).toEqual([])
    expect(hook.result.current.unread).toBe(0)
  })
})
