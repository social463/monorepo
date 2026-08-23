import { useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  PDI_ACTION_PRIORITIES,
  PDI_ACTION_PRIORITY_LABELS,
  PDI_ACTION_TYPES,
  PDI_ACTION_TYPE_ICONS,
  PDI_ACTION_TYPE_LABELS,
  PDI_PLAN_STATUSES,
  PDI_PLAN_STATUS_LABELS,
  PDI_SHOWCASE_VISIBILITIES,
  PDI_SHOWCASE_VISIBILITY_LABELS,
  type PdiActionDTO,
  type PdiActionPriority,
  type PdiActionType,
  type PdiPlanDTO,
  type PdiShowcaseVisibility,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { Skeleton } from '../../components/Skeleton'
import { useAuth } from '../../auth/AuthContext'
import { ApiError } from '../../lib/api'
import {
  createPdiAction,
  createPdiPlan,
  deletePdiPlan,
  getPdiDashboard,
  getPdiShowcase,
  listEligiblePdiLeaders,
  listPdiPlans,
  updatePdiPlan,
  updatePdiVisibility,
} from '../../lib/pdi-api'
import { CompleteActionWizard } from './CompleteActionWizard'
import { LeaderValidationPanel } from './LeaderValidationPanel'
import { PdiActionCard } from './PdiActionCard'
import { PdiProgressBar } from './PdiProgressBar'

const TABS = [
  { key: 'meus-pdis', label: 'Meus PDIs' },
  { key: 'validacoes', label: 'Validações' },
  { key: 'painel', label: 'Painel' },
  { key: 'vitrine', label: 'Vitrine' },
] as const

type TabKey = (typeof TABS)[number]['key']

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value)
}

function NewPlanForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [cyclePeriod, setCyclePeriod] = useState('')
  const [leaderId, setLeaderId] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Só quem pode validar: mesmo setor e papel acima na hierarquia. A regra vive
  // no service; aqui a lista já vem pronta.
  const { data: leadersData } = useQuery({ queryKey: ['pdi', 'leaders'], queryFn: listEligiblePdiLeaders })
  const leaders = leadersData?.leaders ?? []

  const mutation = useMutation({
    mutationFn: () =>
      createPdiPlan({
        title: title.trim(),
        cyclePeriod: cyclePeriod.trim() || null,
        leaderId: leaderId || null,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        status: 'IN_PROGRESS',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pdi'] })
      onDone()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível criar o plano.'),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    mutation.mutate()
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-md rounded-xl border border-outline-variant/30 bg-surface-container p-lg"
    >
      <h3 className="font-headline text-title-lg text-on-surface">Novo plano</h3>

      <label className="flex flex-col gap-xs">
        <span className="font-label text-label-md text-on-surface">Título</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Ex.: Meu desenvolvimento 2026-Q1"
          className="rounded-lg border border-outline-variant/40 bg-surface p-md text-body-md text-on-surface outline-none focus:border-primary"
        />
      </label>

      <div className="grid gap-md sm:grid-cols-2">
        <label className="flex flex-col gap-xs">
          <span className="font-label text-label-md text-on-surface">Ciclo</span>
          <input
            value={cyclePeriod}
            onChange={(event) => setCyclePeriod(event.target.value)}
            placeholder="2026-Q1"
            className="rounded-lg border border-outline-variant/40 bg-surface p-md text-body-md text-on-surface outline-none focus:border-primary"
          />
        </label>
        <div className="flex flex-col gap-xs">
          <span className="font-label text-label-md text-on-surface">Líder que valida</span>
          <Select
            ariaLabel="Líder que valida o plano"
            placeholder="Sem líder (concluo sozinho)"
            value={leaderId}
            options={[
              { value: '', label: 'Sem líder (concluo sozinho)' },
              ...leaders.map((leader) => ({
                value: leader.id,
                label: leader.position ? `${leader.name} · ${leader.position}` : leader.name,
              })),
            ]}
            onChange={setLeaderId}
          />
          {leaders.length === 0 && (
            <span className="text-body-sm text-on-surface-variant">
              Ninguém acima de você no seu setor — o plano segue sem validação.
            </span>
          )}
        </div>
        <label className="flex flex-col gap-xs">
          <span className="font-label text-label-md text-on-surface">Início</span>
          <input
            type="date"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className="rounded-lg border border-outline-variant/40 bg-surface p-md text-body-md text-on-surface outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-xs">
          <span className="font-label text-label-md text-on-surface">Fim</span>
          <input
            type="date"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            className="rounded-lg border border-outline-variant/40 bg-surface p-md text-body-md text-on-surface outline-none focus:border-primary"
          />
        </label>
      </div>

      {error && <p className="text-body-sm text-error">{error}</p>}

      <div className="flex gap-sm">
        <button
          type="submit"
          disabled={!title.trim() || mutation.isPending}
          className="rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Criar plano
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-full px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

function NewActionForm({ planId, onDone }: { planId: string; onDone: () => void }) {
  const qc = useQueryClient()
  const [description, setDescription] = useState('')
  const [type, setType] = useState<PdiActionType>('COURSE')
  const [priority, setPriority] = useState<PdiActionPriority>('MEDIUM')
  const [competency, setCompetency] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      createPdiAction(planId, {
        description: description.trim(),
        type,
        priority,
        competency: competency.trim() || null,
        dueDate: dueDate || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pdi'] })
      onDone()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível criar a ação.'),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (description.trim()) mutation.mutate()
      }}
      className="flex flex-col gap-md rounded-xl border border-dashed border-outline-variant/50 bg-surface p-lg"
    >
      <input
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="O que você vai fazer? Ex.: concluir o curso de liderança"
        className="rounded-lg border border-outline-variant/40 bg-surface p-md text-body-md text-on-surface outline-none focus:border-primary"
      />
      <div className="grid gap-sm sm:grid-cols-4">
        <Select
          ariaLabel="Tipo da ação"
          value={type}
          options={PDI_ACTION_TYPES.map((option) => ({ value: option, label: PDI_ACTION_TYPE_LABELS[option] }))}
          onChange={(next) => setType(next as PdiActionType)}
        />
        <Select
          ariaLabel="Prioridade da ação"
          value={priority}
          options={PDI_ACTION_PRIORITIES.map((option) => ({
            value: option,
            label: `Prioridade ${PDI_ACTION_PRIORITY_LABELS[option]}`,
          }))}
          onChange={(next) => setPriority(next as PdiActionPriority)}
        />
        <input
          value={competency}
          onChange={(event) => setCompetency(event.target.value)}
          placeholder="Competência"
          className="rounded-lg border border-outline-variant/40 bg-surface p-md text-body-sm text-on-surface outline-none focus:border-primary"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          className="rounded-lg border border-outline-variant/40 bg-surface p-md text-body-sm text-on-surface outline-none focus:border-primary"
        />
      </div>
      {error && <p className="text-body-sm text-error">{error}</p>}
      <div className="flex gap-sm">
        <button
          type="submit"
          disabled={!description.trim() || mutation.isPending}
          className="rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Adicionar ação
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-full px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

function PlanCard({
  plan,
  leaderRequired,
  onComplete,
}: {
  plan: PdiPlanDTO
  leaderRequired: boolean
  onComplete: (action: PdiActionDTO) => void
}) {
  const qc = useQueryClient()
  const [addingAction, setAddingAction] = useState(false)
  const invalidate = () => qc.invalidateQueries({ queryKey: ['pdi'] })

  const changeStatus = useMutation({
    mutationFn: (status: PdiPlanDTO['status']) => updatePdiPlan(plan.id, { status }),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: () => deletePdiPlan(plan.id), onSuccess: invalidate })

  return (
    <section className="flex flex-col gap-lg rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
      <header className="flex flex-wrap items-start justify-between gap-md">
        <div className="min-w-0">
          <h3 className="font-headline text-headline-md text-on-surface">{plan.title}</h3>
          <p className="mt-xs text-body-sm text-on-surface-variant">
            {plan.cyclePeriod ? `${plan.cyclePeriod} · ` : ''}
            {plan.leader ? `Valida: ${plan.leader.name}` : 'Sem líder validador'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          <Select
            ariaLabel={`Situação do plano ${plan.title}`}
            className="w-44"
            value={plan.status}
            options={PDI_PLAN_STATUSES.map((status) => ({ value: status, label: PDI_PLAN_STATUS_LABELS[status] }))}
            onChange={(next) => changeStatus.mutate(next as PdiPlanDTO['status'])}
          />
          <button
            type="button"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            aria-label={`Excluir plano ${plan.title}`}
            className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-error disabled:opacity-50"
          >
            <Icon name="delete" className="text-[20px]" />
          </button>
        </div>
      </header>

      <PdiProgressBar value={plan.progressPct} label="Progresso geral" />

      <div className="flex flex-col gap-md">
        {plan.actions.map((action) => (
          <PdiActionCard key={action.id} action={action} onComplete={onComplete} />
        ))}
        {plan.actions.length === 0 && !addingAction && (
          <p className="text-body-sm text-on-surface-variant">
            Nenhuma ação ainda. Adicione o que você vai fazer neste ciclo.
          </p>
        )}
      </div>

      {addingAction ? (
        <NewActionForm planId={plan.id} onDone={() => setAddingAction(false)} />
      ) : (
        <div className="flex flex-col items-center justify-between gap-sm md:flex-row">
          <button
            type="button"
            onClick={() => setAddingAction(true)}
            className="inline-flex w-full items-center justify-center gap-xs rounded-full border border-outline-variant/40 bg-surface-container-highest px-lg py-sm font-label text-label-md text-on-surface transition-colors hover:border-outline-variant md:w-auto"
          >
            <Icon name="add" className="text-[18px]" /> Adicionar ação
          </button>
          {leaderRequired && plan.leader && (
            <p className="text-center text-body-sm text-on-surface-variant md:text-right">
              Ao concluir uma ação, ela vai para a validação de {plan.leader.name}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function MyPlansTab({
  creating,
  onCancelCreate,
  onComplete,
}: {
  creating: boolean
  onCancelCreate: () => void
  onComplete: (action: PdiActionDTO, leaderRequired: boolean) => void
}) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['pdi', 'plans'], queryFn: listPdiPlans })

  if (isLoading) return <Skeleton className="h-64 w-full" />
  if (isError || !data) return <p className="text-body-md text-error">Erro ao carregar seus planos.</p>

  const leaderRequired = data.settings.leaderApprovalRequired

  return (
    <div className="flex flex-col gap-lg">
      {creating && <NewPlanForm onDone={onCancelCreate} />}

      {data.plans.length === 0 && !creating && (
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-xl text-center">
          <h3 className="font-headline text-headline-md text-on-surface">Você ainda não tem um PDI</h3>
          <p className="mt-sm text-body-md text-on-surface-variant">
            Monte o plano do ciclo com as ações que vão te levar aonde você quer chegar.
          </p>
        </div>
      )}

      {data.plans.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          leaderRequired={leaderRequired}
          onComplete={(action) => onComplete(action, leaderRequired && plan.leader != null)}
        />
      ))}
    </div>
  )
}

/** Cartão de métrica do painel: rótulo e ícone em cima, número grande embaixo. */
function MetricCard({
  label,
  icon,
  value,
  highlight = false,
  children,
}: {
  label: string
  icon: string
  value: number | string
  highlight?: boolean
  children?: ReactNode
}) {
  return (
    <div
      className={`flex flex-col justify-between gap-md rounded-xl border bg-surface-container p-md ${
        highlight ? 'border-primary/40' : 'border-outline-variant/30'
      }`}
    >
      <div className="flex items-start justify-between gap-sm">
        <p className="font-label text-label-md text-on-surface-variant">{label}</p>
        <Icon name={icon} className={`text-[20px] ${highlight ? 'text-primary' : 'text-on-surface-variant'}`} />
      </div>
      <div className="flex flex-col gap-xs">
        <p className="font-headline text-headline-lg tabular-nums text-on-surface">{value}</p>
        {children}
      </div>
    </div>
  )
}

function SectionHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-sm border-b border-outline-variant/40 pb-sm">
      <h3 className="font-headline text-headline-sm text-on-surface">{title}</h3>
      {children}
    </div>
  )
}

function DashboardTab() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['pdi', 'dashboard'], queryFn: getPdiDashboard })

  if (isLoading) return <Skeleton className="h-48 w-full" />
  if (isError || !data) return <p className="text-body-md text-error">Erro ao carregar o painel.</p>

  const { actions, doneActions, awaitingReview, overdue, plans, progressPct, byType } = data.dashboard
  const donePct = actions === 0 ? 0 : Math.round((doneActions / actions) * 100)

  return (
    <div className="flex flex-col gap-xl">
      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Ações no total" icon="checklist" value={actions}>
          <p className="font-label text-label-sm text-on-surface-variant">
            {plans === 1 ? 'em 1 plano' : `em ${plans} planos`}
          </p>
        </MetricCard>

        <MetricCard label="Concluídas" icon="task_alt" value={doneActions}>
          <div className="mt-xs h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
            <div className="h-full rounded-full bg-primary" style={{ width: `${donePct}%` }} />
          </div>
        </MetricCard>

        <MetricCard
          label="Aguardando validação"
          icon="pending_actions"
          value={awaitingReview}
          highlight={awaitingReview > 0}
        >
          <p className="font-label text-label-sm text-on-surface-variant">
            {awaitingReview > 0 ? 'na mão do líder' : 'nada na fila'}
          </p>
        </MetricCard>

        <MetricCard label="Com prazo vencido" icon="warning" value={overdue}>
          <p className={`font-label text-label-sm ${overdue > 0 ? 'text-error' : 'text-on-surface-variant'}`}>
            {overdue > 0 ? 'precisa de atenção' : 'tudo dentro do prazo'}
          </p>
        </MetricCard>
      </div>

      <div className="grid gap-lg lg:grid-cols-3 lg:items-start">
        <section className="flex flex-col gap-md lg:col-span-2">
          <SectionHeading title="Progresso por tipo" />
          {byType.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">
              Nenhuma ação ainda. O painel se enche conforme você monta o plano.
            </p>
          ) : (
            <ul className="flex flex-col gap-sm">
              {byType.map((entry) => {
                const pct = entry.total === 0 ? 0 : Math.round((entry.done / entry.total) * 100)
                return (
                  <li
                    key={entry.type}
                    className="flex items-center justify-between gap-md rounded-lg border border-outline-variant/30 bg-surface-container p-md"
                  >
                    <div className="flex min-w-0 items-center gap-md">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-highest text-primary">
                        <Icon name={PDI_ACTION_TYPE_ICONS[entry.type]} className="text-[20px]" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-label text-label-md text-on-surface">
                          {PDI_ACTION_TYPE_LABELS[entry.type]}
                        </p>
                        <p className="truncate text-body-sm text-on-surface-variant">
                          {entry.done} de {entry.total} {entry.total === 1 ? 'concluída' : 'concluídas'}
                        </p>
                      </div>
                    </div>
                    <div className="w-24 shrink-0 sm:w-40">
                      <PdiProgressBar value={pct} className="h-1.5" />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-md">
          <SectionHeading title="Ciclos" />
          <div className="flex flex-col gap-lg rounded-xl border border-outline-variant/30 bg-surface-container p-md">
            <div className="flex items-center gap-md">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <Icon name="trending_up" className="text-[24px]" />
              </span>
              <div className="min-w-0">
                <p className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Progresso geral
                </p>
                <p className="font-headline text-title-lg tabular-nums text-on-surface">{progressPct}%</p>
              </div>
            </div>

            {data.cycles.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">Nenhum ciclo registrado ainda.</p>
            ) : (
              <ul className="flex flex-col gap-md border-t border-outline-variant/40 pt-md">
                {data.cycles.map((cycle) => (
                  <li key={cycle.cyclePeriod} className="flex flex-col gap-xs">
                    <div className="flex items-center justify-between gap-md">
                      <span className="font-label text-label-md text-on-surface">{cycle.cyclePeriod}</span>
                      <span className="text-body-sm text-on-surface-variant">
                        {cycle.doneActions}/{cycle.actions} ações
                      </span>
                    </div>
                    <PdiProgressBar value={cycle.progressPct} className="h-1.5" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

/** Ícone de cada alcance da vitrine — só visual, por isso mora aqui e não no contrato. */
const VISIBILITY_ICONS: Record<PdiShowcaseVisibility, string> = {
  ALL: 'public',
  TEAM: 'groups',
  LEADER: 'supervisor_account',
  PRIVATE: 'lock',
}

function ShowcaseTab() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const { data: plansData } = useQuery({ queryKey: ['pdi', 'plans'], queryFn: listPdiPlans })
  const { data, isLoading } = useQuery({
    queryKey: ['pdi', 'showcase', user?.id],
    queryFn: () => getPdiShowcase(user?.id ?? ''),
    enabled: Boolean(user?.id),
  })

  const changeVisibility = useMutation({
    mutationFn: (visibility: PdiShowcaseVisibility) => updatePdiVisibility(visibility),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pdi'] }),
  })

  if (isLoading) return <Skeleton className="h-48 w-full" />

  const visibility = plansData?.visibility ?? 'TEAM'
  const showcase = data?.showcase

  const actions = showcase?.actions ?? []
  const competencies = showcase?.competencies ?? []

  return (
    <div className="flex flex-col gap-lg">
      <div>
        <h2 className="font-headline text-headline-sm text-on-surface">Sua vitrine</h2>
        <p className="mt-xs text-body-md text-on-surface-variant">
          Ação de PDI concluída carrega evidência e reflexão. Aqui está o que você entregou — e você escolhe quem
          enxerga.
        </p>
      </div>

      <div className="grid gap-lg lg:grid-cols-3 lg:items-start">
        <section className="flex flex-col gap-md lg:col-span-2">
          <SectionHeading title="Suas conquistas">
            <span className="font-label text-label-sm text-on-surface-variant">
              {actions.length === 1 ? '1 ação concluída' : `${actions.length} ações concluídas`}
            </span>
          </SectionHeading>

          {actions.length === 0 ? (
            <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-xl text-center">
              <p className="font-headline text-title-md text-on-surface">Nada na vitrine ainda</p>
              <p className="mt-xs text-body-sm text-on-surface-variant">
                Conclua uma ação do seu PDI para ela aparecer aqui.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-sm">
              {actions.map((action) => (
                <li
                  key={action.id}
                  className="flex items-start gap-md rounded-lg border border-outline-variant/30 bg-surface-container p-md"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-highest text-primary">
                    <Icon name={PDI_ACTION_TYPE_ICONS[action.type]} className="text-[20px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-headline text-title-md text-on-surface">{action.description}</p>
                    <div className="mt-xs flex flex-wrap items-center gap-x-sm gap-y-xs font-label text-label-sm">
                      <span className="rounded bg-surface-container-highest px-sm py-0.5 text-on-surface-variant">
                        {PDI_ACTION_TYPE_LABELS[action.type]}
                      </span>
                      {action.competency && (
                        <span className="rounded bg-primary/15 px-sm py-0.5 text-primary">{action.competency}</span>
                      )}
                      <span className="text-on-surface-variant">
                        Concluída em{' '}
                        {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(action.completedAt))}
                      </span>
                    </div>
                  </div>
                  <Icon name="check_circle" filled className="shrink-0 text-[20px] text-primary" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-md">
          <SectionHeading title="Quem vê" />
          <div className="flex flex-col gap-sm rounded-xl border border-outline-variant/30 bg-surface-container p-md">
            {PDI_SHOWCASE_VISIBILITIES.map((option) => {
              const isActive = visibility === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => changeVisibility.mutate(option)}
                  aria-pressed={isActive}
                  className={`flex items-center justify-between gap-sm rounded-lg border px-md py-sm text-left font-label text-label-md transition-colors ${
                    isActive
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-outline-variant/30 text-on-surface-variant hover:border-outline-variant hover:text-on-surface'
                  }`}
                >
                  <span className="inline-flex items-center gap-sm">
                    <Icon name={VISIBILITY_ICONS[option]} className="text-[18px]" />
                    {PDI_SHOWCASE_VISIBILITY_LABELS[option]}
                  </span>
                  {isActive && <Icon name="check" className="text-[18px]" />}
                </button>
              )
            })}
          </div>

          {competencies.length > 0 && (
            <>
              <SectionHeading title="Competências" />
              <ul className="flex flex-wrap gap-xs rounded-xl border border-outline-variant/30 bg-surface-container p-md">
                {competencies.map((competency) => (
                  <li
                    key={competency}
                    className="rounded-full bg-primary/15 px-md py-xs font-label text-label-sm text-primary"
                  >
                    {competency}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * Meu PDI. As abas vivem na mesma rota (o menu lateral é flat) e a aba ativa vai
 * na URL — a notificação de validação leva direto para `?aba=validacoes`.
 */
export function PdiPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('aba')
  const active: TabKey = isTabKey(requested) ? requested : 'meus-pdis'
  const [wizard, setWizard] = useState<{ action: PdiActionDTO; leaderRequired: boolean } | null>(null)
  const [creating, setCreating] = useState(false)

  function selectTab(key: TabKey) {
    const next = new URLSearchParams(searchParams)
    next.set('aba', key)
    setSearchParams(next, { replace: true })
  }

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header className="flex flex-col justify-between gap-md md:flex-row md:items-end">
        <div>
          <h1 className="font-headline text-headline-lg text-on-surface md:text-headline-xl">Meu PDI</h1>
          <p className="mt-xs text-body-md text-on-surface-variant">
            O plano do seu ciclo: o que você vai fazer, como aplicou e o que aprendeu.
          </p>
        </div>
        {active === 'meus-pdis' && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex w-full items-center justify-center gap-xs rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary transition-opacity hover:opacity-90 md:w-auto"
          >
            <Icon name="add" className="text-[18px]" /> Novo plano
          </button>
        )}
      </header>

      {/* `flex-wrap` em vez de `overflow-x-auto`: overflow no eixo X liga o
          eixo Y junto, e a borda inferior deixava a caixa 1px mais alta que o
          conteúdo — o bastante para o macOS desenhar uma barra de rolagem
          fantasma ao lado das abas. Em tela estreita elas quebram para a linha
          seguinte, que é melhor do que rolar de lado. */}
      <div role="tablist" aria-label="Seções do PDI" className="flex flex-wrap gap-lg border-b border-outline-variant/40">
        {TABS.map((tab) => {
          const isActive = tab.key === active
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab.key)}
              className={`-mb-px whitespace-nowrap border-b-2 pb-sm font-label text-label-md transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {active === 'meus-pdis' && (
        <MyPlansTab
          creating={creating}
          onCancelCreate={() => setCreating(false)}
          onComplete={(action, leaderRequired) => setWizard({ action, leaderRequired })}
        />
      )}
      {active === 'validacoes' && <LeaderValidationPanel />}
      {active === 'painel' && <DashboardTab />}
      {active === 'vitrine' && <ShowcaseTab />}

      {wizard && (
        <CompleteActionWizard
          action={wizard.action}
          leaderRequired={wizard.leaderRequired}
          onClose={() => setWizard(null)}
        />
      )}
    </section>
  )
}
