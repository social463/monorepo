import { describe, it, expect, vi } from 'vitest'
import { OneOnOneHub } from './one-on-one-hub'

function fakeConn(userId: string) {
  return { socket: { send: vi.fn() }, userId }
}

describe('OneOnOneHub', () => {
  it('entrega o evento só a quem foi endereçado', () => {
    const hub = new OneOnOneHub()
    const ana = fakeConn('ana')
    const bruno = fakeConn('bruno')
    const carla = fakeConn('carla')
    hub.subscribe(ana)
    hub.subscribe(bruno)
    hub.subscribe(carla)

    hub.emit(['ana', 'bruno'], { type: 'actions:changed' })

    const payload = JSON.stringify({ type: 'actions:changed' })
    expect(ana.socket.send).toHaveBeenCalledWith(payload)
    expect(bruno.socket.send).toHaveBeenCalledWith(payload)
    // O 1:1 é conversa fechada: quem não é do par não fica sabendo que mudou.
    expect(carla.socket.send).not.toHaveBeenCalled()
  })

  it('atende todas as abas da mesma pessoa', () => {
    const hub = new OneOnOneHub()
    const aba1 = fakeConn('ana')
    const aba2 = fakeConn('ana')
    hub.subscribe(aba1)
    hub.subscribe(aba2)

    hub.emit(['ana'], { type: 'meeting:changed', meetingId: 'm1' })

    expect(aba1.socket.send).toHaveBeenCalledOnce()
    expect(aba2.socket.send).toHaveBeenCalledOnce()
    expect(hub.connectionsOf('ana')).toBe(2)
  })

  it('não duplica o envio quando o mesmo id vem repetido', () => {
    const hub = new OneOnOneHub()
    const ana = fakeConn('ana')
    hub.subscribe(ana)

    hub.emit(['ana', 'ana'], { type: 'agenda:changed' })

    expect(ana.socket.send).toHaveBeenCalledOnce()
  })

  it('para de enviar após unsubscribe e não guarda a pessoa vazia', () => {
    const hub = new OneOnOneHub()
    const ana = fakeConn('ana')
    hub.subscribe(ana)
    hub.unsubscribe(ana)

    hub.emit(['ana'], { type: 'agenda:changed' })

    expect(ana.socket.send).not.toHaveBeenCalled()
    expect(hub.size()).toBe(0)
    expect(hub.connectionsOf('ana')).toBe(0)
  })

  it('um socket que lança no send não impede os demais', () => {
    const hub = new OneOnOneHub()
    const morto = {
      socket: {
        send: vi.fn(() => {
          throw new Error('dead')
        }),
      },
      userId: 'ana',
    }
    const vivo = fakeConn('bruno')
    hub.subscribe(morto)
    hub.subscribe(vivo)

    expect(() => hub.emit(['ana', 'bruno'], { type: 'pdi:changed' })).not.toThrow()
    expect(vivo.socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pdi:changed' }))
  })
})
