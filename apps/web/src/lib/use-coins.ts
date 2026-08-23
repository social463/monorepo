import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { CoinBalanceDTO, CoinLedgerResponse, CoinRulePublicListResponse } from '@legends/shared'
import { apiFetch } from './api'
import { useAuth } from '../auth/AuthContext'
import { effectiveFeatures } from './features'

export const COINS_KEY = ['coins'] as const

export function useCoinBalance(enabled = true) {
  return useQuery({
    queryKey: ['coins', 'balance'],
    queryFn: () => apiFetch<CoinBalanceDTO>('/me/coins'),
    enabled,
  })
}

export function useCoinLedger(page: number, enabled = true) {
  return useQuery({
    queryKey: ['coins', 'ledger', page],
    queryFn: () => apiFetch<CoinLedgerResponse>(`/me/coins/transactions?page=${page}`),
    enabled,
  })
}

export function useCoinRules(enabled = true) {
  return useQuery({
    queryKey: ['coins', 'rules'],
    queryFn: () => apiFetch<CoinRulePublicListResponse>('/coins/rules'),
    enabled,
  })
}

/** Invalida saldo, extrato e regras depois de uma ação que pode ter creditado. */
export function invalidateCoins(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: COINS_KEY })
}

/**
 * Colaborador com a feature `coins`. Devolve boolean (e não o Set de
 * `effectiveFeatures`, que nasce novo a cada render) para poder entrar em dep
 * array sem provocar loop de render.
 */
export function useHasCoins(): boolean {
  const { user } = useAuth()
  if (!user) return false
  return effectiveFeatures({
    role: user.role,
    enabledFeatures: user.enabledFeatures,
    sectorFeatures: user.sectorFeatures,
  }).has('coins')
}
