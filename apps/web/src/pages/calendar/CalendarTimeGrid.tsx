import type { CalendarEventOccurrenceDTO } from '@legends/shared'
import {
  computeRowSpans,
  isAllDay,
  minutesOf,
  occurrencesByDay,
  WEEKDAY_LABELS,
  type EventSpan,
} from './calendar-events'
import { EventBar, readableOn } from './EventBar'

/** A grade cobre o horário comercial folgado; nada útil acontece às 3h. */
const HOUR_START = 6
const HOUR_END = 22
const HOUR_PX = 44
const GRID_HEIGHT = (HOUR_END - HOUR_START + 1) * HOUR_PX
/** Evento com início e sem fim ocupa uma hora — é a suposição menos surpreendente. */
const DEFAULT_MINUTES = 60

const HOURS_COL = '52px'

/**
 * Grade de horas da semana (7 colunas) ou do dia (1 coluna).
 *
 * Duas regiões, e a separação entre elas é o ponto: **evento sem horário vai
 * para a faixa "DIA TODO"** no topo, nunca para uma faixa de horário. Fingir
 * uma hora para ele empurraria toda campanha de mês inteiro para as 6h da
 * manhã, que é onde a grade começa.
 */
export function CalendarTimeGrid({
  days,
  events,
  todayIso,
  now,
  onSelect,
}: {
  days: string[]
  events: readonly CalendarEventOccurrenceDTO[]
  todayIso: string
  now: Date
  onSelect: (event: CalendarEventOccurrenceDTO) => void
}) {
  const porDia = occurrencesByDay(events)
  const template = `${HOURS_COL} repeat(${days.length}, minmax(0, 1fr))`
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container">
      <div className="grid border-b border-outline-variant/30 bg-surface-container-highest" style={{ gridTemplateColumns: template }}>
        <div className="border-r border-outline-variant/20" />
        {days.map((iso) => (
          <div key={iso} className="flex items-center justify-center gap-1 border-r border-outline-variant/20 px-1 py-1 last:border-r-0">
            <span className="font-label text-[11px] uppercase text-on-surface-variant">
              {WEEKDAY_LABELS[new Date(`${iso}T00:00:00Z`).getUTCDay()]}
            </span>
            <span
              className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-label text-[11px] ${
                iso === todayIso ? 'bg-primary font-bold text-on-primary' : 'text-on-surface'
              }`}
            >
              {Number(iso.slice(8, 10))}
            </span>
          </div>
        ))}
      </div>

      <AllDayBand days={days} events={events} onSelect={onSelect} template={template} />

      <div className="max-h-[560px] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: template }}>
          <HoursColumn />
          {days.map((iso) => (
            <DayColumn
              key={iso}
              iso={iso}
              events={porDia.get(iso) ?? []}
              nowMinutes={iso === todayIso ? nowMinutes : null}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * A faixa "DIA TODO". Usa os mesmos trechos contínuos da grade do mês, então um
 * evento de três dias é uma barra só atravessando as três colunas.
 */
function AllDayBand({
  days,
  events,
  onSelect,
  template,
}: {
  days: string[]
  events: readonly CalendarEventOccurrenceDTO[]
  onSelect: (event: CalendarEventOccurrenceDTO) => void
  template: string
}) {
  const spans = computeRowSpans(days, events.filter(isAllDay))

  return (
    <div className="grid border-b border-outline-variant/30 bg-surface-container-low" style={{ gridTemplateColumns: template }}>
      <div className="border-r border-outline-variant/20 px-1 py-1 text-right font-label text-[10px] uppercase tracking-wide text-on-surface-variant">
        Dia todo
      </div>
      <div
        className="grid gap-y-[3px] px-[2px] py-1"
        style={{
          gridColumn: `2 / span ${days.length}`,
          gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
          gridAutoRows: '18px',
          minHeight: '26px',
        }}
      >
        {spans.map((span) => (
          <div
            key={`${span.event.eventId}-${span.event.iso}-${span.start}`}
            style={{ gridColumn: `${span.start + 1} / span ${span.length}`, minWidth: 0 }}
          >
            <EventBar span={span} onSelect={onSelect} />
          </div>
        ))}
      </div>
    </div>
  )
}

function HoursColumn() {
  return (
    <div className="border-r border-outline-variant/20" style={{ height: `${GRID_HEIGHT}px` }}>
      {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => (
        <div key={i} style={{ height: `${HOUR_PX}px` }} className="relative">
          <span className="absolute right-1 top-0 -translate-y-1/2 font-label text-[10px] text-on-surface-variant">
            {String(HOUR_START + i).padStart(2, '0')}:00
          </span>
        </div>
      ))}
    </div>
  )
}

interface TimedBlock {
  event: CalendarEventOccurrenceDTO
  top: number
  height: number
  /** Faixa horizontal, para eventos que se sobrepõem no mesmo horário. */
  lane: number
  lanes: number
}

/**
 * Posiciona os eventos com horário e resolve sobreposição em faixas verticais:
 * duas reuniões às 14h dividem a largura da coluna em vez de uma sumir embaixo
 * da outra.
 */
export function layoutTimedEvents(events: readonly CalendarEventOccurrenceDTO[]): TimedBlock[] {
  const comHora = events
    .filter((e) => !isAllDay(e) && e.startTime)
    .map((event) => {
      const inicio = minutesOf(event.startTime as string)
      const fim = event.endTime ? minutesOf(event.endTime) : inicio + DEFAULT_MINUTES
      return { event, inicio, fim: Math.max(fim, inicio + 15) }
    })
    .sort((a, b) => a.inicio - b.inicio || a.fim - b.fim)

  // Um "grupo" é um bloco de eventos que se tocam em cadeia: a largura de cada
  // um é 1/N do grupo, e não 1/N do dia — dois eventos de manhã não podem
  // encolher o da tarde, que está sozinho.
  const blocks: TimedBlock[] = []
  let grupo: typeof comHora = []
  let fimDoGrupo = -1

  function fecharGrupo() {
    if (grupo.length === 0) return
    const lanes: number[] = []
    const posicoes = grupo.map((item) => {
      let lane = lanes.findIndex((fim) => fim <= item.inicio)
      if (lane === -1) {
        lane = lanes.length
        lanes.push(item.fim)
      } else {
        lanes[lane] = item.fim
      }
      return { item, lane }
    })
    for (const { item, lane } of posicoes) {
      const inicioH = Math.max(HOUR_START * 60, item.inicio)
      const fimH = Math.min((HOUR_END + 1) * 60, item.fim)
      if (fimH <= inicioH) continue
      blocks.push({
        event: item.event,
        top: ((inicioH - HOUR_START * 60) / 60) * HOUR_PX,
        height: Math.max(18, ((fimH - inicioH) / 60) * HOUR_PX - 2),
        lane,
        lanes: lanes.length,
      })
    }
    grupo = []
    fimDoGrupo = -1
  }

  for (const item of comHora) {
    if (grupo.length > 0 && item.inicio >= fimDoGrupo) fecharGrupo()
    grupo.push(item)
    fimDoGrupo = Math.max(fimDoGrupo, item.fim)
  }
  fecharGrupo()

  return blocks
}

function DayColumn({
  iso,
  events,
  nowMinutes,
  onSelect,
}: {
  iso: string
  events: readonly CalendarEventOccurrenceDTO[]
  nowMinutes: number | null
  onSelect: (event: CalendarEventOccurrenceDTO) => void
}) {
  const blocks = layoutTimedEvents(events)
  const nowTop = nowMinutes === null ? null : ((nowMinutes - HOUR_START * 60) / 60) * HOUR_PX

  return (
    <div className="relative border-r border-outline-variant/20 last:border-r-0" style={{ height: `${GRID_HEIGHT}px` }}>
      {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => (
        <div
          key={i}
          style={{ top: `${i * HOUR_PX}px`, height: `${HOUR_PX}px` }}
          className="absolute inset-x-0 border-t border-outline-variant/15"
        />
      ))}

      {nowTop !== null && nowTop >= 0 && nowTop <= GRID_HEIGHT && (
        <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: `${nowTop}px` }} data-testid="agora">
          <div className="relative h-px bg-error">
            <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-error" />
          </div>
        </div>
      )}

      {blocks.map((block) => (
        <button
          key={`${block.event.eventId}-${block.event.iso}-${iso}`}
          type="button"
          onClick={() => onSelect(block.event)}
          title={`${block.event.title} · ${block.event.startTime}`}
          style={{
            top: `${block.top}px`,
            height: `${block.height}px`,
            left: `calc(${(block.lane / block.lanes) * 100}% + 2px)`,
            width: `calc(${100 / block.lanes}% - 4px)`,
            backgroundColor: block.event.color,
            color: readableOn(block.event.color),
          }}
          className="absolute z-10 flex flex-col items-start overflow-hidden rounded px-1.5 py-1 text-left font-label text-[10px] leading-tight transition-opacity hover:opacity-85"
        >
          <span className="flex w-full items-center gap-1 truncate">
            {block.event.isInternalComm && <span aria-label="Ação de Comunicação Interna">📌</span>}
            <span className="truncate">{block.event.title}</span>
          </span>
          <span className="truncate opacity-85">{block.event.startTime}</span>
        </button>
      ))}
    </div>
  )
}
