import { describe, it, expect } from 'vitest'
import { makeFloatingReaction, FLOAT_REACTION_TTL_MS, FLOAT_REACTION_THROTTLE_MS } from './floating-reactions'

describe('makeFloatingReaction', () => {
  it('constrói a reação com id, dados e xPercent na faixa 8–88', () => {
    const r = makeFloatingReaction({ userId: 'u1', name: 'Dan', emoji: '❤️' }, { id: 'r1', rand: 0 })
    expect(r).toEqual({ id: 'r1', userId: 'u1', name: 'Dan', emoji: '❤️', xPercent: 8 })
    const r2 = makeFloatingReaction({ userId: 'u2', name: 'Ana', emoji: '🎉' }, { id: 'r2', rand: 1 })
    expect(r2.xPercent).toBe(88)
  })

  it('expõe TTL e throttle coerentes com a animação', () => {
    expect(FLOAT_REACTION_TTL_MS).toBe(2500)
    expect(FLOAT_REACTION_THROTTLE_MS).toBe(400)
  })
})
