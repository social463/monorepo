import { describe, it, expect } from 'vitest'
import { extractEventTimeRange, formatEventTimeRange } from './event-time-range'

describe('extractEventTimeRange', () => {
  it('lê início e fim do formato usado nas provas B2B', () => {
    const desc = [
      'Data e Horário início: 31/08/2026 às 8h',
      'Data e Horário finalização: 31/08/2026 às 12h',
      'Data Liberação do gabarito: 31/08/2026 às 14h',
    ].join('\n')
    expect(extractEventTimeRange(desc, '08:00')).toEqual({ start: '08:00', end: '12:00' })
  })

  it('aceita as variações de escrita da hora', () => {
    expect(extractEventTimeRange('início: 13:30h\nfinalização: 18:30h', null)).toEqual({
      start: '13:30',
      end: '18:30',
    })
    expect(extractEventTimeRange('início 18/08/2026 13h30\nfinalização 18/08/2026 18h30', null)).toEqual({
      start: '13:30',
      end: '18:30',
    })
    expect(extractEventTimeRange('Horário início: 12/08/2026 | 08h\nHorário finalização: 12/08/2026 | 12h', null)).toEqual({
      start: '08:00',
      end: '12:00',
    })
  })

  it('não confunde a data com a hora', () => {
    expect(extractEventTimeRange('Data e Horário início: 31/08/2026', null).start).toBeNull()
  })

  it('ignora a linha do gabarito ao procurar o fim', () => {
    const desc = 'Data e Horário início: 17/08/2026 às 8h\nData Liberação do gabarito: 17/08/2026 às 14h'
    expect(extractEventTimeRange(desc, '08:00')).toEqual({ start: '08:00', end: null })
  })

  it('o campo startTime manda no início, mesmo com hora escrita na descrição', () => {
    expect(extractEventTimeRange('início: às 9h', '13:30').start).toBe('13:30')
  })

  it('descrição vazia ou fora do padrão não inventa horário', () => {
    expect(extractEventTimeRange('', null)).toEqual({ start: null, end: null })
    expect(extractEventTimeRange('Prova presencial, levar documento', null)).toEqual({ start: null, end: null })
  })

  it('descarta hora impossível', () => {
    expect(extractEventTimeRange('início: 99h99', null).start).toBeNull()
  })
})

describe('formatEventTimeRange', () => {
  it('junta início e fim, e se vira com só um dos dois', () => {
    expect(formatEventTimeRange({ start: '08:00', end: '12:00' })).toBe('08:00 às 12:00')
    expect(formatEventTimeRange({ start: '08:00', end: null })).toBe('08:00')
    expect(formatEventTimeRange({ start: null, end: '12:00' })).toBeNull()
  })
})
