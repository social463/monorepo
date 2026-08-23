import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateFeedbackRequest,
  FeedbackDTO,
  AiStatusResponse,
  GenerateFeedbackResponse,
  PublicUser,
  RecognitionCategoriesResponse,
  SectorOptionDTO,
} from '@legends/shared'
import {
  CUSTOM_CATEGORY_MAX_LENGTH,
  FEEDBACK_AI_PROMPT_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  MAX_FEEDBACK_RECIPIENTS,
  MAX_RECOGNITION_CATEGORIES_PER_FEEDBACK,
  MIN_FEEDBACK_FIELD_LENGTH,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Avatar } from '../../components/Avatar'
import { invalidateCoins } from '../../lib/use-coins'
import { SHARED_FEEDBACKS_KEY } from './shared-feedbacks'
import { TargetPicker } from './TargetPicker'
import { CategoryPicker } from './CategoryPicker'
import { SelectMenu } from '../../components/SelectMenu'

/** Emojis mais usados no feedback — atalho para quem escreve do celular. */
const QUICK_EMOJIS = ['💚', '👏', '🎉', '🚀', '🙌', '💪', '🔥', '🙏', '✨', '🧠']

/**
 * Aba **Enviar** do Mural de Feedbacks ("Reconheça um colega").
 *
 * A copy é a oficial do documento da G&G, ao pé da letra — inclusive os emojis.
 * O que a 2ª rodada trouxe: N destinatários, competências do catálogo da
 * empresa, categoria personalizada, o toggle de público (que agora é decisão de
 * **quem escreve**) e o botão de escrever com IA.
 */
