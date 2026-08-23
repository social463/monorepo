import type { CalendarEventOccurrenceDTO } from '@legends/shared'
import { computeRowSpans, monthWeekRows, WEEKDAY_LABELS, type EventSpan, type MonthDay } from './calendar-events'
import { EventBar } from './EventBar'

/**
 * Grade do mês, no formato compacto do protótipo: cada semana é uma faixa com
 * os números dos dias em cima e as barras de evento embaixo.
 *
 * As barras são **contínuas**, não uma marcação por dia: um evento de 5 de maio
 * a 9 de maio é uma faixa só atravessando a semana. É o que `computeRowSpans`
 * calcula, e é a diferença entre ler "a campanha dura a semana" e ler cinco
 * chips soltos.
 */
export function CalendarMonthGrid({
  monthRef,
  events,
  todayIso,
  onSelect,
}: {
  monthRef: string
  events: readonly CalendarEventOccurrenceDTO[]
  todayIso: string
  onSelect: (event: CalendarEventOccurrenceDTO) => void
}) {
  const rows = monthWeekRows(monthRef)

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container">
      <div className="grid grid-cols-7 border-b border-outline-variant/30 bg-surface-container-highest">
        {WEEKDAY_LABELS.map((day) => (
          <div key={day} className="px-sm py-1 text-center font-label text-label-sm text-on-surface-variant">
            {day}
          </div>
        ))}
      </div>

      {rows.map((row) => (
        <WeekRow key={row[0].iso} row={row} events={events} todayIso={todayIso} onSelect={onSelect} />
      ))}
    </div>
  )
}

function WeekRow({
  row,
  events,
  todayIso,
  onSelect,
}: {
  row: MonthDay[]
  events: readonly CalendarEventOccurrenceDTO[]
  todayIso: string
  onSelect: (event: CalendarEventOccurrenceDTO) => void
}) {
  const spans = computeRowSpans(
    row.map((d) => d.iso),
    events,
  )

  return (
    <div className="border-b border-outline-variant/20 last:border-b-0">
      <div className="grid grid-cols-7">
        {row.map((day) => (
          <div
            key={day.iso}
            className={`border-r border-outline-variant/20 px-1 pt-1 last:border-r-0 ${
              day.inMonth ? '' : 'bg-surface'
            }`}
          >
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full font-label text-[11px] ${
                day.iso === todayIso
                  ? 'bg-primary font-bold text-on-primary'
                  : day.inMonth
                    ? 'text-on-surface-variant'
                    : // Dia de mês vizinho apaga com um TOKEN, não com opacidade:
                      // alfa em cor de texto de marca quebra o contraste (ver
                      // `brand-alpha.test.ts`).
                      'text-outline'
              }`}
            >
              {day.day}
            </span>
          </div>
        ))}
      </div>
      {/* `gridAutoRows` fixo é o que mantém as barras alinhadas entre semanas: o
          fluxo automático empilha cada trecho numa linha de altura conhecida, e
          a faixa cresce sozinha quando a semana tem muitos eventos. */}
      <div
        className="grid grid-cols-7 gap-y-[3px] px-[2px] pb-1 pt-[2px]"
        style={{ gridAutoRows: '18px', minHeight: '44px' }}
      >
        {spans.map((span) => (
          <SpanBar key={`${span.event.eventId}-${span.event.iso}-${span.start}`} span={span} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

function SpanBar({ span, onSelect }: { span: EventSpan; onSelect: (event: CalendarEventOccurrenceDTO) => void }) {
  return (
    <div style={{ gridColumn: `${span.start + 1} / span ${span.length}`, minWidth: 0 }}>
      <EventBar span={span} onSelect={onSelect} />
    </div>
  )
}
