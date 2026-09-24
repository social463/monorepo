import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { OkrCycleDTO, OkrObjectiveDTO } from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { getOkrPersonResults, listOkrObjectives } from '../../lib/okr-api'
import { Select } from '../../components/Select'
import { inputCls } from '../admin/shared'
import { CyclePicker } from './CyclePicker'
import { okrObjectivePath } from './okr-format'
import { ObjectivesTable } from './ObjectivesTable'
import { ResultsPanel } from './ResultsPanel'
import { useOkrCycle } from './use-okr-cycle'
import { ObjectiveFormDialog } from './ObjectiveFormDialog'
import { OKR_RESULT_MODES, canAdminOkr, isOkrResultMode, type OkrResultMode } from './okr-view'

const VIEWS = [
  { key: 'minhas', label: 'Minhas metas' },
  { key: 'ciclo', label: 'Metas do ciclo' },
] as const

type ViewKey = (typeof VIEWS)[number]['key']

const isViewKey = (value: string | null): value is ViewKey => VIEWS.some((view) => view.key === value)

/** Sem acento e sem caixa, para a busca achar "conversao" em "Conversão". */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export function OkrEmpty({ children }: { children: string }) {
  return (
    <p className="rounded-xl border border-dashed border-outline-variant/50 p-xl text-center font-body text-body-md text-on-surface-variant">
      {children}
    </p>
  )
}

/** Resultados e tabela do recorte — a mesma composição nas duas visões e na página da pessoa. */
export function OkrResults({
  objectives,
  cycle,
  mode,
  title,
}: {
  objectives: OkrObjectiveDTO[]
  cycle: OkrCycleDTO
  mode: OkrResultMode
  title: string
}) {
  return (
    <>
      <ResultsPanel objectives={objectives} cycle={cycle} mode={mode} />
      <section className="flex flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
        <h2 className="font-label text-label-lg text-on-surface">{title}</h2>
        <ObjectivesTable objectives={objectives} cycle={cycle} mode={mode} />
      </section>
    </>
  )
}

/**
 * "Exibição de resultado", como na ImpulseUp. Botões, e não select: são duas
 * opções que se comparam o tempo todo, e o estado precisa estar à vista.
 */
