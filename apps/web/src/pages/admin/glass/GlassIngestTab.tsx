import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  GLASS_RAW_MAX_LENGTH,
  GLASS_REQUIRED_FIELD_LABELS,
  GLASS_SENTIMENTS,
  GLASS_SENTIMENT_LABELS,
  GLASS_STATUS,
  GLASS_STATUS_LABELS,
  GLASS_TENURE_BUCKETS,
  GLASS_TENURE_LABELS,
  GLASS_THEME_LABELS,
  type CreateGlassReviewRequest,
  type GlassReviewDraft,
  type GlassRequiredField,
} from '@legends/shared'
import { createGlassReview, parseGlassReview } from '../../../lib/glass-api'
import { Panel, inputCls } from '../shared'

const EXEMPLO = `Data: 12/03/2026
Nota: 2,0
Cargo: Analista de Suporte
Nível: Pleno
Setor: Atendimento
Tempo de casa: 1 a 2 anos
Status: Funcionário atual
Recomenda: Não
Aprova a liderança: Não
Título: Muita cobrança
Prós: ...
Contras: ...
Conselhos à gestão: ...`

/** Um campo obrigatório está preenchido? " " não conta. */
function isFilled(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Ingestão em dois passos: **interpretar** (não grava) e **confirmar** (grava).
 * Entre um e outro existe uma pessoa conferindo — é ela que impede que a
 * leitura do modelo vire dado de RH sem revisão.
 */
export function GlassIngestTab() {
  const qc = useQueryClient()
  const [raw, setRaw] = useState('')
  const [draft, setDraft] = useState<GlassReviewDraft | null>(null)
  const [missing, setMissing] = useState<GlassRequiredField[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)

  const parseMutation = useMutation({
    mutationFn: () => parseGlassReview({ raw: raw.trim() }),
    onSuccess: (data) => {
      setDraft(data.draft)
      setMissing(data.missingFields)
      setErro(null)
      setSucesso(null)
    },
    onError: (err: Error) => setErro(err.message),
  })

  const createMutation = useMutation({
    mutationFn: (body: CreateGlassReviewRequest) => createGlassReview(body),
    onSuccess: () => {
      setDraft(null)
      setRaw('')
      setMissing([])
      setErro(null)
      setSucesso('Avaliação registrada.')
      qc.invalidateQueries({ queryKey: ['admin', 'glass'] })
    },
    onError: (err: Error) => setErro(err.message),
  })

  function update<K extends keyof GlassReviewDraft>(key: K, value: GlassReviewDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  // Recalculado do rascunho atual, não do que a API devolveu: assim que a
  // pessoa digita o setor que faltava, o botão libera.
  const pendentes = draft
    ? (['sector', 'role', 'tenure'] as GlassRequiredField[]).filter((field) => !isFilled(draft[field] as string | null))
    : missing

  function confirmar(event: FormEvent) {
    event.preventDefault()
    if (!draft || pendentes.length > 0) return
    createMutation.mutate({
      ...draft,
      sector: (draft.sector ?? '').trim(),
      role: (draft.role ?? '').trim(),
      tenure: draft.tenure!,
    })
  }

  return (
    <div className="flex flex-col gap-lg">
      <Panel title="Colar avaliação">
        <label htmlFor="glass-raw" className="mb-sm block text-body-sm text-on-surface-variant">
          Cole aqui a avaliação, no formato do site
        </label>
        <textarea
          id="glass-raw"
          aria-label="Texto da avaliação"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          maxLength={GLASS_RAW_MAX_LENGTH}
          rows={10}
          placeholder={EXEMPLO}
          className={`${inputCls} font-mono`}
        />
        <div className="mt-md flex items-center gap-md">
          <button
            type="button"
            onClick={() => parseMutation.mutate()}
            disabled={raw.trim().length === 0 || parseMutation.isPending}
            className="rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {parseMutation.isPending ? 'Interpretando…' : 'Interpretar'}
          </button>
          <p className="text-body-sm text-on-surface-variant">Interpretar não grava nada.</p>
        </div>
      </Panel>

      {erro && (
        <p role="alert" className="rounded-md bg-error-container px-lg py-md text-body-sm text-on-error-container">
          {erro}
        </p>
      )}
      {sucesso && (
        <p role="status" className="rounded-md bg-surface-container-high px-lg py-md text-body-sm text-on-surface">
          {sucesso}
        </p>
      )}

      {draft && (
        <Panel title="Revisar antes de gravar">
          {pendentes.length > 0 && (
            <p role="alert" className="mb-lg rounded-md bg-error-container px-lg py-md text-body-sm text-on-error-container">
              Complete {pendentes.map((field) => GLASS_REQUIRED_FIELD_LABELS[field]).join(', ')} para poder gravar.
            </p>
          )}

          <form onSubmit={confirmar} className="grid gap-md sm:grid-cols-2">
            <Campo id="glass-sector" label="Setor" destaque={pendentes.includes('sector')}>
              <input
                id="glass-sector"
                className={inputCls}
                value={draft.sector ?? ''}
                onChange={(event) => update('sector', event.target.value)}
              />
            </Campo>

            <Campo id="glass-role" label="Cargo" destaque={pendentes.includes('role')}>
              <input
                id="glass-role"
                className={inputCls}
                value={draft.role ?? ''}
                onChange={(event) => update('role', event.target.value)}
              />
            </Campo>

            <Campo id="glass-tenure" label="Tempo de casa" destaque={pendentes.includes('tenure')}>
              <select
                id="glass-tenure"
                className={inputCls}
                value={draft.tenure ?? ''}
                onChange={(event) => update('tenure', (event.target.value || null) as GlassReviewDraft['tenure'])}
              >
                <option value="">Selecione</option>
                {GLASS_TENURE_BUCKETS.map((bucket) => (
                  <option key={bucket} value={bucket}>
                    {GLASS_TENURE_LABELS[bucket]}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo id="glass-status" label="Status">
              <select
                id="glass-status"
                className={inputCls}
                value={draft.status ?? ''}
                onChange={(event) => update('status', (event.target.value || null) as GlassReviewDraft['status'])}
              >
                <option value="">Não informado</option>
                {GLASS_STATUS.map((status) => (
                  <option key={status} value={status}>
                    {GLASS_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo id="glass-date" label="Data da avaliação">
              <input
                id="glass-date"
                type="date"
                className={inputCls}
                value={draft.reviewDate ?? ''}
                onChange={(event) => update('reviewDate', event.target.value || null)}
              />
            </Campo>

            <Campo id="glass-rating" label="Nota">
              <input
                id="glass-rating"
                type="number"
                min={1}
                max={5}
                step={0.5}
                className={inputCls}
                value={draft.rating ?? ''}
                onChange={(event) => update('rating', event.target.value === '' ? null : Number(event.target.value))}
              />
            </Campo>

            <Campo id="glass-sentiment" label="Sentimento">
              <select
                id="glass-sentiment"
                className={inputCls}
                value={draft.sentiment}
                onChange={(event) => update('sentiment', event.target.value as GlassReviewDraft['sentiment'])}
              >
                {GLASS_SENTIMENTS.map((sentiment) => (
                  <option key={sentiment} value={sentiment}>
                    {GLASS_SENTIMENT_LABELS[sentiment]}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo id="glass-level" label="Nível">
              <input
                id="glass-level"
                className={inputCls}
                value={draft.level ?? ''}
                onChange={(event) => update('level', event.target.value || null)}
              />
            </Campo>

            <div className="sm:col-span-2">
              <p className="text-body-sm text-on-surface-variant">
                Temas positivos: {draft.themesPositive.map((t) => GLASS_THEME_LABELS[t] ?? t).join(', ') || '—'}
              </p>
              <p className="text-body-sm text-on-surface-variant">
                Temas negativos: {draft.themesNegative.map((t) => GLASS_THEME_LABELS[t] ?? t).join(', ') || '—'}
              </p>
            </div>

            <TextoLongo id="glass-positives" label="Prós" value={draft.positives} onChange={(v) => update('positives', v)} />
            <TextoLongo id="glass-negatives" label="Contras" value={draft.negatives} onChange={(v) => update('negatives', v)} />
            <TextoLongo id="glass-advice" label="Conselhos à gestão" value={draft.advice} onChange={(v) => update('advice', v)} />

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={pendentes.length > 0 || createMutation.isPending}
                className="rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
              >
                {createMutation.isPending ? 'Gravando…' : 'Confirmar e gravar'}
              </button>
            </div>
          </form>
        </Panel>
      )}
    </div>
  )
}

function Campo({
  id,
  label,
  destaque,
  children,
}: {
  id: string
  label: string
  destaque?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={destaque ? 'rounded-md ring-2 ring-error p-sm' : undefined}>
      <label htmlFor={id} className="mb-xs block text-label-sm text-on-surface-variant">
        {label}
      </label>
      {children}
    </div>
  )
}

function TextoLongo({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string | null
  onChange: (value: string | null) => void
}) {
  return (
    <div className="sm:col-span-2">
      <label htmlFor={id} className="mb-xs block text-label-sm text-on-surface-variant">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        className={inputCls}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
      />
    </div>
  )
}
