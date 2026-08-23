import { useQuery } from '@tanstack/react-query'
import type { CalendarEventsResponse, CalendarEventOccurrenceDTO, CalendarEventTypeDTO } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { viewRange, type CalendarView } from './calendar-events'

const NO_OCCURRENCES: CalendarEventOccurrenceDTO[] = []
const NO_TYPES: CalendarEventTypeDTO[] = []

/**
 * A única fonte do calendário: os eventos cadastrados que a pessoa alcança na
 * janela do recorte exibido. O recorte por público-alvo, por setor e por
 * comunicação interna é todo do backend — a tela nunca recebe evento que não é
 * dela, e por isso não há aqui nenhum filtro de visibilidade.
 *
 * A resposta traz também o catálogo de categorias, que é o que popula o filtro
 * e o campo de cadastro. Vem junto de propósito: uma request a menos, e a
 * categoria nunca aparece na tela sem os eventos dela (ou o contrário).
 */
export function useCalendarData(args: { view: CalendarView; cursor: string }): {
  occurrences: CalendarEventOccurrenceDTO[]
  types: CalendarEventTypeDTO[]
  isLoading: boolean
  isError: boolean
} {
  const { from, to } = viewRange(args.view, args.cursor)
  const query = useQuery({
    queryKey: ['calendar-events', from, to],
    queryFn: () => apiFetch<CalendarEventsResponse>(`/calendar/events?from=${from}&to=${to}`),
    // Navegar de mês e voltar não pisca a grade: os dados antigos ficam na tela
    // enquanto os novos chegam, e `isLoading` só é verdade na primeira visita.
    placeholderData: (anterior) => anterior,
  })

  return {
    occurrences: query.data?.occurrences ?? NO_OCCURRENCES,
    types: query.data?.types ?? NO_TYPES,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
