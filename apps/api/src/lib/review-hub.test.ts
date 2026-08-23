import { describe, it, expect, vi } from 'vitest'
import { ReviewHub } from './review-hub'

function fakeConn() {
  return { socket: { send: vi.fn() } }
}

describe('ReviewHub', () => {
  it('faz broadcast do evento para todas as conexões inscritas', () => {
    const hub = new ReviewHub()
    const a = fakeConn()
    const b = fakeConn()
    hub.subscribe(a)
    hub.subscribe(b)

    hub.broadcast({ type: 'feed:changed' })

    const payload = JSON.stringify({ type: 'feed:changed' })
    expect(a.socket.send).toHaveBeenCalledWith(payload)
    expect(b.socket.send).toHaveBeenCalledWith(payload)
  })

  it('para de enviar após unsubscribe', () => {
    const hub = new ReviewHub()
    const a = fakeConn()
    hub.subscribe(a)
    hub.unsubscribe(a)

    hub.broadcast({ type: 'review:changed', reviewId: 'r1' })

    expect(a.socket.send).not.toHaveBeenCalled()
    expect(hub.size()).toBe(0)
  })

  it('um socket que lança no send não impede os demais', () => {
    const hub = new ReviewHub()
    const bad = { socket: { send: vi.fn(() => { throw new Error('dead') }) } }
    const good = fakeConn()
    hub.subscribe(bad)
    hub.subscribe(good)

    expect(() => hub.broadcast({ type: 'feed:changed' })).not.toThrow()
    expect(good.socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'feed:changed' }))
  })
})
