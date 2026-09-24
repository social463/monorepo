import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  OKR_CYCLE_STATUSES,
  OKR_DEFAULT_DECIMALS,
  OKR_DEFAULT_PROGRESS_RANGES,
  okrProgressRangesError,
  type CreateOkrCycleRequest,
  type OkrCycleDTO,
  type OkrCycleStatus,
  type OkrProgressRange,
  type UpdateOkrCycleRequest,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { createOkrCycle, listOkrCycles, updateOkrCycle } from '../../lib/okr-api'
import { Panel, errorMessage, inputCls } from './shared'

// A MESMA chave da tela de metas: ciclo criado aqui já aparece lá, sem recarregar.
const QUERY_KEY = ['okr', 'cycles']

const STATUS_LABELS: Record<OkrCycleStatus, string> = {
  DRAFT: 'Rascunho',
  OPEN: 'Aberto',
  CLOSED: 'Encerrado',
}

const STATUS_OPTIONS = OKR_CYCLE_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))

/** `YYYY-MM-DD` → `DD/MM/AAAA`, sem passar por `Date` (que puxaria o dia pro fuso). */
function formatDay(ymd: string | null): string {
  if (!ymd) return '—'
  const [year, month, day] = ymd.split('-')
  return day && month && year ? `${day}/${month}/${year}` : ymd
}

interface CycleForm {
  name: string
  description: string
  status: OkrCycleStatus
  startDate: string
  finishDate: string
  forceCommentOnCheckIn: boolean
  updateWindowStart: string
  updateWindowFinish: string
  progressRanges: OkrProgressRange[]
  decimals: { percentage: number; numeric: number; currency: number }
}

function emptyForm(): CycleForm {
  return {
    name: '',
    description: '',
    status: 'DRAFT',
    startDate: '',
    finishDate: '',
    forceCommentOnCheckIn: false,
    updateWindowStart: '',
    updateWindowFinish: '',
    progressRanges: OKR_DEFAULT_PROGRESS_RANGES.map((range) => ({ ...range })),
    decimals: { ...OKR_DEFAULT_DECIMALS },
  }
}

function formOf(cycle: OkrCycleDTO): CycleForm {
  return {
    name: cycle.name,
    description: cycle.description ?? '',
    status: cycle.status,
    startDate: cycle.startDate,
    finishDate: cycle.finishDate,
    forceCommentOnCheckIn: cycle.forceCommentOnCheckIn,
    updateWindowStart: cycle.updateWindowStart ?? '',
    updateWindowFinish: cycle.updateWindowFinish ?? '',
    progressRanges: cycle.progressRanges.map((range) => ({ ...range })),
    decimals: { ...cycle.decimals },
  }
}

function payloadOf(form: CycleForm): CreateOkrCycleRequest {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    status: form.status,
    startDate: form.startDate,
    finishDate: form.finishDate,
    forceCommentOnCheckIn: form.forceCommentOnCheckIn,
    updateWindowStart: form.updateWindowStart || null,
    updateWindowFinish: form.updateWindowFinish || null,
    progressRanges: form.progressRanges,
    decimals: form.decimals,
  }
}

/**
 * Só o que mudou: o PATCH do ciclo trata campo ausente como "não mexa", e
 * mandar o payload inteiro faria uma edição de nome reescrever semáforo e
 * casas decimais — inclusive por cima do que outra pessoa acabou de salvar.
 */
function diffOf(cycle: OkrCycleDTO, form: CycleForm): UpdateOkrCycleRequest {
  const next = payloadOf(form)
  const current = payloadOf(formOf(cycle))
  const patch: UpdateOkrCycleRequest = {}
  for (const key of Object.keys(next) as (keyof CreateOkrCycleRequest)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(current[key])) {
      Object.assign(patch, { [key]: next[key] })
    }
  }
  return patch
}

/**
 * Administração dos ciclos de metas (Administração › Metas e OKRs). Ciclo é o
 * recipiente de objetivos e KRs: nome, janela de vigência, semáforo e as casas
 * decimais que toda a área usa para exibir valor.
 */
