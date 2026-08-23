import { describe, it, expect } from 'vitest'
import { applyReactionToggle } from './use-reviews'

const me = { id: 'u1', name: 'Ana' }

describe('applyReactionToggle', () => {
  it('adiciona reação nova', () => {
    const out = applyReactionToggle([], '😂', me)
    expect(out).toEqual([{ emoji: '😂', count: 1, reactedByMe: true, users: [me] }])
  })

  it('remove reação existente do usuário', () => {
    const start = [{ emoji: '😂' as const, count: 1, reactedByMe: true, users: [me] }]
    expect(applyReactionToggle(start, '😂', me)).toEqual([])
  })

  it('incrementa quando outro já reagiu', () => {
    const start = [{ emoji: '😂' as const, count: 1, reactedByMe: false, users: [{ id: 'x', name: 'X' }] }]
    const out = applyReactionToggle(start, '😂', me)
    expect(out[0].count).toBe(2)
    expect(out[0].reactedByMe).toBe(true)
  })
})
