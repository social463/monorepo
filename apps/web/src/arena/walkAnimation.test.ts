import { describe, expect, it } from 'vitest'
import { walkAnimationAction } from './walkAnimation'

const base = { moving: true, exists: true, currentKey: 'walk-down', isPlaying: true, animKey: 'walk-down' }

describe('walkAnimationAction', () => {
  it('andando na mesma direção, com a animação rodando: não reinicia', () => {
    expect(walkAnimationAction(base)).toBe('manter')
  })

  it('parado: para a animação', () => {
    expect(walkAnimationAction({ ...base, moving: false })).toBe('parar')
  })

  it('virou: toca a animação da direção nova', () => {
    expect(walkAnimationAction({ ...base, animKey: 'walk-left' })).toBe('tocar')
  })

  /**
   * O bug relatado: `anims.stop()` NÃO limpa `currentAnim`. Quem parou e volta
   * a andar na MESMA direção mantém a key, então comparar só a key não
   * reiniciava nada — o personagem deslizava sem mexer as pernas e só
   * destravava ao virar para cima ou para baixo.
   */
  it('parou e voltou a andar na mesma direção: toca de novo', () => {
    expect(walkAnimationAction({ ...base, isPlaying: false })).toBe('tocar')
  })

  it('sheet ainda compondo (animação inexistente): fica parado, sem estourar', () => {
    expect(walkAnimationAction({ ...base, exists: false })).toBe('parar')
  })

  it('nunca tocou nada ainda: toca', () => {
    expect(walkAnimationAction({ ...base, currentKey: undefined, isPlaying: false })).toBe('tocar')
  })
})
