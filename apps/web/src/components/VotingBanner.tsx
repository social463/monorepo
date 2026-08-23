import { Link } from 'react-router-dom'
import { useCurrentPeriod } from '../lib/use-current-period'
import { Icon } from './Icon'

/** Dias inteiros (arredondando pra cima) entre agora e a data ISO; nunca negativo. */
function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

/**
 * Faixa de votação no topo da Home. Só aparece quando há votação aberta —
 * caso contrário não renderiza nada (sem placeholder).
 */
export function VotingBanner() {
  const { period, votingOpen } = useCurrentPeriod()

  if (!votingOpen || !period) return null

  const days = daysUntil(period.endsAt)
  const prazo = days <= 0 ? 'último dia' : days === 1 ? 'falta 1 dia' : `faltam ${days} dias`
  return (
    <Link
      to="/votar"
      data-testid="voting-banner-open"
      className="flex items-center justify-between gap-md rounded-xl border border-primary/30 bg-primary/10 px-lg py-md transition-colors hover:bg-primary/15"
    >
      <span className="flex items-center gap-sm font-label text-label-lg text-on-surface">
        <Icon name="how_to_vote" filled className="text-[20px] text-primary" />
        Votação aberta · {prazo}
      </span>
      <span className="flex shrink-0 items-center gap-1 font-label text-label-md text-primary">
        Votar agora
        <Icon name="arrow_forward" className="text-[18px]" />
      </span>
    </Link>
  )
}
