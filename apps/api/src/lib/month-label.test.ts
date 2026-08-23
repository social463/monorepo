import { describe, it, expect } from 'vitest'
import { monthLabel, monthName } from './month-label'

describe('monthLabel', () => {
  it('formats a YYYY-MM into a Brazilian month label', () => {
    expect(monthLabel('2026-06')).toBe('Junho de 2026')
    expect(monthLabel('2026-01')).toBe('Janeiro de 2026')
    expect(monthLabel('2026-12')).toBe('Dezembro de 2026')
  })
})

describe('monthName', () => {
  it('returns just the Brazilian month name', () => {
    expect(monthName('2026-07')).toBe('Julho')
    expect(monthName('2026-01')).toBe('Janeiro')
    expect(monthName('2026-12')).toBe('Dezembro')
  })
})
