import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateFeedbackRequest,
  FeedbackDTO,
  FeedbackCategory,
  RecognitionCategoriesResponse,
} from '@legends/shared'
import {
  MIN_FEEDBACK_FIELD_LENGTH,
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  CUSTOM_CATEGORY_MAX_LENGTH,
  MAX_RECOGNITION_CATEGORIES_PER_FEEDBACK,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { FEEDBACK_CATEGORY_BADGE } from '../../lib/feedback-category'
import { CategoryPicker } from '../mural-feedbacks/CategoryPicker'
import { Icon } from '../../components/Icon'
import { useAuth } from '../../auth/AuthContext'
import { invalidateCoins } from '../../lib/use-coins'

const GUIDE_STORAGE_KEY = 'feedback-guide-enabled'

const GUIDE_ITEMS: { label: string; hint: string }[] = [
  { label: 'Situação', hint: 'em que contexto e quando isso aconteceu?' },
  { label: 'Comportamento', hint: 'o que a pessoa fez — ações observáveis, não interpretações?' },
  { label: 'Impacto', hint: 'que efeito isso gerou no time, no projeto ou em você?' },
]

function readGuidePreference(): boolean {
  if (typeof localStorage === 'undefined') return true
  const stored = localStorage.getItem(GUIDE_STORAGE_KEY)
  return stored === null ? true : stored === 'true'
}

/**
 * Escrever um feedback é um card próprio, ao lado da galeria de selos — a lista
 * (`FeedbackSection`) fica na coluna da direita. Escrever e ler são tarefas
 * diferentes: com o formulário no topo da lista, quem só queria ler o que
 * recebeu rolava um formulário inteiro antes do primeiro feedback.
 *
 * A conversa entre os dois cards é a query `['feedbacks', targetId]`: criar
 * invalida esse prefixo e a lista recarrega sozinha, mesmo em outro componente.
 */
export function FeedbackComposer({ targetId, className = '' }: { targetId: string; className?: string }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState<FeedbackCategory | ''>('')
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [customCategory, setCustomCategory] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guideOn, setGuideOn] = useState(readGuidePreference)

  const canWrite = Boolean(user) && user?.role !== 'ADMIN' && user?.id !== targetId

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<RecognitionCategoriesResponse>('/categories'),
    staleTime: 5 * 60 * 1000,
    enabled: canWrite,
  })

  const create = useMutation({
    mutationFn: (body: CreateFeedbackRequest) =>
      apiFetch<{ feedback: FeedbackDTO }>(`/users/${targetId}/feedbacks`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setMessage('')
      setCategory('')
      setCategoryIds([])
      setCustomCategory('')
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['feedbacks', targetId] })
      invalidateCoins(queryClient)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao enviar feedback.'),
  })

  if (!canWrite) return null

  const messageValid = message.trim().length >= MIN_FEEDBACK_FIELD_LENGTH
  const hasRecognitionCategory = categoryIds.length > 0 || customCategory.trim().length > 0
  // Só criação (a edição é inline no card da lista); tipo e categoria são
  // obrigatórios, o mesmo contrato do mural.
  const canSubmit = messageValid && category !== '' && hasRecognitionCategory

  function toggleGuide() {
    setGuideOn((prev) => {
      const next = !prev
      if (typeof localStorage !== 'undefined') localStorage.setItem(GUIDE_STORAGE_KEY, String(next))
      return next
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!messageValid) {
      setError(`O feedback precisa de pelo menos ${MIN_FEEDBACK_FIELD_LENGTH} caracteres.`)
      return
    }
    if (category === '') {
      setError('Selecione o tipo do feedback.')
      return
    }
    if (!hasRecognitionCategory) {
      setError('Selecione ao menos uma categoria.')
      return
    }
    create.mutate({
      message: message.trim(),
      category,
      ...(categoryIds.length ? { categoryIds } : {}),
      ...(customCategory.trim() ? { customCategory: customCategory.trim() } : {}),
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex flex-col gap-sm rounded-xl border border-outline-variant/40 bg-surface-container p-lg ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h3 className="font-headline text-headline-md text-on-surface">Deixar feedback</h3>
        <button
          type="button"
          onClick={toggleGuide}
          aria-pressed={guideOn}
          className={`flex items-center gap-xs rounded-full border px-sm py-0.5 font-label text-label-sm transition-colors ${
            guideOn
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-outline-variant/60 text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <Icon name="lightbulb" className="text-[16px]" />
          Guia {guideOn ? 'ligado' : 'desligado'}
        </button>
      </div>

      {guideOn && (
        <div className="rounded-md border border-outline-variant/30 bg-surface-container-highest p-sm">
          <p className="mb-xs font-label text-label-sm text-on-surface">
            Um bom feedback costuma cobrir três pontos:
          </p>
          <ul className="flex flex-col gap-xs">
            {GUIDE_ITEMS.map((item) => (
              <li key={item.label} className="text-body-sm text-on-surface-variant">
                <span className="font-label text-on-surface">{item.label}</span> — {item.hint}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-md flex flex-col gap-sm">
        <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
          Tipo do feedback
        </p>
        <div className="flex flex-wrap gap-sm" role="group" aria-label="Tipo do feedback">
          {FEEDBACK_CATEGORIES.map((cat) => {
            const selected = category === cat
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategory(cat)}
                className={`flex items-center gap-xs rounded-full border px-md py-1.5 font-label text-label-md transition-colors ${
                  selected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-outline-variant/60 text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {FEEDBACK_CATEGORY_BADGE[cat].locked && <Icon name="lock" className="text-[16px]" />}
                {FEEDBACK_CATEGORY_LABELS[cat]}
              </button>
            )
          })}
        </div>
      </div>

      {/* As mesmas competências do Mural de Feedbacks, e obrigatórias como
          lá: o tipo diz o que o feedback é, elas dizem sobre o quê. A
          categoria personalizada conta como uma. */}
      <div className="mb-md mt-md flex flex-col gap-sm">
        <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
          Categorias do feedback
        </p>
        <CategoryPicker
          categories={categoriesQuery.data?.categories ?? []}
          value={categoryIds}
          onChange={setCategoryIds}
          max={MAX_RECOGNITION_CATEGORIES_PER_FEEDBACK}
          loading={categoriesQuery.isLoading}
        />
        <input
          value={customCategory}
          onChange={(e) => setCustomCategory(e.target.value.slice(0, CUSTOM_CATEGORY_MAX_LENGTH))}
          placeholder="Categoria personalizada (opcional)"
          aria-label="Categoria personalizada"
          className="rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-2 text-body-sm text-on-surface outline-none focus:border-primary"
        />
      </div>

      <textarea
        className="min-h-[120px] rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-2 text-body-sm text-on-surface outline-none focus:border-primary"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Escreva um feedback específico e construtivo…"
        aria-label="Seu feedback"
      />

      {error && (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}
      <div className="flex gap-sm">
        <button
          type="submit"
          disabled={!canSubmit || create.isPending}
          className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Enviar feedback
        </button>
      </div>
    </form>
  )
}
