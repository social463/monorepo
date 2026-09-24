import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  OKR_COMMENT_MAX_LENGTH,
  OKR_CONFIDENCE_LABELS,
  OKR_CONFIDENCE_LEVELS,
  OKR_SOURCE_REF_MAX_LENGTH,
  formatOkrValue,
  type CreateOkrCheckInRequest,
  type OkrConfidenceLevel,
  type OkrCycleDTO,
  type OkrKeyResultDTO,
  type OkrObjectiveDTO,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { createOkrCheckIn } from '../../lib/okr-api'
import { errorMessage, inputCls } from '../admin/shared'
import { OKR_CONFIDENCE_ICONS } from './OkrProgress'
import { parseDecimal } from './okr-format'

function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

/** Cor de cada confiança: borda e ícone quando livre, contêiner quando escolhida. */
const CONFIDENCE_OPTION: Record<OkrConfidenceLevel, { idle: string; picked: string }> = {
  ON_TRACK: {
    idle: 'border-primary/60 [&_.material-symbols-outlined]:text-primary',
    picked: 'border-primary bg-primary-container text-on-primary-container',
  },
  ATTENTION_REQUIRED: {
    idle: 'border-tertiary/60 [&_.material-symbols-outlined]:text-tertiary',
    picked: 'border-tertiary bg-tertiary-container text-on-tertiary-container',
  },
  AT_RISK: {
    idle: 'border-error/60 [&_.material-symbols-outlined]:text-error',
    picked: 'border-error bg-error-container text-on-error-container',
  },
  COMPLETED: {
    idle: 'border-secondary/60 [&_.material-symbols-outlined]:text-secondary',
    picked: 'border-secondary bg-secondary-container text-on-secondary-container',
  },
}

const secondaryBtn =
  'rounded-lg border border-outline-variant px-lg py-sm font-label text-label-lg text-primary hover:bg-primary/10'
const primaryBtn =
  'rounded-lg bg-primary px-lg py-sm font-label text-label-lg text-on-primary hover:bg-primary/90 disabled:bg-surface-container-highest disabled:text-on-surface-variant'

/**
 * Atualizar progresso da meta, no formato da ImpulseUp: controle deslizante da
 * base à meta, ou o valor digitado; comentário; e a confiança no atingimento.
 *
 * Por baixo é um check-in (o valor é o fato — é a série que dá histórico à meta).
 * Meta que é razão pode vir como numerador e denominador, o que deixa o servidor
 * somar o ciclo em vez de tirar média de porcentagens.
 */
