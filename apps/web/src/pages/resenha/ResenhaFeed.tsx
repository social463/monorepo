import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useCreateReview, useReviewFeed } from '../../lib/use-reviews'
import { useReviewSocket } from '../../lib/useReviewSocket'
import { ReviewComposer } from './ReviewComposer'
import { ReviewCard } from './ReviewCard'

/** Feed de resenha reutilizável: composer + lista + scroll infinito + deep-link.
 * A conexão de tempo real vive aqui para o feed ficar "ao vivo" onde quer que
 * seja montado (Home e /resenha) — não só na página dedicada. */
export function ResenhaFeed() {
  useReviewSocket()
  const feed = useReviewFeed()
  const create = useCreateReview()
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { hash } = useLocation()
  const targetId = hash.startsWith('#') ? hash.slice(1) : ''

  // Deep-link de notificação: carrega páginas até encontrar o post alvo, depois rola até ele.
  const scrolledRef = useRef(false)
  useEffect(() => {
    scrolledRef.current = false
  }, [targetId])
  useEffect(() => {
    if (!targetId) return
    const reviews = feed.data?.pages.flatMap((p) => p.items) ?? []
    if (!reviews.some((r) => r.id === targetId)) {
      if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage()
      return
    }
    if (scrolledRef.current) return
    scrolledRef.current = true
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [targetId, feed.data, feed.hasNextPage, feed.isFetchingNextPage])

  // Scroll infinito: observa a sentinela e busca a próxima página ao aparecer.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) {
        feed.fetchNextPage()
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [feed.hasNextPage, feed.isFetchingNextPage])

  const reviews = feed.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container">
      <div className="border-b border-outline-variant/40 px-lg py-md">
        <ReviewComposer
          onSubmit={(content, mentionedUserIds, gif, image, poll) =>
            create.mutate({
              content,
              mentionedUserIds,
              ...(gif ? { gif } : {}),
              ...(image ? { image } : {}),
              ...(poll ? { poll } : {}),
            })
          }
          pending={create.isPending}
        />
      </div>

      {feed.isLoading ? (
        <p className="px-lg py-md text-body-sm text-on-surface-variant">Carregando…</p>
      ) : feed.isError ? (
        <p role="alert" className="flex items-center gap-sm px-lg py-md text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          Erro ao carregar a resenha.
        </p>
      ) : reviews.length === 0 ? (
        <p className="px-lg py-md text-body-sm text-on-surface-variant">
          Ainda não há resenhas. Seja o primeiro!
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-outline-variant/40">
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </ul>
      )}

      {/* Sentinela do scroll infinito + fallback acessível por botão. */}
      <div ref={sentinelRef} className="h-px" />
      {feed.hasNextPage && (
        <button
          type="button"
          onClick={() => feed.fetchNextPage()}
          disabled={feed.isFetchingNextPage}
          className="w-full border-t border-outline-variant/40 px-lg py-md font-label text-label-md text-primary transition-colors hover:bg-surface-container-high disabled:opacity-50"
        >
          {feed.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  )
}
