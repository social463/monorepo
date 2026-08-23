import { describe, expect, it } from 'vitest'
import { CampaignError } from './campaign-error'
import { buildScheduleSlots } from './campaign-schedule'

// 2026-09-01T12:00Z é 09:00 em São Paulo (UTC-3, sem horário de verão).
const inicio = new Date('2026-09-01T03:00:00.000Z')
const fim = new Date('2026-09-10T03:00:00.000Z')

describe('grade de datas da campanha', () => {
  it('devolve exatamente a quantidade pedida, em ordem crescente', () => {
    const slots = buildScheduleSlots({ startsAt: inicio, endsAt: fim, quantity: 4 })
    expect(slots).toHaveLength(4)
    const ordenados = [...slots].sort((a, b) => a.getTime() - b.getTime())
    expect(slots).toEqual(ordenados)
  })

  it('mantém toda a grade dentro da janela', () => {
    const slots = buildScheduleSlots({ startsAt: inicio, endsAt: fim, quantity: 7 })
    for (const slot of slots) {
      expect(slot.getTime()).toBeGreaterThanOrEqual(new Date('2026-09-01T00:00:00.000Z').getTime())
      expect(slot.getTime()).toBeLessThanOrEqual(new Date('2026-09-11T00:00:00.000Z').getTime())
    }
  })

  it('usa o primeiro dia às 09:00 de São Paulo quando pede um só', () => {
    const slots = buildScheduleSlots({ startsAt: inicio, endsAt: fim, quantity: 1 })
    expect(slots[0].toISOString()).toBe('2026-09-01T12:00:00.000Z')
  })

  it('empilha horários distintos quando há mais itens que dias', () => {
    const curto = new Date('2026-09-02T03:00:00.000Z')
    const slots = buildScheduleSlots({ startsAt: inicio, endsAt: curto, quantity: 4 })
    const iso = slots.map((s) => s.toISOString())
    expect(new Set(iso).size).toBe(4)
    expect(iso[0]).toBe('2026-09-01T12:00:00.000Z')
    expect(iso[1]).toBe('2026-09-01T14:00:00.000Z')
  })

  it('recusa quantidade que não cabe na janela', () => {
    expect(() => buildScheduleSlots({ startsAt: inicio, endsAt: inicio, quantity: 5 })).toThrow(CampaignError)
  })

  it('recusa janela invertida', () => {
    expect(() => buildScheduleSlots({ startsAt: fim, endsAt: inicio, quantity: 2 })).toThrow(CampaignError)
  })
})
