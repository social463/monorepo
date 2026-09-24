import { useCallback, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  OKR_DIRECTION_LABELS,
  OKR_METRIC_TYPE_LABELS,
  OKR_SCOPE_LABELS,
  formatOkrValue,
  type OkrCycleDTO,
  type OkrKeyResultDTO,
  type OkrObjectiveDTO,
  type OkrPersonDTO,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { ApiError } from '../../lib/api'
import { errorMessage } from '../admin/shared'
import { useAuth } from '../../auth/AuthContext'
import { deleteOkrObjective, getOkrObjective, listOkrCycles, listOkrObjectives } from '../../lib/okr-api'
import { CheckInHistory, KeyResultDialog } from './KeyResultDialog'
import { KeyResultFormDialog } from './KeyResultFormDialog'
import { ObjectiveFormDialog } from './ObjectiveFormDialog'
import { OKR_SCOPE_ICONS, OkrPeople, responsiblesOf } from './ObjectivesTable'
import { OkrConfidenceChip, OkrProgressMeter } from './OkrProgress'
import { UpdateProgressDialog } from './UpdateProgressDialog'
import { canAdminOkr } from './okr-view'
import { formatYmd, okrObjectivePath } from './okr-format'

function Chip({ icon, children, title }: { icon?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-xs rounded-md bg-surface-container-highest px-sm py-xs font-label text-label-md text-on-surface"
    >
      {icon && <Icon name={icon} className="text-[16px] text-on-surface-variant" />}
      {children}
    </span>
  )
}

/** Seção recolhível com contador, como "Meta pai" e "Submetas" da ImpulseUp. */
function Collapsible({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [aberto, setAberto] = useState(false)
  const id = `okr-section-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container">
      <h2>
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={id}
          onClick={() => setAberto((value) => !value)}
          className="flex w-full items-center gap-sm px-lg py-md text-left font-label text-label-lg text-on-surface"
        >
          <Icon name={aberto ? 'expand_more' : 'chevron_right'} className="text-[20px]" />
          {title}
          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-primary px-1.5 font-label text-label-sm text-on-primary">
            {count}
          </span>
        </button>
      </h2>
      {aberto && (
        <div id={id} className="flex flex-col gap-sm border-t border-outline-variant/40 p-md">
          {children}
        </div>
      )}
    </section>
  )
}

/** Linha compacta de outra meta (pai ou submeta), que leva à página dela. */
function ObjectiveLinkRow({ objective }: { objective: OkrObjectiveDTO }) {
  const single = objective.keyResults.length === 1 ? objective.keyResults[0] : null
  const item = single ?? objective
  return (
    <div className="grid items-center gap-sm rounded-lg border border-outline-variant/30 p-md md:grid-cols-[1fr_auto_14rem]">
      <div className="flex min-w-0 items-start gap-sm">
        <Icon name={OKR_SCOPE_ICONS[objective.scope]} className="mt-0.5 text-[18px] text-on-surface-variant" />
        <div className="min-w-0">
          <Link to={okrObjectivePath(objective.id)} className="font-body text-body-md text-primary hover:underline">
            {objective.name}
          </Link>
          <p className="font-body text-body-sm text-on-surface-variant">
            {OKR_SCOPE_LABELS[objective.scope]}
            {objective.code ? ` · ${objective.code}` : ''}
            {objective.finishDate ? ` · ${formatYmd(objective.finishDate)}` : ''}
          </p>
        </div>
      </div>
      <OkrPeople people={responsiblesOf(objective, single)} />
      <div className="flex flex-col items-start gap-xs">
        <OkrProgressMeter
          attainment={item.attainment}
          overshoot={item.overshoot}
          color={item.color}
          label={`Resultado de ${objective.name}`}
        />
        <OkrConfidenceChip level={objective.confidenceLevel} />
      </div>
    </div>
  )
}

/** Quadro de progresso de um KR, à direita da aba Meta. */
function ProgressBox({
  keyResult,
  objective,
  cycle,
  showName,
  onUpdate,
  onEdit,
}: {
  keyResult: OkrKeyResultDTO
  objective: OkrObjectiveDTO
  cycle: OkrCycleDTO
  showName: boolean
  onUpdate: () => void
  onEdit: () => void
}) {
  const fmt = (value: number | null) => formatOkrValue(value, keyResult, cycle.decimals)
  const acumulado = keyResult.accumulatedValue != null
  return (
    <div className="flex flex-col gap-sm rounded-lg border border-outline-variant/40 p-md">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        {showName ? <span className="font-label text-label-lg text-on-surface">{keyResult.name}</span> : <span />}
        <span className="font-body text-body-md tabular-nums text-on-surface">
          {acumulado ? 'Acumulado' : 'Valor atual'}: {fmt(acumulado ? keyResult.accumulatedValue : keyResult.currentValue)}
        </span>
      </div>
      <OkrProgressMeter
        attainment={keyResult.attainment}
        overshoot={keyResult.overshoot}
        color={keyResult.color}
        label={`Resultado de ${keyResult.name}`}
      />
      <div className="flex justify-between gap-md font-body text-body-sm tabular-nums text-on-surface-variant">
        <span>Valor inicial / base: {fmt(keyResult.baseline)}</span>
        <span>
          {keyResult.direction === 'LOWER_IS_BETTER' ? 'Teto' : 'Meta'}: {fmt(keyResult.target)}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <OkrConfidenceChip level={objective.confidenceLevel} />
        <span className="flex flex-wrap items-center gap-md">
          {keyResult.permissions.updateKeyResult && (
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Editar key result ${keyResult.name}`}
              className="font-label text-label-md text-primary underline"
            >
              Editar
            </button>
          )}
          {keyResult.permissions.createCheckIn && (
            <button type="button" onClick={onUpdate} className="font-label text-label-md text-primary underline">
              Atualizar progresso
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

/** Pessoas da meta, uma vez cada, na ordem: responsáveis e depois donos. */
function everyone(objective: OkrObjectiveDTO): OkrPersonDTO[] {
  const people = new Map<string, OkrPersonDTO>()
  for (const assignment of [...objective.assignments, ...objective.keyResults.flatMap((kr) => kr.assignments)]) {
    if (assignment.role !== 'CREATOR') people.set(assignment.person.id, assignment.person)
  }
  return [...people.values()]
}

const TABS = [
  { key: 'meta', label: 'Meta' },
  { key: 'atualizacoes', label: 'Atualizações' },
] as const

function ObjectiveCard({
  objective,
  cycle,
  onOpen,
  onEditKeyResult,
  actions,
}: {
  objective: OkrObjectiveDTO
  cycle: OkrCycleDTO
  onOpen: (keyResultId: string, withForm: boolean) => void
  onEditKeyResult: (keyResult: OkrKeyResultDTO) => void
  actions: ReactNode
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('meta')
  const single = objective.keyResults.length === 1 ? objective.keyResults[0] : null
  const metric = single ?? objective.keyResults[0]

  return (
    <article className="overflow-hidden rounded-xl border border-primary/60 bg-surface-container">
      <header className="flex flex-wrap items-center justify-between gap-sm border-b border-outline-variant/40 bg-primary/5 px-lg py-md">
        <h1 className="flex min-w-0 items-center gap-sm font-headline text-headline-sm text-primary">
          <Icon name="track_changes" className="text-[22px]" />
          {objective.name}
        </h1>
        <div className="flex flex-wrap items-center gap-xs">
          {single && (
            <button
              type="button"
              onClick={() => onOpen(single.id, false)}
              aria-label={`Evolução de ${objective.name}`}
              title="Evolução"
              className="rounded-full p-xs text-primary hover:bg-primary/10"
            >
              <Icon name="monitoring" className="text-[24px]" />
            </button>
          )}
          {actions}
        </div>
      </header>

      <div role="tablist" aria-label="Seções da meta" className="flex gap-lg border-b border-outline-variant/40 px-lg">
        {TABS.map((option) => {
          const active = option.key === tab
          return (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(option.key)}
              className={`-mb-px border-b-2 py-sm font-label text-label-md ${
                active ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      {tab === 'meta' ? (
        <div role="tabpanel" className="grid gap-lg p-lg lg:grid-cols-[1fr_minmax(0,32rem)]">
          <div className="flex min-w-0 flex-col gap-md">
            <div className="flex flex-wrap items-center gap-sm">
              <div className="flex">
                <OkrPeople people={everyone(objective)} />
              </div>
              {objective.finishDate && <Chip icon="calendar_month">{formatYmd(objective.finishDate)}</Chip>}
              <Chip icon={OKR_SCOPE_ICONS[objective.scope]}>{OKR_SCOPE_LABELS[objective.scope]}</Chip>
              <Link
                to={`/metas?aba=ciclo&ciclo=${cycle.id}`}
                className="inline-flex items-center gap-xs rounded-md bg-primary/10 px-sm py-xs font-label text-label-md text-primary hover:bg-primary/15"
              >
                <Icon name="history" className="text-[16px]" />
                {cycle.name}
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-sm">
              {objective.code && <Chip>ID: {objective.code}</Chip>}
              {metric && (
                <Chip icon={metric.direction === 'LOWER_IS_BETTER' ? 'arrow_downward' : 'arrow_upward'}>
                  {OKR_METRIC_TYPE_LABELS[metric.metricType]} · {OKR_DIRECTION_LABELS[metric.direction]}
                </Chip>
              )}
            </div>
            {(objective.description || single?.description) && (
              <p className="whitespace-pre-line break-words font-body text-body-md text-on-surface">
                {objective.description || single?.description}
              </p>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-sm">
            {objective.keyResults.length === 0 ? (
              <div className="flex flex-col gap-sm rounded-lg border border-outline-variant/40 p-md">
                <OkrProgressMeter
                  attainment={objective.attainment}
                  overshoot={objective.overshoot}
                  color={objective.color}
                  label={`Resultado de ${objective.name}`}
                />
                <OkrConfidenceChip level={objective.confidenceLevel} />
              </div>
            ) : (
              objective.keyResults.map((keyResult) => (
                <ProgressBox
                  key={keyResult.id}
                  keyResult={keyResult}
                  objective={objective}
                  cycle={cycle}
                  showName={!single}
                  onUpdate={() => onOpen(keyResult.id, true)}
                  onEdit={() => onEditKeyResult(keyResult)}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        <div role="tabpanel" className="flex flex-col gap-lg p-lg">
          {objective.keyResults.length === 0 && (
            <p className="font-body text-body-sm text-on-surface-variant">Esta meta não tem key results.</p>
          )}
          {objective.keyResults.map((keyResult) => (
            <section key={keyResult.id} className="flex flex-col gap-sm">
              {!single && <h2 className="font-label text-label-lg text-on-surface">{keyResult.name}</h2>}
              <CheckInHistory keyResult={keyResult} cycle={cycle} />
            </section>
          ))}
        </div>
      )}
    </article>
  )
}

/**
 * Página de uma meta, no formato da ImpulseUp: meta pai, a meta (dados e
 * progresso; atualizações) e submetas. Ações, contramedidas, anexos e etiquetas
 * não existem no módulo e ficam de fora.
 */
const acaoCls =
  'inline-flex items-center gap-xs rounded-lg border border-outline-variant px-md py-xs font-label text-label-md text-primary hover:bg-primary/10'

export function OkrObjectivePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState<{ keyResultId: string; withForm: boolean } | null>(null)
  const [updated, setUpdated] = useState<string | null>(null)
  const [editando, setEditando] = useState(false)
  const [novaSubmeta, setNovaSubmeta] = useState(false)
  const [krEmEdicao, setKrEmEdicao] = useState<'novo' | OkrKeyResultDTO | null>(null)
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const close = useCallback(() => setOpen(null), [])
  const queryClient = useQueryClient()

  const objectiveQuery = useQuery({
    queryKey: ['okr', 'objective', id],
    queryFn: () => getOkrObjective(id),
    enabled: !!id,
  })
  const objective = objectiveQuery.data?.objective
  const cyclesQuery = useQuery({ queryKey: ['okr', 'cycles'], queryFn: listOkrCycles })
  const cycle = cyclesQuery.data?.cycles.find((c) => c.id === objective?.cycleId)
  const parentQuery = useQuery({
    queryKey: ['okr', 'objective', objective?.parentId],
    queryFn: () => getOkrObjective(objective!.parentId!),
    enabled: !!objective?.parentId,
  })
  const childrenQuery = useQuery({
    queryKey: ['okr', 'objectives', objective?.cycleId, { parentId: id }],
    queryFn: () => listOkrObjectives(objective!.cycleId, { parentId: id }),
    enabled: !!objective,
  })

  const excluir = useMutation({
    mutationFn: () => deleteOkrObjective(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['okr'] })
      navigate('/metas')
    },
    onError: (err) => setErroAcao(errorMessage(err, 'Não foi possível excluir a meta.')),
  })

  const selectedKr = open ? objective?.keyResults.find((kr) => kr.id === open.keyResultId) : undefined
  const { user } = useAuth()
  const podeAdministrar = canAdminOkr(user) && cycle?.status !== 'CLOSED'
  const notFound = objectiveQuery.error instanceof ApiError && objectiveQuery.error.status === 404
  const children = childrenQuery.data?.objectives ?? []

  function voltar() {
    // Entrou direto pelo link (sem histórico no app): volta para a lista.
    if (location.key === 'default') navigate('/metas')
    else navigate(-1)
  }

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <p className="font-headline text-headline-md text-on-surface-variant">Metas e OKRs</p>
      <button
        type="button"
        onClick={voltar}
        className="inline-flex items-center gap-xs self-start rounded-full border border-outline-variant px-md py-xs font-label text-label-md text-on-surface hover:bg-surface-container-high"
      >
        <Icon name="arrow_back" className="text-[18px]" /> Voltar
      </button>

      {(objectiveQuery.isLoading || cyclesQuery.isLoading) && <Skeleton className="h-60 w-full" />}
      {objectiveQuery.isError && (
        <p className="rounded-xl border border-dashed border-outline-variant/50 p-xl text-center font-body text-body-md text-on-surface-variant">
          {notFound ? 'Meta não encontrada.' : 'Não foi possível carregar a meta.'}
        </p>
      )}

      {objective && cycle && (
        <>
          <Collapsible title="Meta pai" count={objective.parentId ? 1 : 0}>
            {!objective.parentId && (
              <p className="font-body text-body-sm text-on-surface-variant">Esta meta não desdobra nenhuma outra.</p>
            )}
            {parentQuery.isLoading && <Skeleton className="h-16 w-full" />}
            {parentQuery.isError && (
              <p className="font-body text-body-sm text-on-surface-variant">Você não tem acesso à meta pai.</p>
            )}
            {parentQuery.data && <ObjectiveLinkRow objective={parentQuery.data.objective} />}
          </Collapsible>

          <p role="status" className={updated ? 'font-body text-body-sm text-on-surface' : 'sr-only'}>
            {updated ? `Progresso de ${updated} atualizado.` : ''}
          </p>
          <ObjectiveCard
            objective={objective}
            cycle={cycle}
            onOpen={(keyResultId, withForm) => {
              setUpdated(null)
              setOpen({ keyResultId, withForm })
            }}
            onEditKeyResult={setKrEmEdicao}
            actions={
              <>
                {objective.permissions.updateObjective && (
                  <button type="button" onClick={() => setEditando(true)} className={acaoCls}>
                    <Icon name="edit" className="text-[18px]" /> Editar
                  </button>
                )}
                {objective.permissions.createKeyResult && (
                  <button type="button" onClick={() => setKrEmEdicao('novo')} className={acaoCls}>
                    <Icon name="add" className="text-[18px]" /> Key result
                  </button>
                )}
                {(objective.permissions.updateObjective || podeAdministrar) && (
                  <button type="button" onClick={() => setNovaSubmeta(true)} className={acaoCls}>
                    <Icon name="account_tree" className="text-[18px]" /> Submeta
                  </button>
                )}
                {objective.permissions.deleteObjective && (
                  <button
                    type="button"
                    onClick={() => {
                      // A exclusão leva a subárvore junto; confirmar é o mínimo.
                      const filhas = children.length
                      const aviso = filhas > 0 ? ` Isso também exclui ${filhas} submeta(s).` : ''
                      if (window.confirm(`Excluir "${objective.name}"?${aviso}`)) excluir.mutate()
                    }}
                    className={`${acaoCls} text-error hover:bg-error/10`}
                  >
                    <Icon name="delete" className="text-[18px]" /> Excluir
                  </button>
                )}
              </>
            }
          />
          {erroAcao && (
            <p role="alert" className="rounded-lg bg-error/10 px-md py-sm font-body text-body-sm text-error">
              {erroAcao}
            </p>
          )}

          <Collapsible title="Submetas" count={children.length}>
            {childrenQuery.isLoading && <Skeleton className="h-16 w-full" />}
            {!childrenQuery.isLoading && children.length === 0 && (
              <p className="font-body text-body-sm text-on-surface-variant">Nenhuma submeta desdobra esta meta.</p>
            )}
            {children.map((child) => (
              <ObjectiveLinkRow key={child.id} objective={child} />
            ))}
          </Collapsible>

          {editando && (
            <ObjectiveFormDialog
              cycle={cycle}
              objective={objective}
              onClose={() => setEditando(false)}
              onSaved={() => setEditando(false)}
            />
          )}
          {novaSubmeta && (
            <ObjectiveFormDialog
              cycle={cycle}
              objective={null}
              parent={objective}
              onClose={() => setNovaSubmeta(false)}
              onSaved={() => setNovaSubmeta(false)}
            />
          )}
          {krEmEdicao && (
            <KeyResultFormDialog
              objective={objective}
              keyResult={krEmEdicao === 'novo' ? null : krEmEdicao}
              onClose={() => setKrEmEdicao(null)}
              onSaved={() => setKrEmEdicao(null)}
            />
          )}
          {selectedKr && open?.withForm && (
            <UpdateProgressDialog
              key={`update-${selectedKr.id}`}
              keyResult={selectedKr}
              objective={objective}
              cycle={cycle}
              onDone={() => {
                setOpen(null)
                setUpdated(selectedKr.name)
              }}
              onClose={close}
            />
          )}
          {selectedKr && open && !open.withForm && (
            <KeyResultDialog
              key={`detail-${selectedKr.id}`}
              keyResult={selectedKr}
              objective={objective}
              cycle={cycle}
              onUpdate={() => setOpen({ keyResultId: selectedKr.id, withForm: true })}
              onClose={close}
            />
          )}
        </>
      )}
    </section>
  )
}