export function UpdateProgressDialog({
  keyResult,
  objective,
  cycle,
  onDone,
  onClose,
}: {
  keyResult: OkrKeyResultDTO
  objective: OkrObjectiveDTO
  cycle: OkrCycleDTO
  onDone: () => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const fmt = (value: number | null) => formatOkrValue(value, keyResult, cycle.decimals)
  const places = Math.min(
    2,
    keyResult.metricType === 'PERCENTAGE'
      ? cycle.decimals.percentage
      : keyResult.metricType === 'CURRENCY'
        ? cycle.decimals.currency
        : cycle.decimals.numeric,
  )
  const start = keyResult.currentValue ?? keyResult.baseline
  // A faixa vai da base à meta, esticada até o valor atual: num teto estourado o
  // atual passa da meta, e o controle não pode nascer fora do trilho.
  const min = Math.min(keyResult.baseline, keyResult.target, start)
  const max = Math.max(keyResult.baseline, keyResult.target, start)

  const [mode, setMode] = useState<'slider' | 'value' | 'ratio'>(max > min ? 'slider' : 'value')
  const [slider, setSlider] = useState(start)
  const [value, setValue] = useState('')
  const [numerator, setNumerator] = useState('')
  const [denominator, setDenominator] = useState('')
  const [comment, setComment] = useState('')
  const [effectiveAt, setEffectiveAt] = useState(todayYmd)
  const [sourceRef, setSourceRef] = useState('')
  const [confidence, setConfidence] = useState<OkrConfidenceLevel | null>(objective.confidenceLevel)
  const [erro, setErro] = useState<string | null>(null)
  const titleId = `okr-update-${keyResult.id}`
  const firstFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const salvar = useMutation({
    mutationFn: (body: CreateOkrCheckInRequest) => createOkrCheckIn(keyResult.id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['okr'] })
      onDone()
    },
  })

  function enviar(event: FormEvent) {
    event.preventDefault()
    setErro(null)
    const body: CreateOkrCheckInRequest = {
      effectiveAt,
      comment: comment.trim() || null,
      sourceRef: sourceRef.trim() || null,
    }
    if (mode === 'slider') {
      body.value = slider
    } else if (mode === 'value') {
      const parsed = parseDecimal(value)
      if (parsed == null || Number.isNaN(parsed)) return setErro('Informe o valor.')
      body.value = parsed
    } else {
      const num = parseDecimal(numerator)
      const den = parseDecimal(denominator)
      if (num == null || den == null || Number.isNaN(num) || Number.isNaN(den)) {
        return setErro('Informe numerador e denominador.')
      }
      if (den === 0) return setErro('O denominador não pode ser zero.')
      body.numerator = num
      body.denominator = den
    }
    if (!effectiveAt) return setErro('Informe a data de referência.')
    if (cycle.forceCommentOnCheckIn && !body.comment) return setErro('Este ciclo exige um comentário no check-in.')
    if (confidence !== objective.confidenceLevel) body.confidenceLevel = confidence
    salvar.mutate(body)
  }

  const mensagem = erro ?? (salvar.isError ? errorMessage(salvar.error, 'Não foi possível atualizar o progresso.') : null)
  const pct = max > min ? ((slider - min) / (max - min)) * 100 : 0
  const unit = keyResult.metricType === 'PERCENTAGE' ? ' (%)' : keyResult.unit ? ` (${keyResult.unit})` : ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 md:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={enviar}
        aria-label={`Atualizar progresso de ${keyResult.name}`}
        className="flex w-full max-w-2xl flex-col rounded-xl border border-outline-variant/40 bg-surface-container shadow-xl"
      >
        <header className="flex items-center justify-between gap-md border-b border-outline-variant/40 px-lg py-md">
          <h2 id={titleId} className="font-headline text-headline-sm text-on-surface">
            Atualizar progresso da meta
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="flex flex-col gap-lg px-lg py-md">
          {mode === 'slider' ? (
            <div className="flex flex-col gap-sm">
              <label htmlFor={`${titleId}-slider`} className="font-label text-label-lg text-on-surface">
                {keyResult.name}
              </label>
              <div className="relative pt-9">
                <output
                  htmlFor={`${titleId}-slider`}
                  className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-sm py-0.5 font-label text-label-md tabular-nums text-on-primary"
                  style={{ left: `clamp(2rem, ${pct}%, calc(100% - 2rem))` }}
                >
                  {fmt(slider)}
                </output>
                <input
                  ref={firstFieldRef}
                  id={`${titleId}-slider`}
                  type="range"
                  min={min}
                  max={max}
                  step={10 ** -places}
                  value={slider}
                  onChange={(e) => setSlider(Number(e.target.value))}
                  aria-valuetext={fmt(slider)}
                  className="w-full accent-primary"
                />
              </div>
              <div className="flex justify-between gap-md font-body text-body-sm text-on-surface-variant">
                <span>Valor inicial / base: {fmt(keyResult.baseline)}</span>
                <span>
                  {keyResult.direction === 'LOWER_IS_BETTER' ? 'Teto' : 'Meta'}: {fmt(keyResult.target)}
                </span>
              </div>
              <button type="button" onClick={() => setMode('value')} className={`${secondaryBtn} self-start`}>
                Informar valor
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-sm">
              <span className="font-label text-label-lg text-on-surface">{keyResult.name}</span>
              <div className="grid gap-md sm:grid-cols-2">
                {mode === 'value' ? (
                  <label className="flex flex-col gap-xs">
                    <span className="font-label text-label-md text-on-surface">Valor{unit}</span>
                    <input
                      ref={firstFieldRef}
                      className={inputCls}
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </label>
                ) : (
                  <>
                    <label className="flex flex-col gap-xs">
                      <span className="font-label text-label-md text-on-surface">Numerador</span>
                      <input
                        ref={firstFieldRef}
                        className={inputCls}
                        inputMode="decimal"
                        value={numerator}
                        onChange={(e) => setNumerator(e.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-xs">
                      <span className="font-label text-label-md text-on-surface">Denominador</span>
                      <input
                        className={inputCls}
                        inputMode="decimal"
                        value={denominator}
                        onChange={(e) => setDenominator(e.target.value)}
                      />
                    </label>
                  </>
                )}
              </div>
              <p className="font-body text-body-sm text-on-surface-variant">
                Base: {fmt(keyResult.baseline)} · {keyResult.direction === 'LOWER_IS_BETTER' ? 'Teto' : 'Meta'}:{' '}
                {fmt(keyResult.target)}
              </p>
              <div className="flex flex-wrap gap-sm">
                {mode === 'value' ? (
                  <button type="button" onClick={() => setMode('ratio')} className={secondaryBtn}>
                    Informar numerador e denominador
                  </button>
                ) : (
                  <button type="button" onClick={() => setMode('value')} className={secondaryBtn}>
                    Informar valor
                  </button>
                )}
                {max > min && (
                  <button type="button" onClick={() => setMode('slider')} className={secondaryBtn}>
                    Usar controle deslizante
                  </button>
                )}
              </div>
            </div>
          )}

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">
              Comentário{cycle.forceCommentOnCheckIn && <span className="text-error"> *</span>}
            </span>
            <textarea
              className={`${inputCls} min-h-[80px]`}
              placeholder="Insira seu comentário"
              maxLength={OKR_COMMENT_MAX_LENGTH}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>

          <div className="grid gap-md sm:grid-cols-[12rem_1fr]">
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">Referente a</span>
              <input className={inputCls} type="date" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">Link de origem (opcional)</span>
              <input
                className={inputCls}
                type="url"
                placeholder="https://"
                maxLength={OKR_SOURCE_REF_MAX_LENGTH}
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
              />
            </label>
          </div>

          <fieldset className="flex flex-col gap-md rounded-lg border border-outline-variant/40 p-md">
            <legend className="sr-only">Status de confiança</legend>
            <div aria-hidden>
              <p className="font-label text-label-lg text-on-surface">Status de confiança</p>
              <p className="font-body text-body-sm text-on-surface-variant">Confiança no atingimento da meta.</p>
            </div>
            <div className="flex flex-wrap gap-sm">
              {OKR_CONFIDENCE_LEVELS.map((level) => {
                const option = CONFIDENCE_OPTION[level]
                const picked = confidence === level
                return (
                  <label
                    key={level}
                    className={`relative inline-flex cursor-pointer items-center gap-xs rounded-lg border px-md py-sm font-label text-label-md transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${
                      picked ? option.picked : `${option.idle} text-on-surface hover:bg-surface-container-high`
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${titleId}-confidence`}
                      value={level}
                      checked={picked}
                      onChange={() => setConfidence(level)}
                      className="sr-only"
                    />
                    <Icon name={OKR_CONFIDENCE_ICONS[level]} className="text-[18px]" filled={picked} />
                    {OKR_CONFIDENCE_LABELS[level]}
                  </label>
                )
              })}
            </div>
          </fieldset>

          {mensagem && (
            <p role="alert" className="rounded-lg bg-error/10 px-md py-sm font-body text-body-sm text-error">
              {mensagem}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-sm border-t border-outline-variant/40 px-lg py-md">
          <button type="button" onClick={onClose} className={secondaryBtn}>
            Cancelar
          </button>
          <button type="submit" disabled={salvar.isPending} className={primaryBtn}>
            {salvar.isPending ? 'Atualizando…' : 'Atualizar progresso'}
          </button>
        </footer>
      </form>
    </div>
  )
}
