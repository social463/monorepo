import { describe, it, expect } from 'vitest'
import type { OfficeOccupant } from '@legends/shared'
import type { RemoteMedia } from './media/useOfficeMedia'
import { nearbyRemotesForGrid } from './nearbyRemotesForGrid'

function occupant(userId: string, x: number, y: number): OfficeOccupant {
  return { userId, name: userId, x, y, dir: 'down', avatarSeed: null, avatarOptions: null }
}

function remote(userId: string): RemoteMedia {
  return {
    userId,
    name: userId,
    audioTrack: null,
    cameraTrack: null,
    screenTrack: null,
    screenAudioTrack: null,
    micOpen: false,
    speaking: false,
  }
}

describe('nearbyRemotesForGrid', () => {
  it('no espaço aberto, mantém só quem está dentro do raio de proximidade', () => {
    const you = occupant('you', 10, 5)
    const occupants = [you, occupant('near', 12, 5), occupant('far', 20, 5)]
    const remotes = [remote('near'), remote('far')]

    const result = nearbyRemotesForGrid(remotes, occupants, you, false)

    expect(result.map((r) => r.userId)).toEqual(['near'])
  })

  it('dentro de sala de reunião/zona privada (inZone), não filtra ninguém', () => {
    const you = occupant('you', 10, 5)
    const occupants = [you, occupant('far', 20, 5)]
    const remotes = [remote('far')]

    const result = nearbyRemotesForGrid(remotes, occupants, you, true)

    expect(result.map((r) => r.userId)).toEqual(['far'])
  })

  it('sem "you" resolvido ainda, não filtra nada (evita esconder todo mundo por engano)', () => {
    const remotes = [remote('far')]

    const result = nearbyRemotesForGrid(remotes, [occupant('far', 20, 5)], null, false)

    expect(result.map((r) => r.userId)).toEqual(['far'])
  })

  it('remoto sem occupant correspondente (já saiu do escritório) é excluído no espaço aberto', () => {
    const you = occupant('you', 10, 5)
    const remotes = [remote('ghost')]

    const result = nearbyRemotesForGrid(remotes, [you], you, false)

    expect(result).toHaveLength(0)
  })
})
