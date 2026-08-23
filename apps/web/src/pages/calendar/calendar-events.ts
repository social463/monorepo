/**
 * Domínio da tela do **Calendário Endomarketing**: ações, datas comemorativas,
 * campanhas e ritos institucionais.
 *
 * A única fonte é `CalendarEventOccurrenceDTO` — os eventos cadastrados. As
 * marcações derivadas de outras tabelas (aniversário, tempo de casa, férias,
 * 1:1) saíram daqui de propósito: cada uma continua na aba do seu assunto, e
 * juntas poluíam a grade a ponto de esconder o que este calendário existe para
 * mostrar.
 */
import type { CalendarEventOccurrenceDTO } from '@legends/shared'
import { normalizeAudienceTag } from '@legends/shared'

/** Os três recortes de período da barra: dia, semana e mês. */
export type CalendarView = 'day' | 'week' | 'month'

export const CALENDAR_VIEWS: readonly CalendarView[] = ['day', 'week', 'month']

/** "Hoje" é o rótulo do recorte de UM dia — é como o protótipo o chama. */
export const CALENDAR_VIEW_LABELS: Record<CalendarView, string> = {
  day: 'Hoje',
  week: 'Semana',
  month: 'Mês',
}

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

const DAY_MS = 24 * 60 * 60 * 1000

/** Data civil YYYY-MM-DD → Date à meia-noite UTC (nenhuma conversão de fuso). */
function utcDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  return isoOf(new Date(utcDate(iso).getTime() + days * DAY_MS))
}

/** Distância em dias entre duas datas civis. Negativa se `to` vier antes. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / DAY_MS)
}

/**
 * O dia civil **local** (`YYYY-MM-DD`) de um instante. É o único ponto de
 * conversão instante→dia da tela: usar UTC aqui faria "hoje" virar amanhã
 * das 21h à meia-noite em America/Sao_Paulo.
 */
export function localIsoOf(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function monthRefOf(iso: string): string {
  return iso.slice(0, 7)
}

export function shiftMonth(monthRef: string, delta: number): string {
  const [year, month] = monthRef.split('-').map(Number)
  // Date.UTC trata overflow: (2026, 12, 1) → janeiro de 2027.
  return isoOf(new Date(Date.UTC(year, month - 1 + delta, 1))).slice(0, 7)
}

export function monthLabel(monthRef: string): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    utcDate(`${monthRef}-01`),
  )
}

export interface MonthDay {
  iso: string
  day: number
  inMonth: boolean
}

/** A grade: semanas completas de domingo a sábado cobrindo o mês inteiro. */
export function buildMonthDays(monthRef: string): MonthDay[] {
  const [year, month] = monthRef.split('-').map(Number)
  const first = Date.UTC(year, month - 1, 1)
  // Date.UTC com dia 0 dá o último dia do mês anterior — aqui, o último do mês pedido.
  const last = Date.UTC(year, month, 0)
  const start = first - new Date(first).getUTCDay() * DAY_MS
  const end = last + (6 - new Date(last).getUTCDay()) * DAY_MS

  const days: MonthDay[] = []
  for (let t = start; t <= end; t += DAY_MS) {
    const date = new Date(t)
    days.push({ iso: isoOf(date), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month - 1 })
  }
  return days
}

/** As seis linhas de sete dias da grade do mês. */
export function monthWeekRows(monthRef: string): MonthDay[][] {
  const days = buildMonthDays(monthRef)
  const rows: MonthDay[][] = []
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7))
  return rows
}

/** O domingo da semana de `iso`. */
export function startOfWeek(iso: string): string {
  return addDays(iso, -utcDate(iso).getUTCDay())
}

/** Os sete dias da semana de `iso`, de domingo a sábado. */
export function weekDays(iso: string): string[] {
  const domingo = startOfWeek(iso)
  return Array.from({ length: 7 }, (_, i) => addDays(domingo, i))
}

/**
 * A janela que a query precisa cobrir. No mês é a **grade inteira**, não o mês:
 * ela começa no domingo anterior ao dia 1 e termina no sábado seguinte ao
 * último dia, e sem isso os dias de borda apareceriam vazios.
 */
export function viewRange(view: CalendarView, cursor: string): { from: string; to: string } {
  if (view === 'day') return { from: cursor, to: cursor }
  if (view === 'week') {
    const dias = weekDays(cursor)
    return { from: dias[0], to: dias[6] }
  }
  const days = buildMonthDays(monthRefOf(cursor))
  return { from: days[0].iso, to: days[days.length - 1].iso }
}

/** Um passo de navegação: um dia, uma semana ou um mês, conforme o recorte. */
export function shiftCursor(view: CalendarView, cursor: string, delta: number): string {
  if (view === 'day') return addDays(cursor, delta)
  if (view === 'week') return addDays(cursor, 7 * delta)
  // No mês o passo é do MÊS, e o dia é fixado no 1: somar 30 dias pularia
  // fevereiro e cairia duas vezes no mesmo mês ao voltar.
  return `${shiftMonth(monthRefOf(cursor), delta)}-01`
}

function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

/** O título do período exibido, no formato de cada recorte. */
export function viewHeadline(view: CalendarView, cursor: string): string {
  if (view === 'month') return monthLabel(monthRefOf(cursor))
  if (view === 'week') {
    const dias = weekDays(cursor)
    return `${dayMonth(dias[0])} – ${dayMonth(dias[6])} · ${dias[6].slice(0, 4)}`
  }
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(cursor))
}

