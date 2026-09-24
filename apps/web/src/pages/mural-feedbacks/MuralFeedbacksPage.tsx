import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  FEEDBACK_WALL_PAGE_SIZE,
  type MyFeedbacksResponse,
  type RecognitionCategoriesResponse,
} from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { FeedbackListSkeleton } from '../../components/Skeleton'
import { SelectMenu } from '../../components/SelectMenu'
import { categoryDotClass } from './category-colors'
import { NewFeedbackForm } from './NewFeedbackForm'
import { SharedFeedbackCard } from './SharedFeedbackCard'
import {
  fetchSharedFeedbacks,
  sharedFeedbacksPageKey,
  useMarkFeedbackWallSeen,
  useToggleSharedReaction,
} from './shared-feedbacks'

type Tab = 'mural' | 'enviar' | 'recebidos' | 'enviados'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'mural', label: 'Mural', icon: 'campaign' },
  { id: 'enviar', label: 'Enviar', icon: 'send' },
  { id: 'recebidos', label: 'Recebidos', icon: 'inbox' },
  { id: 'enviados', label: 'Enviados', icon: 'outbox' },
]

/** Aba Mural: o feed público da empresa, com busca e filtro por competência. */
function MuralTab() {
  const toggleReaction = useToggleSharedReaction()
  const [term, setTerm] = useState('')
  const [q, setQ] = useState('')
  const [categoryId, setCategoryId] = useState('')

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<RecognitionCategoriesResponse>('/categories'),
    staleTime: 5 * 60 * 1000,
  })

  // A busca vale no SERVIDOR (a lista é paginada), e só dispara no submit: um
  // fetch por tecla digitada custaria uma query ao banco por caractere.
  const feedbacksQuery = useInfiniteQuery({
    queryKey: [...sharedFeedbacksPageKey, q, categoryId],
    queryFn: ({ pageParam }) => fetchSharedFeedbacks(pageParam, FEEDBACK_WALL_PAGE_SIZE, { q, categoryId }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.reduce((n, p) => n + p.feedbacks.length, 0) : undefined,
  })
  const feedbacks = feedbacksQuery.data?.pages.flatMap((page) => page.feedbacks) ?? []

  return (
    <div className="flex flex-col gap-md">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setQ(term.trim())
        }}
        className="flex flex-wrap items-center gap-sm"
      >
        <label className="group relative min-w-[16rem] flex-1">
          <span className="sr-only">Buscar no mural</span>
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant">
            <Icon name="search" className="text-[20px]" />
          </span>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar por colega, categoria ou trecho…"
            className="w-full rounded-md border border-outline-variant/60 bg-surface-container-highest py-2 pl-10 pr-4 text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant focus:border-primary"
          />
        </label>
        <SelectMenu
          label="Categoria"
          value={categoryId}
          onChange={setCategoryId}
          className="min-w-[15rem]"
          searchPlaceholder="Buscar categoria…"
          options={[
            { value: '', label: 'Todas as categorias' },
            ...(categories.data?.categories ?? []).map((category) => ({
              value: category.id,
              label: category.name,
              adornment: (
                <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${categoryDotClass(category.name)}`} />
              ),
            })),
          ]}
        />
        <button
          type="submit"
          className="rounded-md border border-outline-variant/60 px-md py-2 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          Buscar
        </button>
      </form>

      {feedbacksQuery.isLoading ? (
        <FeedbackListSkeleton />
      ) : feedbacksQuery.isError ? (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          Erro ao carregar o mural de feedbacks.
        </p>
      ) : feedbacks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-low px-lg py-lg text-body-sm text-on-surface-variant">
          {q || categoryId
            ? 'Nenhum feedback encontrado com esses filtros.'
            : 'Ainda não há feedbacks públicos. Reconheça um colega e comece a conversa 💚'}
        </p>
      ) : (
        <ul className="flex flex-col gap-md">
          {feedbacks.map((feedback) => (
            <SharedFeedbackCard
              key={feedback.id}
              feedback={feedback}
              onToggleReaction={(emoji) => toggleReaction.mutate({ feedbackId: feedback.id, emoji })}
            />
          ))}
        </ul>
      )}

      {feedbacksQuery.hasNextPage && (
        <button
          type="button"
          onClick={() => feedbacksQuery.fetchNextPage()}
          disabled={feedbacksQuery.isFetchingNextPage}
          className="w-full rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {feedbacksQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  )
}

/** Abas Recebidos e Enviados: a mesma lista, endpoints diferentes. */
function MyFeedbacksTab({ kind }: { kind: 'received' | 'sent' }) {
  const toggleReaction = useToggleSharedReaction()
  const query = useInfiniteQuery({
    queryKey: ['feedbacks', kind],
    queryFn: ({ pageParam }) =>
      apiFetch<MyFeedbacksResponse>(`/feedbacks/${kind}?offset=${pageParam}&limit=${FEEDBACK_WALL_PAGE_SIZE}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.reduce((n, p) => n + p.feedbacks.length, 0) : undefined,
  })
  const feedbacks = query.data?.pages.flatMap((page) => page.feedbacks) ?? []

  if (query.isLoading) return <FeedbackListSkeleton />
  if (query.isError) {
    return (
      <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
        <Icon name="error" className="text-[16px]" />
        Erro ao carregar os feedbacks.
      </p>
    )
  }
  if (feedbacks.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-low px-lg py-lg text-body-sm text-on-surface-variant">
        {kind === 'received' ? (
          <>
            Você ainda não recebeu feedbacks.
            <br />
            Que tal começar dando um feedback a um colega? 💚
          </>
        ) : (
          'Você ainda não enviou feedbacks.'
        )}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-md">
      <ul className="flex flex-col gap-md">
        {feedbacks.map((feedback) => (
          <SharedFeedbackCard
            key={feedback.id}
            feedback={feedback}
            onToggleReaction={(emoji) => toggleReaction.mutate({ feedbackId: feedback.id, emoji })}
          />
        ))}
      </ul>
      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="w-full rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  )
}

/**
 * Mural de Feedbacks em abas — Mural · Enviar · Recebidos · Enviados.
 *
 * O mural é o conteúdo principal; o formulário saiu da frente e virou uma aba.
 * Antes ele ocupava a tela inteira ao abrir a página, e quem só queria ler o
 * que a empresa reconheceu tinha que rolar por cima dele.
 */
export function MuralFeedbacksPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('mural')
  // Abrir a página é o que apaga o selo "Novo" da Home (Documento 3, seção 9.3).
  useMarkFeedbackWallSeen()
  // Admin não deixa feedback (a API recusa com 403), então a aba nem aparece.
  const canWrite = Boolean(user) && user?.role !== 'ADMIN' && user?.role !== 'SUBADMIN'
  const tabs = TABS.filter((t) => t.id !== 'enviar' || canWrite)

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header className="flex flex-col gap-xs">
        <h1 className="font-headline text-headline-xl text-on-surface">Mural de Feedbacks</h1>
        <p className="text-body-sm text-on-surface-variant">
          Os reconhecimentos que a empresa compartilhou, do mais recente para o mais antigo.
        </p>
      </header>

      <div role="tablist" aria-label="Mural de Feedbacks" className="flex gap-xs border-b border-outline-variant/40">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-xs border-b-2 px-md py-sm font-label text-label-md transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <Icon name={t.icon} className="text-[18px]" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'mural' && <MuralTab />}
      {tab === 'enviar' && canWrite && <NewFeedbackForm />}
      {tab === 'recebidos' && <MyFeedbacksTab kind="received" />}
      {tab === 'enviados' && <MyFeedbacksTab kind="sent" />}
    </section>
  )
}
