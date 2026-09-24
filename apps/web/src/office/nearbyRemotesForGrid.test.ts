import { describe, it, expect } from 'vitest'
import type { OfficeOccupant } from '@legends/shared'
import type { RemoteMedia } from './media/useOfficeMedia'
import { nearbyRemotesForGrid } from './nearbyRemotesForGrid'

/** Tile do mapa nos casos comuns; o último caso usa 48 de propósito. */
const TILE = 32

/**
 * O fixture recebe TILE e converte, porque é assim que se pensa o cenário ("ele
 * está a oito tiles"). O occupant, esse, fala PIXEL desde o movimento livre.
 */
function occupant(userId: string, tileX: number, tileY: number, tile = TILE): OfficeOccupant {
  return {
    userId,
    name: userId,
    x: tileX * tile + tile / 2,
    y: tileY * tile + tile / 2,
    dir: 'down',
    avatarSeed: null,
    avatarOptions: null,
  }
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

    const result = nearbyRemotesForGrid(remotes, occupants, you, false, TILE)

    expect(result.map((r) => r.userId)).toEqual(['near'])
  })

  it('dentro de sala de reunião/zona privada (inZone), não filtra ninguém', () => {
    const you = occupant('you', 10, 5)
    const occupants = [you, occupant('far', 20, 5)]
    const remotes = [remote('far')]

    const result = nearbyRemotesForGrid(remotes, occupants, you, true, TILE)

    expect(result.map((r) => r.userId)).toEqual(['far'])
  })

  it('sem "you" resolvido ainda, não filtra nada (evita esconder todo mundo por engano)', () => {
    const remotes = [remote('far')]

    const result = nearbyRemotesForGrid(remotes, [occupant('far', 20, 5)], null, false, TILE)

    expect(result.map((r) => r.userId)).toEqual(['far'])
  })

  it('remoto sem occupant correspondente (já saiu do escritório) é excluído no espaço aberto', () => {
    const you = occupant('you', 10, 5)
    const remotes = [remote('ghost')]

    const result = nearbyRemotesForGrid(remotes, [you], you, false, TILE)

    expect(result).toHaveLength(0)
  })
})

describe('nearbyRemotesForGrid em mapa que não é de 32', () => {
  it('mede o raio pela régua do mapa ATIVO', () => {
    const you = occupant('you', 10, 5, 48)
    const perto = occupant('perto', 13, 5, 48) // 3 tiles de 48: dentro do raio
    const remotes = [remote('perto')]

    expect(nearbyRemotesForGrid(remotes, [you, perto], you, false, 48).map((r) => r.userId)).toEqual([
      'perto',
    ])
    // Com a régua do mapa legado, os mesmos pixels dão 4 tiles e a câmera do
    // colega ao lado some da grade.
    expect(nearbyRemotesForGrid(remotes, [you, perto], you, false, 32)).toHaveLength(0)
  })
})
