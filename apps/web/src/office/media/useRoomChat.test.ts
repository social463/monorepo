import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ROOM_CHAT_MESSAGE_MAX_LENGTH } from '@legends/shared'
import { OfficeBridge } from '../OfficeBridge'
import { useRoomChat } from './useRoomChat'

const ana = { userId: 'ana', name: 'Ana' }

function renderRoomChat(roomId: string | null = 'room-1', connected = true) {
  const bridge = new OfficeBridge()
  const hook = renderHook(
    ({ roomId, connected }) => useRoomChat(bridge, roomId, ana, connected),
    { initialProps: { roomId, connected } },
  )
  return { bridge, ...hook }
}

describe('useRoomChat', () => {
  it('adiciona a mensagem própria imediatamente e a envia pelo bridge', () => {
    const { bridge, result } = renderRoomChat()
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => expect(result.current.sendMessage('  oi pessoal  ')).toBe(true))

    expect(result.current.messages).toEqual([
      expect.objectContaining({ userId: 'ana', name: 'Ana', text: 'oi pessoal' }),
    ])
    expect(sent).toEqual([{ type: 'room-chat-message', text: 'oi pessoal' }])
  })

  it('acumula mensagens recebidas da sala atual e ignora outras salas', () => {
    const { bridge, result } = renderRoomChat()

    act(() => {
      bridge.emitServerMessage({
        type: 'room-chat-message',
        roomId: 'room-2',
        userId: 'outra',
        name: 'Outra',
        text: 'ignorar',
        sentAt: '2026-01-01T00:00:00.000Z',
      })
      bridge.emitServerMessage({
        type: 'room-chat-message',
        roomId: 'room-1',
        userId: 'bruno',
        name: 'Bruno',
        text: 'oi',
        sentAt: '2026-01-01T00:00:01.000Z',
      })
    })

    expect(result.current.messages).toEqual([
      { userId: 'bruno', name: 'Bruno', text: 'oi', sentAt: '2026-01-01T00:00:01.000Z' },
    ])
  })

  it('zera as mensagens ao sair e não as recupera ao reentrar', () => {
    const { bridge, result, rerender } = renderRoomChat()
    act(() => {
      bridge.emitServerMessage({
        type: 'room-chat-message',
        roomId: 'room-1',
        userId: 'bruno',
        name: 'Bruno',
        text: 'mensagem antiga',
        sentAt: '2026-01-01T00:00:00.000Z',
      })
    })
    expect(result.current.messages).toHaveLength(1)

    rerender({ roomId: null, connected: true })
    expect(result.current.messages).toEqual([])

    rerender({ roomId: 'room-1', connected: true })
    expect(result.current.messages).toEqual([])
  })

  it('mantém as mensagens enquanto a sala não muda', () => {
    const { result, rerender } = renderRoomChat()
    act(() => result.current.sendMessage('continua aqui'))

    rerender({ roomId: 'room-1', connected: true })
    expect(result.current.messages).toHaveLength(1)
  })

  it('bloqueia envio fora da sala, desconectado ou com texto vazio', () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))
    const { result, rerender } = renderHook(
      ({ roomId, connected }) => useRoomChat(bridge, roomId, ana, connected),
      { initialProps: { roomId: null as string | null, connected: true } },
    )

    expect(result.current.canSend).toBe(false)
    act(() => expect(result.current.sendMessage('oi')).toBe(false))

    rerender({ roomId: 'room-1', connected: false })
    expect(result.current.canSend).toBe(false)
    act(() => expect(result.current.sendMessage('oi')).toBe(false))

    rerender({ roomId: 'room-1', connected: true })
    act(() => expect(result.current.sendMessage('   ')).toBe(false))
    expect(sent).toEqual([])
  })

  it('aplica ao texto o mesmo limite compartilhado com o servidor', () => {
    const { result } = renderRoomChat()
    act(() => result.current.sendMessage('x'.repeat(ROOM_CHAT_MESSAGE_MAX_LENGTH + 10)))
    expect(result.current.messages[0].text).toHaveLength(ROOM_CHAT_MESSAGE_MAX_LENGTH)
  })
})
