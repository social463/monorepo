import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isSectorAdminOnly } from '@legends/shared'
import type { HighlightDTO, SectorDTO, VotingPeriodDTO } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { Panel, inputCls } from './shared'
import { useAuth } from '../../auth/AuthContext'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toDateTimeLocalValue(value: string): string {
  const date = new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// ----- Destaque do mês (geração, edição e publicação) -----
function HighlightAdmin({ period }: { period: VotingPeriodDTO }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [highlightMonthRef, setHighlightMonthRef] = useState(period.monthRef)
  const [error, setError] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['highlight', period.id],
    queryFn: () => apiFetch<{ highlight: HighlightDTO }>(`/admin/periods/${period.id}/highlight`),
    enabled: period.state === 'ENDED',
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['highlight', period.id] })
    qc.invalidateQueries({ queryKey: ['admin-highlights'] })
  }

  useEffect(() => {
    if (!data?.highlight) return
    setText(data.highlight.text ?? '')
    setHighlightMonthRef(data.highlight.highlightMonthRef ?? data.highlight.monthRef)
  }, [data?.highlight])

  const generate = useMutation({
    mutationFn: () =>
      apiFetch<{ highlight: HighlightDTO }>(`/admin/periods/${period.id}/highlight`, { method: 'POST' }),
    onSuccess: (res) => {
      setText(res.highlight.text ?? '')
      setError(null)
      qc.setQueryData(['highlight', period.id], res)
      invalidate()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao gerar destaque.'),
  })
  const saveText = useMutation({
    mutationFn: () =>
      apiFetch<{ highlight: HighlightDTO }>(`/admin/periods/${period.id}/highlight`, {
        method: 'PATCH',
        body: JSON.stringify({ text, highlightMonthRef }),
      }),
    onSuccess: (res) => {
      qc.setQueryData(['highlight', period.id], res)
      invalidate()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao salvar texto.'),
  })
  const generateImage = useMutation({
    mutationFn: () =>
      apiFetch<{ highlight: HighlightDTO }>(`/admin/periods/${period.id}/highlight/image`, { method: 'POST' }),
    onSuccess: (res) => {
      setError(null)
      qc.setQueryData(['highlight', period.id], res)
      invalidate()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao gerar imagem.'),
  })
  const publish = useMutation({
    mutationFn: () =>
      apiFetch<{ highlight: HighlightDTO }>(`/admin/periods/${period.id}/highlight/publish`, { method: 'POST' }),
    onSuccess: (res) => {
      setError(null)
      qc.setQueryData(['highlight', period.id], res)
      invalidate()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao publicar destaque.'),
  })

  const highlight = data?.highlight
  const status = highlight?.status ?? 'NONE'

  useEffect(() => {
    if (highlight?.text != null) setText(highlight.text)
  }, [highlight?.text])

  if (period.state !== 'ENDED') return null

  return (
    <div className="mt-sm rounded-lg border border-outline-variant/30 bg-surface-container p-md">
      <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Destaque do mês</p>
      {error && (
        <p role="alert" className="mt-xs flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}
      {status === 'PUBLISHED' ? (
        <div className="mt-xs flex flex-wrap items-center gap-sm text-body-sm text-on-surface">
          <span>
            Publicado <Icon name="check_circle" className="inline text-[16px] text-primary" />
          </span>
          {highlight?.imageUrl && (
            <a
              href={highlight.imageUrl}
              download={`destaque-${period.monthRef}.png`}
              className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
            >
              Baixar imagem
            </a>
          )}
        </div>
      ) : status === 'DRAFT' ? (
        <div className="mt-sm space-y-sm">
          <textarea
            className="w-full rounded-md border border-outline-variant/40 bg-surface-container-highest px-3 py-2 text-body-sm text-on-surface outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/30"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <label className="flex max-w-xs flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Mês de referência do destaque
            <input
              className={inputCls}
              type="month"
              value={highlightMonthRef}
              onChange={(e) => setHighlightMonthRef(e.target.value)}
              aria-label="Mês de referência do destaque"
            />
          </label>
          {highlight?.imageUrl && (
            <div className="overflow-hidden rounded-md border border-outline-variant/30 bg-surface-container-low">
              <img
                src={highlight.imageUrl}
                alt={`Imagem do destaque de ${highlight.highlightMonthRef ?? period.monthRef}`}
                className="block w-full max-w-xl object-contain"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-sm">
            <button
              className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
              onClick={() => saveText.mutate()}
              disabled={saveText.isPending}
            >
              {saveText.isPending ? 'Salvando…' : 'Salvar texto'}
            </button>
            <button
              className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
              onClick={() => generateImage.mutate()}
              disabled={generateImage.isPending}
            >
              {generateImage.isPending ? 'Gerando imagem…' : highlight?.imageUrl ? 'Gerar nova imagem' : 'Gerar imagem'}
            </button>
            {highlight?.imageUrl && (
              <a
                href={highlight.imageUrl}
                download={`destaque-${period.monthRef}.png`}
                className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
              >
                Baixar imagem
              </a>
            )}
            <button
              className="rounded-md bg-primary px-md py-1 font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
              onClick={() => publish.mutate()}
              disabled={publish.isPending || !highlight?.imageUrl}
            >
              {publish.isPending ? 'Publicando…' : 'Publicar'}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="mt-sm rounded-md bg-primary px-md py-1 font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
        >
          {generate.isPending ? 'Gerando…' : 'Gerar destaque'}
        </button>
      )}
    </div>
  )
}

// ----- Linha de período, com edição inline da janela -----
function PeriodRow({
  period,
  fmtRange,
  closeLabel,
  onClose,
  onSave,
}: {
  period: VotingPeriodDTO
  fmtRange: (startsAt: string, endsAt: string) => string
  closeLabel?: string
  onClose?: (id: string) => void
  onSave: (id: string, startsAt: string, endsAt: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [startsAt, setStartsAt] = useState(() => toDateTimeLocalValue(period.startsAt))
  const [endsAt, setEndsAt] = useState(() => toDateTimeLocalValue(period.endsAt))

  if (editing) {
    return (
      <li className="flex flex-col gap-sm rounded-lg border border-primary/40 bg-surface-container-low p-md">
        <span className="font-label text-label-sm text-on-surface-variant">Editando {period.monthRef}</span>
        <div className="grid gap-sm sm:grid-cols-2">
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Início
            <input className={inputCls} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} aria-label={`Início do período ${period.monthRef}`} />
          </label>
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Fim
            <input className={inputCls} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} aria-label={`Fim do período ${period.monthRef}`} />
          </label>
        </div>
        <div className="flex gap-sm">
          <button
            onClick={() => {
              onSave(period.id, startsAt, endsAt)
              setEditing(false)
            }}
            className="rounded-md bg-primary px-md py-1 font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
          >
            Salvar
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:text-on-surface"
          >
            Cancelar edição
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="flex flex-col gap-0 rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <div className="flex items-center justify-between gap-md">
        <span className="text-on-surface">
          <span className="font-label text-primary">{period.monthRef}</span>
          <span className="ml-2 font-label text-label-sm text-on-surface-variant">{fmtRange(period.startsAt, period.endsAt)}</span>
        </span>
        <div className="flex shrink-0 gap-sm">
          {period.editable && (
            <button
              onClick={() => setEditing(true)}
              aria-label={`Editar período ${period.monthRef}`}
              className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
            >
              Editar
            </button>
          )}
          {closeLabel && onClose && (
            <button
              onClick={() => onClose(period.id)}
              className={[
                'rounded-md border px-3 py-1 font-label text-label-sm transition-colors',
                closeLabel === 'Cancelar'
                  ? 'border-error/40 text-error hover:border-error'
                  : 'border-outline-variant/60 text-on-surface-variant hover:border-primary hover:text-primary',
              ].join(' ')}
            >
              {closeLabel}
            </button>
          )}
        </div>
      </div>
      <HighlightAdmin period={period} />
    </li>
  )
}

// ----- Grupo de períodos por estado (Em andamento / Agendados / Encerrados) -----
function PeriodGroup({
  title,
  periods,
  fmtRange,
  closeLabel,
  onClose,
  onSave,
}: {
  title: string
  periods: VotingPeriodDTO[]
  fmtRange: (startsAt: string, endsAt: string) => string
  closeLabel?: string
  onClose?: (id: string) => void
  onSave: (id: string, startsAt: string, endsAt: string) => void
}) {
  if (periods.length === 0) return null
  return (
    <div className="mb-md">
      <p className="mb-sm font-label text-label-sm uppercase tracking-wide text-on-surface-variant">{title}</p>
      <ul className="flex flex-col gap-2">
        {periods.map((p) => (
          <PeriodRow key={p.id} period={p} fmtRange={fmtRange} closeLabel={closeLabel} onClose={onClose} onSave={onSave} />
        ))}
      </ul>
    </div>
  )
}

export function PeriodsSection() {
  const { user } = useAuth()
  const isSubadmin = isSectorAdminOnly(user)
  const queryClient = useQueryClient()
  const emptyPeriod = { monthRef: '', startsAt: '', endsAt: '', sectorId: '' }
  const [periodForm, setPeriodForm] = useState(emptyPeriod)
  const [periodError, setPeriodError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [selectedSectorId, setSelectedSectorId] = useState('')

  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })
  const sectors = sectorsQuery.data?.sectors ?? []
  const sectorOptions = sectors.map((s) => ({ value: s.id, label: s.name }))
  const periodsQuery = useQuery({
    queryKey: ['admin', 'periods', selectedSectorId],
    queryFn: () =>
      apiFetch<{ periods: VotingPeriodDTO[] }>(
        selectedSectorId ? `/admin/periods?sectorId=${selectedSectorId}` : '/admin/periods',
      ),
  })
  const invalidatePeriods = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'periods'] })
    queryClient.invalidateQueries({ queryKey: ['period'] })
  }
  const schedulePeriod = useMutation({
    mutationFn: (body: { monthRef: string; startsAt: string; endsAt: string; sectorId?: string }) =>
      apiFetch<{ period: VotingPeriodDTO }>('/admin/periods', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setPeriodForm(emptyPeriod)
      setPeriodError(null)
      setShowForm(false)
      invalidatePeriods()
    },
    onError: (err) => setPeriodError(err instanceof ApiError ? err.message : 'Erro ao agendar período.'),
  })
  const closePeriod = useMutation({
    mutationFn: (id: string) => apiFetch<{ period: VotingPeriodDTO }>(`/admin/periods/${id}/close`, { method: 'POST' }),
    onSuccess: invalidatePeriods,
  })
  const updatePeriod = useMutation({
    mutationFn: (vars: { id: string; startsAt: string; endsAt: string }) =>
      apiFetch<{ period: VotingPeriodDTO }>(`/admin/periods/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ startsAt: vars.startsAt, endsAt: vars.endsAt }),
      }),
    onSuccess: () => {
      setPeriodError(null)
      invalidatePeriods()
    },
    onError: (err) => setPeriodError(err instanceof ApiError ? err.message : 'Erro ao editar período.'),
  })

  const periods = periodsQuery.data?.periods ?? []
  const activePeriods = periods.filter((p) => p.state === 'ACTIVE')
  const scheduledPeriods = periods.filter((p) => p.state === 'SCHEDULED')
  const endedPeriods = periods.filter((p) => p.state === 'ENDED')

  function handleMonthChange(monthRef: string) {
    if (!monthRef) {
      setPeriodForm({ ...periodForm, monthRef })
      return
    }
    const [year, month] = monthRef.split('-').map(Number)
    const lastDay = new Date(year, month, 0).getDate()
    setPeriodForm({
      ...periodForm,
      monthRef,
      startsAt: `${monthRef}-01T00:00`,
      endsAt: `${year}-${pad(month)}-${pad(lastDay)}T23:59`,
    })
  }

  function handleSchedulePeriod(event: FormEvent) {
    event.preventDefault()
    if (!periodForm.monthRef || !periodForm.startsAt || !periodForm.endsAt) {
      setPeriodError('Escolha o mês e as datas de início e fim.')
      return
    }
    setPeriodError(null)
    schedulePeriod.mutate({
      monthRef: periodForm.monthRef,
      startsAt: periodForm.startsAt,
      endsAt: periodForm.endsAt,
      sectorId: periodForm.sectorId || undefined,
    })
  }

  const fmtRange = (startsAt: string, endsAt: string) =>
    `${new Date(startsAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} – ${new Date(endsAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`

  return (
    <Panel
      title="Período de votação"
      action={
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {showForm ? 'Cancelar' : '+ Agendar período'}
        </button>
      }
    >
      {showForm && (
      <form onSubmit={handleSchedulePeriod} className="mb-lg flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
        <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Agendar período</p>
        <div className="grid gap-sm sm:grid-cols-3">
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Mês do destaque
            <input className={inputCls} type="month" value={periodForm.monthRef} onChange={(e) => handleMonthChange(e.target.value)} aria-label="Mês do destaque" />
          </label>
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Início da votação
            <input className={inputCls} type="datetime-local" value={periodForm.startsAt} onChange={(e) => setPeriodForm({ ...periodForm, startsAt: e.target.value })} aria-label="Início da votação" />
          </label>
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Fim da votação
            <input className={inputCls} type="datetime-local" value={periodForm.endsAt} onChange={(e) => setPeriodForm({ ...periodForm, endsAt: e.target.value })} aria-label="Fim da votação" />
          </label>
          {!isSubadmin && (
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Setor
            <Select
              ariaLabel="Setor do período"
              value={periodForm.sectorId}
              onChange={(value) => setPeriodForm({ ...periodForm, sectorId: value })}
              options={[{ value: '', label: '—' }, ...sectorOptions]}
            />
          </label>
          )}
        </div>
        {periodError && (
          <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
            <Icon name="error" className="text-[16px]" />
            {periodError}
          </p>
        )}
        <div>
          <button type="submit" disabled={schedulePeriod.isPending} className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant">
            {schedulePeriod.isPending ? 'Agendando…' : 'Agendar período'}
          </button>
        </div>
      </form>
      )}

      {!isSubadmin && (
      <label className="mb-md flex max-w-xs flex-col gap-1 font-label text-label-sm text-on-surface-variant">
        Filtrar por setor
        <Select
          ariaLabel="Filtrar períodos por setor"
          value={selectedSectorId}
          onChange={setSelectedSectorId}
          options={[{ value: '', label: 'Todos os setores' }, ...sectorOptions]}
          searchable={sectors.length > 6}
        />
      </label>
      )}

      <PeriodGroup
        title="Em andamento"
        periods={activePeriods}
        fmtRange={fmtRange}
        closeLabel="Fechar"
        onClose={(id) => closePeriod.mutate(id)}
        onSave={(id, startsAt, endsAt) => updatePeriod.mutate({ id, startsAt, endsAt })}
      />
      <PeriodGroup
        title="Agendados"
        periods={scheduledPeriods}
        fmtRange={fmtRange}
        closeLabel="Cancelar"
        onClose={(id) => closePeriod.mutate(id)}
        onSave={(id, startsAt, endsAt) => updatePeriod.mutate({ id, startsAt, endsAt })}
      />
      <PeriodGroup
        title="Encerrados"
        periods={endedPeriods}
        fmtRange={fmtRange}
        onSave={(id, startsAt, endsAt) => updatePeriod.mutate({ id, startsAt, endsAt })}
      />

      {periods.length === 0 && !periodsQuery.isLoading && (
        <p className="text-body-sm text-on-surface-variant">Nenhum período cadastrado ainda.</p>
      )}
    </Panel>
  )
}
