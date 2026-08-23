import { describe, it, expect } from 'vitest'
import { effectiveFeatures } from './features'

describe('effectiveFeatures', () => {
  it('usa sectorFeatures para papéis normais', () => {
    const set = effectiveFeatures({ role: 'LEGEND', sectorFeatures: ['resenha', 'votar'], enabledFeatures: [] })
    expect(set.has('resenha')).toBe(true)
    expect(set.has('votar')).toBe(true)
    expect(set.has('lendas')).toBe(false)
  })

  it('usa enabledFeatures (allowlist individual) para THIRD_PARTY, ignorando sectorFeatures', () => {
    const set = effectiveFeatures({ role: 'THIRD_PARTY', sectorFeatures: ['resenha', 'votar'], enabledFeatures: ['escritorio'] })
    expect(set.has('escritorio')).toBe(true)
    expect(set.has('resenha')).toBe(false)
  })

  it('retorna set vazio sem role/features', () => {
    expect(effectiveFeatures({}).size).toBe(0)
  })
})
