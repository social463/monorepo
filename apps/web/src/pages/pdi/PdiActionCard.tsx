import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  PDI_ACTION_EVENT_LABELS,
  PDI_ACTION_PRIORITY_LABELS,
  PDI_ACTION_STATUS_LABELS,
  PDI_ACTION_TYPE_ICONS,
  PDI_ACTION_TYPE_LABELS,
  type PdiActionDTO,
  type PdiActionPriority,
  type PdiActionStatus,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { deletePdiAction, listPdiActionHistory, updatePdiAction } from '../../lib/pdi-api'

const STATUS_STYLE: Record<PdiActionStatus, string> = {
  NOT_STARTED: 'bg-surface-container-highest text-on-surface-variant',
  IN_PROGRESS: 'bg-primary/15 text-primary',
  AWAITING_REVIEW: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  DONE: 'bg-primary text-on-primary',
}

/** Faixa colorida na borda esquerda: dá o estado da ação de relance na lista. */
const STATUS_ACCENT: Record<PdiActionStatus, string> = {
  NOT_STARTED: 'bg-outline-variant',
  IN_PROGRESS: 'bg-primary/60',
  AWAITING_REVIEW: 'bg-amber-500',
  DONE: 'bg-primary',
}

const PRIORITY_STYLE: Record<PdiActionPriority, string> = {
  LOW: 'text-on-surface-variant',
  MEDIUM: 'text-amber-600 dark:text-amber-400',
  HIGH: 'text-error',
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value))
}

function ActionHistory({ actionId }: { actionId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['pdi', 'history', actionId],
    queryFn: () => listPdiActionHistory(actionId),
  })

  if (isLoading) return <p className="text-body-sm text-on-surface-variant">Carregando histórico…</p>

  return (
    <ol className="flex flex-col gap-xs border-l border-outline-variant/40 pl-md">
      {(data?.entries ?? []).map((entry) => (
        <li key={entry.id} className="text-body-sm text-on-surface-variant">
          <strong className="text-on-surface">{PDI_ACTION_EVENT_LABELS[entry.eventType]}</strong>
          {entry.actor ? ` · ${entry.actor.name}` : ''} · {dateLabel(entry.createdAt)}
        </li>
      ))}
    </ol>
  )
}

export function PdiActionCard({
  action,
  onComplete,
}: {
  action: PdiActionDTO
  onComplete: (action: PdiActionDTO) => void
}) {
  const qc = useQueryClient()
  const [showHistory, setShowHistory] = useState(false)
  const [progress, setProgress] = useState(action.progressPct)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['pdi'] })
  const saveProgress = useMutation({
    mutationFn: (value: number) => updatePdiAction(action.id, { progressPct: value }),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: () => deletePdiAction(action.id), onSuccess: invalidate })

  const editable = action.status !== 'DONE' && action.status !== 'AWAITING_REVIEW'
  const overdue = action.dueDate != null && action.status !== 'DONE' && new Date(action.dueDate) < new Date()

  return (
    <article className="relative flex flex-col gap-md overflow-hidden rounded-lg border border-outline-variant/30 bg-surface p-md pl-lg transition-colors hover:border-outline-variant">
      <span className={`absolute inset-y-0 left-0 w-1 ${STATUS_ACCENT[action.status]}`} aria-hidden="true" />
      <header className="flex flex-wrap items-start justify-between gap-sm">
        <div className="flex min-w-0 items-start gap-sm">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-highest text-primary">
            <Icon name={PDI_ACTION_TYPE_ICONS[action.type]} className="text-[20px]" />
          </span>
          <div className="min-w-0">
            <h4 className="font-headline text-title-md text-on-surface">{action.description}</h4>
            <div className="mt-xs flex flex-wrap items-center gap-x-sm gap-y-xs font-label text-label-sm">
              <span className="rounded bg-surface-container-highest px-sm py-0.5 text-on-surface-variant">
                {PDI_ACTION_TYPE_LABELS[action.type]}
              </span>
              <span className={`inline-flex items-center gap-xs ${PRIORITY_STYLE[action.priority]}`}>
                <span className="h-2 w-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
                Prioridade {PDI_ACTION_PRIORITY_LABELS[action.priority]}
              </span>
              {action.competency && (
                <span className="rounded bg-surface-container-highest px-sm py-0.5 text-on-surface-variant">
                  {action.competency}
                </span>
              )}
              {action.dueDate && (
                <span className={`inline-flex items-center gap-xs ${overdue ? 'text-error' : 'text-on-surface-variant'}`}>
                  {overdue && <Icon name="warning" className="text-[14px]" />}
                  {overdue ? `Prazo vencido em ${dateLabel(action.dueDate)}` : `Prazo ${dateLabel(action.dueDate)}`}
                </span>
              )}
            </div>
          </div>
        </div>
        <span className={`rounded-full px-md py-xs font-label text-label-sm ${STATUS_STYLE[action.status]}`}>
          {PDI_ACTION_STATUS_LABELS[action.status]}
        </span>
      </header>

      {action.reviewComment && action.status !== 'DONE' && (
        <p className="rounded-lg bg-amber-500/10 p-md text-body-sm text-on-surface">
          <strong>Ajustes pedidos pelo líder:</strong> {action.reviewComment}
        </p>
      )}

      {action.status === 'AWAITING_REVIEW' && (
        <p className="rounded-lg bg-surface-container-highest p-md text-body-sm text-on-surface-variant">
          Enviada para validação. Você poderá editar de novo se o líder pedir ajustes.
        </p>
      )}

      <div className="flex flex-col gap-xs">
        <span className="text-right font-label text-label-sm tabular-nums text-on-surface-variant">
          {editable ? progress : action.progressPct}%
        </span>
        {editable ? (
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(event) => setProgress(Number(event.target.value))}
            onMouseUp={() => saveProgress.mutate(progress)}
            onTouchEnd={() => saveProgress.mutate(progress)}
            onKeyUp={() => saveProgress.mutate(progress)}
            aria-label={`Progresso de ${action.description}`}
            className="h-1.5 w-full cursor-pointer accent-primary"
          />
        ) : (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, action.progressPct)}%` }}
            />
          </div>
        )}
      </div>

      {action.checklist.length > 0 && (
        <ul className="flex flex-col gap-xs">
          {action.checklist.map((item) => (
            <li key={item.id} className="flex items-center gap-sm text-body-sm text-on-surface-variant">
              <Icon
                name={item.done ? 'check_box' : 'check_box_outline_blank'}
                className={`text-[18px] ${item.done ? 'text-primary' : ''}`}
              />
              {item.text}
            </li>
          ))}
        </ul>
      )}

      <footer className="flex flex-wrap items-center gap-sm border-t border-outline-variant/30 pt-sm">
        {editable && (
          <button
            type="button"
            onClick={() => onComplete(action)}
            className="inline-flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label text-label-sm text-on-primary transition-opacity hover:opacity-90"
          >
            <Icon name="task_alt" className="text-[16px]" /> Concluir ação
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowHistory((value) => !value)}
          className="inline-flex items-center gap-xs rounded-full px-sm py-sm font-label text-label-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <Icon name="history" className="text-[16px]" /> Histórico
        </button>
        {editable && (
          <button
            type="button"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="inline-flex items-center gap-xs rounded-full px-sm py-sm font-label text-label-sm text-on-surface-variant transition-colors hover:text-error disabled:opacity-50"
          >
            <Icon name="delete" className="text-[16px]" /> Excluir
          </button>
        )}
      </footer>

      {showHistory && <ActionHistory actionId={action.id} />}
    </article>
  )
}
