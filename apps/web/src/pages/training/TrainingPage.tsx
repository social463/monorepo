import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  TRAINING_REASON_LABELS,
  TRAINING_SPONSOR_LABELS,
  TRAINING_VALIDATION_STATUS_LABELS,
  formatTrainingHours,
  formatTrainingMoney,
  type TrainingRecordDTO,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { deleteTrainingRecord, fetchMyTraining } from '../../lib/training-api'
import { TrainingRecordForm } from './TrainingRecordForm'

const TABS = [
  { key: 'meus', label: 'Meus treinamentos' },
  { key: 'registrar', label: 'Registrar treinamento' },
] as const

type TabKey = (typeof TABS)[number]['key']

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value)
}

function statusCls(status: TrainingRecordDTO['validationStatus']): string {
  if (status === 'APPROVED') return 'bg-primary/15 text-primary'
  if (status === 'REJECTED') return 'bg-error/10 text-error'
  return 'bg-surface-container-highest text-on-surface-variant'
}

function formatDate(ymd: string | null): string {
  if (!ymd) return '—'
  const [year, month, day] = ymd.split('-')
  return `${day}/${month}/${year}`
}

function RecordCard({ record, onEdit }: { record: TrainingRecordDTO; onEdit: () => void }) {
  const queryClient = useQueryClient()
  const [confirmando, setConfirmando] = useState(false)

  const excluir = useMutation({
    mutationFn: () => deleteTrainingRecord(record.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['training', 'me'] }),
  })

  // Validado sai do alcance do dono: o número já entrou no indicador, e
  // deixá-lo mudar por baixo reescreveria o painel do mês passado.
  const editavel = record.validationStatus !== 'APPROVED'

  return (
    <article className="flex flex-col gap-sm rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <header className="flex flex-wrap items-start justify-between gap-sm">
        <div>
          <h3 className="font-headline text-headline-md text-on-surface">{record.courseTitle}</h3>
          <p className="font-body text-body-sm text-on-surface-variant">
            {record.institution ?? 'Sem instituição'} · {record.learningType}
            {record.modality ? ` · ${record.modality}` : ''}
          </p>
        </div>
        <span className={`rounded-full px-md py-xs font-label text-label-sm ${statusCls(record.validationStatus)}`}>
          {TRAINING_VALIDATION_STATUS_LABELS[record.validationStatus]}
        </span>
      </header>

      <dl className="grid gap-sm text-body-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="font-label text-label-sm uppercase text-on-surface-variant">Concluído em</dt>
          <dd className="text-on-surface">{formatDate(record.completionDate)}</dd>
        </div>
        <div>
          <dt className="font-label text-label-sm uppercase text-on-surface-variant">Carga horária</dt>
          <dd className="text-on-surface">{formatTrainingHours(record.hours)}</dd>
        </div>
        <div>
          <dt className="font-label text-label-sm uppercase text-on-surface-variant">Investimento</dt>
          <dd className="text-on-surface">
            {TRAINING_SPONSOR_LABELS[record.sponsor]}
            {record.investmentCents > 0 ? ` · ${formatTrainingMoney(record.investmentCents)}` : ''}
          </dd>
        </div>
        <div>
          <dt className="font-label text-label-sm uppercase text-on-surface-variant">Motivo</dt>
          <dd className="text-on-surface">
            {record.reasons.map((reason) => TRAINING_REASON_LABELS[reason]).join(', ') || '—'}
          </dd>
        </div>
      </dl>

      {record.validationStatus === 'REJECTED' && record.rejectionReason && (
        <p role="alert" className="rounded-lg bg-error/10 px-md py-sm font-body text-body-sm text-error">
          A G&amp;G pediu ajuste: {record.rejectionReason}
        </p>
      )}

      <footer className="flex flex-wrap items-center gap-md">
        {record.certificateUrl && (
          <a
            href={record.certificateUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-xs font-label text-label-md text-primary"
          >
            <Icon name="description" className="text-[18px]" /> Ver comprovante
          </a>
        )}
        {editavel && (
          <button type="button" onClick={onEdit} className="font-label text-label-md text-primary">
            Editar
          </button>
        )}
        {editavel &&
          (confirmando ? (
            <span className="flex items-center gap-sm font-body text-body-sm text-on-surface-variant">
              Excluir mesmo?
              <button
                type="button"
                onClick={() => excluir.mutate()}
                disabled={excluir.isPending}
                className="font-label text-label-md text-error"
              >
                Excluir
              </button>
              <button type="button" onClick={() => setConfirmando(false)} className="font-label text-label-md">
                Manter
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className="font-label text-label-md text-on-surface-variant"
            >
              Excluir
            </button>
          ))}
      </footer>
    </article>
  )
}

/**
 * Meus treinamentos.
 *
 * Substitui "Envie seu Certificado": é a mesma porta, agora registrando o
 * treinamento inteiro (carga horária, instituição, conclusão) em vez de só o
 * anexo — ver `docs/superpowers/specs/2026-09-12-modulo-de-treinamentos-td-design.md`.
 */
export function TrainingPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('aba')
  const active: TabKey = isTabKey(requested) ? requested : 'meus'
  const [editing, setEditing] = useState<TrainingRecordDTO | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['training', 'me'], queryFn: fetchMyTraining })
  const records = data?.records ?? []

  function selectTab(key: TabKey) {
    const next = new URLSearchParams(searchParams)
    next.set('aba', key)
    setSearchParams(next, { replace: true })
    setEditing(null)
  }

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header className="flex flex-col justify-between gap-md md:flex-row md:items-end">
        <div>
          <h1 className="font-headline text-headline-lg text-on-surface md:text-headline-xl">Meus treinamentos</h1>
          <p className="mt-xs text-body-md text-on-surface-variant">
            Cursos, workshops e capacitações que você fez — dentro ou fora da empresa.
          </p>
        </div>
        <dl className="flex gap-lg">
          <div>
            <dt className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Horas no ano</dt>
            <dd className="font-headline text-headline-lg text-primary">
              {formatTrainingHours(data?.yearHours ?? 0)}
            </dd>
          </div>
          <div>
            <dt className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Validados</dt>
            <dd className="font-headline text-headline-lg text-on-surface">{data?.yearTrainings ?? 0}</dd>
          </div>
        </dl>
      </header>

      <div
        role="tablist"
        aria-label="Seções dos treinamentos"
        className="flex flex-wrap gap-lg border-b border-outline-variant/40"
      >
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

      {active === 'registrar' && <TrainingRecordForm onDone={() => selectTab('meus')} />}

      {active === 'meus' && editing && (
        <TrainingRecordForm record={editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
      )}

      {active === 'meus' && !editing && (
        <div className="flex flex-col gap-md">
          {isLoading && <Skeleton className="h-40 w-full" />}
          {!isLoading && records.length === 0 && (
            <p className="rounded-xl border border-dashed border-outline-variant/50 p-xl text-center font-body text-body-md text-on-surface-variant">
              Você ainda não registrou nenhum treinamento. Use a aba "Registrar treinamento".
            </p>
          )}
          {records.map((record) => (
            <RecordCard key={record.id} record={record} onEdit={() => setEditing(record)} />
          ))}
        </div>
      )}
    </section>
  )
}
