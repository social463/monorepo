import { describe, expect, it } from 'vitest'
import { ALL_AVATAR_STYLE_KEYS } from './avatar'

describe('avatar styles', () => {
  it('só o estilo lpc é gravável', () => {
    expect(ALL_AVATAR_STYLE_KEYS).toEqual(['lpc'])
  })
})
