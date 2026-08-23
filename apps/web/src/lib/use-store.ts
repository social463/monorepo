import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateStoreOrderResponse,
  StoreOrderListResponse,
  StoreProductListResponse,
} from '@legends/shared'
import { apiFetch } from './api'
import { invalidateCoins } from './use-coins'

export const STORE_KEY = ['store'] as const

export function useStoreProducts() {
  return useQuery({
    queryKey: ['store', 'products'],
    queryFn: () => apiFetch<StoreProductListResponse>('/store/products'),
  })
}

export function useMyStoreOrders(page: number) {
  return useQuery({
    queryKey: ['store', 'orders', page],
    queryFn: () => apiFetch<StoreOrderListResponse>(`/store/orders?page=${page}`),
  })
}

/**
 * Resgate. Invalida a loja E os coins: o saldo do chip do cabeçalho muda no
 * mesmo clique, e o estoque do produto também.
 */
export function useRedeemProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (productId: string) =>
      apiFetch<CreateStoreOrderResponse>('/store/orders', {
        method: 'POST',
        body: JSON.stringify({ productId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORE_KEY })
      invalidateCoins(queryClient)
    },
  })
}
