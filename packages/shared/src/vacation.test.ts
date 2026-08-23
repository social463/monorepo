import { describe, it, expect } from 'vitest'
import { overlaps, VACATION_NOTE_MAX_LENGTH } from './vacation'
import { FEATURE_KEYS, FEATURE_LABELS } from './third-party'

describe('overlaps', () => {
  it('detecta interseção parcial nas duas direções', () => {
    expect(overlaps('2026-08-01', '2026-08-10', '2026-08-05', '2026-08-15')).toBe(true)
    expect(overlaps('2026-08-05', '2026-08-15', '2026-08-01', '2026-08-10')).toBe(true)
  })

  it('trata como sobreposição quando as bordas se encostam', () => {
    expect(overlaps('2026-08-01', '2026-08-10', '2026-08-10', '2026-08-12')).toBe(true)
  })

  it('não sobrepõe períodos disjuntos', () => {
    expect(overlaps('2026-08-01', '2026-08-10', '2026-08-11', '2026-08-12')).toBe(false)
  })

  it('detecta período contido em outro', () => {
    expect(overlaps('2026-08-01', '2026-08-31', '2026-08-10', '2026-08-12')).toBe(true)
  })
})

describe('feature calendario', () => {
  it('está na lista de features com label em português', () => {
    expect(FEATURE_KEYS).toContain('calendario')
    expect(FEATURE_LABELS.calendario).toBe('Calendário')
  })

  it('expõe o teto da observação', () => {
    expect(VACATION_NOTE_MAX_LENGTH).toBe(200)
  })
})
