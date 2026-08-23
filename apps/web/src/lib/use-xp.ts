import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { XpBalanceDTO, XpEvent, XpRulePublicListResponse } from '@legends/shared'
import { apiFetch } from './api'

export const XP_KEY = ['xp'] as const

/**
 * Carteira de XP e nível. Sem gate de feature, ao contrário de `useCoinBalance`:
 * o nível aparece no card de perfil da Home, que toda pessoa logada vê.
 */
export function useXpBalance(enabled = true) {
  return useQuery({
    queryKey: ['xp', 'balance'],
    queryFn: () => apiFetch<XpBalanceDTO>('/me/xp'),
    enabled,
  })
}

/** Regras ativas — alimenta o Manual do Game. */
export function useXpRules(enabled = true) {
  return useQuery({
    queryKey: ['xp', 'rules'],
    queryFn: () => apiFetch<XpRulePublicListResponse>('/xp/rules'),
    enabled,
  })
}

/**
 * Quanto vale um evento NESTA empresa, ou null quando a regra está desligada
 * (a rota só devolve regra ativa). É o que deixa a tela prometer "+3 pts" sem
 * cravar o número: o valor é dado, editável em Administração › Pontos.
 *
 * Compartilha a query de `useXpRules`, então chamar de vários cards não gera
 * requisição nova.
 */
export function useXpAmount(event: XpEvent): number | null {
  const { data } = useXpRules()
  return data?.rules?.find((rule) => rule.event === event)?.amount ?? null
}

/** Invalida carteira e regras depois de uma ação que pode ter creditado XP. */
export function invalidateXp(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: XP_KEY })
}
