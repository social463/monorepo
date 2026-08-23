import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { canPublishCorporatePostDirectly } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { useAuth } from '../../auth/AuthContext'
import { useCorporateMuralFeed, useCreateCorporatePost } from '../../lib/use-corporate-mural'
import { CorporatePostComposer } from './CorporatePostComposer'
import { CorporatePostCard } from './CorporatePostCard'

/** Feed do mural corporativo: composer + lista + scroll infinito + deep-link.
 *
 * A conexão de tempo real NÃO vive mais aqui: ela mora no `AppLayout` (via
 * `CorporatePostToasts`), uma por aba. Assim o comunicado publicado por um
 * colega aparece sem refresh mesmo para quem está na Home — e não há duas
 * conexões abertas por pessoa, com só uma delas invalidando a query. */
export function MuralCorporativoFeed() {
  const { user } = useAuth()
  const feed = useCorporateMuralFeed()
  const create = useCreateCorporatePost()
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { hash } = useLocation()
  const targetId = hash.startsWith('#') ? hash.slice(1) : ''

  // Escrever é de todo mundo desde a 2ª rodada da G&G; o que o papel decide é
  // se o comunicado sai publicado ou vai para a fila. A API é a autoridade;
  // enquanto o feed não chega, o papel do usuário já responde (evita piscar).
  const canPublishDirectly =
    feed.data?.pages[0]?.canPublishDirectly ?? canPublishCorporatePostDirectly(user?.role, user?.adminAccess)

  // Deep-link de notificação: carrega páginas até encontrar o post alvo, depois rola até ele.
  const scrolledRef = useRef(false)
  useEffect(() => {
    scrolledRef.current = false
  }, [targetId])
  useEffect(() => {
    if (!targetId) return
    const posts = feed.data?.pages.flatMap((p) => p.items) ?? []
    if (!posts.some((p) => p.id === targetId)) {
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

  const posts = feed.data?.pages.flatMap((p) => p.items) ?? []

  return (
    // Cada comunicado é um CARD próprio, e não uma linha de uma lista dividida:
    // o post da empresa tem título, mídia e barra de ações — separá-los dá o
    // limite de onde um acaba e o outro começa, que a lista com `divide` não dá.
    <div className="flex flex-col gap-lg">
      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-lg py-md">
        <CorporatePostComposer
          onSubmit={(body) => create.mutate(body)}
          pending={create.isPending}
          canPublishDirectly={canPublishDirectly}
        />
      </div>

      {feed.isLoading ? (
        <p className="text-body-sm text-on-surface-variant">Carregando…</p>
      ) : feed.isError ? (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          Erro ao carregar o Feed Corporativo.
        </p>
      ) : posts.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          Nenhuma publicação ainda. Comece a conversa com a empresa!
        </p>
      ) : (
        <ul className="flex flex-col gap-lg">
          {posts.map((p) => (
            <CorporatePostCard key={p.id} post={p} />
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
          className="w-full rounded-2xl border border-outline-variant/40 px-lg py-md font-label text-label-md text-primary transition-colors hover:bg-surface-container-high disabled:opacity-50"
        >
          {feed.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  )
}
