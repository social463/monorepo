import { describe, it, expect } from 'vitest'
import { buildMonthGrid, shiftMonth, isWeekendYmd } from './streak-calendar'

describe('streak-calendar', () => {
  it('buildMonthGrid gera 42 células começando no domingo', () => {
    const grid = buildMonthGrid('2026-06') // 1/jun/2026 é segunda → domingo anterior é 31/mai
    expect(grid).toHaveLength(42)
    expect(grid[0]).toMatchObject({ ymd: '2026-05-31', day: 31, inMonth: false })
    expect(grid[1]).toMatchObject({ ymd: '2026-06-01', day: 1, inMonth: true })
    expect(grid[30]).toMatchObject({ ymd: '2026-06-30', day: 30, inMonth: true })
  })

  it('shiftMonth navega entre meses e anos', () => {
    expect(shiftMonth('2026-06', 1)).toBe('2026-07')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('isWeekendYmd identifica sábado e domingo', () => {
    expect(isWeekendYmd('2026-06-06')).toBe(true) // sábado
    expect(isWeekendYmd('2026-06-07')).toBe(true) // domingo
    expect(isWeekendYmd('2026-06-05')).toBe(false) // sexta
    expect(isWeekendYmd('2026-06-08')).toBe(false) // segunda
  })
})
