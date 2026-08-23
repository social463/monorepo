import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type {
  CorporatePostCommentDTO,
  CorporatePostCommentsResponse,
  CorporatePostDTO,
  CorporatePostFeedResponse,
  CorporatePostReachResponse,
  CorporatePostReactorsResponse,
  CorporatePostReactionEmoji,
  CreateCorporatePostCommentRequest,
  CreateCorporatePostRequest,
  GenerateCorporatePostRequest,
  GenerateCorporatePostResponse,
  PendingCorporatePostsResponse,
  UpdateCorporatePostRequest,
} from '@legends/shared'
import { apiFetch } from './api'
import { applyReactionToggle } from './use-reviews'

export const CORPORATE_FEED_KEY = ['corporate-posts', 'feed'] as const
export const CORPORATE_PENDING_KEY = ['corporate-posts', 'pending'] as const

/**
 * O feed devolve, junto dos itens, o que o viewer pode fazer. `canPublish` hoje
 * é sempre true (todo mundo escreve); `canPublishDirectly` é o que decide se o
 * composer avisa "vai para aprovação".
 */
type FeedPage = CorporatePostFeedResponse & { canPublish: boolean; canPublishDirectly: boolean }

export function useCorporateMuralFeed() {
  return useInfiniteQuery({
    queryKey: CORPORATE_FEED_KEY,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiFetch<FeedPage>(`/corporate-posts?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

export function useCreateCorporatePost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCorporatePostRequest) =>
      apiFetch<{ post: CorporatePostDTO }>('/corporate-posts', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CORPORATE_FEED_KEY }),
  })
}

/** Edição de um comunicado: admin em qualquer um, autor no dele enquanto pendente. */
export function useUpdateCorporatePost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { postId: string; body: UpdateCorporatePostRequest }) =>
      apiFetch<{ post: CorporatePostDTO }>(`/corporate-posts/${vars.postId}`, {
        method: 'PATCH',
        body: JSON.stringify(vars.body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CORPORATE_FEED_KEY })
      qc.invalidateQueries({ queryKey: CORPORATE_PENDING_KEY })
    },
  })
}

/**
 * Fila de revisão. Para quem administra é a fila da empresa; para o
 * colaborador, "Meus envios" — a rota é a mesma e o escopo é do servidor.
 */
export function useCorporatePendingPosts(options: { mine?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...CORPORATE_PENDING_KEY, options.mine ?? false],
    enabled: options.enabled ?? true,
    queryFn: () =>
      apiFetch<PendingCorporatePostsResponse>(`/corporate-posts/pending${options.mine ? '?mine=true' : ''}`),
  })
}

export function useReviewCorporatePost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { postId: string; approve: boolean; reason?: string }) =>
      apiFetch<{ post: CorporatePostDTO }>(
        `/corporate-posts/${vars.postId}/${vars.approve ? 'approve' : 'reject'}`,
        { method: 'POST', ...(vars.approve ? {} : { body: JSON.stringify({ reason: vars.reason }) }) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CORPORATE_PENDING_KEY })
      qc.invalidateQueries({ queryKey: CORPORATE_FEED_KEY })
    },
  })
}

/** Gera título + corpo com a IA da empresa. Sem chave cadastrada, a API dá 503. */
export function useGenerateCorporatePost() {
  return useMutation({
    mutationFn: (body: GenerateCorporatePostRequest) =>
      apiFetch<GenerateCorporatePostResponse>('/corporate-posts/ai/generate', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}

/**
 * Um post isolado. É o que o toast usa: o WebSocket manda só o id (o hub é
 * global, mandar conteúdo vazaria entre empresas) e o conteúdo vem daqui — quem
 * não é do público-alvo recebe 404 e não vê toast nenhum.
 */
export function useCorporatePost(postId: string | null) {
  return useQuery({
    queryKey: ['corporate-posts', 'item', postId],
    enabled: postId !== null,
    queryFn: () => apiFetch<{ post: CorporatePostDTO }>(`/corporate-posts/${postId}`),
    retry: false,
  })
}

export function useDeleteCorporatePost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/corporate-posts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CORPORATE_FEED_KEY }),
  })
}

export function useToggleCorporatePostReaction(me: { id: string; name: string } | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { postId: string; emoji: CorporatePostReactionEmoji }) =>
      apiFetch<{ post: CorporatePostDTO }>(`/corporate-posts/${vars.postId}/reactions/toggle`, {
        method: 'POST',
        body: JSON.stringify({ emoji: vars.emoji }),
      }),
    onMutate: async (vars) => {
      if (!me) return { previous: undefined }
      await qc.cancelQueries({ queryKey: CORPORATE_FEED_KEY })
      const previous = qc.getQueryData<InfiniteData<FeedPage>>(CORPORATE_FEED_KEY)
      qc.setQueryData<InfiniteData<FeedPage>>(CORPORATE_FEED_KEY, (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((p) =>
              p.id === vars.postId ? { ...p, reactions: applyReactionToggle(p.reactions, vars.emoji, me) } : p,
            ),
          })),
        }
      })
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(CORPORATE_FEED_KEY, ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CORPORATE_FEED_KEY }),
  })
}

export function useCorporatePostComments(postId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['corporate-posts', 'comments', postId],
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      apiFetch<CorporatePostCommentsResponse>(`/corporate-posts/${postId}/comments?offset=${pageParam}&limit=10`),
    getNextPageParam: (last, all) =>
      last.hasMore ? all.reduce((n, p) => n + p.items.length, 0) : undefined,
  })
}

export function useCreateCorporatePostComment(postId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCorporatePostCommentRequest) =>
      apiFetch<{ comment: CorporatePostCommentDTO }>(`/corporate-posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['corporate-posts', 'comments', postId] })
      qc.invalidateQueries({ queryKey: CORPORATE_FEED_KEY })
    },
  })
}

