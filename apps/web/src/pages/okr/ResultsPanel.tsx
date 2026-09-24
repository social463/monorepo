import {
  OKR_SCOPES,
  OKR_SCOPE_LABELS,
  okrAverageAttainment,
  okrRangeColor,
  type OkrCycleDTO,
  type OkrObjectiveDTO,
} from '@legends/shared'
import { OkrProgressMeter } from './OkrProgress'
import { okrObjectiveView, type OkrResultMode } from './okr-view'

/** Média do atingimento, pintada pelo mesmo semáforo do ciclo. */
function Average({
  label,
  objectives,
  cycle,
  mode,
}: {
  label: string
  objectives: OkrObjectiveDTO[]
  cycle: OkrCycleDTO
  mode: OkrResultMode
}) {
  const views = objectives.map((objective) => okrObjectiveView(objective, cycle, mode))
  const attainment = okrAverageAttainment(views)
  const color =
    attainment == null ? null : okrRangeColor(cycle.progressRanges, { attainment, overshoot: 0, goalMet: attainment >= 1 })
  const goalsMet = views.filter((view) => view.goalMet).length
  return (
    <div className="flex min-w-0 flex-col gap-xs">
      <span className="font-label text-label-md text-on-surface">{label}</span>
      {objectives.length === 0 ? (
        <div className="rounded-md bg-surface-container-highest px-sm py-xs text-center font-label text-label-sm text-on-surface-variant">
          Sem metas
        </div>
      ) : (
        <OkrProgressMeter attainment={attainment} overshoot={0} color={color} label={label} />
      )}
      <span className="font-body text-body-sm text-on-surface-variant">
        {objectives.length} {objectives.length === 1 ? 'meta' : 'metas'} · {goalsMet} {goalsMet === 1 ? 'cumprida' : 'cumpridas'}
      </span>
    </div>
  )
}

/**
 * Resultados do recorte em tela. É média simples do atingimento de quem tem
 * valor — a mesma regra do resumo do ciclo; a ImpulseUp pondera por peso, mas
 * nenhuma meta do tenant tem peso cadastrado.
 */
export function ResultsPanel({
  objectives,
  cycle,
  mode,
}: {
  objectives: OkrObjectiveDTO[]
  cycle: OkrCycleDTO
  mode: OkrResultMode
}) {
  return (
    <section
      aria-label="Resultados"
      className="flex flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg"
    >
      <h2 className="font-label text-label-lg text-on-surface">Resultados</h2>
      <div className="grid gap-md md:grid-cols-[1fr_3fr]">
        <div className="rounded-lg border border-outline-variant/40 p-md">
          <Average label="Resultado no ciclo" objectives={objectives} cycle={cycle} mode={mode} />
        </div>
        <div className="grid gap-md rounded-lg border border-outline-variant/40 p-md sm:grid-cols-3">
          {OKR_SCOPES.map((scope) => (
            <Average
              key={scope}
              label={`Resultado ${OKR_SCOPE_LABELS[scope].toLowerCase()}`}
              objectives={objectives.filter((objective) => objective.scope === scope)}
              cycle={cycle}
              mode={mode}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
