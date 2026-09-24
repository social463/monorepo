import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import type { OkrCycleDTO } from '@legends/shared'
import { listOkrCycles } from '../../lib/okr-api'

/**
 * Ciclo em tela: o da URL (`?ciclo=`), senão o aberto mais recente, senão o
 * primeiro da lista (que já vem do mais novo para o mais antigo).
 */
export function useOkrCycle() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = useQuery({ queryKey: ['okr', 'cycles'], queryFn: listOkrCycles })
  const cycles = query.data?.cycles ?? []
  const requested = searchParams.get('ciclo')
  const cycle: OkrCycleDTO | null =
    cycles.find((c) => c.id === requested) ?? cycles.find((c) => c.status === 'OPEN') ?? cycles[0] ?? null

  function selectCycle(id: string) {
    const next = new URLSearchParams(searchParams)
    next.set('ciclo', id)
    setSearchParams(next, { replace: true })
  }

  return { cycles, cycle, selectCycle, isLoading: query.isLoading, isError: query.isError }
}
