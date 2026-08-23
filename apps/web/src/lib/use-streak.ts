import { useQuery } from '@tanstack/react-query'
import type { StreakSummaryDTO, StreakCalendarDTO } from '@legends/shared'
import { apiFetch } from './api'

/** Resumo da ofensiva (streak atual/melhor + se hoje já tem boost). */
export function useStreakSummary() {
  return useQuery({
    queryKey: ['streak'],
    queryFn: () => apiFetch<StreakSummaryDTO>('/me/streak'),
  })
}

/** Dias com boost de um mês "YYYY-MM"; só busca quando enabled. */
export function useStreakCalendar(monthRef: string, enabled = true) {
  return useQuery({
    queryKey: ['streak-calendar', monthRef],
    enabled,
    queryFn: () => apiFetch<StreakCalendarDTO>(`/me/streak/calendar?month=${monthRef}`),
  })
}
