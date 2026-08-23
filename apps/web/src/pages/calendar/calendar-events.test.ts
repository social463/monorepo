import { describe, expect, it } from 'vitest'
import type { CalendarEventOccurrenceDTO } from '@legends/shared'
import {
  buildMonthDays,
  computeRowSpans,
  filterOccurrences,
  audienceOptions,
  isAllDay,
  localIsoOf,
  monthRefOf,
  monthWeekRows,
  occurrencesByDay,
  periodLabel,
  shiftCursor,
  shiftMonth,
  timeLabel,
  viewHeadline,
  viewRange,
  weekDays,
} from './calendar-events'

function occ(over: Partial<CalendarEventOccurrenceDTO> = {}): CalendarEventOccurrenceDTO {
  return {
    eventId: 'e1',
    iso: '2026-08-12',
    endIso: '2026-08-12',
    title: 'Semana da Cultura',
    description: '',
    startTime: null,
    endTime: null,
    typeSlug: 'cultura',
    typeName: 'Cultura',
    typeIcon: 'diversity_3',
    color: '#14b8a6',
    audienceTags: [],
    isInternalComm: false,
    createdById: 'u1',
    createdByName: 'Ana',
    createdAt: '2026-08-01T12:00:00.000Z',
    ...over,
  }
}

