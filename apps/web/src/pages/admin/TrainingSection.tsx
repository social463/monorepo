import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  TRAINING_MAX_SLA_DAYS,
  TRAINING_MIN_SLA_DAYS,
  MAX_TRAINING_REASONS,
  TRAINING_LEARNING_TYPES,
  TRAINING_MODALITIES,
  TRAINING_PARTICIPATION_STATUS,
  TRAINING_PRIORITIES,
  TRAINING_REASONS,
  TRAINING_REASON_LABELS,
  TRAINING_SPONSORS,
  TRAINING_SPONSOR_LABELS,
  TRAINING_SOURCES,
  TRAINING_VALIDATION_STATUS,
  TRAINING_VALIDATION_STATUS_LABELS,
  formatTrainingHours,
  formatTrainingMoney,
  type TrainingFilters,
  type TrainingParticipationStatus,
  type TrainingPriority,
  type TrainingReason,
  type TrainingRecordDTO,
  type TrainingSponsor,
  type TrainingSliceDTO,
} from '@legends/shared'
import {
  ChartCard,
  DistributionBars,
  DonutChart,
  EmptyState,
  RateBar,
  StatCard,
} from '../../components/analytics/AnalyticsPrimitives'
import { DownloadCsvButton } from '../../components/DownloadCsvButton'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import {
  deleteTrainingRecord,
  downloadTrainingCsv,
  fetchTrainingDashboard,
  fetchTrainingFilterOptions,
  fetchTrainingRecords,
  reviewTrainingRecord,
  updateTrainingRecord,
  updateTrainingSla,
} from '../../lib/training-api'
import { errorMessage, inputCls } from './shared'

const TABS = [
  { key: 'painel', label: 'Painel' },
  { key: 'central', label: 'Central de Treinamentos' },
] as const

type TabKey = (typeof TABS)[number]['key']

/** `{name,value}` do contrato → `{key,label,count}` das primitivas de gráfico. */
function toSlices(slices: TrainingSliceDTO[]) {
  return slices.map((slice) => ({ key: slice.name, label: slice.name, count: slice.value }))
}

function formatDate(ymd: string | null): string {
  if (!ymd) return '—'
  const [year, month, day] = ymd.split('-')
  return `${day}/${month}/${year}`
}

/**
 * Uma opção de filtro. A lista é declarativa de propósito: são dezoito recortes,
 * e escrevê-los como JSX repetido seria quatrocentas linhas onde mudar o
 * espaçamento de um significa mudar de dezoito.
 */
interface FilterSelect {
  key: keyof TrainingFilters
  label: string
  options: { value: string; label: string }[]
}

