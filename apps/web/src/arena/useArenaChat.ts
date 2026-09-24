import { useCallback, useRef, useState } from 'react'
import { ROOM_CHAT_MESSAGE_MAX_LENGTH } from '@legends/shared'
import type { RoomChatMessage } from '../office/media/useRoomChat'

export interface ArenaChatSender {
  userId: string
  name: string
}

export interface ArenaChatState {
  messages: RoomChatMessage[]
  /** Chegaram com o painel fechado. Zera em `markRead`. */
  unread: number
  markRead(): void
  /** Chamado pelo handler do socket quando chega um `chat` do servidor. */
  receive(message: RoomChatMessage): void
  sendMessage(text: string): boolean
  /** Trocar de arena (ou voltar ao menu) zera a conversa — como no escritório. */
  reset(): void
}

/**
 * Histórico local da permanência atual — arena ou saguão.
 *
 * Mesmo desenho do `useRoomChat` do escritório: nada é persistido, a mensagem
 * própria entra na hora e o servidor só retransmite para os outros. A
 * diferença é a plumbing: o socket da arena entrega tudo por UM callback (não
 * há barramento como o `OfficeBridge`), então quem recebe é o `receive` daqui,
 * chamado pelo handler da página.
 */
export function useArenaChat({
  send,
  sender,
  connected,
  open,
}: {
  send: (text: string) => void
  sender: ArenaChatSender | null
  connected: boolean
  /** Painel aberto: o que chega já nasce lido. */
  open: boolean
}): ArenaChatState {
  const [messages, setMessages] = useState<RoomChatMessage[]>([])
  const [unread, setUnread] = useState(0)
  const openRef = useRef(open)
  openRef.current = open

  const receive = useCallback((message: RoomChatMessage) => {
    setMessages((current) => [...current, message])
    if (!openRef.current) setUnread((count) => count + 1)
  }, [])

  const markRead = useCallback(() => setUnread(0), [])

  const reset = useCallback(() => {
    setMessages([])
    setUnread(0)
  }, [])

  const sendMessage = useCallback(
    (text: string) => {
      if (!sender || !connected) return false
      const trimmed = text.trim().slice(0, ROOM_CHAT_MESSAGE_MAX_LENGTH)
      if (!trimmed) return false
      setMessages((current) => [
        ...current,
        { userId: sender.userId, name: sender.name, text: trimmed, sentAt: new Date().toISOString() },
      ])
      send(trimmed)
      return true
    },
    [connected, send, sender],
  )

  return { messages, unread, markRead, receive, sendMessage, reset }
}
