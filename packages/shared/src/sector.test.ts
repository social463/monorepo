import { describe, it, expect } from 'vitest'
import { DEFAULT_SECTOR_ID } from './sector'
import { FEATURE_KEYS, FEATURE_LABELS } from './third-party'

describe('sector shared types', () => {
  it('expõe um DEFAULT_SECTOR_ID estável', () => {
    expect(DEFAULT_SECTOR_ID).toBe('sector-dev-produto')
  })

  it('todo FEATURE_KEYS tem rótulo em FEATURE_LABELS', () => {
    for (const key of FEATURE_KEYS) {
      expect(FEATURE_LABELS[key]).toBeTruthy()
    }
  })
})
