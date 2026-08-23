import { formatObservedDate, relativeDayLabel } from '../lib/celebration-date-label'

/**
 * Quando é a próxima ocorrência: "Hoje" em destaque (chip sólido), ou
 * "Amanhã"/"Em N dias" mais discreto.
 *
 * Inline (`<span>`), e não um parágrafo próprio: o `CelebrationTile` põe isto
 * na mesma linha do setor. A data absoluta só acompanha o que NÃO é hoje — no
 * "Hoje" ela era redundante e transformava a linha em três informações.
 */
export function CelebrationDateLabel({ daysUntil, observedDate }: { daysUntil: number; observedDate: string }) {
  if (daysUntil === 0) {
    return (
      <span className="shrink-0 rounded-full bg-primary px-sm py-0.5 font-label text-label-sm font-bold uppercase tracking-wide text-on-primary">
        Hoje
      </span>
    )
  }
  return (
    <span>
      {relativeDayLabel(daysUntil)} · {formatObservedDate(observedDate)}
    </span>
  )
}
