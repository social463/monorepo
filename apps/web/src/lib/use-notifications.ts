import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NotificationListResponse, UnreadCountResponse } from '@legends/shared'
import { apiFetch } from './api'

/** Contador de não-lidas, com polling curto. Alimenta o badge do sino. */
export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => apiFetch<UnreadCountResponse>('/notifications/unread-count'),
    refetchInterval: 10_000,
  })
}

/** Lista de não-lidas, com polling curto — alimenta os toasts de convite do Escritório. */
export function useUnreadNotificationsPoll() {
  return useQuery({
    queryKey: ['notifications', 'unread-list'],
    queryFn: () => apiFetch<NotificationListResponse>('/notifications?limit=20&read=false'),
    refetchInterval: 10_000,
  })
}

/** 'all' (padrão), 'unread' (não-lidas) ou 'read' (lidas). */
export type NotificationFilter = 'all' | 'unread' | 'read'

function readParam(filter: NotificationFilter): string {
  if (filter === 'unread') return '&read=false'
  if (filter === 'read') return '&read=true'
  return ''
}

/** Lista paginada por cursor; carregada quando o dropdown/página abre. */
export function useNotifications(filter: NotificationFilter = 'all', enabled = true) {
  return useInfiniteQuery({
    queryKey: ['notifications', 'list', filter],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiFetch<NotificationListResponse>(
        `/notifications?limit=20${pageParam ? `&cursor=${pageParam}` : ''}${readParam(filter)}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

/** Marca todas como lidas e revalida a lista + contador. */
export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<UnreadCountResponse>('/notifications/read', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

/** Marca uma notificação como lida (move-a para a aba "Lidas") e revalida. */
export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<UnreadCountResponse>(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

/** Remove todas as notificações já lidas e revalida a lista. */
export function useClearRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<void>('/notifications/read', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
