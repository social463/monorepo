import { describe, it, expect, vi } from 'vitest'
import { RetroHub } from './retro-hub'

function fakeConn(userId: string, name = userId) {
  return { socket: { send: vi.fn() }, userId, name }
}

describe('RetroHub', () => {
  it('faz broadcast só para quem o build retorna payload', () => {
    const hub = new RetroHub()
    const a = fakeConn('u1')
    const b = fakeConn('u2')
    hub.subscribe('r1', a)
    hub.subscribe('r1', b)

    hub.broadcast('r1', (viewerId) => (viewerId === 'u1' ? { hi: viewerId } : null))

    expect(a.socket.send).toHaveBeenCalledWith(JSON.stringify({ hi: 'u1' }))
    expect(b.socket.send).not.toHaveBeenCalled()
  })

  it('presença lista userIds únicos e cai ao desinscrever', () => {
    const hub = new RetroHub()
    const a1 = fakeConn('u1')
    const a2 = fakeConn('u1') // segunda aba do mesmo usuário
    const b = fakeConn('u2')
    hub.subscribe('r1', a1)
    hub.subscribe('r1', a2)
    hub.subscribe('r1', b)
    expect(hub.presentUserIds('r1').sort()).toEqual(['u1', 'u2'])

    hub.unsubscribe('r1', b)
    expect(hub.presentUserIds('r1')).toEqual(['u1'])

    hub.unsubscribe('r1', a1)
    expect(hub.presentUserIds('r1')).toEqual(['u1']) // u1 ainda tem a2 aberta
  })

  it('não vaza entre salas', () => {
    const hub = new RetroHub()
    const a = fakeConn('u1')
    hub.subscribe('r1', a)
    hub.broadcast('r2', () => ({ x: 1 }))
    expect(a.socket.send).not.toHaveBeenCalled()
  })
})

describe('RetroHub soft-lock', () => {
  it('grab trava; segundo grab de outro usuário é negado; drop libera', () => {
    const hub = new RetroHub()
    expect(hub.grabCard('r1', 'c1', 'u1', 'Ana')).toBe(true)
    expect(hub.grabCard('r1', 'c1', 'u2', 'Bia')).toBe(false)
    expect(hub.lockOwner('r1', 'c1')).toEqual({ userId: 'u1', name: 'Ana' })
    expect(hub.dropCard('r1', 'c1', 'u2')).toBe(false) // não é o dono
    expect(hub.dropCard('r1', 'c1', 'u1')).toBe(true)
    expect(hub.lockOwner('r1', 'c1')).toBeUndefined()
    expect(hub.grabCard('r1', 'c1', 'u2', 'Bia')).toBe(true) // agora livre
  })

  it('releaseLocksHeldBy libera todos os locks do usuário e retorna os cardIds', () => {
    const hub = new RetroHub()
    hub.grabCard('r1', 'c1', 'u1', 'Ana')
    hub.grabCard('r1', 'c2', 'u1', 'Ana')
    hub.grabCard('r1', 'c3', 'u2', 'Bia')
    const freed = hub.releaseLocksHeldBy('r1', 'u1').sort()
    expect(freed).toEqual(['c1', 'c2'])
    expect(hub.lockOwner('r1', 'c3')).toEqual({ userId: 'u2', name: 'Bia' })
  })
})
