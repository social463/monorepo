import { useQuery } from '@tanstack/react-query'
import {
  PRESENCE_ONLINE_WINDOW_MINUTES,
  type RankingOverviewResponse,
  type RankingResponse,
  type StreakRankingResponse,
} from '@legends/shared'
import { apiFetch } from './api'

export const RANKING_KEY = ['ranking'] as const

/**
 * De quanto em quanto tempo o ranking se atualiza sozinho.
 *
 * Amarrado à janela de presença: a bolinha verde viaja junto com a pontuação,
 * e um ranking que só recarrega ao trocar de tela mostraria como on-line quem
 * saiu há meia hora. Recarregar mais rápido que a janela não descobre nada novo.
 */
const REFETCH_MS = (PRESENCE_ONLINE_WINDOW_MINUTES / 2) * 60 * 1000

/**
 * Ranking geral por pontos (XP acumulado).
 *
 * `limit` corta só a lista devolvida — `total` e `me` continuam sendo do ranking
 * inteiro, então o bloco de 5 da Home ainda consegue dizer a posição real de
 * quem está olhando.
 */
export function useRanking(limit?: number) {
  return useQuery({
    queryKey: ['ranking', 'points', limit ?? 'todos'],
    queryFn: () => apiFetch<RankingResponse>(limit ? `/ranking?limit=${limit}` : '/ranking'),
    refetchInterval: REFETCH_MS,
  })
}

/** Ranking de consistência: dias úteis seguidos com humor registrado. */
export function useStreakRanking(enabled = true) {
  return useQuery({
    queryKey: ['ranking', 'streaks'],
    queryFn: () => apiFetch<StreakRankingResponse>('/ranking/streaks'),
    enabled,
    refetchInterval: REFETCH_MS,
  })
}

/** Visão do admin: a economia de XP da empresa (Administração › Engajamento). */
export function useRankingOverview(enabled = true) {
  return useQuery({
    queryKey: ['ranking', 'admin-overview'],
    queryFn: () => apiFetch<RankingOverviewResponse>('/admin/ranking/overview'),
    enabled,
  })
}
