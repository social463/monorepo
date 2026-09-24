import { describe, it, expect } from 'vitest'
import {
  OFFICE_USER_STATUSES,
  isOfficeUserStatus,
  isOfficeAudioIsolated,
  OFFICE_MAP,
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  OFFICE_SPAWN_TILES,
  isWalkable,
  isDirection,
  HIGH_FIVE_EMOJI,
  REACTION_ACTIVE_WINDOW_MS,
} from './index'
import type { OfficeClientMessage, OfficeServerMessage } from './index'

describe('mapa do escritório', () => {
  it('é retangular', () => {
    expect(OFFICE_MAP).toHaveLength(OFFICE_HEIGHT)
    for (const row of OFFICE_MAP) {
      expect(row).toHaveLength(OFFICE_WIDTH)
    }
  })

  it('é cercado por parede', () => {
    for (let x = 0; x < OFFICE_WIDTH; x += 1) {
      expect(isWalkable(x, 0)).toBe(false)
      expect(isWalkable(x, OFFICE_HEIGHT - 1)).toBe(false)
    }
    for (let y = 0; y < OFFICE_HEIGHT; y += 1) {
      expect(isWalkable(0, y)).toBe(false)
      expect(isWalkable(OFFICE_WIDTH - 1, y)).toBe(false)
    }
  })

  it('tem spawns, e todo spawn é andável', () => {
    expect(OFFICE_SPAWN_TILES.length).toBeGreaterThan(0)
    for (const tile of OFFICE_SPAWN_TILES) {
      expect(isWalkable(tile.x, tile.y)).toBe(true)
    }
  })

  it('trata coordenada fora do mapa como não-andável', () => {
    expect(isWalkable(-1, 5)).toBe(false)
    expect(isWalkable(5, -1)).toBe(false)
    expect(isWalkable(OFFICE_WIDTH, 5)).toBe(false)
    expect(isWalkable(5, OFFICE_HEIGHT)).toBe(false)
  })
})

describe('isDirection', () => {
  it('aceita as quatro direções e rejeita o resto', () => {
    expect(isDirection('up')).toBe(true)
    expect(isDirection('down')).toBe(true)
    expect(isDirection('left')).toBe(true)
    expect(isDirection('right')).toBe(true)
    expect(isDirection('diagonal')).toBe(false)
    expect(isDirection(42)).toBe(false)
    expect(isDirection(undefined)).toBe(false)
  })
})

describe('contrato de confete', () => {
  it('aceita as mensagens de confete/comemoração nas uniões', () => {
    const client: OfficeClientMessage = { type: 'confetti', active: true }
    const serverConfetti: OfficeServerMessage = { type: 'confetti', userId: 'ana', active: false }
    const serverCelebration: OfficeServerMessage = { type: 'celebration' }

    expect(client).toEqual({ type: 'confetti', active: true })
    expect(serverConfetti).toMatchObject({ type: 'confetti', userId: 'ana', active: false })
    expect(serverCelebration.type).toBe('celebration')
  })
})

describe('high-five', () => {
  it('aceita a mensagem de high-five na união do servidor', () => {
    const message: OfficeServerMessage = { type: 'high-five', userIds: ['ana', 'bruno'], perfect: false }
    expect(message.userIds).toHaveLength(2)
  })

  it('expõe o emoji do gesto e a janela de validade da reação', () => {
    expect(HIGH_FIVE_EMOJI).toBe('👋')
    expect(REACTION_ACTIVE_WINDOW_MS).toBe(3000)
  })
})

describe('call-failed', () => {
  it('aceita o motivo "away" na união do servidor', () => {
    const message: OfficeServerMessage = { type: 'call-failed', targetUserId: 'ana', reason: 'away' }
    expect(message.reason).toBe('away')
  })
})

describe('status "Ocupado" e moderação de sala (#22775)', () => {
  it('busy entra no catálogo de status e é aceito pelo guard', () => {
    expect(OFFICE_USER_STATUSES).toContain('busy')
    expect(isOfficeUserStatus('busy')).toBe(true)
    expect(isOfficeUserStatus('offline')).toBe(false)
  })

  it('só Ocupado isola o áudio — os outros status não', () => {
    expect(isOfficeAudioIsolated('busy')).toBe(true)
    expect(isOfficeAudioIsolated('away')).toBe(false)
    expect(isOfficeAudioIsolated('brb')).toBe(false)
    expect(isOfficeAudioIsolated('online')).toBe(false)
    expect(isOfficeAudioIsolated(undefined)).toBe(false)
  })

  it('aceita a remoção de participante nas duas pontas do contrato', () => {
    const pedido: OfficeClientMessage = { type: 'remove-from-room', userId: 'bruno' }
    const aviso: OfficeServerMessage = {
      type: 'removed-from-room',
      roomId: 'room-1',
      userId: 'bruno',
      byUserId: 'ana',
      byName: 'Ana',
    }
    expect(pedido.userId).toBe('bruno')
    expect(aviso.byName).toBe('Ana')
  })

  it('aceita a lista de managers na união do servidor', () => {
    const message: OfficeServerMessage = {
      type: 'room-managers-changed',
      managers: [{ roomId: 'room-1', userId: 'ana', byDeskOwner: true }],
    }
    expect(message.managers[0]?.byDeskOwner).toBe(true)
  })
})
