import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type {
  FeedbackWallResponse,
  FeedbackReactionEmoji,
  ReactionSummary,
  SharedFeedbackDTO,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { applyToggle } from '../../lib/reaction-toggle'
import { invalidateCoins } from '../../lib/use-coins'
import { useAuth } from '../../auth/AuthContext'

/** Prefixo das queries do Mural de Feedbacks — a prévia da home e a página completa. */
export const SHARED_FEEDBACKS_KEY = ['shared-feedbacks'] as const
export const sharedFeedbacksPreviewKey = [...SHARED_FEEDBACKS_KEY, 'preview'] as const
export const sharedFeedbacksPageKey = [...SHARED_FEEDBACKS_KEY, 'page'] as const

/**
 * `filters` viaja na URL porque a busca é do servidor: a lista é paginada, e
 * filtrar no cliente esconderia o resultado que está na página seguinte.
 */
export function fetchSharedFeedbacks(
  offset: number,
  limit: number,
  filters: { q?: string; categoryId?: string } = {},
): Promise<FeedbackWallResponse> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  if (filters.q) params.set('q', filters.q)
  if (filters.categoryId) params.set('categoryId', filters.categoryId)
  return apiFetch<FeedbackWallResponse>(`/feedbacks/mural?${params.toString()}`)
}

/**
 * Aplica `mapper` aos feedbacks de um cache do mural. A prévia guarda uma página só
 * e a lista completa guarda um InfiniteData, então tratamos os dois formatos.
 */
function mapWallCache(old: unknown, mapper: (f: SharedFeedbackDTO) => SharedFeedbackDTO): unknown {
  if (!old || typeof old !== 'object') return old
  if ('pages' in old) {
    const infinite = old as InfiniteData<FeedbackWallResponse>
    return {
      ...infinite,
      pages: infinite.pages.map((page) => ({ ...page, feedbacks: page.feedbacks.map(mapper) })),
    }
  }
  const page = old as FeedbackWallResponse
  if (!Array.isArray(page.feedbacks)) return old
  return { ...page, feedbacks: page.feedbacks.map(mapper) }
}

/**
 * Reagir a um feedback do mural, com atualização otimista em todos os caches do
 * mural (a home e a página mostram os mesmos itens e precisam concordar).
 */
export function useToggleSharedReaction() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: (vars: { feedbackId: string; emoji: FeedbackReactionEmoji }) =>
      apiFetch<{ reactions: ReactionSummary[] }>(`/feedbacks/${vars.feedbackId}/reactions/toggle`, {
        method: 'POST',
        body: JSON.stringify({ emoji: vars.emoji }),
      }),
    onMutate: async (vars) => {
      if (!user) return { previous: [] as [readonly unknown[], unknown][] }
      await queryClient.cancelQueries({ queryKey: SHARED_FEEDBACKS_KEY })
      const previous = queryClient.getQueriesData({ queryKey: SHARED_FEEDBACKS_KEY })
      const me = { id: user.id, name: user.name }
      queryClient.setQueriesData({ queryKey: SHARED_FEEDBACKS_KEY }, (old: unknown) =>
        mapWallCache(old, (f) =>
          f.id === vars.feedbackId ? { ...f, reactions: applyToggle(f.reactions, vars.emoji, me) } : f,
        ),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.previous ?? []) queryClient.setQueryData(key, data)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SHARED_FEEDBACKS_KEY })
      invalidateCoins(queryClient)
    },
  })
}
