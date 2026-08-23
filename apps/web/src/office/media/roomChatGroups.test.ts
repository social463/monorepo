import { describe, it, expect } from 'vitest'
import { groupRoomChatMessages, ROOM_CHAT_GROUP_WINDOW_MS } from './roomChatGroups'
import type { RoomChatMessage } from './useRoomChat'

function message(userId: string, text: string, sentAt: string): RoomChatMessage {
  return { userId, name: userId === 'ana' ? 'Ana' : 'Bruno', text, sentAt }
}

const START = Date.parse('2026-01-01T10:00:00.000Z')
const at = (offsetMs: number) => new Date(START + offsetMs).toISOString()

describe('groupRoomChatMessages', () => {
  it('junta mensagens seguidas da mesma pessoa dentro da janela', () => {
    const groups = groupRoomChatMessages([
      message('ana', 'oi', at(0)),
      message('ana', 'tudo bem?', at(2000)),
      message('ana', 'bora?', at(4000)),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('Ana')
    expect(groups[0].messages.map((m) => m.text)).toEqual(['oi', 'tudo bem?', 'bora?'])
  })

  it('abre bloco novo quando outra pessoa fala no meio', () => {
    const groups = groupRoomChatMessages([
      message('ana', 'oi', at(0)),
      message('bruno', 'e aí', at(1000)),
      message('ana', 'voltei', at(2000)),
    ])

    expect(groups.map((group) => group.userId)).toEqual(['ana', 'bruno', 'ana'])
    expect(groups.every((group) => group.messages.length === 1)).toBe(true)
  })

  it('abre bloco novo quando a mesma pessoa volta a falar depois da janela', () => {
    const groups = groupRoomChatMessages([
      message('ana', 'oi', at(0)),
      message('ana', 'ainda por aqui', at(ROOM_CHAT_GROUP_WINDOW_MS + 1000)),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0].key).not.toBe(groups[1].key)
  })

  it('mantém o bloco quando o relógio de quem enviou está alguns segundos atrás', () => {
    const groups = groupRoomChatMessages([
      message('ana', 'oi', at(0)),
      message('ana', 'de novo', at(-3000)),
    ])

    expect(groups).toHaveLength(1)
  })

  it('devolve lista vazia sem mensagens', () => {
    expect(groupRoomChatMessages([])).toEqual([])
  })
})
