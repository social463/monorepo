import { describe, it, expect } from 'vitest'
import { PROXIMITY_RADIUS } from './office-media'
import {
  ARENA_LOBBY_ID,
  ARENA_VOICE_RADIUS_TILES,
  ARENA_VOICE_SUBSCRIBE_RADIUS_TILES,
  arenaMediaRoom,
  isWithinArenaVoiceRange,
} from './arena-media'

describe('sala de mídia da arena', () => {
  it('leva a empresa no nome — o modo é igual em todo tenant', () => {
    expect(arenaMediaRoom('empresa-1', 'mata-mata')).toBe('arena-empresa-1-mata-mata')
    expect(arenaMediaRoom('empresa-1', 'mata-mata')).not.toBe(
      arenaMediaRoom('empresa-2', 'mata-mata'),
    )
  })

  it('o saguão é uma sala como as outras', () => {
    expect(arenaMediaRoom('empresa-1', ARENA_LOBBY_ID)).toBe('arena-empresa-1-lobby')
  })
})

describe('alcance da voz', () => {
  // O mapa da arena tem 121×85 tiles e a câmera sozinha mostra ~20: com o raio
  // do escritório, dois jogadores visíveis na tela ficariam mudos.
  it('é bem maior que o do escritório', () => {
    expect(ARENA_VOICE_RADIUS_TILES).toBeGreaterThan(PROXIMITY_RADIUS * 3)
  })

  it('assina antes de ouvir — a margem cobre quem está chegando', () => {
    expect(ARENA_VOICE_SUBSCRIBE_RADIUS_TILES).toBeGreaterThan(ARENA_VOICE_RADIUS_TILES)
    expect(isWithinArenaVoiceRange(ARENA_VOICE_RADIUS_TILES + 1, 0)).toBe(true)
  })

  it('fora do raio de assinatura, não assina', () => {
    expect(isWithinArenaVoiceRange(ARENA_VOICE_SUBSCRIBE_RADIUS_TILES + 0.1, 0)).toBe(false)
    // Euclidiana, não Chebyshev: a diagonal conta.
    expect(
      isWithinArenaVoiceRange(ARENA_VOICE_SUBSCRIBE_RADIUS_TILES, ARENA_VOICE_SUBSCRIBE_RADIUS_TILES),
    ).toBe(false)
  })
})
