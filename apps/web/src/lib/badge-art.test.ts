import { describe, it, expect } from 'vitest'
import { BADGE_ART, DEFAULT_ART_KEY, badgeArt, badgeAccentColor } from './badge-art'

describe('badge-art catálogo', () => {
  it('tem entradas e todas apontam para /badge-art/<key>.png', () => {
    expect(BADGE_ART.length).toBeGreaterThanOrEqual(12)
    for (const art of BADGE_ART) {
      expect(art.src).toBe(`/badge-art/${art.key}.png`)
      expect(art.color).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(art.label.length).toBeGreaterThan(0)
    }
  })

  it('não tem chaves duplicadas', () => {
    const keys = BADGE_ART.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('DEFAULT_ART_KEY existe no catálogo', () => {
    expect(badgeArt(DEFAULT_ART_KEY)).toBeDefined()
  })

  it('badgeArt retorna item por chave e undefined p/ desconhecida', () => {
    expect(badgeArt('rocket')?.key).toBe('rocket')
    expect(badgeArt('chave-inexistente')).toBeUndefined()
  })

  it('badgeAccentColor usa a cor do catálogo, com fallback por kind', () => {
    expect(badgeAccentColor('rocket', 'IMPACT')).toBe(badgeArt('rocket')!.color)
    expect(badgeAccentColor('chave-inexistente', 'RECURRENCE')).toBe('#2dd4bf')
    expect(badgeAccentColor('chave-inexistente', 'KIND-DESCONHECIDO')).toBe('#52fba2')
  })
})