export function OkrCyclesSection() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<OkrCycleDTO | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cyclesQuery = useQuery({ queryKey: QUERY_KEY, queryFn: listOkrCycles })
  const cycles = cyclesQuery.data?.cycles ?? []

  const save = useMutation({
    mutationFn: (vars: { cycle: OkrCycleDTO | 'new'; form: CycleForm }) =>
      vars.cycle === 'new'
        ? createOkrCycle(payloadOf(vars.form))
        : updateOkrCycle(vars.cycle.id, diffOf(vars.cycle, vars.form)),
    onSuccess: () => {
      setEditing(null)
      setError(null)
      void qc.invalidateQueries({ queryKey: ['okr'] })
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível salvar o ciclo.')),
  })

  function handleSubmit(form: CycleForm) {
    if (!editing) return
    if (!form.name.trim()) {
      setError('Informe o nome do ciclo.')
      return
    }
    if (!form.startDate || !form.finishDate) {
      setError('Informe as datas de início e fim do ciclo.')
      return
    }
    if (form.startDate > form.finishDate) {
      setError('O ciclo precisa começar antes de terminar.')
      return
    }
    const rangesError = okrProgressRangesError(form.progressRanges)
    if (rangesError) {
      setError(rangesError)
      return
    }
    setError(null)
    save.mutate({ cycle: editing, form })
  }

  return (
    <Panel
      title="Ciclos de metas"
      action={
        <button
          type="button"
          onClick={() => {
            setError(null)
            setEditing('new')
          }}
          className="inline-flex items-center gap-sm rounded-md bg-primary px-lg py-2 font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
        >
          <Icon name="add" className="text-[18px]" />
          Novo ciclo
        </button>
      }
    >
      <p className="mb-lg text-body-sm text-on-surface-variant">
        O ciclo é o recipiente dos objetivos e resultados-chave: define a vigência, a janela em que o check-in pode ser
        lançado, o semáforo de atingimento e as casas decimais usadas na exibição dos valores.
      </p>

      {error && !editing && (
        <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}

      {cyclesQuery.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando ciclos…</p>}
      {cyclesQuery.isError && (
        <p role="alert" className="text-body-sm text-error">
          Não foi possível carregar os ciclos.
        </p>
      )}

      {!cyclesQuery.isLoading && cycles.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum ciclo cadastrado ainda.</p>
      )}

      {cycles.length > 0 && (
        <ul className="flex flex-col gap-sm">
          {cycles.map((cycle) => (
            <li
              key={cycle.id}
              className="flex flex-wrap items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
            >
              <div className="min-w-0">
                <p className="font-label text-label-lg text-on-surface">{cycle.name}</p>
                <p className="text-body-sm text-on-surface-variant">
                  {formatDay(cycle.startDate)} – {formatDay(cycle.finishDate)}
                </p>
                <p className="text-body-sm text-on-surface-variant">
                  Janela de atualização:{' '}
                  {cycle.updateWindowStart || cycle.updateWindowFinish
                    ? `${formatDay(cycle.updateWindowStart)} – ${formatDay(cycle.updateWindowFinish)}`
                    : 'o ciclo inteiro'}
                </p>
                <p className="text-body-sm text-on-surface-variant">
                  {cycle.forceCommentOnCheckIn ? 'Exige comentário no check-in' : 'Comentário opcional no check-in'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-sm">
                <span className="rounded-full border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant">
                  {STATUS_LABELS[cycle.status]}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    setEditing(cycle)
                  }}
                  className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
                >
                  Editar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <CycleDialog
          cycle={editing === 'new' ? null : editing}
          error={error}
          saving={save.isPending}
          onClose={() => {
            setEditing(null)
            setError(null)
          }}
          onSubmit={handleSubmit}
        />
      )}
    </Panel>
  )
}

function CycleDialog({
  cycle,
  error,
  saving,
  onClose,
  onSubmit,
}: {
  cycle: OkrCycleDTO | null
  error: string | null
  saving: boolean
  onClose: () => void
  onSubmit: (form: CycleForm) => void
}) {
  const [form, setForm] = useState<CycleForm>(() => (cycle ? formOf(cycle) : emptyForm()))

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const title = cycle ? 'Editar ciclo' : 'Novo ciclo'

  function patch(changes: Partial<CycleForm>) {
    setForm((current) => ({ ...current, ...changes }))
  }

  function patchRange(index: number, changes: Partial<OkrProgressRange>) {
    setForm((current) => ({
      ...current,
      progressRanges: current.progressRanges.map((range, i) => (i === index ? { ...range, ...changes } : range)),
    }))
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    onSubmit(form)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-md overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-headline text-title-md text-on-surface">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-on-surface-variant hover:text-on-surface"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Nome</span>
          <input
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
            aria-label="Nome"
            placeholder="Ex.: 2026 · 1º semestre"
            className={inputCls}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Descrição</span>
          <textarea
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
            aria-label="Descrição"
            rows={2}
            className={inputCls}
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Situação</span>
          <Select
            options={STATUS_OPTIONS}
            value={form.status}
            onChange={(value) => patch({ status: value as OkrCycleStatus })}
            ariaLabel="Situação"
          />
        </div>

        <div className="grid gap-md sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Início</span>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => patch({ startDate: e.target.value })}
              aria-label="Início"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Fim</span>
            <input
              type="date"
              value={form.finishDate}
              onChange={(e) => patch({ finishDate: e.target.value })}
              aria-label="Fim"
              className={inputCls}
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-sm rounded-lg border border-outline-variant/20 p-md">
          <legend className="px-1 font-label text-label-sm text-on-surface-variant">
            Janela de atualização (opcional)
          </legend>
          <p className="text-body-sm text-on-surface-variant">
            Período em que o check-in pode ser lançado. Em branco, vale o ciclo inteiro.
          </p>
          <div className="grid gap-md sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Início da janela</span>
              <input
                type="date"
                value={form.updateWindowStart}
                onChange={(e) => patch({ updateWindowStart: e.target.value })}
                aria-label="Início da janela"
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Fim da janela</span>
              <input
                type="date"
                value={form.updateWindowFinish}
                onChange={(e) => patch({ updateWindowFinish: e.target.value })}
                aria-label="Fim da janela"
                className={inputCls}
              />
            </label>
          </div>
        </fieldset>

        <label className="flex items-center gap-sm font-label text-label-md text-on-surface">
          <input
            type="checkbox"
            checked={form.forceCommentOnCheckIn}
            onChange={(e) => patch({ forceCommentOnCheckIn: e.target.checked })}
            aria-label="Exigir comentário no check-in"
          />
          Exigir comentário no check-in
        </label>

        <fieldset className="grid gap-md rounded-lg border border-outline-variant/20 p-md sm:grid-cols-3">
          <legend className="px-1 font-label text-label-sm text-on-surface-variant">Casas decimais</legend>
          {(
            [
              ['percentage', 'Percentual'],
              ['numeric', 'Número'],
              ['currency', 'Moeda'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">{label}</span>
              <input
                type="number"
                min={0}
                max={6}
                value={form.decimals[key]}
                onChange={(e) => patch({ decimals: { ...form.decimals, [key]: Number(e.target.value) || 0 } })}
                aria-label={`Casas decimais — ${label}`}
                className={inputCls}
              />
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-sm rounded-lg border border-outline-variant/20 p-md">
          <legend className="px-1 font-label text-label-sm text-on-surface-variant">Semáforo</legend>
          <p className="text-body-sm text-on-surface-variant">
            Faixas de atingimento, em pontos percentuais. Precisam ser contínuas: a primeira começa sem limite inferior
            e a última termina sem limite superior.
          </p>
          {form.progressRanges.map((range, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-sm">
              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">Mínimo</span>
                <input
                  type="number"
                  value={range.min ?? ''}
                  placeholder="sem limite"
                  onChange={(e) => patchRange(index, { min: e.target.value === '' ? null : Number(e.target.value) })}
                  aria-label={`Mínimo da faixa ${index + 1}`}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">Máximo</span>
                <input
                  type="number"
                  value={range.max ?? ''}
                  placeholder="sem limite"
                  onChange={(e) => patchRange(index, { max: e.target.value === '' ? null : Number(e.target.value) })}
                  aria-label={`Máximo da faixa ${index + 1}`}
                  className={inputCls}
                />
              </label>
              <input
                type="color"
                value={range.color}
                onChange={(e) => patchRange(index, { color: e.target.value })}
                aria-label={`Cor da faixa ${index + 1}`}
                className="h-10 w-12 cursor-pointer rounded-md border border-outline-variant/60 bg-surface-container-highest p-1"
              />
              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    progressRanges: current.progressRanges.filter((_, i) => i !== index),
                  }))
                }
                aria-label={`Remover faixa ${index + 1}`}
                className="rounded-md border border-outline-variant/60 p-2 text-on-surface-variant hover:border-error hover:text-error"
              >
                <Icon name="delete" className="text-[18px]" />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-sm">
            <button
              type="button"
              onClick={() =>
                setForm((current) => {
                  const last = current.progressRanges[current.progressRanges.length - 1]
                  return {
                    ...current,
                    progressRanges: [
                      ...current.progressRanges,
                      {
                        min: last?.max ?? null,
                        max: null,
                        color: last?.color ?? OKR_DEFAULT_PROGRESS_RANGES[0].color,
                      },
                    ],
                  }
                })
              }
              className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
            >
              Adicionar faixa
            </button>
            <button
              type="button"
              onClick={() => patch({ progressRanges: OKR_DEFAULT_PROGRESS_RANGES.map((range) => ({ ...range })) })}
              className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
            >
              Restaurar padrão
            </button>
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
            <Icon name="error" className="text-[16px]" />
            {error}
          </p>
        )}

        <div className="flex justify-end gap-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-outline-variant/60 px-lg py-2 font-label text-label-md text-on-surface-variant hover:border-primary hover:text-primary"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-lg py-2 font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            Salvar
          </button>
        </div>
      </form>
    </div>
  )
}