function SelectFilter({
  select,
  value,
  onChange,
}: {
  select: FilterSelect
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-xs">
      <span className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">{select.label}</span>
      <select className={inputCls} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Todos</option>
        {select.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

const plain = (values: string[]) => values.map((value) => ({ value, label: value }))

function FiltersBar({
  filters,
  onChange,
}: {
  filters: TrainingFilters
  onChange: (filters: TrainingFilters) => void
}) {
  const { data: options } = useQuery({
    queryKey: ['admin', 'training', 'filters'],
    queryFn: fetchTrainingFilterOptions,
  })
  const [expandido, setExpandido] = useState(false)

  function set(key: keyof TrainingFilters, value: string) {
    onChange({ ...filters, [key]: value || undefined })
  }

  // Os seis primeiros ficam sempre à vista; o resto abre no "Mais filtros".
  // Vinte seletores abertos de uma vez empurram o painel para fora da tela, e
  // quase todo recorte do dia a dia cabe nos seis.
  const principais: FilterSelect[] = [
    { key: 'year', label: 'Ano', options: plain((options?.years ?? []).map(String)) },
    { key: 'sector', label: 'Setor', options: plain(options?.sectors ?? []) },
    {
      key: 'reason',
      label: 'Motivo',
      options: TRAINING_REASONS.map((reason) => ({ value: reason, label: TRAINING_REASON_LABELS[reason] })),
    },
    {
      key: 'sponsor',
      label: 'Quem pagou',
      options: TRAINING_SPONSORS.map((sponsor) => ({ value: sponsor, label: TRAINING_SPONSOR_LABELS[sponsor] })),
    },
    { key: 'sla', label: 'SLA', options: plain(['Dentro do SLA', 'Fora do SLA', 'Pendente']) },
  ]

  const todosSecundarios: FilterSelect[] = [
    { key: 'semester', label: 'Semestre', options: plain(['1º semestre', '2º semestre']) },
    { key: 'quarter', label: 'Trimestre', options: plain(['T1', 'T2', 'T3', 'T4']) },
    { key: 'squad', label: 'Squad', options: plain(options?.squads ?? []) },
    { key: 'leader', label: 'Liderança', options: plain(options?.leaders ?? []) },
    { key: 'positionCategory', label: 'Categoria de cargo', options: plain(options?.positionCategories ?? []) },
    { key: 'employmentType', label: 'Vínculo', options: plain(['CLT', 'PJ']) },
    { key: 'learningType', label: 'Tipo de aprendizado', options: plain(options?.learningTypes ?? []) },
    { key: 'institution', label: 'Instituição', options: plain(options?.institutions ?? []) },
    { key: 'priority', label: 'Prioridade', options: plain([...TRAINING_PRIORITIES]) },
    { key: 'source', label: 'Origem do registro', options: plain([...TRAINING_SOURCES]) },
    {
      key: 'eventId',
      label: 'Evento',
      options: (options?.events ?? []).map((event) => ({ value: event.id, label: event.name })),
    },
  ]
  // Seletor sem opção nenhuma é caminho que só leva a tela vazia — some.
  const secundarios = todosSecundarios.filter((select) => select.options.length > 0)

  const ativos = Object.values(filters).filter(Boolean).length

  return (
    <div className="flex flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <div className="flex flex-wrap items-end gap-md">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-xs">
          <span className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Buscar</span>
          <input
            className={inputCls}
            placeholder="Curso, pessoa, instituição…"
            value={filters.search ?? ''}
            onChange={(event) => set('search', event.target.value)}
          />
        </label>

        {principais.map((select) => (
          <SelectFilter
            key={select.key}
            select={select}
            value={(filters[select.key] as string) ?? ''}
            onChange={(value) => set(select.key, value)}
          />
        ))}

        <button
          type="button"
          onClick={() => setExpandido((atual) => !atual)}
          aria-expanded={expandido}
          className="flex items-center gap-xs rounded-full border border-outline-variant px-lg py-sm font-label text-label-md text-on-surface"
        >
          <Icon name={expandido ? 'expand_less' : 'tune'} className="text-[18px]" />
          Mais filtros
        </button>

        {ativos > 0 && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="rounded-full border border-outline-variant px-lg py-sm font-label text-label-md text-on-surface"
          >
            Limpar ({ativos})
          </button>
        )}
      </div>

      {expandido && (
        <div className="grid gap-md border-t border-outline-variant/30 pt-md sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              Concluído a partir de
            </span>
            <input
              className={inputCls}
              type="date"
              value={filters.from ?? ''}
              onChange={(event) => set('from', event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">até</span>
            <input
              className={inputCls}
              type="date"
              value={filters.to ?? ''}
              onChange={(event) => set('to', event.target.value)}
            />
          </label>
          {secundarios.map((select) => (
            <SelectFilter
              key={select.key}
              select={select}
              value={(filters[select.key] as string) ?? ''}
              onChange={(value) => set(select.key, value)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DashboardTab({ filters }: { filters: TrainingFilters }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'training', 'overview', filters],
    queryFn: () => fetchTrainingDashboard(filters),
  })

  if (isLoading || !data) return <Skeleton className="h-96 w-full" />
  const { kpis } = data

  const maxMes = Math.max(1, ...data.monthly.map((point) => point.trainings))

  return (
    <div className="flex flex-col gap-lg">
      <p className="font-body text-body-sm text-on-surface-variant">
        Os números contam o que a G&amp;G já validou — o que está em análise aparece na Central, não aqui.
      </p>

      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Treinamentos" value={kpis.trainings} icon="school" />
        <StatCard label="Participações" value={kpis.participations} icon="groups" />
        <StatCard
          label="Pessoas treinadas"
          value={kpis.people}
          hint={`de ${kpis.totalCollaborators} ativas`}
          icon="person_check"
        />
        <StatCard label="Horas de aprendizagem" value={formatTrainingHours(kpis.hours)} icon="schedule" />
        <StatCard label="Média por pessoa" value={formatTrainingHours(kpis.avgHours)} icon="timeline" />
        <StatCard label="Investimento" value={formatTrainingMoney(kpis.investmentCents)} icon="payments" />
        <StatCard
          label="Investimento por pessoa"
          value={formatTrainingMoney(kpis.avgInvestmentCents)}
          icon="account_balance_wallet"
        />
        <StatCard
          label="SLA médio"
          value={`${kpis.avgSla} dias`}
          hint={`meta de ${data.slaDays} dias`}
          icon="timer"
        />
      </div>

      <div className="grid gap-lg lg:grid-cols-2">
        <ChartCard title="Cobertura e cumprimento" subtitle="Percentuais do recorte selecionado">
          <div className="flex flex-col gap-lg">
            <RateBar label="Cobertura de aprendizagem" rate={kpis.coverage} hint="pelo menos uma ação no período" />
            <RateBar label="Dentro do SLA" rate={kpis.pctInSla} hint="só o que foi pedido por LNT, PDI ou líder" />
            <RateBar label="Vinculados ao PDI" rate={kpis.pctPdi} />
            <RateBar label="Vinculados ao LNT" rate={kpis.pctLnt} />
            <RateBar label="Obrigatórios" rate={kpis.pctMandatory} />
          </div>
        </ChartCard>

        <ChartCard title="Evolução mensal" subtitle="Treinamentos concluídos por mês">
          {data.monthly.length === 0 ? (
            <EmptyState message="Nenhum treinamento concluído no período." />
          ) : (
            <ul className="flex flex-col gap-sm">
              {data.monthly.map((point) => (
                <li key={point.month} className="flex items-center gap-md">
                  <span className="w-20 shrink-0 font-label text-label-sm text-on-surface-variant">{point.month}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-highest">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${(point.trainings / maxMes) * 100}%` }}
                    />
                  </span>
                  <span className="w-32 shrink-0 text-right font-label text-label-sm text-on-surface">
                    {point.trainings} · {formatTrainingHours(point.hours)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>

        <ChartCard title="Treinamentos por setor">
          <DistributionBars slices={toSlices(data.bySector)} emptyMessage="Nenhum treinamento no período." />
        </ChartCard>

        <ChartCard title="Horas por setor">
          <DistributionBars
            slices={toSlices(data.hoursBySector)}
            emptyMessage="Nenhuma hora registrada."
            showShare={false}
          />
        </ChartCard>

        <ChartCard title="Cobertura por setor (%)" subtitle="Quanto do time já fez pelo menos uma ação">
          <DistributionBars
            slices={toSlices(data.coverageBySector)}
            emptyMessage="Sem pessoas ativas para comparar."
            showShare={false}
          />
        </ChartCard>

        <ChartCard title="Instituições mais usadas">
          <DistributionBars slices={toSlices(data.byInstitution)} emptyMessage="Nenhuma instituição informada." />
        </ChartCard>

        <ChartCard title="Tipo de aprendizado">
          <DonutChart slices={toSlices(data.byLearningType)} emptyMessage="Nenhum treinamento no período." />
        </ChartCard>

        <ChartCard title="Origem da demanda">
          <DonutChart
            slices={toSlices(data.byReason).map((slice) => ({
              ...slice,
              label: TRAINING_REASON_LABELS[slice.key as keyof typeof TRAINING_REASON_LABELS] ?? slice.label,
            }))}
            emptyMessage="Nenhum motivo informado."
          />
        </ChartCard>

        <ChartCard title="Situação do SLA">
          <DonutChart slices={toSlices(data.sla)} emptyMessage="Nada a medir no período." />
        </ChartCard>

        <ChartCard title="Participação por liderança">
          <DistributionBars slices={toSlices(data.byLeader)} emptyMessage="Ninguém com líder cadastrado." />
        </ChartCard>

        <ChartCard title="Investimento por setor" subtitle="Em reais, no recorte selecionado">
          <DistributionBars
            slices={toSlices(data.investmentBySector).map((slice) => ({
              ...slice,
              // A barra é desenhada em centavos (a proporção é a mesma) e o
              // rótulo sai em reais — converter antes achataria os valores
              // pequenos por arredondamento.
              label: `${slice.label} · ${formatTrainingMoney(slice.count)}`,
            }))}
            emptyMessage="Nenhum investimento registrado."
            showShare={false}
          />
        </ChartCard>

        <ChartCard title="Participação por categoria de cargo">
          <DistributionBars
            slices={toSlices(data.byPositionCategory)}
            emptyMessage="Ninguém com categoria de cargo cadastrada."
          />
        </ChartCard>

        <ChartCard title="Origem do registro" subtitle="Por qual porta o treinamento entrou">
          <DonutChart slices={toSlices(data.bySource)} emptyMessage="Nenhum treinamento no período." />
        </ChartCard>
      </div>
    </div>
  )
}

/**
 * Correção de um registro pelo T&D.
 *
 * Existe porque a linha migrada do envio de certificado chega sem carga horária
 * (o formulário antigo não perguntava) e porque quem valida é quem percebe o
 * erro de digitação. O `PATCH` é o mesmo do colaborador — o que muda é o poder,
 * que o serviço decide: só daqui sai `participationStatus`, e só daqui se edita
 * um registro já validado.
 */
function EditRecordDialog({ record, onClose }: { record: TrainingRecordDTO; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    courseTitle: record.courseTitle,
    learningType: record.learningType,
    modality: record.modality ?? '',
    institution: record.institution ?? '',
    hours: String(record.hours),
    amount: String(record.investmentCents / 100),
    sponsor: record.sponsor,
    completionDate: record.completionDate ?? '',
    requestDate: record.requestDate,
    participationStatus: record.participationStatus,
    priority: record.priority,
    reasons: record.reasons,
    notes: record.notes ?? '',
  })

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((atual) => ({ ...atual, [key]: value }))
  }

  const salvar = useMutation({
    mutationFn: () =>
      updateTrainingRecord(record.id, {
        courseTitle: form.courseTitle.trim(),
        learningType: form.learningType,
        modality: form.modality || null,
        institution: form.institution.trim() || null,
        hours: Number(form.hours.replace(',', '.')) || 0,
        sponsor: form.sponsor,
        investmentCents:
          form.sponsor === 'EMR' ? Math.round(Number(form.amount.replace(',', '.')) * 100) || 0 : null,
        completionDate: form.completionDate || undefined,
        requestDate: form.requestDate || undefined,
        participationStatus: form.participationStatus,
        priority: form.priority,
        reasons: form.reasons,
        notes: form.notes.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'training'] })
      onClose()
    },
  })

  function alternarMotivo(reason: TrainingReason) {
    set(
      'reasons',
      form.reasons.includes(reason)
        ? form.reasons.filter((atual) => atual !== reason)
        : form.reasons.length >= MAX_TRAINING_REASONS
          ? form.reasons
          : [...form.reasons, reason],
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Editar ${record.courseTitle}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-lg"
    >
      <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
        <header className="mb-md flex items-start justify-between gap-md">
          <div>
            <h3 className="font-headline text-headline-md text-on-surface">Editar registro</h3>
            <p className="font-body text-body-sm text-on-surface-variant">
              {record.userName} · {record.sectorName ?? 'Sem setor'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-on-surface-variant">
            <Icon name="close" className="text-[20px]" />
          </button>
        </header>

        <div className="grid gap-md sm:grid-cols-2">
          <label className="flex flex-col gap-xs sm:col-span-2">
            <span className="font-label text-label-md text-on-surface">Treinamento</span>
            <input className={inputCls} value={form.courseTitle} onChange={(e) => set('courseTitle', e.target.value)} />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Tipo de aprendizado</span>
            <select className={inputCls} value={form.learningType} onChange={(e) => set('learningType', e.target.value)}>
              {TRAINING_LEARNING_TYPES.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {tipo}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Modalidade</span>
            <select className={inputCls} value={form.modality} onChange={(e) => set('modality', e.target.value)}>
              <option value="">Não informada</option>
              {TRAINING_MODALITIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Instituição</span>
            <input className={inputCls} value={form.institution} onChange={(e) => set('institution', e.target.value)} />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Carga horária (horas)</span>
            <input
              className={inputCls}
              type="number"
              min="0"
              step="0.5"
              value={form.hours}
              onChange={(e) => set('hours', e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Quem pagou</span>
            <select
              className={inputCls}
              value={form.sponsor}
              onChange={(e) => set('sponsor', e.target.value as TrainingSponsor)}
            >
              {TRAINING_SPONSORS.map((sponsor) => (
                <option key={sponsor} value={sponsor}>
                  {TRAINING_SPONSOR_LABELS[sponsor]}
                </option>
              ))}
            </select>
          </label>

          {form.sponsor === 'EMR' && (
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">Valor investido (R$)</span>
              <input
                className={inputCls}
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
              />
            </label>
          )}

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Solicitado em</span>
            <input
              className={inputCls}
              type="date"
              value={form.requestDate}
              onChange={(e) => set('requestDate', e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Concluído em</span>
            <input
              className={inputCls}
              type="date"
              value={form.completionDate}
              onChange={(e) => set('completionDate', e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Participação</span>
            <select
              className={inputCls}
              value={form.participationStatus}
              onChange={(e) => set('participationStatus', e.target.value as TrainingParticipationStatus)}
            >
              {TRAINING_PARTICIPATION_STATUS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-md text-on-surface">Prioridade</span>
            <select
              className={inputCls}
              value={form.priority}
              onChange={(e) => set('priority', e.target.value as TrainingPriority)}
            >
              {TRAINING_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-xs sm:col-span-2">
            <legend className="font-label text-label-md text-on-surface">
              Motivo (até {MAX_TRAINING_REASONS})
            </legend>
            <div className="flex flex-wrap gap-sm">
              {TRAINING_REASONS.map((reason) => {
                const marcado = form.reasons.includes(reason)
                return (
                  <label
                    key={reason}
                    className={`flex cursor-pointer items-center gap-xs rounded-full border px-md py-xs font-label text-label-sm ${
                      marcado
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-outline-variant/60 text-on-surface-variant'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={marcado}
                      onChange={() => alternarMotivo(reason)}
                    />
                    {TRAINING_REASON_LABELS[reason]}
                  </label>
                )
              })}
            </div>
          </fieldset>

          <label className="flex flex-col gap-xs sm:col-span-2">
            <span className="font-label text-label-md text-on-surface">Observações</span>
            <textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
        </div>

        {salvar.isError && (
          <p role="alert" className="mt-md rounded-lg bg-error/10 px-md py-sm font-body text-body-sm text-error">
            {errorMessage(salvar.error, 'Não foi possível salvar.')}
          </p>
        )}

        <footer className="mt-lg flex flex-wrap gap-sm">
          <button
            type="button"
            disabled={salvar.isPending || !form.courseTitle.trim()}
            onClick={() => salvar.mutate()}
            className="rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-outline-variant px-lg py-sm font-label text-label-md text-on-surface"
          >
            Cancelar
          </button>
        </footer>
      </div>
    </div>
  )
}

function ReviewActions({ record, onEdit }: { record: TrainingRecordDTO; onEdit: () => void }) {
  const queryClient = useQueryClient()
  const [recusando, setRecusando] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [motivo, setMotivo] = useState('')

  // Exclusão é lógica no servidor: a linha sai das telas e o histórico de
  // auditoria continua fazendo sentido.
  const excluir = useMutation({
    mutationFn: () => deleteTrainingRecord(record.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'training'] }),
  })

  const avaliar = useMutation({
    mutationFn: (body: { status: 'APPROVED' | 'REJECTED'; rejectionReason?: string }) =>
      reviewTrainingRecord(record.id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'training'] })
      setRecusando(false)
      setMotivo('')
    },
  })

  if (recusando) {
    return (
      <div className="flex flex-col gap-xs">
        <input
          className={inputCls}
          placeholder="Motivo da recusa"
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
        />
        <div className="flex gap-sm">
          <button
            type="button"
            disabled={!motivo.trim() || avaliar.isPending}
            onClick={() => avaliar.mutate({ status: 'REJECTED', rejectionReason: motivo.trim() })}
            className="font-label text-label-md text-error disabled:opacity-50"
          >
            Recusar
          </button>
          <button type="button" onClick={() => setRecusando(false)} className="font-label text-label-md">
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-sm">
      {record.validationStatus !== 'APPROVED' && (
        <button
          type="button"
          disabled={avaliar.isPending}
          onClick={() => avaliar.mutate({ status: 'APPROVED' })}
          className="font-label text-label-md text-primary disabled:opacity-50"
        >
          Validar
        </button>
      )}
      {record.validationStatus !== 'REJECTED' && (
        <button type="button" onClick={() => setRecusando(true)} className="font-label text-label-md text-error">
          Recusar
        </button>
      )}
      <button type="button" onClick={onEdit} className="font-label text-label-md text-on-surface">
        Editar
      </button>
      {confirmandoExclusao ? (
        <span className="flex items-center gap-sm font-body text-body-sm text-on-surface-variant">
          Excluir?
          <button
            type="button"
            disabled={excluir.isPending}
            onClick={() => excluir.mutate()}
            className="font-label text-label-md text-error disabled:opacity-50"
          >
            Sim
          </button>
          <button
            type="button"
            onClick={() => setConfirmandoExclusao(false)}
            className="font-label text-label-md"
          >
            Não
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmandoExclusao(true)}
          className="font-label text-label-md text-on-surface-variant"
        >
          Excluir
        </button>
      )}
      {avaliar.isError && (
        <span role="alert" className="font-body text-body-sm text-error">
          {errorMessage(avaliar.error, 'Não foi possível avaliar.')}
        </span>
      )}
    </div>
  )
}

function CentralTab({ filters, onChange }: { filters: TrainingFilters; onChange: (f: TrainingFilters) => void }) {
  const [page, setPage] = useState(1)
  const [editando, setEditando] = useState<TrainingRecordDTO | null>(null)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'training', 'records', filters, page],
    queryFn: () => fetchTrainingRecords(filters, page),
  })
  const { data: options } = useQuery({
    queryKey: ['admin', 'training', 'filters'],
    queryFn: fetchTrainingFilterOptions,
  })

  const [slaInput, setSlaInput] = useState('')
  const slaAtual = options?.slaDays
  const salvarSla = useMutation({
    mutationFn: (days: number) => updateTrainingSla(days),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'training'] })
      setSlaInput('')
    },
  })

  const records = data?.records ?? []

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-end justify-between gap-md">
        <div className="flex flex-wrap items-center gap-md">
          <span className="font-body text-body-sm text-on-surface-variant">
            {data?.total ?? 0} registro(s) · {data?.pending ?? 0} aguardando validação
          </span>
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Situação</span>
            <select
              className={inputCls}
              value={filters.validationStatus ?? ''}
              onChange={(event) => {
                setPage(1)
                onChange({ ...filters, validationStatus: event.target.value || undefined })
              }}
            >
              <option value="">Todas</option>
              {TRAINING_VALIDATION_STATUS.map((status) => (
                <option key={status} value={status}>
                  {TRAINING_VALIDATION_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              Participação
            </span>
            <select
              className={inputCls}
              value={filters.participationStatus ?? ''}
              onChange={(event) => {
                setPage(1)
                onChange({ ...filters, participationStatus: event.target.value || undefined })
              }}
            >
              <option value="">Todas</option>
              {TRAINING_PARTICIPATION_STATUS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-md">
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              SLA da empresa (dias)
            </span>
            <span className="flex items-center gap-sm">
              <input
                className={`${inputCls} w-24`}
                type="number"
                min={TRAINING_MIN_SLA_DAYS}
                max={TRAINING_MAX_SLA_DAYS}
                placeholder={slaAtual ? String(slaAtual) : ''}
                value={slaInput}
                onChange={(event) => setSlaInput(event.target.value)}
              />
              <button
                type="button"
                disabled={!slaInput || salvarSla.isPending}
                onClick={() => salvarSla.mutate(Number(slaInput))}
                className="font-label text-label-md text-primary disabled:opacity-50"
              >
                Salvar
              </button>
            </span>
          </label>
          <DownloadCsvButton
            fetcher={() => downloadTrainingCsv(filters)}
            fallbackName="treinamentos.csv"
            label="Baixar CSV"
          />
        </div>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}

      {!isLoading && records.length === 0 && <EmptyState message="Nenhum treinamento neste recorte." />}

      {records.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-outline-variant/40">
          <table className="w-full min-w-[64rem] border-collapse text-left">
            <thead className="bg-surface-container-high">
              <tr className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
                <th className="px-md py-sm">Pessoa</th>
                <th className="px-md py-sm">Treinamento</th>
                <th className="px-md py-sm">Conclusão</th>
                <th className="px-md py-sm">Horas</th>
                <th className="px-md py-sm">Investimento</th>
                <th className="px-md py-sm">SLA</th>
                <th className="px-md py-sm">Situação</th>
                <th className="px-md py-sm">Ações</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-t border-outline-variant/20 align-top text-body-sm">
                  <td className="px-md py-sm">
                    <span className="block text-on-surface">{record.userName}</span>
                    <span className="block text-on-surface-variant">{record.sectorName ?? 'Sem setor'}</span>
                  </td>
                  <td className="px-md py-sm">
                    <span className="block text-on-surface">{record.courseTitle}</span>
                    <span className="block text-on-surface-variant">
                      {record.institution ?? '—'} · {record.learningType} · {record.source}
                    </span>
                    {record.certificateUrl && (
                      <a
                        href={record.certificateUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-xs font-label text-label-sm text-primary"
                      >
                        <Icon name="description" className="text-[16px]" /> Comprovante
                      </a>
                    )}
                  </td>
                  <td className="px-md py-sm text-on-surface">{formatDate(record.completionDate)}</td>
                  <td className="px-md py-sm text-on-surface">{formatTrainingHours(record.hours)}</td>
                  <td className="px-md py-sm text-on-surface">{formatTrainingMoney(record.investmentCents)}</td>
                  <td className="px-md py-sm text-on-surface">
                    {record.slaStatus}
                    {record.slaDays != null && (
                      <span className="block text-on-surface-variant">{record.slaDays} dias</span>
                    )}
                  </td>
                  <td className="px-md py-sm text-on-surface">
                    {TRAINING_VALIDATION_STATUS_LABELS[record.validationStatus]}
                    {record.rejectionReason && (
                      <span className="block text-on-surface-variant">{record.rejectionReason}</span>
                    )}
                  </td>
                  <td className="px-md py-sm">
                    <ReviewActions record={record} onEdit={() => setEditando(record)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && <EditRecordDialog record={editando} onClose={() => setEditando(null)} />}

      {(data?.pageCount ?? 1) > 1 && (
        <nav className="flex items-center justify-center gap-md" aria-label="Paginação dos treinamentos">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
            className="font-label text-label-md text-primary disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="font-body text-body-sm text-on-surface-variant">
            Página {data?.page} de {data?.pageCount}
          </span>
          <button
            type="button"
            disabled={page >= (data?.pageCount ?? 1)}
            onClick={() => setPage((current) => current + 1)}
            className="font-label text-label-md text-primary disabled:opacity-40"
          >
            Próxima
          </button>
        </nav>
      )}
    </div>
  )
}

/**
 * Administração › Gente e Gestão › Treinamentos.
 *
 * Duas abas: o Painel (indicadores do que foi validado) e a Central (a fila de
 * validação e a tabela completa, com CSV). Os filtros são os MESMOS nas duas —
 * é o que permite olhar um número no painel e ir ver as linhas por trás dele
 * sem remontar o recorte.
 */
export function TrainingSection() {
  const [active, setActive] = useState<TabKey>('painel')
  const [filters, setFilters] = useState<TrainingFilters>({})
  const filtrosAtivos = useMemo(() => Object.values(filters).filter(Boolean).length, [filters])

  return (
    <section className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-lg text-on-surface">Treinamentos</h2>
        <p className="mt-xs font-body text-body-md text-on-surface-variant">
          Desenvolvimento de quem trabalha aqui: horas, investimento, cobertura e prazo de atendimento.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Seções de treinamentos"
        className="flex flex-wrap gap-lg border-b border-outline-variant/40"
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={tab.key === active}
            onClick={() => setActive(tab.key)}
            className={`-mb-px whitespace-nowrap border-b-2 pb-sm font-label text-label-md transition-colors ${
              tab.key === active
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <FiltersBar filters={filters} onChange={setFilters} />
      {filtrosAtivos > 0 && (
        <p className="font-body text-body-sm text-on-surface-variant">
          {filtrosAtivos} filtro(s) aplicado(s) — painel e Central mostram o mesmo recorte.
        </p>
      )}

      {active === 'painel' && <DashboardTab filters={filters} />}
      {active === 'central' && <CentralTab filters={filters} onChange={setFilters} />}
    </section>
  )
}
