import type { RoomChatMessage } from './useRoomChat'

/**
 * Janela em que mensagens seguidas da mesma pessoa continuam o mesmo bloco —
 * o avatar e o nome só aparecem na primeira. Passou disso, a conversa já é
 * "outro momento" e vale repetir quem falou.
 */
export const ROOM_CHAT_GROUP_WINDOW_MS = 5 * 60 * 1000

export interface RoomChatGroup {
  /** Estável dentro da lista: id de quem falou + horário da primeira mensagem do bloco. */
  key: string
  userId: string
  name: string
  messages: RoomChatMessage[]
}

/**
 * O relógio da própria mensagem é o do browser de quem enviou (ver
 * `useRoomChat`), então comparamos o módulo da diferença: alguns segundos de
 * defasagem entre máquinas não podem quebrar um bloco. Horário impossível de
 * ler mantém o bloco, que é o resultado menos barulhento.
 */
function continuesBlock(previousSentAt: string, sentAt: string): boolean {
  const previous = Date.parse(previousSentAt)
  const current = Date.parse(sentAt)
  if (Number.isNaN(previous) || Number.isNaN(current)) return true
  return Math.abs(current - previous) <= ROOM_CHAT_GROUP_WINDOW_MS
}

/** Junta mensagens consecutivas da mesma pessoa, preservando a ordem recebida. */
export function groupRoomChatMessages(messages: RoomChatMessage[]): RoomChatGroup[] {
  const groups: RoomChatGroup[] = []
  for (const message of messages) {
    const current = groups[groups.length - 1]
    const previous = current?.messages[current.messages.length - 1]
    if (current && previous && current.userId === message.userId && continuesBlock(previous.sentAt, message.sentAt)) {
      current.messages.push(message)
      continue
    }
    groups.push({
      key: `${message.userId}-${message.sentAt}-${groups.length}`,
      userId: message.userId,
      name: message.name,
      messages: [message],
    })
  }
  return groups
}
