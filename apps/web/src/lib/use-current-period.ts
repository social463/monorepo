import { useQuery } from '@tanstack/react-query'
import type { VotingPeriodDTO } from '@legends/shared'
import { apiFetch } from './api'

/**
 * Período de votação aberto no momento (ou null). Compartilhado entre a sidebar
 * e a página de votação via a queryKey ['period'] — uma única consulta em cache.
 * `votingOpen` é a fonte da verdade no front para "votação aberta".
 */
export function useCurrentPeriod() {
  const query = useQuery({
    queryKey: ['period'],
    queryFn: () => apiFetch<{ period: VotingPeriodDTO | null }>('/periods/current'),
  })
  const period = query.data?.period ?? null
  return { period, votingOpen: period != null, isLoading: query.isLoading }
}