export function NewFeedbackForm() {
  const queryClient = useQueryClient()
  const [targets, setTargets] = useState<PublicUser[]>([])
  const [sectorId, setSectorId] = useState('')
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [customCategory, setCustomCategory] = useState('')
  const [message, setMessage] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [aiOpen, setAiOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<RecognitionCategoriesResponse>('/categories'),
    staleTime: 5 * 60 * 1000,
  })
  const sectors = useQuery({
    queryKey: ['sectors'],
    queryFn: () => apiFetch<{ sectors: SectorOptionDTO[] }>('/sectors'),
    staleTime: 5 * 60 * 1000,
  })
  // Empresa sem chave de IA cadastrada não vê "Escrever com IA": oferecer o
  // botão para ele responder 503 e mandar falar com o admin é um beco sem saída
  // — quem escreve o reconhecimento não é quem cadastra a chave.
  const ai = useQuery({
    queryKey: ['ai', 'status'],
    queryFn: () => apiFetch<AiStatusResponse>('/ai/status'),
    staleTime: 5 * 60 * 1000,
  })
  const aiEnabled = ai.data?.configured === true

  const generate = useMutation({
    mutationFn: () =>
      apiFetch<GenerateFeedbackResponse>('/feedbacks/ai/generate', {
        method: 'POST',
        body: JSON.stringify({
          targetNames: targets.map((t) => t.name),
          categoryNames: selectedCategoryNames(),
          notes: notes.trim() || undefined,
        }),
      }),
    onSuccess: (draft) => {
      setMessage(draft.message)
      setAiOpen(false)
      setNotes('')
    },
  })

  const create = useMutation({
    mutationFn: (vars: { targetId: string; body: CreateFeedbackRequest }) =>
      apiFetch<{ feedback: FeedbackDTO }>(`/users/${vars.targetId}/feedbacks`, {
        method: 'POST',
        body: JSON.stringify(vars.body),
      }),
    onSuccess: (_data, vars) => {
      setSentTo(targets.map((t) => t.name).join(', '))
      setError(null)
      setMessage('')
      setCategoryIds([])
      setCustomCategory('')
      setTargets([])
      setIsPublic(true)
      queryClient.invalidateQueries({ queryKey: ['feedbacks', vars.targetId] })
      queryClient.invalidateQueries({ queryKey: SHARED_FEEDBACKS_KEY })
      queryClient.invalidateQueries({ queryKey: ['feedbacks', 'sent'] })
      invalidateCoins(queryClient)
    },
    onError: (err) => {
      setSentTo(null)
      setError(err instanceof ApiError ? err.message : 'Erro ao enviar feedback.')
    },
  })

  function selectedCategoryNames(): string[] {
    const all = categories.data?.categories ?? []
    return categoryIds.map((id) => all.find((c) => c.id === id)?.name ?? '').filter(Boolean)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSentTo(null)
    if (targets.length === 0) {
      setError('Escolha para quem é o feedback.')
      return
    }
    if (message.trim().length < MIN_FEEDBACK_FIELD_LENGTH) {
      setError(`O feedback precisa de pelo menos ${MIN_FEEDBACK_FIELD_LENGTH} caracteres.`)
      return
    }
    if (categoryIds.length === 0 && !customCategory.trim()) {
      setError('Selecione ao menos uma categoria.')
      return
    }
    const [principal, ...demais] = targets
    create.mutate({
      targetId: principal.id,
      body: {
        message: message.trim(),
        // A categoria antiga (enum) segue existindo para o perfil e a Quinta de
        // Dev; reconhecimento é sempre ELOGIO, e o "porquê" vive nas competências.
        category: 'ELOGIO',
        ...(demais.length ? { targetIds: demais.map((t) => t.id) } : {}),
        ...(categoryIds.length ? { categoryIds } : {}),
        ...(customCategory.trim() ? { customCategory: customCategory.trim() } : {}),
        isPublic,
      },
    })
  }

  const canSubmit =
    targets.length > 0 &&
    message.trim().length >= MIN_FEEDBACK_FIELD_LENGTH &&
    (categoryIds.length > 0 || customCategory.trim().length > 0)

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Reconheça um colega"
      className="flex flex-col gap-lg rounded-xl border border-outline-variant/40 bg-surface-container p-lg"
    >
      <div>
        <h2 className="font-headline text-headline-md text-on-surface">Reconheça um colega</h2>
        <p className="mt-xs text-body-sm text-on-surface-variant">
          Cada feedback enviado vale <strong className="text-on-surface">+10 XP</strong> (até 3 ganhos por semana).
          Mantenha nossa cultura viva.
        </p>
      </div>

      {/* Duas colunas no desktop: o "para quem" e o "por quê" à esquerda, a
          mensagem à direita. Antes o formulário era uma coluna estreita com
          meia tela vazia ao lado; agora acompanha a largura das outras telas. */}
      <div className="grid gap-lg lg:grid-cols-2">
        <div className="flex flex-col gap-lg">
          <div className="flex flex-col gap-sm">
            <p className="font-label text-label-md text-on-surface">Para quem?</p>
            {targets.length > 0 && (
              <ul className="flex flex-wrap gap-xs">
                {targets.map((person) => (
                  <li
                    key={person.id}
                    className="flex items-center gap-xs rounded-full border border-primary/40 bg-primary/5 py-1 pl-1 pr-sm"
                  >
                    <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
                      <Avatar user={person} />
                    </span>
                    <span className="font-label text-label-sm text-on-surface">{person.name}</span>
                    <button
                      type="button"
                      aria-label={`Remover ${person.name}`}
                      onClick={() => setTargets((prev) => prev.filter((p) => p.id !== person.id))}
                      className="text-on-surface-variant transition-colors hover:text-error"
                    >
                      <Icon name="close" className="text-[16px]" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-sm">
              <SelectMenu
                label="Filtrar por setor"
                value={sectorId}
                onChange={setSectorId}
                className="min-w-[16rem]"
                options={[
                  { value: '', label: 'Todos os setores' },
                  ...(sectors.data?.sectors ?? []).map((sector) => ({ value: sector.id, label: sector.name })),
                ]}
              />
              {targets.length < MAX_FEEDBACK_RECIPIENTS && (
                <span className="font-label text-label-sm text-on-surface-variant">
                  {targets.length === 0 ? 'Selecione um colega…' : 'Adicionar mais alguém'}
                </span>
              )}
            </div>
            {targets.length < MAX_FEEDBACK_RECIPIENTS && (
              <TargetPicker
                value={null}
                sectorId={sectorId || undefined}
                excludeIds={targets.map((t) => t.id)}
                placeholder="Buscar colaborador…"
                onChange={(user) => {
                  if (user) setTargets((prev) => [...prev, user])
                }}
              />
            )}
          </div>

          <div className="flex flex-col gap-sm">
            <p className="font-label text-label-md text-on-surface">Categorias do feedback</p>
            <p className="text-label-sm text-on-surface-variant">
              Selecione uma ou mais categorias que representam esse feedback.
            </p>
            <CategoryPicker
              categories={categories.data?.categories ?? []}
              value={categoryIds}
              onChange={setCategoryIds}
              max={MAX_RECOGNITION_CATEGORIES_PER_FEEDBACK}
              loading={categories.isLoading}
            />
            <input
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value.slice(0, CUSTOM_CATEGORY_MAX_LENGTH))}
              placeholder="Categoria personalizada (opcional)"
              aria-label="Categoria personalizada"
              className="rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-2 text-body-sm text-on-surface outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex flex-col gap-lg">
          <div className="flex flex-grow flex-col gap-sm">
            <label htmlFor="feedback-message" className="font-label text-label-md text-on-surface">
              Mensagem do feedback
            </label>
            <textarea
              id="feedback-message"
              className="min-h-[160px] flex-grow rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-2 text-body-sm text-on-surface outline-none focus:border-primary"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MESSAGE_MAX_LENGTH))}
              placeholder="Conte o que esse colega fez que merece destaque…"
            />
            <div className="flex flex-wrap items-center gap-sm">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setEmojiOpen((v) => !v)}
                  aria-label="Inserir emoji"
                  className="flex items-center gap-xs rounded-full border border-outline-variant/60 px-sm py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                >
                  <Icon name="mood" className="text-[18px]" /> Emoji
                </button>
                {emojiOpen && (
                  <div className="absolute left-0 top-full z-50 mt-xs flex w-56 flex-wrap gap-1 rounded-xl border border-outline-variant/40 bg-surface-container p-sm shadow-lg">
                    {QUICK_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        aria-label={`Inserir ${emoji}`}
                        onClick={() => {
                          setMessage((prev) => `${prev}${emoji}`)
                          setEmojiOpen(false)
                        }}
                        className="rounded-md px-1 py-0.5 text-body-lg hover:bg-surface-container-highest"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {aiEnabled && (
                <button
                  type="button"
                  onClick={() => setAiOpen((v) => !v)}
                  disabled={targets.length === 0}
                  className="flex items-center gap-xs rounded-full border border-outline-variant/60 px-sm py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                >
                  <Icon name="auto_awesome" className="text-[18px]" /> Escrever com IA
                </button>
              )}
              <span className="ml-auto font-label text-label-sm text-on-surface-variant">
                {message.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
              </span>
            </div>
          </div>

          {aiOpen && aiEnabled && (
            <div className="flex flex-col gap-sm rounded-lg border border-outline-variant/60 p-md">
              <label htmlFor="feedback-ai" className="font-label text-label-md text-on-surface">
                O que você quer dizer?
              </label>
              <textarea
                id="feedback-ai"
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, FEEDBACK_AI_PROMPT_MAX_LENGTH))}
                rows={3}
                placeholder="Ex.: segurou a virada do sistema no fim de semana e avisou o time o tempo todo"
                className="w-full resize-none rounded-md border border-outline-variant/60 bg-transparent px-sm py-1 text-body-sm text-on-surface outline-none focus:border-primary"
              />
              {generate.isError && (
                <span role="alert" className="text-label-sm text-error">
                  {(generate.error as Error).message}
                </span>
              )}
              <div className="flex items-center gap-sm">
                <button
                  type="button"
                  onClick={() => generate.mutate()}
                  disabled={generate.isPending}
                  className="rounded-full bg-primary px-lg py-1 font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
                >
                  {generate.isPending ? 'Escrevendo…' : 'Escrever com IA'}
                </button>
                <button
                  type="button"
                  onClick={() => setAiOpen(false)}
                  className="font-label text-label-md text-on-surface-variant hover:text-on-surface"
                >
                  Cancelar
                </button>
              </div>
              <p className="text-label-sm text-on-surface-variant">
                O texto gerado substitui a mensagem. Revise antes de enviar.
              </p>
            </div>
          )}

          <label className="flex items-start gap-sm rounded-lg border border-outline-variant/40 p-md">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[rgb(var(--brand-primary))]"
            />
            <span>
              <span className="block font-label text-label-md text-on-surface">Tornar público no mural</span>
              <span className="block text-label-sm text-on-surface-variant">
                Quando desativado, apenas o destinatário e o time de G&amp;G verão o feedback.
              </span>
            </span>
          </label>
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}
      {sentTo && (
        <p role="status" className="flex items-start gap-sm text-body-sm text-on-surface-variant">
          <span className="text-primary">
            <Icon name="check_circle" className="text-[16px]" />
          </span>
          Feedback enviado para {sentTo}.
        </p>
      )}

      <div>
        {/* Desabilitado sai de `surface-container` — o padrão do resto do app —
            porque aqui o cartão do formulário JÁ é `surface-container`: o botão
            sumia no fundo, e o que restava parecia texto solto. `-highest` é a
            mesma superfície dos campos ao lado, com a borda marcando a moldura. */}
        <button
          type="submit"
          disabled={!canSubmit || create.isPending}
          className="rounded-md border border-transparent bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:border-outline-variant/60 disabled:bg-surface-container-highest disabled:text-on-surface-variant"
        >
          Enviar feedback
        </button>
      </div>
    </form>
  )
}
