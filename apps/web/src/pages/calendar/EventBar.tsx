import type { CalendarEventOccurrenceDTO } from '@legends/shared'
import type { EventSpan } from './calendar-events'

/**
 * Luminância relativa do hex, para decidir se o texto em cima dele é branco ou
 * preto. A cor da categoria é escolhida por gente (e pode ser sobrescrita evento
 * a evento), então cravar `text-white` deixaria ilegível qualquer amarelo.
 */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const canal = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const luz = 0.2126 * canal[0] + 0.7152 * canal[1] + 0.0722 * canal[2]
  return luz > 0.45 ? '#1b1b1f' : '#ffffff'
}

/**
 * A barra de um evento na grade. Cor da categoria (ou a do próprio evento),
 * cantos arredondados só nas pontas verdadeiras do período e 📌 quando é uma
 * Ação de Comunicação Interna — que só chega aqui para quem pode vê-la.
 */
export function EventBar({
  span,
  onSelect,
  showTime = false,
}: {
  span: EventSpan
  onSelect: (event: CalendarEventOccurrenceDTO) => void
  showTime?: boolean
}) {
  const { event, isStart, isEnd } = span
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      title={`${event.title}${event.startTime ? ` · ${event.startTime}` : ''}`}
      style={{
        backgroundColor: event.color,
        color: readableOn(event.color),
        borderTopLeftRadius: isStart ? 4 : 0,
        borderBottomLeftRadius: isStart ? 4 : 0,
        borderTopRightRadius: isEnd ? 4 : 0,
        borderBottomRightRadius: isEnd ? 4 : 0,
      }}
      className="flex h-full w-full items-center gap-1 overflow-hidden px-1.5 text-left font-label text-[11px] leading-none transition-opacity hover:opacity-85"
    >
      {event.isInternalComm && <span aria-label="Ação de Comunicação Interna">📌</span>}
      {/* O trecho continuado repete o título com a seta: quem olha só a segunda
          semana de uma campanha precisa saber o que é aquela faixa. */}
      {!isStart && <span aria-hidden="true">↳</span>}
      <span className="truncate">{event.title}</span>
      {showTime && event.startTime && <span className="ml-auto shrink-0 opacity-80">{event.startTime}</span>}
    </button>
  )
}
