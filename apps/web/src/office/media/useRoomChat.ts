import { useEffect, useRef, useState } from 'react'
import { ROOM_CHAT_MESSAGE_MAX_LENGTH } from '@legends/shared'
import type { OfficeBridge } from '../OfficeBridge'

export interface RoomChatMessage {
  userId: string
  name: string
  text: string
  sentAt: string
}

export interface RoomChatState {
  messages: RoomChatMessage[]
  canSend: boolean
  sendMessage: (text: string) => boolean
}

export interface RoomChatSender {
  userId: string
  name: string
}

/**
 * Histórico local da permanência atual na sala. A mensagem própria entra
 * imediatamente no estado; o servidor retransmite apenas para os outros
 * sockets da mesma sala. Trocar/sair da sala sempre zera a conversa.
 */
export function useRoomChat(
  bridge: OfficeBridge,
  roomId: string | null,
  sender: RoomChatSender | null,
  connected: boolean,
): RoomChatState {
  const [messages, setMessages] = useState<RoomChatMessage[]>([])
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId

  useEffect(() => {
    setMessages([])
  }, [roomId])

  useEffect(
    () =>
      bridge.onServerMessage((message) => {
        if (message.type === 'room-chat-message' && message.roomId === roomIdRef.current) {
          setMessages((current) => [
            ...current,
            { userId: message.userId, name: message.name, text: message.text, sentAt: message.sentAt },
          ])
        }
      }),
    [bridge],
  )

  function sendMessage(text: string) {
    if (!roomId || !sender || !connected) return false
    const trimmed = text.trim().slice(0, ROOM_CHAT_MESSAGE_MAX_LENGTH)
    if (!trimmed) return false

    setMessages((current) => [
      ...current,
      {
        userId: sender.userId,
        name: sender.name,
        text: trimmed,
        sentAt: new Date().toISOString(),
      },
    ])
    bridge.emitClientMessage({ type: 'room-chat-message', text: trimmed })
    return true
  }

  return { messages, canSend: roomId !== null && sender !== null && connected, sendMessage }
}
