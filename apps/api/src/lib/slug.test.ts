import { describe, it, expect } from 'vitest'
import { slugify } from './slug'

describe('slugify', () => {
  it('lowercases and removes accents', () => {
    expect(slugify('Colaboração')).toBe('colaboracao')
  })

  it('replaces spaces and punctuation with hyphens', () => {
    expect(slugify('Bug Killer do Mês!')).toBe('bug-killer-do-mes')
  })

  it('trims leading/trailing separators', () => {
    expect(slugify('  Inovação  ')).toBe('inovacao')
  })
})
