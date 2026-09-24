import { describe, it, expect } from 'vitest'
import { parseSpreadsheetDate, parseSpreadsheetTimeRange } from './spreadsheet-values'

describe('parseSpreadsheetDate', () => {
  it('lê o formato do Excel pt-BR e o do input date', () => {
    expect(parseSpreadsheetDate('09/08/2026')?.toISOString()).toBe('2026-08-09T00:00:00.000Z')
    expect(parseSpreadsheetDate('2026-08-09')?.toISOString()).toBe('2026-08-09T00:00:00.000Z')
  })

  it('recusa data que o Date normalizaria em silêncio', () => {
    expect(parseSpreadsheetDate('31/02/2026')).toBeNull()
    expect(parseSpreadsheetDate('29/02/2027')).toBeNull()
  })

  it('recusa texto que não é data', () => {
    expect(parseSpreadsheetDate('Sexta (verificando)')).toBeNull()
    expect(parseSpreadsheetDate('')).toBeNull()
    expect(parseSpreadsheetDate('9/8/2026')).toBeNull()
  })
})

describe('parseSpreadsheetTimeRange', () => {
  it('trata vazio e "Dia todo" como evento de dia inteiro', () => {
    expect(parseSpreadsheetTimeRange('')).toEqual({ start: null, end: null })
    expect(parseSpreadsheetTimeRange('Dia todo')).toEqual({ start: null, end: null })
    expect(parseSpreadsheetTimeRange('dia inteiro')).toEqual({ start: null, end: null })
  })

  it('lê a escrita com "h", com e sem minutos dos dois lados', () => {
    expect(parseSpreadsheetTimeRange('15h-22h')).toEqual({ start: '15:00', end: '22:00' })
    expect(parseSpreadsheetTimeRange('16h-16h50')).toEqual({ start: '16:00', end: '16:50' })
    expect(parseSpreadsheetTimeRange('14h30-15h')).toEqual({ start: '14:30', end: '15:00' })
    expect(parseSpreadsheetTimeRange('15h00-16h00')).toEqual({ start: '15:00', end: '16:00' })
    expect(parseSpreadsheetTimeRange('8h-18h')).toEqual({ start: '08:00', end: '18:00' })
  })

  it('lê separadores por extenso e os travessões', () => {
    expect(parseSpreadsheetTimeRange('das 14h às 15h30')).toEqual({ start: '14:00', end: '15:30' })
    expect(parseSpreadsheetTimeRange('14h a 15h')).toEqual({ start: '14:00', end: '15:00' })
    expect(parseSpreadsheetTimeRange('14h – 15h')).toEqual({ start: '14:00', end: '15:00' })
    expect(parseSpreadsheetTimeRange('14:00-15:30')).toEqual({ start: '14:00', end: '15:30' })
  })

  it('aceita só a hora de início', () => {
    expect(parseSpreadsheetTimeRange('16h')).toEqual({ start: '16:00', end: null })
  })

  it('devolve null quando a célula não é horário — quem chamou vira erro de linha', () => {
    expect(parseSpreadsheetTimeRange('a combinar')).toBeNull()
    expect(parseSpreadsheetTimeRange('25h-26h')).toBeNull()
    expect(parseSpreadsheetTimeRange('14h70')).toBeNull()
    // Três horários numa célula: chutar qual vale seria pior que devolver o problema.
    expect(parseSpreadsheetTimeRange('9h-10h e 14h')).toBeNull()
    // Dígito solto fora do horário: a célula tem mais coisa que hora.
    expect(parseSpreadsheetTimeRange('15h na sala 2')).toBeNull()
  })
})
