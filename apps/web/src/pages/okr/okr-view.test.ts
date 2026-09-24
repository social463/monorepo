import { describe, expect, it } from 'vitest'
import type { OkrCycleDTO, OkrKeyResultDTO } from '@legends/shared'
import { okrKeyResultView } from './okr-view'

const cycle = {
  progressRanges: [
    { min: null, max: 30, color: '#eb5656' },
    { min: 30, max: 60, color: '#fcb813' },
    { min: 60, max: 100, color: '#86bd49' },
    { min: 100, max: null, color: '#64b2cb' },
  ],
} as OkrCycleDTO

/** Meta que é razão: o acumulado do ciclo (8÷135 = 5,93%) e o último (4÷52 = 7,69%). */
const ratio = {
  baseline: 0,
  target: 5,
  direction: 'LOWER_IS_BETTER',
  currentValue: 7.69,
  accumulatedValue: 5.93,
  attainment: 0.8431,
  overshoot: 0,
  goalMet: false,
  color: '#86bd49',
} as OkrKeyResultDTO

describe('okrKeyResultView', () => {
  it('acumulado é o que o servidor calculou', () => {
    expect(okrKeyResultView(ratio, cycle, 'acumulado')).toMatchObject({
      value: 5.93,
      attainment: 0.8431,
      accumulated: true,
    })
  })

  it('por ciclo usa o último check-in e recalcula atingimento e cor pela mesma regra', () => {
    const view = okrKeyResultView(ratio, cycle, 'ciclo')
    expect(view.value).toBe(7.69)
    // Teto de 5 estourado por 7,69: 5 ÷ 7,69.
    expect(view.attainment).toBeCloseTo(0.6502, 4)
    expect(view.goalMet).toBe(false)
    expect(view.color).toBe('#86bd49')
    expect(view.accumulated).toBe(false)
  })

  it('sem acumulado, as duas exibições são o mesmo último valor', () => {
    const simple = { ...ratio, accumulatedValue: null, attainment: 0.6502, color: '#86bd49' } as OkrKeyResultDTO
    expect(okrKeyResultView(simple, cycle, 'ciclo')).toEqual(okrKeyResultView(simple, cycle, 'acumulado'))
    expect(okrKeyResultView(simple, cycle, 'acumulado').accumulated).toBe(false)
  })
})
