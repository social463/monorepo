import { describe, it, expect, afterAll } from 'vitest'
import {
  hhmmssInSaoPaulo,
  saoPauloEndOfDayUtc,
  saoPauloInstant,
  ymdOf,
  dayFromYmd,
  addDays,
  monthRefOf,
  monthBounds,
  monthInstantBoundsInSaoPaulo,
  isBusinessDay,
  prevBusinessDay,
  nextBusinessDay,
  ymdInSaoPaulo,
  hourInSaoPaulo,
  saoPauloMidnightUtc,
  startOfWeekYmd,
} from './sao-paulo-date'

describe('sao-paulo-date helpers', () => {
  it('ymdOf converte Date UTC-midnight em YYYY-MM-DD', () => {
    expect(ymdOf(new Date('2026-06-23T00:00:00.000Z'))).toBe('2026-06-23')
  })

  it('dayFromYmd retorna Date à meia-noite UTC', () => {
    expect(dayFromYmd('2026-06-23').toISOString()).toBe('2026-06-23T00:00:00.000Z')
  })

  it('startOfWeekYmd devolve a segunda da semana civil', () => {
    // 2026-07-27 é segunda; 29 é quarta; 2026-08-02 é domingo da mesma semana.
    expect(startOfWeekYmd('2026-07-27')).toBe('2026-07-27')
    expect(startOfWeekYmd('2026-07-29')).toBe('2026-07-27')
    expect(startOfWeekYmd('2026-08-02')).toBe('2026-07-27')
    // Atravessa virada de ano: 2026-01-01 é quinta, a segunda é 2025-12-29.
    expect(startOfWeekYmd('2026-01-01')).toBe('2025-12-29')
  })

  it('addDays soma e subtrai dias atravessando meses', () => {
    expect(addDays('2026-06-23', 1)).toBe('2026-06-24')
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('monthRefOf extrai o YYYY-MM', () => {
    expect(monthRefOf('2026-06-23')).toBe('2026-06')
  })

  it('monthBounds devolve início do mês e início do mês seguinte (exclusivo)', () => {
    const { start, endExclusive } = monthBounds('2026-06')
    expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(endExclusive.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    const dez = monthBounds('2026-12')
    expect(dez.endExclusive.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('monthInstantBoundsInSaoPaulo desloca a janela para o fuso de São Paulo', () => {
    const { start, endExclusive } = monthInstantBoundsInSaoPaulo('2026-07')
    expect(start.toISOString()).toBe('2026-07-01T03:00:00.000Z')
    expect(endExclusive.toISOString()).toBe('2026-08-01T03:00:00.000Z')

    const dez = monthInstantBoundsInSaoPaulo('2026-12')
    expect(dez.endExclusive.toISOString()).toBe('2027-01-01T03:00:00.000Z')
  })

  it('monthInstantBoundsInSaoPaulo inclui as 21h do último dia do mês, que já é o dia seguinte em UTC', () => {
    // 2026-07-31 21:05 em São Paulo = 2026-08-01 00:05 UTC. Com a janela em UTC
    // puro (monthBounds) esse instante cairia fora de julho.
    const instante = new Date('2026-08-01T00:05:00.000Z')
    const julho = monthInstantBoundsInSaoPaulo('2026-07')

    expect(instante >= julho.start && instante < julho.endExclusive).toBe(true)
    expect(instante < monthBounds('2026-07').endExclusive).toBe(false)
  })
})

// Referência de dias da semana (2026): 06-01 seg, 06-05 sex, 06-06 sáb,
// 06-07 dom, 06-08 seg. 05-29 é sexta.
describe('sao-paulo-date business days', () => {
  it('isBusinessDay distingue seg–sex de fim de semana', () => {
    expect(isBusinessDay('2026-06-05')).toBe(true) // sexta
    expect(isBusinessDay('2026-06-06')).toBe(false) // sábado
    expect(isBusinessDay('2026-06-07')).toBe(false) // domingo
    expect(isBusinessDay('2026-06-08')).toBe(true) // segunda
  })

  it('prevBusinessDay pula o fim de semana e a virada de mês', () => {
    expect(prevBusinessDay('2026-06-08')).toBe('2026-06-05') // seg → sexta
    expect(prevBusinessDay('2026-06-05')).toBe('2026-06-04') // sex → quinta
    expect(prevBusinessDay('2026-06-01')).toBe('2026-05-29') // seg → sexta do mês anterior
  })

  it('nextBusinessDay pula o fim de semana e a virada de mês', () => {
    expect(nextBusinessDay('2026-06-05')).toBe('2026-06-08') // sex → segunda
    expect(nextBusinessDay('2026-06-08')).toBe('2026-06-09') // seg → terça
    expect(nextBusinessDay('2026-05-29')).toBe('2026-06-01') // sexta → segunda do mês seguinte
  })
})

describe('helpers SP com now injetado', () => {
  it('ymdInSaoPaulo retorna o dia civil em São Paulo (UTC-3)', () => {
    // 2026-06-25T19:00Z == 16:00 em São Paulo (mesmo dia civil)
    expect(ymdInSaoPaulo(new Date('2026-06-25T19:00:00.000Z'))).toBe('2026-06-25')
    // 2026-06-26T02:00Z == 23:00 do dia 25 em São Paulo
    expect(ymdInSaoPaulo(new Date('2026-06-26T02:00:00.000Z'))).toBe('2026-06-25')
  })

  it('hourInSaoPaulo retorna a hora civil 0–23 em São Paulo', () => {
    expect(hourInSaoPaulo(new Date('2026-06-25T19:00:00.000Z'))).toBe(16)
    expect(hourInSaoPaulo(new Date('2026-06-25T12:00:00.000Z'))).toBe(9)
    expect(hourInSaoPaulo(new Date('2026-06-26T02:00:00.000Z'))).toBe(23)
  })

  it('saoPauloMidnightUtc é a meia-noite de São Paulo, não a UTC', () => {
    // 00:00 em São Paulo (UTC-3) é 03:00Z do mesmo dia.
    expect(saoPauloMidnightUtc('2026-06-25').toISOString()).toBe('2026-06-25T03:00:00.000Z')
    expect(saoPauloMidnightUtc('2026-01-01').toISOString()).toBe('2026-01-01T03:00:00.000Z')
    // E é sempre 3h depois da meia-noite UTC do mesmo dia (dayFromYmd).
    expect(saoPauloMidnightUtc('2026-06-25').getTime() - dayFromYmd('2026-06-25').getTime()).toBe(3 * 3600 * 1000)
  })
})

/**
 * O fuso do processo é trocado de propósito: em dev ele é São Paulo e esconde o
 * bug, enquanto o contêiner de produção roda em UTC. Estes helpers têm que dar o
 * mesmo instante nos dois — é justamente o que `new Date('...T10:30:00')` não dá.
 */
describe('helpers SP independem do fuso do processo', () => {
  const original = process.env.TZ
  afterAll(() => {
    process.env.TZ = original
  })

  for (const tz of ['UTC', 'America/Sao_Paulo', 'Asia/Tokyo']) {
    it(`saoPauloInstant traduz hora de parede em instante com TZ=${tz}`, () => {
      process.env.TZ = tz
      // 10:30 em São Paulo (UTC-3) é 13:30Z — o horário que o 1:1 grava.
      expect(saoPauloInstant('2026-08-12', '10:30').toISOString()).toBe('2026-08-12T13:30:00.000Z')
      expect(saoPauloInstant('2026-08-12', '00:00').toISOString()).toBe('2026-08-12T03:00:00.000Z')
      // Depois das 21h o instante já é do dia seguinte em UTC — e tudo bem.
      expect(saoPauloInstant('2026-08-12', '22:00').toISOString()).toBe('2026-08-13T01:00:00.000Z')
      // Aceita segundos, para fechar janela de dia.
      expect(saoPauloInstant('2026-08-12', '23:59:59').toISOString()).toBe('2026-08-13T02:59:59.000Z')
      expect(saoPauloEndOfDayUtc('2026-08-12').toISOString()).toBe('2026-08-13T02:59:59.999Z')
      expect(hhmmssInSaoPaulo(new Date('2026-08-12T13:30:00.000Z'))).toBe('10:30:00')
    })
  }

  it('saoPauloInstant concorda com saoPauloMidnightUtc na meia-noite', () => {
    expect(saoPauloInstant('2026-06-25', '00:00').getTime()).toBe(saoPauloMidnightUtc('2026-06-25').getTime())
  })

  it('data ou hora inválida vira Invalid Date, sem lançar', () => {
    expect(Number.isNaN(saoPauloInstant('2026-13-40', '10:30').getTime())).toBe(true)
    expect(Number.isNaN(saoPauloInstant('2026-08-12', '99:99').getTime())).toBe(true)
  })
})