// ---------------------------------------------------------------- filtros

export const CALENDAR_FILTER_ALL = 'all'

export interface CalendarFilters {
  /** Slug da categoria, ou `all`. */
  category: string
  /** Tag de público-alvo, ou `all`. */
  audience: string
}

export const EMPTY_CALENDAR_FILTERS: CalendarFilters = {
  category: CALENDAR_FILTER_ALL,
  audience: CALENDAR_FILTER_ALL,
}

export function filterOccurrences(
  events: readonly CalendarEventOccurrenceDTO[],
  filters: CalendarFilters,
): CalendarEventOccurrenceDTO[] {
  const alvo = filters.audience === CALENDAR_FILTER_ALL ? null : normalizeAudienceTag(filters.audience)
  return events.filter((event) => {
    if (filters.category !== CALENDAR_FILTER_ALL && event.typeSlug !== filters.category) return false
    if (!alvo) return true
    // Evento sem tag é da empresa inteira, então ele casa com QUALQUER filtro de
    // público: filtrar por "Líder" mostra o que é só de líder e o que é de todos.
    if (event.audienceTags.length === 0) return true
    return event.audienceTags.some((tag) => normalizeAudienceTag(tag) === alvo)
  })
}

/** As tags que aparecem nos eventos da janela, para popular o filtro. */
export function audienceOptions(events: readonly CalendarEventOccurrenceDTO[]): string[] {
  const vistas = new Map<string, string>()
  for (const event of events) {
    for (const tag of event.audienceTags) {
      const chave = normalizeAudienceTag(tag)
      if (chave && !vistas.has(chave)) vistas.set(chave, tag)
    }
  }
  return [...vistas.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

// ---------------------------------------------------------------- desenho

/**
 * Evento **sem horário** vai para a faixa "DIA TODO" no topo da grade, e não
 * para uma faixa de horário. Evento de mais de um dia também: ele não cabe numa
 * coluna de hora, e o que importa nele é o período.
 */
export function isAllDay(event: CalendarEventOccurrenceDTO): boolean {
  return !event.startTime || event.endIso !== event.iso
}

/** Minutos desde a meia-noite de um `HH:MM`. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Eventos por dia — o de vários dias entra em CADA dia do período. */
export function occurrencesByDay(
  events: readonly CalendarEventOccurrenceDTO[],
): Map<string, CalendarEventOccurrenceDTO[]> {
  const map = new Map<string, CalendarEventOccurrenceDTO[]>()
  for (const event of events) {
    let cursor = event.iso
    // Teto de segurança: ocorrência com `endIso` corrompido não pode virar laço
    // infinito na renderização.
    for (let i = 0; i <= 366 && cursor <= event.endIso; i += 1) {
      const lista = map.get(cursor) ?? []
      lista.push(event)
      map.set(cursor, lista)
      cursor = addDays(cursor, 1)
    }
  }
  return map
}

/**
 * Um trecho de evento dentro de uma linha da grade. Um evento de 10 dias cruza
 * duas semanas e vira dois trechos: `isStart`/`isEnd` dizem qual ponta é a
 * verdadeira, e é o que arredonda só o canto certo da barra.
 */
export interface EventSpan {
  event: CalendarEventOccurrenceDTO
  /** Coluna inicial dentro da linha, base 0. */
  start: number
  /** Quantas colunas o trecho ocupa. */
  length: number
  isStart: boolean
  isEnd: boolean
}

/**
 * Os trechos que caem numa linha de dias contíguos (uma semana da grade, ou os
 * sete dias da visão de semana). Ordena por trecho mais longo primeiro: assim o
 * fluxo automático do CSS grid empilha as barras curtas embaixo das longas, em
 * vez de deixar buraco.
 */
export function computeRowSpans(
  rowIsos: readonly string[],
  events: readonly CalendarEventOccurrenceDTO[],
): EventSpan[] {
  if (rowIsos.length === 0) return []
  const rowStart = rowIsos[0]
  const rowEnd = rowIsos[rowIsos.length - 1]

  const spans: EventSpan[] = []
  for (const event of events) {
    if (event.endIso < rowStart || event.iso > rowEnd) continue
    const segStart = event.iso > rowStart ? event.iso : rowStart
    const segEnd = event.endIso < rowEnd ? event.endIso : rowEnd
    spans.push({
      event,
      start: daysBetween(rowStart, segStart),
      length: daysBetween(segStart, segEnd) + 1,
      isStart: event.iso === segStart,
      isEnd: event.endIso === segEnd,
    })
  }
  spans.sort((a, b) => b.length - a.length || a.start - b.start || a.event.iso.localeCompare(b.event.iso))
  return spans
}

/** "03/08/2026", ou "03/08 → 07/08/2026" quando o evento ocupa vários dias. */
export function periodLabel(event: CalendarEventOccurrenceDTO): string {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      utcDate(iso),
    )
  return event.iso === event.endIso ? fmt(event.iso) : `${fmt(event.iso)} → ${fmt(event.endIso)}`
}

/** "14:00 – 15:30", "14:00" ou "Dia todo". */
export function timeLabel(event: CalendarEventOccurrenceDTO): string {
  if (!event.startTime) return 'Dia todo'
  return event.endTime ? `${event.startTime} – ${event.endTime}` : event.startTime
}
