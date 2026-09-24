import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  FeedbackDTO,
  FeedbackReactionEmoji,
  ProfileFeedbacksResponse,
  ReactionSummary,
  RecognitionCategoriesResponse,
  UpdateFeedbackRequest,
} from '@legends/shared'
import {
  MIN_FEEDBACK_FIELD_LENGTH,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_REACTIONS,
  PUBLIC_FEEDBACK_CATEGORIES,
  PROFILE_FEEDBACK_PAGE_SIZE,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { applyToggle } from '../../lib/reaction-toggle'
import { FEEDBACK_CATEGORY_BADGE } from '../../lib/feedback-category'
import { SHARED_FEEDBACKS_KEY } from '../mural-feedbacks/shared-feedbacks'
import { FeedbackComments } from '../mural-feedbacks/FeedbackComments'
import { SelectMenu } from '../../components/SelectMenu'
import { Icon } from '../../components/Icon'
import { Avatar } from '../../components/Avatar'
import { FeedbackReactions } from './FeedbackReactions'
import { FeedbackListSkeleton } from '../../components/Skeleton'
import { useAuth } from '../../auth/AuthContext'
import { invalidateCoins } from '../../lib/use-coins'

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Chave da página do perfil. O prefixo `['feedbacks', targetId]` é o que as
 *  mutações invalidam — trocar de página ou de filtro não sai desse prefixo. */
function pageKey(targetId: string, offset: number, categoryId: string) {
  return ['feedbacks', targetId, { offset, categoryId }] as const
}

export function FeedbackSection({
  targetId,
  highlightId,
}: {
  targetId: string
  /** Quando vindo do mural (deep-link): abre a página que contém este feedback, rola até ele e destaca. */
  highlightId?: string | null
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editMessage, setEditMessage] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [categoryFilter, setCategoryFilter] = useState('')
  // Quais feedbacks estão com as respostas abertas. Um conjunto, e não um id
  // só: como no mural, abrir a conversa de um feedback não fecha a do outro.
  const [openComments, setOpenComments] = useState<ReadonlySet<string>>(() => new Set())
  // Âncora do deep-link: some assim que o servidor responde em que página o
  // feedback caiu. Enquanto está setada, é ela — e não `offset` — que manda.
  const [anchor, setAnchor] = useState<string | null>(highlightId ?? null)

  const outerCls =
    'col-span-12 rounded-xl border border-outline-variant/40 bg-surface-container p-lg lg:col-span-7'

  /**
   * Uma página por vez, e não rolagem infinita: a lista do perfil só cresce com
   * o tempo, e acumular tudo no DOM fazia o card do perfil esticar sem teto.
   *
   * Com âncora a chave é outra de propósito — o offset ainda é desconhecido.
   * Quando a resposta chega, ela é semeada na chave do offset devolvido, para a
   * troca de âncora para offset não custar uma segunda ida ao servidor.
   */
  const feedbacksQuery = useQuery({
    queryKey: anchor ? (['feedbacks', targetId, { anchor, categoryId: categoryFilter }] as const) : pageKey(targetId, offset, categoryFilter),
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PROFILE_FEEDBACK_PAGE_SIZE) })
      if (anchor) params.set('anchor', anchor)
      else params.set('offset', String(offset))
      if (categoryFilter) params.set('categoryId', categoryFilter)
      return apiFetch<ProfileFeedbacksResponse>(`/users/${targetId}/feedbacks?${params.toString()}`)
    },
    placeholderData: (previous) => previous,
    // Trocar de página (ou voltar da âncora para o offset) não deve custar uma
    // segunda ida ao servidor pela mesma página que acabou de chegar. As
    // mutações invalidam explicitamente, então isso não segura dado velho.
    staleTime: 30_000,
  })

  // O catálogo alimenta o filtro por categoria do cabeçalho.
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<RecognitionCategoriesResponse>('/categories'),
    staleTime: 5 * 60 * 1000,
  })

  // Navegar para outro ?feedback= sem remontar (ex.: pelo sino) reabre a âncora.
  const scrolledRef = useRef<string | null>(null)
  useEffect(() => {
    if (!highlightId) return
    setAnchor(highlightId)
    scrolledRef.current = null
  }, [highlightId])

  // Âncora resolvida: adota o offset que o servidor calculou e volta ao modo página.
  const data = feedbacksQuery.data
  useEffect(() => {
    if (!anchor || !data) return
    queryClient.setQueryData(pageKey(targetId, data.offset, categoryFilter), data)
    setOffset(data.offset)
    setAnchor(null)
  }, [anchor, data, queryClient, targetId, categoryFilter])

  // Rola até o feedback do deep-link uma única vez por alvo.
  useEffect(() => {
    if (!highlightId || anchor || scrolledRef.current === highlightId) return
    if (!data?.feedbacks.some((f) => f.id === highlightId)) return
    scrolledRef.current = highlightId
    document.getElementById(`feedback-${highlightId}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [highlightId, anchor, data])

  // Apagar o último item de uma página deixaria a lista vazia num offset que não
  // existe mais — volta uma página em vez de mostrar "nenhum feedback".
  useEffect(() => {
    if (data && data.feedbacks.length === 0 && offset > 0) {
      setOffset(Math.max(0, offset - PROFILE_FEEDBACK_PAGE_SIZE))
    }
  }, [data, offset])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['feedbacks', targetId] })
  const update = useMutation({
    mutationFn: (vars: { id: string; body: UpdateFeedbackRequest }) =>
      apiFetch<{ feedback: FeedbackDTO }>(`/feedbacks/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify(vars.body),
      }),
    onSuccess: () => {
      cancelEdit()
      invalidate()
    },
    onError: (err) => setEditError(err instanceof ApiError ? err.message : 'Erro ao salvar feedback.'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/feedbacks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir feedback.'),
  })

  const toggleReaction = useMutation({
    mutationFn: (vars: { feedbackId: string; emoji: FeedbackReactionEmoji }) =>
      apiFetch<{ reactions: ReactionSummary[] }>(`/feedbacks/${vars.feedbackId}/reactions/toggle`, {
        method: 'POST',
        body: JSON.stringify({ emoji: vars.emoji }),
      }),
    onMutate: async (vars) => {
      if (!user) return { previous: undefined }
      const key = pageKey(targetId, offset, categoryFilter)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ProfileFeedbacksResponse>(key)
      const me = { id: user.id, name: user.name }
      queryClient.setQueryData<ProfileFeedbacksResponse>(key, (old) =>
        old
          ? {
              ...old,
              feedbacks: old.feedbacks.map((f) =>
                f.id === vars.feedbackId ? { ...f, reactions: applyToggle(f.reactions, vars.emoji, me) } : f,
              ),
            }
          : old,
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(pageKey(targetId, offset, categoryFilter), ctx.previous)
      setError('Não foi possível registrar a reação.')
    },
    onSettled: () => {
      invalidate()
      invalidateCoins(queryClient)
    },
  })

  const toggleShare = useMutation({
    mutationFn: (vars: { id: string; shared: boolean }) =>
      apiFetch<{ feedback: FeedbackDTO }>(`/feedbacks/${vars.id}/share`, {
        method: vars.shared ? 'POST' : 'DELETE',
      }),
    onSuccess: () => {
      invalidate()
      // Compartilhar/descompartilhar muda os dois murais: o do time e o da empresa.
      queryClient.invalidateQueries({ queryKey: ['mural'] })
      queryClient.invalidateQueries({ queryKey: SHARED_FEEDBACKS_KEY })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível atualizar o compartilhamento.'),
  })

  if (feedbacksQuery.isLoading) {
    return (
      <div className={outerCls}>
        <div className="mb-lg flex flex-col gap-md sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <h3 className="font-headline text-headline-md text-on-surface">Feedbacks</h3>
        </div>
        <FeedbackListSkeleton />
      </div>
    )
  }
  if (feedbacksQuery.isError) {
    return (
      <div className={outerCls}>
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          Erro ao carregar feedbacks.
        </p>
      </div>
    )
  }

  const feedbacks = data?.feedbacks ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PROFILE_FEEDBACK_PAGE_SIZE))
  const currentPage = Math.floor(offset / PROFILE_FEEDBACK_PAGE_SIZE) + 1
  const filterOptions = [
    { value: '', label: 'Todas as categorias' },
    ...(categoriesQuery.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name })),
  ]

  function startEdit(feedback: FeedbackDTO) {
    setEditingId(feedback.id)
    setEditMessage(feedback.message)
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditMessage('')
    setEditError(null)
  }

  function saveEdit(id: string) {
    if (editMessage.trim().length < MIN_FEEDBACK_FIELD_LENGTH) {
      setEditError(`O feedback precisa de pelo menos ${MIN_FEEDBACK_FIELD_LENGTH} caracteres.`)
      return
    }
    update.mutate({ id, body: { message: editMessage.trim() } })
  }

  function toggleComments(id: string) {
    setOpenComments((open) => {
      const next = new Set(open)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  return (
    <div className={outerCls}>
      <div className="mb-lg flex flex-col gap-md sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h3 className="font-headline text-headline-md text-on-surface">
          Feedbacks {total > 0 && <span className="font-label text-label-md text-on-surface-variant">({total})</span>}
        </h3>
        {/* Filtrar no servidor, e não na página: filtrar depois de paginar
            esconderia o resultado que está na página seguinte. */}
        {(total > 0 || categoryFilter) && (
          <SelectMenu
            label="Filtrar por categoria"
            value={categoryFilter}
            onChange={(value) => {
              setCategoryFilter(value)
              setOffset(0)
            }}
            className="min-w-[14rem]"
            options={filterOptions}
          />
        )}
      </div>

      {/* Erro de excluir/reagir/compartilhar. Antes ele aparecia dentro do
          formulário de criação, que hoje é outro card. */}
      {error && (
        <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}

      {feedbacks.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          {categoryFilter ? 'Nenhum feedback nessa categoria.' : 'Nenhum feedback ainda.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-md">
          {feedbacks.map((feedback) => {
            const isAuthor = user?.id === feedback.author.id
            const canDelete = isAuthor || user?.role === 'ADMIN'
            const isTarget = user?.id === targetId
            const isPublic = (PUBLIC_FEEDBACK_CATEGORIES as readonly string[]).includes(feedback.category)
            const canShare = isTarget && isPublic
            const isShared = feedback.sharedAt !== null
            const commentsOpen = openComments.has(feedback.id)
            // Mesmos chips do card do mural — sem eles, escolher competência no
            // formulário aqui não apareceria em lugar nenhum.
            const chips = [
              ...feedback.categories.map((c) => c.name),
              ...(feedback.customCategory ? [feedback.customCategory] : []),
            ]
            return (
              <li
                key={feedback.id}
                id={`feedback-${feedback.id}`}
                className={`relative rounded-lg border border-outline-variant/20 bg-surface-container-low p-md ${feedback.id === highlightId ? 'mural-highlight' : ''}`}
              >
                <div className="mb-sm flex items-center gap-sm">
                  <Link
                    to={`/perfil/${feedback.author.id}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest transition-opacity hover:opacity-80"
                  >
                    <Avatar user={feedback.author} />
                  </Link>
                  <div className="min-w-0 flex-grow">
                    <Link
                      to={`/perfil/${feedback.author.id}`}
                      className="block truncate font-label text-label-md text-on-surface transition-colors hover:text-primary hover:underline"
                    >
                      {feedback.author.name}
                    </Link>
                    <div className="flex items-center gap-sm">
                      <p className="font-label text-label-sm text-on-surface-variant">{formatDate(feedback.createdAt)}</p>
                      <span
                        className={`absolute right-2 top-0 z-10 flex -translate-y-1/2 items-center gap-xs rounded-full px-sm py-0.5 font-label text-label-sm shadow-sm md:static md:right-auto md:top-auto md:z-auto md:translate-y-0 md:shadow-none ${FEEDBACK_CATEGORY_BADGE[feedback.category].cls}`}
                      >
                        {FEEDBACK_CATEGORY_BADGE[feedback.category].locked && <Icon name="lock" className="text-[14px]" />}
                        {FEEDBACK_CATEGORY_LABELS[feedback.category]}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-sm">
                    {isAuthor && (
                      <button
                        type="button"
                        onClick={() => startEdit(feedback)}
                        aria-label="Editar feedback"
                        className="rounded-md border border-outline-variant/60 p-1 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                      >
                        <Icon name="edit" className="text-[18px]" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => remove.mutate(feedback.id)}
                        aria-label="Excluir feedback"
                        disabled={remove.isPending}
                        className="rounded-md border border-error/40 p-1 text-error transition-colors hover:border-error disabled:opacity-50"
                      >
                        <Icon name="delete" className="text-[18px]" />
                      </button>
                    )}
                  </div>
                </div>
                {chips.length > 0 && (
                  <ul className="mb-sm flex flex-wrap gap-xs">
                    {chips.map((name) => (
                      <li
                        key={name}
                        className="rounded-full bg-primary/10 px-sm py-0.5 font-label text-label-sm text-primary"
                      >
                        {name}
                      </li>
                    ))}
                  </ul>
                )}
                {editingId === feedback.id ? (
                  <div className="flex flex-col gap-sm">
                    <textarea
                      className="min-h-[100px] rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-2 text-body-sm text-on-surface outline-none focus:border-primary"
                      value={editMessage}
                      onChange={(e) => setEditMessage(e.target.value.slice(0, FEEDBACK_MESSAGE_MAX_LENGTH))}
                      aria-label="Editar mensagem do feedback"
                      autoFocus
                    />
                    <span className="text-right font-label text-label-sm text-on-surface-variant">
                      {editMessage.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
                    </span>
                    {editError && (
                      <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
                        <Icon name="error" className="text-[16px]" />
                        {editError}
                      </p>
                    )}
                    <div className="flex gap-sm">
                      <button
                        type="button"
                        onClick={() => saveEdit(feedback.id)}
                        disabled={update.isPending}
                        className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-body-sm text-on-surface">{feedback.message}</p>
                )}
                <div className="mt-sm flex flex-wrap items-center justify-between gap-sm">
                  <div className="flex flex-wrap items-center gap-md">
                    <FeedbackReactions
                      reactions={feedback.reactions}
                      options={FEEDBACK_REACTIONS}
                      onToggle={(emoji) => {
                        if (user) toggleReaction.mutate({ feedbackId: feedback.id, emoji })
                      }}
                    />
                    {/* Responder aqui é o mesmo do mural, e no perfil vale
                        também para o feedback privado: quem pode responder é o
                        servidor que decide (`requireVisibleFeedback`). */}
                    <button
                      type="button"
                      onClick={() => toggleComments(feedback.id)}
                      aria-label="Responder"
                      aria-pressed={commentsOpen}
                      className={`flex items-center gap-xs font-label text-label-sm transition-colors hover:text-primary ${
                        commentsOpen ? 'text-primary' : 'text-on-surface-variant'
                      }`}
                    >
                      <Icon name="chat_bubble" className="text-[18px]" />
                      {feedback.commentCount > 0 ? feedback.commentCount : 'Responder'}
                    </button>
                  </div>
                  {canShare && (
                    <button
                      type="button"
                      onClick={() => toggleShare.mutate({ id: feedback.id, shared: !isShared })}
                      disabled={toggleShare.isPending}
                      aria-pressed={isShared}
                      aria-label={isShared ? 'Remover do mural' : 'Compartilhar no mural'}
                      className={`ml-auto flex items-center gap-xs rounded-md border px-sm py-1 font-label text-label-sm transition-colors disabled:opacity-50 ${
                        isShared
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-outline-variant/60 text-on-surface-variant hover:border-primary hover:text-primary'
                      }`}
                    >
                      <Icon name={isShared ? 'check_circle' : 'share'} className="text-[18px]" />
                      {isShared ? 'Compartilhado' : 'Compartilhar'}
                    </button>
                  )}
                </div>
                {/* `invalidate` porque o contador de respostas vive no feedback,
                    e a lista do perfil é quem o carrega. */}
                {commentsOpen && <FeedbackComments feedbackId={feedback.id} onChange={invalidate} />}
              </li>
            )
          })}
        </ul>
      )}
      {totalPages > 1 && (
        <nav aria-label="Paginação dos feedbacks" className="mt-md flex items-center justify-between gap-sm">
          <button
            type="button"
            onClick={() => setOffset(Math.max(0, offset - PROFILE_FEEDBACK_PAGE_SIZE))}
            disabled={offset === 0 || feedbacksQuery.isFetching}
            className="flex items-center gap-xs rounded-md border border-outline-variant/60 px-md py-1.5 font-label text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-40 disabled:hover:border-outline-variant/60 disabled:hover:text-on-surface-variant"
          >
            <Icon name="chevron_left" className="text-[18px]" />
            Anterior
          </button>
          <span aria-live="polite" className="font-label text-label-sm text-on-surface-variant">
            {`página ${currentPage} de ${totalPages}`}
          </span>
          <button
            type="button"
            onClick={() => setOffset(offset + PROFILE_FEEDBACK_PAGE_SIZE)}
            disabled={!data?.hasMore || feedbacksQuery.isFetching}
            className="flex items-center gap-xs rounded-md border border-outline-variant/60 px-md py-1.5 font-label text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-40 disabled:hover:border-outline-variant/60 disabled:hover:text-on-surface-variant"
          >
            Próxima
            <Icon name="chevron_right" className="text-[18px]" />
          </button>
        </nav>
      )}
    </div>
  )
}
