import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { GifSearchResponse } from '@legends/shared'
import { apiFetch } from './api'

/** Flag pública: o backend tem chave do Giphy? (controla o botão GIF) */
export function useGifsEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['gifs', 'config'],
    queryFn: () => apiFetch<{ enabled: boolean }>('/gifs/config'),
    staleTime: 5 * 60 * 1000,
  })
  return data?.enabled ?? false
}

/** Busca paginada de GIFs. `query` vazio → featured. */
export function useGifSearch(query: string) {
  const q = useInfiniteQuery({
    queryKey: ['gifs', 'search', query],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) =>
      apiFetch<GifSearchResponse>(
        `/gifs/search?q=${encodeURIComponent(query)}${pageParam ? `&pos=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.next ?? undefined,
  })
  return {
    results: q.data?.pages.flatMap((p) => p.results) ?? [],
    fetchNextPage: q.fetchNextPage,
    hasNextPage: q.hasNextPage,
    isLoading: q.isLoading,
  }
}