describe('navegação', () => {
  it('a grade do mês abre no domingo e fecha no sábado', () => {
    const days = buildMonthDays('2026-08')
    expect(days[0].iso).toBe('2026-07-26')
    expect(days[days.length - 1].iso).toBe('2026-09-05')
    expect(days.filter((d) => d.inMonth)).toHaveLength(31)
  })

  it('quebra a grade em semanas de sete dias', () => {
    const rows = monthWeekRows('2026-08')
    expect(rows.every((row) => row.length === 7)).toBe(true)
    expect(rows[0][0].iso).toBe('2026-07-26')
  })

  it('a janela do mês cobre a grade inteira, não só o mês', () => {
    expect(viewRange('month', '2026-08-12')).toEqual({ from: '2026-07-26', to: '2026-09-05' })
  })

  it('a janela da semana vai de domingo a sábado', () => {
    expect(viewRange('week', '2026-08-12')).toEqual({ from: '2026-08-09', to: '2026-08-15' })
    expect(weekDays('2026-08-12')).toHaveLength(7)
  })

  it('a janela do dia é o próprio dia', () => {
    expect(viewRange('day', '2026-08-12')).toEqual({ from: '2026-08-12', to: '2026-08-12' })
  })

  it('o passo é do recorte exibido', () => {
    expect(shiftCursor('day', '2026-08-12', 1)).toBe('2026-08-13')
    expect(shiftCursor('week', '2026-08-12', -1)).toBe('2026-08-05')
    expect(shiftCursor('month', '2026-08-12', 1)).toBe('2026-09-01')
  })

  it('avançar o mês a partir do dia 31 não pula fevereiro', () => {
    // Somar 30 dias cairia em 02/04; o passo do mês fixa o dia 1.
    expect(shiftCursor('month', '2026-01-31', 1)).toBe('2026-02-01')
  })

  it('vira o ano nas duas direções', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('o título muda de formato por recorte', () => {
    expect(viewHeadline('month', '2026-08-12')).toContain('agosto')
    expect(viewHeadline('week', '2026-08-12')).toBe('09/08 – 15/08 · 2026')
    expect(viewHeadline('day', '2026-08-12')).toContain('12')
  })

  it('o dia local não vira o seguinte à noite', () => {
    // Uma data com hora tardia: `toISOString()` daria o dia seguinte em UTC−3.
    const noite = new Date(2026, 7, 12, 23, 30)
    expect(localIsoOf(noite)).toBe('2026-08-12')
    expect(monthRefOf(localIsoOf(noite))).toBe('2026-08')
  })
})

describe('faixa "dia todo"', () => {
  it('evento sem horário é de dia todo', () => {
    expect(isAllDay(occ({ startTime: null }))).toBe(true)
  })

  it('evento com horário cai na grade de horas', () => {
    expect(isAllDay(occ({ startTime: '14:00' }))).toBe(false)
  })

  it('evento de mais de um dia é de dia todo mesmo tendo horário', () => {
    // Ele não cabe numa coluna de hora, e o que importa nele é o período.
    expect(isAllDay(occ({ startTime: '14:00', iso: '2026-08-12', endIso: '2026-08-14' }))).toBe(true)
  })
})

describe('trechos na grade', () => {
  const semana = weekDays('2026-08-12')

  it('evento de um dia ocupa uma coluna', () => {
    const [span] = computeRowSpans(semana, [occ({ iso: '2026-08-12', endIso: '2026-08-12' })])
    expect(span).toMatchObject({ start: 3, length: 1, isStart: true, isEnd: true })
  })

  it('evento de vários dias vira uma barra contínua', () => {
    const [span] = computeRowSpans(semana, [occ({ iso: '2026-08-10', endIso: '2026-08-14' })])
    expect(span).toMatchObject({ start: 1, length: 5, isStart: true, isEnd: true })
  })

  it('evento que cruza a semana é recortado e marca só a ponta verdadeira', () => {
    const [span] = computeRowSpans(semana, [occ({ iso: '2026-08-05', endIso: '2026-08-20' })])
    expect(span).toMatchObject({ start: 0, length: 7, isStart: false, isEnd: false })
  })

  it('evento fora da linha não rende trecho', () => {
    expect(computeRowSpans(semana, [occ({ iso: '2026-09-01', endIso: '2026-09-01' })])).toHaveLength(0)
  })

  it('o trecho mais longo vem primeiro, para as barras curtas empilharem embaixo', () => {
    const spans = computeRowSpans(semana, [
      occ({ eventId: 'curto', iso: '2026-08-12', endIso: '2026-08-12' }),
      occ({ eventId: 'longo', iso: '2026-08-10', endIso: '2026-08-14' }),
    ])
    expect(spans.map((s) => s.event.eventId)).toEqual(['longo', 'curto'])
  })
})

describe('eventos por dia', () => {
  it('evento de vários dias entra em cada dia do período', () => {
    const map = occurrencesByDay([occ({ iso: '2026-08-12', endIso: '2026-08-14' })])
    expect([...map.keys()].sort()).toEqual(['2026-08-12', '2026-08-13', '2026-08-14'])
  })
})

describe('filtros', () => {
  const eventos = [
    occ({ eventId: 'a', typeSlug: 'cultura', audienceTags: [] }),
    occ({ eventId: 'b', typeSlug: 'campanha', audienceTags: ['Líder', 'G&G'] }),
    occ({ eventId: 'c', typeSlug: 'campanha', audienceTags: ['CEO'] }),
  ]

  it('sem filtro devolve tudo', () => {
    expect(filterOccurrences(eventos, { category: 'all', audience: 'all' })).toHaveLength(3)
  })

  it('filtra por categoria', () => {
    const out = filterOccurrences(eventos, { category: 'campanha', audience: 'all' })
    expect(out.map((e) => e.eventId)).toEqual(['b', 'c'])
  })

  it('filtra por público-alvo e mantém o que é de todos', () => {
    // Evento sem tag é da empresa inteira: ele alcança o líder também, e some
    // dele seria esconder metade do calendário de quem filtra por perfil.
    const out = filterOccurrences(eventos, { category: 'all', audience: 'Líder' })
    expect(out.map((e) => e.eventId)).toEqual(['a', 'b'])
  })

  it('a comparação de tag ignora acento e pontuação', () => {
    const out = filterOccurrences(eventos, { category: 'all', audience: 'lider' })
    expect(out.map((e) => e.eventId)).toEqual(['a', 'b'])
  })

  it('as opções de público saem dos eventos da janela, sem repetir', () => {
    expect(audienceOptions(eventos)).toEqual(['CEO', 'G&G', 'Líder'])
  })
})

describe('rótulos', () => {
  it('período de um dia e de vários dias', () => {
    expect(periodLabel(occ({ iso: '2026-08-12', endIso: '2026-08-12' }))).toBe('12 de agosto de 2026')
    expect(periodLabel(occ({ iso: '2026-08-12', endIso: '2026-08-14' }))).toContain('→')
  })

  it('horário vazio é "Dia todo"', () => {
    expect(timeLabel(occ({ startTime: null }))).toBe('Dia todo')
    expect(timeLabel(occ({ startTime: '14:00' }))).toBe('14:00')
    expect(timeLabel(occ({ startTime: '14:00', endTime: '15:30' }))).toBe('14:00 – 15:30')
  })
})