export function OkrResultModePicker({ mode, onSelect }: { mode: OkrResultMode; onSelect: (mode: OkrResultMode) => void }) {
  return (
    <div className="flex flex-col gap-xs">
      <span id="okr-exibicao" className="font-label text-label-md text-on-surface">
        Exibição de resultado
      </span>
      <div role="group" aria-labelledby="okr-exibicao" className="flex rounded-md border border-outline-variant/60 p-0.5">
        {OKR_RESULT_MODES.map((option) => {
          const active = option.key === mode
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(option.key)}
              className={`rounded px-md py-1.5 font-label text-label-md transition-colors ${
                active ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MyGoals({ cycle, mode }: { cycle: OkrCycleDTO; mode: OkrResultMode }) {
  const { user } = useAuth()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['okr', 'person', user?.id, cycle.id],
    queryFn: () => getOkrPersonResults(user!.id, cycle.id),
    enabled: !!user,
  })
  if (isLoading) return <Skeleton className="h-40 w-full" />
  if (isError) return <OkrEmpty>Não foi possível carregar suas metas.</OkrEmpty>
  const objectives = data?.results.objectives ?? []
  if (objectives.length === 0) {
    return <OkrEmpty>Você não tem metas neste ciclo. Troque a visão para "Metas do ciclo" para ver as da empresa.</OkrEmpty>
  }
  return <OkrResults objectives={objectives} cycle={cycle} mode={mode} title="Metas por escopo" />
}

function CycleGoals({ cycle, busca, mode }: { cycle: OkrCycleDTO; busca: string; mode: OkrResultMode }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['okr', 'objectives', cycle.id],
    queryFn: () => listOkrObjectives(cycle.id),
  })

  const filtered = useMemo(() => {
    const objectives = data?.objectives ?? []
    const termo = fold(busca.trim())
    if (!termo) return objectives
    return objectives.filter(
      (o) =>
        fold(o.name).includes(termo) ||
        fold(o.code ?? '').includes(termo) ||
        o.keyResults.some((kr) => fold(kr.name).includes(termo) || kr.assignments.some((a) => fold(a.person.name).includes(termo))) ||
        o.assignments.some((a) => fold(a.person.name).includes(termo)),
    )
  }, [data, busca])

  if (isLoading) return <Skeleton className="h-40 w-full" />
  if (isError) return <OkrEmpty>Não foi possível carregar as metas do ciclo.</OkrEmpty>

  return (
    <>
      <p className="font-body text-body-sm text-on-surface-variant" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? 'objetivo' : 'objetivos'}
      </p>
      {filtered.length === 0 ? (
        <OkrEmpty>Nenhuma meta encontrada.</OkrEmpty>
      ) : (
        <OkrResults objectives={filtered} cycle={cycle} mode={mode} title="Metas por escopo" />
      )}
    </>
  )
}

/**
 * Metas e OKRs: ver e registrar check-in, no formato da ImpulseUp (resultados
 * no topo, metas agrupadas por escopo numa tabela).
 *
 * Criar e editar objetivo/KR ainda não tem tela — as metas vêm do importador da
 * ImpulseUp. Spec: `docs/superpowers/specs/2026-09-17-modulo-metas-okr-design.md`.
 */
export function OkrPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('aba')
  const view: ViewKey = isViewKey(requested) ? requested : 'minhas'
  const { cycles, cycle, selectCycle, isLoading, isError } = useOkrCycle()
  const [busca, setBusca] = useState('')
  const [criando, setCriando] = useState(false)
  const { user } = useAuth()
  const navigate = useNavigate()
  // Só a administração de metas cria meta solta; desdobrar a própria meta é na
  // página dela, onde o dono aparece (é o que o `permissions` do DTO libera).
  const podeCriar = canAdminOkr(user) && cycle?.status !== 'CLOSED'
  const requestedMode = searchParams.get('resultado')
  const mode: OkrResultMode = isOkrResultMode(requestedMode) ? requestedMode : 'acumulado'

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <h1 className="font-headline text-headline-lg text-on-surface md:text-headline-xl">Metas e OKRs</h1>
        {podeCriar && (
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="inline-flex items-center gap-xs rounded-lg bg-primary px-lg py-sm font-label text-label-lg text-on-primary hover:bg-primary/90"
          >
            <Icon name="add" className="text-[18px]" /> Nova meta
          </button>
        )}
      </div>

      {isLoading && <Skeleton className="h-40 w-full" />}
      {isError && <OkrEmpty>Não foi possível carregar os ciclos de metas.</OkrEmpty>}
      {!isLoading && !isError && !cycle && <OkrEmpty>Nenhum ciclo de metas cadastrado ainda.</OkrEmpty>}

      {cycle && (
        <>
          <div className="flex flex-wrap items-start gap-md">
            <OkrResultModePicker mode={mode} onSelect={(next) => setParam('resultado', next)} />
            <CyclePicker cycles={cycles} cycle={cycle} onSelect={selectCycle} />
            <label className="flex w-full max-w-[16rem] flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">Visão</span>
              <Select
                ariaLabel="Visão"
                value={view}
                onChange={(next) => setParam('aba', next)}
                options={VIEWS.map((option) => ({ value: option.key, label: option.label }))}
              />
            </label>
            {view === 'ciclo' && (
              <label className="flex min-w-[16rem] flex-1 flex-col gap-xs">
                <span className="font-label text-label-md text-on-surface">Buscar</span>
                <input
                  className={inputCls}
                  type="search"
                  placeholder="Meta, código ou pessoa"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </label>
            )}
          </div>

          <h2 className="font-headline text-headline-md text-on-surface">{VIEWS.find((v) => v.key === view)!.label}</h2>
          {view === 'minhas' ? (
            <MyGoals cycle={cycle} mode={mode} />
          ) : (
            <CycleGoals cycle={cycle} busca={busca} mode={mode} />
          )}
        </>
      )}
      {criando && cycle && (
        <ObjectiveFormDialog
          cycle={cycle}
          objective={null}
          onClose={() => setCriando(false)}
          onSaved={(objective) => {
            setCriando(false)
            navigate(okrObjectivePath(objective.id))
          }}
        />
      )}
    </section>
  )
}
