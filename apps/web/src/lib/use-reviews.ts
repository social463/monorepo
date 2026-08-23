import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import {
  REVIEW_REACTIONS,
  type CreateReviewCommentRequest,
  type CreateReviewRequest,
  type ReactionSummary,
  type ReviewCommentDTO,
  type ReviewCommentsResponse,
  type ReviewDTO,
  type ReviewFeedResponse,
  type ReviewPollVotesResponse,
  type ReviewReactionEmoji,
} from '@legends/shared'
import { apiFetch } from './api'

const FEED_KEY = ['reviews', 'feed'] as const

/**
 * Recalcula o array de reações ao aplicar/remover a reação do usuário atual.
 *
 * `emoji` é `string`, e não `ReviewReactionEmoji`: o Feed Corporativo tem lista
 * própria desde que a G&G pediu o coração verde, e esta função só compara o
 * emoji com o que já está no array — não valida conjunto (quem valida é a API).
 */
export function applyReactionToggle(
  reactions: ReactionSummary[],
  emoji: string,
  me: { id: string; name: string },
): ReactionSummary[] {
  const existing = reactions.find((r) => r.emoji === emoji)
  if (existing?.reactedByMe) {
    return reactions
      .map((r) =>
        r.emoji === emoji
          ? { ...r, count: r.count - 1, reactedByMe: false, users: r.users.filter((u) => u.id !== me.id) }
          : r,
      )
      .filter((r) => r.count > 0)
  }
  if (existing) {
    return reactions.map((r) =>
      r.emoji === emoji
        ? { ...r, count: r.count + 1, reactedByMe: true, users: [...r.users, { id: me.id, name: me.name }] }
        : r,
    )
  }
  const added: ReactionSummary = { emoji, count: 1, reactedByMe: true, users: [{ id: me.id, name: me.name }] }
  return [...reactions, added].sort(
    (a, b) => REVIEW_REACTIONS.indexOf(a.emoji as ReviewReactionEmoji) - REVIEW_REACTIONS.indexOf(b.emoji as ReviewReactionEmoji),
  )
}

export function useReviewFeed() {
  return useInfiniteQuery({
    queryKey: FEED_KEY,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiFetch<ReviewFeedResponse>(`/reviews?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

export function useCreateReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateReviewRequest) =>
      apiFetch<{ review: ReviewDTO }>('/reviews', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: FEED_KEY }),
  })
}

export function useDeleteReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/reviews/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: FEED_KEY }),
  })
}

export function useToggleReviewReaction(me: { id: string; name: string } | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { reviewId: string; emoji: ReviewReactionEmoji }) =>
      apiFetch<{ review: ReviewDTO }>(`/reviews/${vars.reviewId}/reactions/toggle`, {
        method: 'POST',
        body: JSON.stringify({ emoji: vars.emoji }),
      }),
    onMutate: async (vars) => {
      if (!me) return { previous: undefined }
      await qc.cancelQueries({ queryKey: FEED_KEY })
      const previous = qc.getQueryData<InfiniteData<ReviewFeedResponse>>(FEED_KEY)
      qc.setQueryData<InfiniteData<ReviewFeedResponse>>(FEED_KEY, (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((r) =>
              r.id === vars.reviewId ? { ...r, reactions: applyReactionToggle(r.reactions, vars.emoji, me) } : r,
            ),
          })),
        }
      })
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(FEED_KEY, ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: FEED_KEY }),
  })
}

export function useToggleShare() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { reviewId: string; shared: boolean }) =>
      apiFetch<{ review: ReviewDTO }>(`/reviews/${vars.reviewId}/share`, {
        method: vars.shared ? 'POST' : 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: FEED_KEY })
      qc.invalidateQueries({ queryKey: ['mural'] })
    },
  })
}

export function useVoteReviewPoll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { reviewId: string; optionId: string }) =>
      apiFetch<{ review: ReviewDTO }>(`/reviews/${vars.reviewId}/poll/vote`, {
        method: 'POST',
        body: JSON.stringify({ optionId: vars.optionId }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: FEED_KEY })
      qc.invalidateQueries({ queryKey: ['reviews', 'poll-votes', vars.reviewId] })
    },
  })
}

export function useReviewPollVotes(reviewId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['reviews', 'poll-votes', reviewId],
    enabled,
    queryFn: () => apiFetch<ReviewPollVotesResponse>(`/reviews/${reviewId}/poll/votes`),
  })
}

export function useReviewComments(reviewId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['reviews', 'comments', reviewId],
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      apiFetch<ReviewCommentsResponse>(`/reviews/${reviewId}/comments?offset=${pageParam}&limit=10`),
    getNextPageParam: (last, all) =>
      last.hasMore ? all.reduce((n, p) => n + p.items.length, 0) : undefined,
  })
}

export function useCreateComment(reviewId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateReviewCommentRequest) =>
      apiFetch<{ comment: ReviewCommentDTO }>(`/reviews/${reviewId}/comments`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews', 'comments', reviewId] })
      qc.invalidateQueries({ queryKey: FEED_KEY })
    },
  })
}

export function useDeleteComment(reviewId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => apiFetch<void>(`/reviews/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews', 'comments', reviewId] })
      qc.invalidateQueries({ queryKey: FEED_KEY })
    },
  })
}

export function useToggleCommentReaction(reviewId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { commentId: string; emoji: ReviewReactionEmoji }) =>
      apiFetch<{ comment: ReviewCommentDTO }>(`/reviews/comments/${vars.commentId}/reactions/toggle`, {
        method: 'POST',
        body: JSON.stringify({ emoji: vars.emoji }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews', 'comments', reviewId] }),
  })
}
