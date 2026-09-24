import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { canPublishCorporatePostDirectly } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { useAuth } from '../../auth/AuthContext'
import { useCorporateMuralFeed, useCorporatePostTags, useCreateCorporatePost } from '../../lib/use-corporate-mural'
import { CorporatePostComposer } from './CorporatePostComposer'
import { CorporatePostCard } from './CorporatePostCard'

/**
 * Pílula do filtro por tipo de comunicação.
 *
 * A cor da tag pinta a borda e o ponto, não o fundo: com seis pílulas coloridas
 * lado a lado, fundo cheio faria a selecionada sumir no meio das outras — e é a
 * seleção que precisa saltar. Selecionada, a pílula usa a cor de marca.
 */
function TagPill({
  label,
  color,
  active,
  onClick,
}: {
  label: string
  color?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-xs rounded-full border px-md py-1 font-label text-label-md transition-colors ${
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-outline-variant/60 text-on-surface-variant hover:text-on-surface'
      }`}
    >
      {color && <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      {label}
    </button>
  )
}

/** Feed do mural corporativo: composer + lista + scroll infinito + deep-link.
 *
 * A conexão de tempo real NÃO vive mais aqui: ela mora no `AppLayout` (via
 * `CorporatePostToasts`), uma por aba. Assim o comunicado publicado por um
 * colega aparece sem refresh mesmo para quem está na Home — e não há duas
 * conexões abertas por pessoa, com só uma delas invalidando a query. */
export function MuralCorporativoFeed() {
  const { user } = useAuth()
  // Filtro por tipo de comunicação (seção 13 do Documento 3). Vazio = tudo.
  const [tagId, setTagId] = useState('')
  const tags = useCorporatePostTags()
  const feed = useCorporateMuralFeed(tagId || undefined)
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

      {/* Pílulas de filtro no topo, como a seção 13 pede. Some quando a empresa
          não tem catálogo — um filtro de um item só ocupa espaço sem servir. */}
      {(tags.data?.tags?.length ?? 0) > 0 && (
        <div role="group" aria-label="Filtrar por tipo de comunicação" className="flex flex-wrap gap-sm">
          <TagPill label="Todos" active={tagId === ''} onClick={() => setTagId('')} />
          {(tags.data?.tags ?? []).map((tag) => (
            <TagPill
              key={tag.id}
              label={tag.name}
              color={tag.color}
              active={tagId === tag.id}
              onClick={() => setTagId(tagId === tag.id ? '' : tag.id)}
            />
          ))}
        </div>
      )}

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
