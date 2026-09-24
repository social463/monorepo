import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  OKR_DIRECTION_LABELS,
  formatOkrAttainment,
  formatOkrValue,
  okrResultRatio,
  type OkrCycleDTO,
  type OkrKeyResultDTO,
  type OkrObjectiveDTO,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { listOkrCheckIns } from '../../lib/okr-api'
import { OkrEvolutionChart } from './OkrEvolutionChart'
import { OkrConfidenceChip, OkrProgressMeter } from './OkrProgress'
import { formatYmd } from './okr-format'

export function CheckInHistory({ keyResult, cycle }: { keyResult: OkrKeyResultDTO; cycle: OkrCycleDTO }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['okr', 'check-ins', keyResult.id],
    queryFn: () => listOkrCheckIns(keyResult.id),
  })
  if (isLoading) return <Skeleton className="h-16 w-full" />
  if (isError) return <p className="font-body text-body-sm text-error">Não foi possível carregar o histórico.</p>
  const checkIns = data?.checkIns ?? []
  if (checkIns.length === 0) {
    return <p className="font-body text-body-sm text-on-surface-variant">Nenhum check-in registrado ainda.</p>
  }
  return (
    <div className="flex flex-col gap-md">
      <OkrEvolutionChart checkIns={checkIns} keyResult={keyResult} cycle={cycle} />
      <ol className="flex flex-col gap-sm" aria-label={`Histórico de ${keyResult.name}`}>
        {checkIns.map((checkIn) => (
          <li key={checkIn.id} className="rounded-lg bg-surface-container-high px-md py-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-sm">
              <span className="font-label text-label-md tabular-nums text-on-surface">
                {checkIn.value == null ? 'Só comentário' : formatOkrValue(checkIn.value, keyResult, cycle.decimals)}
                {checkIn.numerator != null && checkIn.denominator != null && (
                  <span className="ml-xs font-body text-body-sm text-on-surface-variant">
                    ({checkIn.numerator.toLocaleString('pt-BR')} ÷ {checkIn.denominator.toLocaleString('pt-BR')})
                  </span>
                )}
              </span>
              <span className="font-body text-body-sm text-on-surface-variant">
                {formatYmd(checkIn.effectiveAt)}
                {checkIn.author ? ` · ${checkIn.author.name}` : ''}
                {checkIn.source === 'IMPULSEUP_IMPORT' ? ' · ImpulseUp' : checkIn.source === 'AUTOMATION' ? ' · automação' : ''}
              </span>
            </div>
            {checkIn.comment && (
              <p className="mt-xs whitespace-pre-line break-words font-body text-body-sm text-on-surface">{checkIn.comment}</p>
            )}
            {checkIn.sourceRef && (
              <a
                href={checkIn.sourceRef}
                target="_blank"
                rel="noreferrer"
                className="mt-xs inline-flex items-center gap-xs font-label text-label-sm text-primary"
              >
                <Icon name="open_in_new" className="text-[16px]" /> Origem
              </a>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * Evolução de um KR: números e a série de check-ins. Atualizar o progresso é
 * outro diálogo (`UpdateProgressDialog`) — daqui se chega nele pelo botão.
 *
 * Recebe o KR fresco a cada render (quem abre resolve pelo id na lista), então
 * o valor atualiza sozinho depois do check-in, sem fechar o diálogo.
 */
export function KeyResultDialog({
  keyResult,
  objective,
  cycle,
  onUpdate,
  onClose,
}: {
  keyResult: OkrKeyResultDTO
  objective: OkrObjectiveDTO
  cycle: OkrCycleDTO
  onUpdate: () => void
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const fmt = (value: number | null) => formatOkrValue(value, keyResult, cycle.decimals)
  const acumulado = keyResult.accumulatedValue != null
  const teto = keyResult.direction === 'LOWER_IS_BETTER'

  // Foco só na abertura: o efeito do Escape roda de novo quando a lista recarrega.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 md:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`kr-dialog-${keyResult.id}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex w-full max-w-2xl flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl">
        <header className="flex items-start justify-between gap-md">
          <div className="min-w-0">
            <h2 id={`kr-dialog-${keyResult.id}`} className="font-headline text-headline-sm text-on-surface">
              {keyResult.name}
            </h2>
            <p className="mt-xs font-body text-body-sm text-on-surface-variant">
              {keyResult.code ? `${keyResult.code} · ` : ''}
              {OKR_DIRECTION_LABELS[keyResult.direction]}
              {keyResult.calculated ? ' · calculado a partir de outras metas' : ''}
            </p>
            {objective.name !== keyResult.name && (
              <p className="font-body text-body-sm text-on-surface-variant">Objetivo: {objective.name}</p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full p-xs text-on-surface-variant hover:bg-surface-container-highest"
          >
            <Icon name="close" />
          </button>
        </header>

        <dl className="grid grid-cols-3 gap-sm">
          <div>
            <dt className="font-label text-label-sm uppercase text-on-surface-variant">{acumulado ? 'Acumulado' : 'Valor atual'}</dt>
            <dd className="font-headline text-headline-sm tabular-nums text-on-surface">
              {fmt(acumulado ? keyResult.accumulatedValue : keyResult.currentValue)}
            </dd>
          </div>
          <div>
            <dt className="font-label text-label-sm uppercase text-on-surface-variant">{teto ? 'Teto' : 'Meta'}</dt>
            <dd className="font-headline text-headline-sm tabular-nums text-on-surface">{fmt(keyResult.target)}</dd>
          </div>
          <div>
            <dt className="font-label text-label-sm uppercase text-on-surface-variant">Resultado</dt>
            <dd className="font-headline text-headline-sm tabular-nums text-on-surface">
              {formatOkrAttainment(okrResultRatio(keyResult))}
            </dd>
          </div>
        </dl>

        <OkrProgressMeter
          attainment={keyResult.attainment}
          overshoot={keyResult.overshoot}
          color={keyResult.color}
          label={`Resultado de ${keyResult.name}`}
        />
        <div className="flex flex-wrap items-center gap-sm">
          <OkrConfidenceChip level={objective.confidenceLevel} />
          {keyResult.attainment != null && (
            <span className="font-body text-body-sm text-on-surface-variant">
              {keyResult.goalMet ? 'Meta cumprida' : 'Abaixo da meta'}
            </span>
          )}
        </div>
        {acumulado && (
          <p className="font-body text-body-sm text-on-surface-variant">
            Somando o ciclo inteiro. Último check-in: {fmt(keyResult.currentValue)}.
          </p>
        )}

        <section className="flex flex-col gap-sm">
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <h3 className="font-label text-label-lg text-on-surface">Evolução</h3>
            {keyResult.permissions.createCheckIn && (
              <button
                type="button"
                onClick={onUpdate}
                className="inline-flex items-center gap-xs rounded-lg bg-primary px-lg py-sm font-label text-label-lg text-on-primary hover:bg-primary/90"
              >
                <Icon name="edit" className="text-[18px]" /> Atualizar progresso
              </button>
            )}
          </div>
          <CheckInHistory keyResult={keyResult} cycle={cycle} />
        </section>
      </div>
    </div>
  )
}
