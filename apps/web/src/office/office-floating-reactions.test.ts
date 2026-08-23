import { describe, it, expect } from 'vitest'
import { makeOfficeFloatingReaction, OFFICE_FLOAT_REACTION_TTL_MS } from './office-floating-reactions'

const baseInput = {
  userId: 'u1',
  name: 'Dan',
  photoUrl: null,
  avatarStyle: null,
  avatarSeed: null,
  avatarOptions: null,
  emoji: '❤️',
}

describe('makeOfficeFloatingReaction', () => {
  it('constrói a reação com id, dados e xPercent na faixa 8–88', () => {
    const r = makeOfficeFloatingReaction(baseInput, { id: 'r1', rand: 0 })
    expect(r).toEqual({ id: 'r1', xPercent: 8, ...baseInput })

    const r2 = makeOfficeFloatingReaction({ ...baseInput, userId: 'u2', name: 'Ana', emoji: '🎉' }, { id: 'r2', rand: 1 })
    expect(r2.xPercent).toBe(88)
  })

  it('expõe TTL coerente com a animação (2.5s)', () => {
    expect(OFFICE_FLOAT_REACTION_TTL_MS).toBe(2500)
  })
})
