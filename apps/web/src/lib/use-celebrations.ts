import { useQuery } from '@tanstack/react-query'
import type { BirthdayDTO, CelebrationsResponse, UpcomingBirthdayDTO, UpcomingWorkAnniversaryDTO, WorkAnniversaryDTO } from '@legends/shared'
import { apiFetch } from './api'

// Constantes estáveis: um `?? { month: [], upcoming: [] }` inline nasceria novo
// a cada render e quebraria memoização de quem consome (ver gotcha no AGENTS.md).
const NO_BIRTHDAYS: { month: BirthdayDTO[]; upcoming: UpcomingBirthdayDTO[] } = { month: [], upcoming: [] }
const NO_WORK: { month: WorkAnniversaryDTO[]; upcoming: UpcomingWorkAnniversaryDTO[] } = { month: [], upcoming: [] }

/**
 * Celebrações do setor: aniversários de nascimento e de casa, os próximos e o
 * mês corrente inteiro. Uma única query serve os dois cards da Home e a tela do
 * calendário (mesma queryKey, cache compartilhado).
 *
 * @param monthRef Mês exibido (YYYY-MM). Ausente = mês corrente — é como a Home
 * chama, e a queryKey diferente mantém o cache dos cards separado do calendário.
 * @param enabled Passa direto para o React Query — o calendário desliga a busca
 * quando nenhum filtro de celebração está ligado.
 */
export function useCelebrations(monthRef?: string, enabled = true) {
  const query = useQuery({
    queryKey: ['celebrations', monthRef ?? 'atual'],
    queryFn: () => apiFetch<CelebrationsResponse>(monthRef ? `/celebrations?month=${monthRef}` : '/celebrations'),
    enabled,
  })
  return {
    birthdays: query.data?.birthdays ?? NO_BIRTHDAYS,
    workAnniversaries: query.data?.workAnniversaries ?? NO_WORK,
    referenceDay: query.data?.referenceDay ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