export function useDeleteCorporatePostComment(postId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) =>
      apiFetch<void>(`/corporate-posts/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['corporate-posts', 'comments', postId] })
      qc.invalidateQueries({ queryKey: CORPORATE_FEED_KEY })
    },
  })
}

export function useToggleCorporateCommentReaction(postId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { commentId: string; emoji: CorporatePostReactionEmoji }) =>
      apiFetch<{ comment: CorporatePostCommentDTO }>(
        `/corporate-posts/comments/${vars.commentId}/reactions/toggle`,
        { method: 'POST', body: JSON.stringify({ emoji: vars.emoji }) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['corporate-posts', 'comments', postId] }),
  })
}

/** Fixa (pin=true) ou desfixa (pin=false) um post. Só admin/subadmin — a API devolve 403. */
export function usePinCorporatePost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { postId: string; pin: boolean }) =>
      apiFetch<{ post: CorporatePostDTO }>(`/corporate-posts/${vars.postId}/pin`, {
        method: vars.pin ? 'POST' : 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CORPORATE_FEED_KEY }),
  })
}

/**
 * `pageSize` é enviado explicitamente para o servidor em vez de confiar no default
 * dele: se o backend mudar o default, o cliente (que calcula "Mostrando X–Y de N"
 * a partir do mesmo número) não pode ficar desalinhado silenciosamente.
 */
export function useCorporateMuralReach(sort: 'date_desc' | 'date_asc', page: number, pageSize: number) {
  return useQuery({
    queryKey: ['admin', 'corporate-posts', 'reach', sort, page, pageSize],
    queryFn: () =>
      apiFetch<CorporatePostReachResponse>(
        `/admin/corporate-posts/reach?sort=${sort}&page=${page}&pageSize=${pageSize}`,
      ),
  })
}

/**
 * Quem reagiu num comunicado, sob demanda: `enabled` só liga quando a lista
 * abre, senão cada card do feed (e cada linha do painel de alcance) buscaria os
 * reatores de um post que ninguém pediu.
 *
 * Rota comum, não a de admin: quem enxerga o post enxerga quem reagiu. O mesmo
 * hook serve o "N reações" do feed e o painel de alcance da moderação.
 */
export function useCorporatePostReactors(postId: string | null) {
  return useQuery({
    queryKey: ['corporate-posts', 'reactors', postId],
    enabled: postId !== null,
    queryFn: () => apiFetch<CorporatePostReactorsResponse>(`/corporate-posts/${postId}/reactions`),
  })
}
