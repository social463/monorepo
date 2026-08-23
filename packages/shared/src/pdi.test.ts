import { describe, expect, it } from 'vitest'
import {
  MIN_PDI_REFLECTION_LENGTH,
  PDI_ACTION_PRIORITY_LABELS,
  PDI_ACTION_STATUSES,
  PDI_ACTION_STATUS_LABELS,
  PDI_ACTION_TYPES,
  PDI_ACTION_TYPE_ICONS,
  PDI_ACTION_TYPE_LABELS,
  PDI_PLAN_STATUSES,
  PDI_PLAN_STATUS_LABELS,
  PDI_REFLECTION_FIELDS,
  PDI_SHOWCASE_VISIBILITIES,
  PDI_SHOWCASE_VISIBILITY_LABELS,
  isPdiReflectionComplete,
  pdiProgressOf,
} from './pdi'

describe('rótulos do PDI', () => {
  it('todo enum tem rótulo em pt-BR', () => {
    for (const status of PDI_PLAN_STATUSES) expect(PDI_PLAN_STATUS_LABELS[status]).toBeTruthy()
    for (const status of PDI_ACTION_STATUSES) expect(PDI_ACTION_STATUS_LABELS[status]).toBeTruthy()
    for (const type of PDI_ACTION_TYPES) {
      expect(PDI_ACTION_TYPE_LABELS[type]).toBeTruthy()
      expect(PDI_ACTION_TYPE_ICONS[type]).toBeTruthy()
    }
    for (const visibility of PDI_SHOWCASE_VISIBILITIES) {
      expect(PDI_SHOWCASE_VISIBILITY_LABELS[visibility]).toBeTruthy()
    }
    expect(PDI_ACTION_PRIORITY_LABELS.HIGH).toBe('Alta')
  })

  it('só a primeira pergunta da reflexão é obrigatória', () => {
    expect(PDI_REFLECTION_FIELDS[0].required).toBe(true)
    expect(PDI_REFLECTION_FIELDS.slice(1).every((field) => !field.required)).toBe(true)
  })
})

describe('pdiProgressOf', () => {
  it('conta ação concluída como 100 e faz a média das demais', () => {
    expect(pdiProgressOf([])).toBe(0)
    expect(pdiProgressOf([{ progressPct: 0, status: 'DONE' }])).toBe(100)
    expect(
      pdiProgressOf([
        { progressPct: 50, status: 'IN_PROGRESS' },
        { progressPct: 0, status: 'NOT_STARTED' },
      ]),
    ).toBe(25)
    expect(
      pdiProgressOf([
        { progressPct: 100, status: 'DONE' },
        { progressPct: 40, status: 'IN_PROGRESS' },
      ]),
    ).toBe(70)
  })
})

describe('isPdiReflectionComplete', () => {
  it('exige a primeira resposta com tamanho mínimo', () => {
    expect(isPdiReflectionComplete({})).toBe(false)
    expect(isPdiReflectionComplete({ mainLearning: 'ok' })).toBe(false)
    expect(isPdiReflectionComplete({ mainLearning: 'a'.repeat(MIN_PDI_REFLECTION_LENGTH) })).toBe(true)
    expect(isPdiReflectionComplete({ challenge: 'foi difícil demais' })).toBe(false)
  })

  it('ignora espaço em branco', () => {
    expect(isPdiReflectionComplete({ mainLearning: '        ' })).toBe(false)
  })
})
