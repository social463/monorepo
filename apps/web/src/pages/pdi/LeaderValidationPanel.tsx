import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  PDI_ACTION_TYPE_ICONS,
  PDI_ACTION_TYPE_LABELS,
  PDI_REFLECTION_FIELDS,
  type PdiPersonDTO,
  type PdiReflectionKey,
  type PdiReviewQueueItemDTO,
} from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { ApiError } from '../../lib/api'
import { listPendingPdiReviews, reviewPdiAction } from '../../lib/pdi-api'
import { PdiProgressBar } from './PdiProgressBar'

/** Uma linha da lista da esquerda: o plano de um liderado e o que ele tem na fila. */
interface ReviewGroup {
  plan: PdiReviewQueueItemDTO['plan']
  owner: PdiPersonDTO
  items: PdiReviewQueueItemDTO[]
}

/**
 * A fila vem por ação; a tela é por pessoa. Agrupa por plano preservando a ordem
 * de chegada (a fila já vem ordenada pelo envio mais antigo).
 */
function groupByPlan(items: PdiReviewQueueItemDTO[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>()
  for (const item of items) {
    const group = groups.get(item.plan.id)
    if (group) group.items.push(item)
    else groups.set(item.plan.id, { plan: item.plan, owner: item.owner, items: [item] })
  }
  return [...groups.values()]
}

function EvidenceLinks({ item }: { item: PdiReviewQueueItemDTO }) {
  if (item.action.evidences.length === 0) {
    return <p className="text-body-sm text-on-surface-variant">Sem evidências anexadas.</p>
  }
  return (
    <ul className="flex flex-wrap gap-sm">
      {item.action.evidences.map((evidence) => {
        const href = evidence.externalUrl ?? evidence.downloadUrl
        const label = evidence.fileName ?? evidence.externalUrl ?? 'Evidência'
        return (
          <li key={evidence.id}>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-[18rem] items-center gap-xs rounded-full bg-surface-container-highest px-md py-sm font-label text-label-sm text-primary hover:underline"
              >
                <Icon name={evidence.externalUrl ? 'link' : 'attach_file'} className="text-[18px]" />
                <span className="truncate">{label}</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-xs rounded-full bg-surface-container-highest px-md py-sm text-body-sm text-on-surface-variant">
                <Icon name="attach_file" className="text-[18px]" /> {label} (indisponível)
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Cartão do liderado na lista da esquerda. */
function QueuePersonCard({
  group,
  active,
  onSelect,
}: {
  group: ReviewGroup
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex w-full flex-col gap-sm rounded-xl border p-md text-left transition-colors ${
        active
          ? 'border-primary bg-surface-container-high'
          : 'border-outline-variant/30 bg-surface-container hover:border-outline-variant'
      }`}
    >
      <div className="flex items-center gap-sm">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
          <Avatar user={group.owner} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-label text-label-md text-on-surface">{group.owner.name}</p>
          {group.owner.position && (
            <p className="truncate text-label-sm text-on-surface-variant">{group.owner.position}</p>
          )}
        </div>
      </div>

      <p className="truncate font-headline text-title-sm text-on-surface">
        {group.plan.title}
        {group.plan.cyclePeriod ? ` · ${group.plan.cyclePeriod}` : ''}
      </p>

      <PdiProgressBar value={group.plan.progressPct} label="Progresso" className="h-1.5" />

      <p className="font-label text-label-sm text-on-surface-variant">
        {group.items.length === 1 ? '1 ação aguardando' : `${group.items.length} ações aguardando`}
      </p>
    </button>
  )
}

function ReviewCard({ item }: { item: PdiReviewQueueItemDTO }) {
  const qc = useQueryClient()
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const review = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REQUEST_CHANGES') =>
      reviewPdiAction(item.action.id, { decision, comment: comment.trim() || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pdi'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível registrar a decisão.'),
  })

  const reflections = PDI_REFLECTION_FIELDS.filter((field) =>
    item.action.reflection?.[field.key as PdiReflectionKey]?.trim(),
  )

  return (
    <article className="flex flex-col gap-md rounded-lg border border-outline-variant/30 bg-surface p-md">
      <header className="flex flex-wrap items-start justify-between gap-sm">
        <div className="flex min-w-0 items-start gap-sm">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-highest text-primary">
            <Icon name={PDI_ACTION_TYPE_ICONS[item.action.type]} className="text-[18px]" />
          </span>
          <div className="min-w-0">
            <h4 className="font-headline text-title-md text-on-surface">{item.action.description}</h4>
            <p className="mt-xs font-label text-label-sm text-on-surface-variant">
              {PDI_ACTION_TYPE_LABELS[item.action.type]}
              {item.action.competency ? ` · ${item.action.competency}` : ''}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-amber-500/15 px-md py-xs font-label text-label-sm text-amber-600 dark:text-amber-400">
          Aguardando validação
        </span>
      </header>

      {item.action.practicalApplication && (
        <div>
          <p className="font-label text-label-md text-on-surface">Aplicação prática</p>
          <p className="mt-xs text-body-sm text-on-surface-variant">{item.action.practicalApplication}</p>
        </div>
      )}

      {reflections.length > 0 && (
        <ul className="flex flex-col gap-xs">
          {reflections.map((field) => (
            <li key={field.key} className="text-body-sm text-on-surface-variant">
              <strong className="text-on-surface">
                {field.emoji} {field.label}
              </strong>{' '}
              {item.action.reflection?.[field.key as PdiReflectionKey]}
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="font-label text-label-md text-on-surface">Evidências</p>
        <div className="mt-xs">
          <EvidenceLinks item={item} />
        </div>
      </div>

      <label className="flex flex-col gap-xs">
        <span className="font-label text-label-md text-on-surface">Comentário do líder</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          placeholder="Obrigatório ao pedir ajustes"
          className="w-full rounded-lg border border-outline-variant/40 bg-surface-container p-md text-body-md text-on-surface outline-none focus:border-primary"
        />
      </label>

      {error && <p className="text-body-sm text-error">{error}</p>}

      <div className="flex flex-wrap gap-sm border-t border-outline-variant/30 pt-sm">
        <button
          type="button"
          onClick={() => review.mutate('APPROVE')}
          disabled={review.isPending}
          className="inline-flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label text-label-sm text-on-primary transition-opacity hover:opacity-90 disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          <Icon name="check_circle" className="text-[16px]" /> Aprovar
        </button>
        <button
          type="button"
          onClick={() => review.mutate('REQUEST_CHANGES')}
          disabled={review.isPending || comment.trim().length === 0}
          className="inline-flex items-center gap-xs rounded-full border border-outline-variant/40 bg-surface-container-highest px-lg py-sm font-label text-label-sm text-on-surface transition-colors hover:border-outline-variant disabled:opacity-50"
        >
          <Icon name="edit" className="text-[16px]" /> Pedir ajustes
        </button>
      </div>
    </article>
  )
}

/**
 * Fila de validação do líder, em duas colunas: à esquerda quem está esperando,
 * à direita as ações da pessoa escolhida, com evidência e reflexão à vista.
 */
export function LeaderValidationPanel() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['pdi', 'reviews'], queryFn: listPendingPdiReviews })
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)

  if (isLoading) return <Skeleton className="h-40 w-full" />
  if (isError) return <p className="text-body-md text-error">Erro ao carregar a fila de validação.</p>

  const groups = groupByPlan(data?.items ?? [])
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-xl text-center">
        <h3 className="font-headline text-headline-md text-on-surface">Nada aguardando validação</h3>
        <p className="mt-sm text-body-md text-on-surface-variant">
          Quando alguém do seu time concluir uma ação, ela aparece aqui com as evidências.
        </p>
      </div>
    )
  }

  // Depois de aprovar a última ação de alguém, o grupo some da fila — daí a
  // seleção cair no primeiro em vez de deixar a direita vazia.
  const active = groups.find((group) => group.plan.id === selectedPlanId) ?? groups[0]

  return (
    <div className="flex flex-col gap-lg">
      <div>
        <h2 className="font-headline text-headline-sm text-on-surface">Validação de PDI</h2>
        <p className="mt-xs text-body-md text-on-surface-variant">
          Revise as ações que seu time concluiu e valide o que foi entregue.
        </p>
      </div>

      <div className="grid gap-lg lg:grid-cols-[20rem_1fr] lg:items-start">
        <aside className="flex flex-col gap-sm">
          <p className="font-label text-label-md text-on-surface-variant">Pendentes ({groups.length})</p>
          {groups.map((group) => (
            <QueuePersonCard
              key={group.plan.id}
              group={group}
              active={group.plan.id === active.plan.id}
              onSelect={() => setSelectedPlanId(group.plan.id)}
            />
          ))}
        </aside>

        <section className="flex flex-col gap-md rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
          <header className="flex flex-wrap items-center justify-between gap-sm">
            <div className="min-w-0">
              <h3 className="font-headline text-title-lg text-on-surface">Ações para validar</h3>
              <p className="truncate text-body-sm text-on-surface-variant">
                {active.owner.name} · {active.plan.title}
              </p>
            </div>
            <span className="rounded-full bg-primary/15 px-md py-xs font-label text-label-sm text-primary">
              {active.plan.progressPct}% do ciclo
            </span>
          </header>

          {active.items.map((item) => (
            <ReviewCard key={item.action.id} item={item} />
          ))}
        </section>
      </div>
    </div>
  )
}
