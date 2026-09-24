import { describe, it, expect, beforeEach } from 'vitest'
import { ROOM_CHAT_MESSAGE_MAX_LENGTH, type ArenaLobbyServerMessage } from '@legends/shared'
import {
  ArenaLobbyHub,
  __resetArenaLobbyHubs,
  getArenaLobbyHub,
  type ArenaLobbySocket,
} from './arena-lobby-hub'

function fakeSocket() {
  const sent: ArenaLobbyServerMessage[] = []
  const socket: ArenaLobbySocket = { send: (data: string) => void sent.push(JSON.parse(data)) }
  return { socket, sent }
}

const ana = { userId: 'ana', name: 'Ana' }
const bruno = { userId: 'bruno', name: 'Bruno' }

let hub: ArenaLobbyHub

beforeEach(() => {
  __resetArenaLobbyHubs()
  hub = new ArenaLobbyHub()
})

describe('presença', () => {
  it('dá as boas-vindas com quem já está no saguão', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const b = fakeSocket()
    hub.join(b.socket, bruno)

    const welcome = b.sent.find((m) => m.type === 'welcome')
    expect(welcome).toMatchObject({ type: 'welcome', youId: 'bruno' })
    expect(welcome?.type === 'welcome' && welcome.members.map((m) => m.userId).sort()).toEqual([
      'ana',
      'bruno',
    ])
  })

  it('avisa os outros de quem entrou e de quem saiu', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const b = fakeSocket()
    hub.join(b.socket, bruno)

    expect(a.sent.some((m) => m.type === 'joined' && m.member.userId === 'bruno')).toBe(true)
    // Quem entra não recebe o próprio `joined` — ele já está no `welcome`.
    expect(b.sent.some((m) => m.type === 'joined')).toBe(false)

    hub.leave(b.socket, 'bruno')
    expect(a.sent.some((m) => m.type === 'left' && m.userId === 'bruno')).toBe(true)
  })

  it('segunda aba entra na mesma presença e não derruba a primeira', () => {
    const aba1 = fakeSocket()
    const aba2 = fakeSocket()
    hub.join(aba1.socket, ana)
    hub.join(aba2.socket, ana)
    expect(hub.size()).toBe(1)

    hub.leave(aba1.socket, 'ana')
    expect(hub.nameOf('ana')).toBe('Ana')

    hub.leave(aba2.socket, 'ana')
    expect(hub.nameOf('ana')).toBeNull()
  })

  it('`nameOf` é a credencial do token de mídia', () => {
    expect(hub.nameOf('ana')).toBeNull()
    const a = fakeSocket()
    hub.join(a.socket, ana)
    expect(hub.nameOf('ana')).toBe('Ana')
  })
})

describe('chat', () => {
  it('retransmite para os outros, nunca para quem escreveu', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.chat(a.socket, 'ana', 'bora de bandeira?')

    expect(b.sent.filter((m) => m.type === 'chat')).toMatchObject([
      { userId: 'ana', name: 'Ana', text: 'bora de bandeira?' },
    ])
    expect(a.sent.some((m) => m.type === 'chat')).toBe(false)
  })

  it('descarta mensagem vazia e corta no limite', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.chat(a.socket, 'ana', '   ')
    expect(b.sent.some((m) => m.type === 'chat')).toBe(false)

    hub.chat(a.socket, 'ana', 'x'.repeat(ROOM_CHAT_MESSAGE_MAX_LENGTH + 50))
    const chat = b.sent.find((m) => m.type === 'chat')
    expect(chat?.type === 'chat' && chat.text.length).toBe(ROOM_CHAT_MESSAGE_MAX_LENGTH)
  })

  it('ignora quem manda pelo socket de outra pessoa', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    // Socket da Ana dizendo ser o Bruno: é o mesmo cuidado do `socketOwner` da
    // arena e do escritório.
    hub.chat(a.socket, 'bruno', 'me passa a bandeira')
    expect(a.sent.some((m) => m.type === 'chat')).toBe(false)
    expect(b.sent.some((m) => m.type === 'chat')).toBe(false)
  })
})

describe('registry', () => {
  it('uma instância por empresa', () => {
    expect(getArenaLobbyHub('empresa-1')).toBe(getArenaLobbyHub('empresa-1'))
    expect(getArenaLobbyHub('empresa-1')).not.toBe(getArenaLobbyHub('empresa-2'))
  })
})
