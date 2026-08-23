import { describe, expect, it } from 'vitest'
import type { OfficeRoomDTO } from '@legends/shared'
import { lockedZonesByExternalKey, sameLockedZones } from './lockedZones'

function sala(over: Partial<OfficeRoomDTO> & { id: string; externalKey: string }): OfficeRoomDTO {
  return {
    name: 'Sala',
    status: 'OPEN',
    capacity: null,
    voiceEnabled: true,
    accessPolicy: 'OPEN',
    allowedUsers: [],
    ...over,
  }
}

describe('lockedZonesByExternalKey', () => {
  it('traduz id de sala em externalKey — é o que a cena entende', () => {
    const rooms = [sala({ id: 'room-db-1', externalKey: 'aurora' })]

    expect(lockedZonesByExternalKey(rooms, ['room-db-1'])).toEqual(new Map([['aurora', 'session']]))
  })

  it('sala trancada no cadastro aparece como tranca de admin, sem ninguém dentro', () => {
    const rooms = [sala({ id: 'room-db-1', externalKey: 'aurora', status: 'LOCKED' })]

    expect(lockedZonesByExternalKey(rooms, [])).toEqual(new Map([['aurora', 'admin']]))
  })

  it('tranca de admin vence a de sessão: quem chega não entra de jeito nenhum', () => {
    const rooms = [sala({ id: 'room-db-1', externalKey: 'aurora', status: 'LOCKED' })]

    expect(lockedZonesByExternalKey(rooms, ['room-db-1']).get('aurora')).toBe('admin')
  })

  it('sala aberta não entra no mapa de trancas', () => {
    const rooms = [sala({ id: 'room-db-1', externalKey: 'aurora' }), sala({ id: 'room-db-2', externalKey: 'boreal' })]

    expect(lockedZonesByExternalKey(rooms, ['room-db-2'])).toEqual(new Map([['boreal', 'session']]))
  })

  it('id trancado que não existe mais no mapa é ignorado', () => {
    // Acontece de verdade: publicar mapa recria as salas, e uma tranca antiga
    // pode apontar pra uma linha que sumiu.
    expect(lockedZonesByExternalKey([sala({ id: 'room-db-1', externalKey: 'aurora' })], ['room-sumida']).size).toBe(0)
  })
})

describe('sameLockedZones', () => {
  it('mapas iguais não disparam redesenho', () => {
    expect(sameLockedZones(new Map([['a', 'session']]), new Map([['a', 'session']]))).toBe(true)
  })

  it('mudança de tipo conta como diferente — o cadeado muda de cor', () => {
    expect(sameLockedZones(new Map([['a', 'session']]), new Map([['a', 'admin']]))).toBe(false)
  })

  it('tamanho diferente é diferente', () => {
    expect(sameLockedZones(new Map(), new Map([['a', 'session']]))).toBe(false)
  })
})
