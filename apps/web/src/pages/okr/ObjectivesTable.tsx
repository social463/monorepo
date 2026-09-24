import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  OKR_SCOPES,
  OKR_SCOPE_LABELS,
  formatOkrAttainment,
  formatOkrValue,
  okrAverageAttainment,
  type OkrAssignmentDTO,
  type OkrCycleDTO,
  type OkrKeyResultDTO,
  type OkrObjectiveDTO,
  type OkrPersonDTO,
  type OkrScope,
} from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { KeyResultDialog } from './KeyResultDialog'
import { UpdateProgressDialog } from './UpdateProgressDialog'
import { OkrConfidenceChip, OkrProgressMeter } from './OkrProgress'
import { formatYmd, okrObjectivePath } from './okr-format'
import { okrKeyResultView, okrObjectiveView, type OkrResultMode, type OkrResultView } from './okr-view'

const PAGE_SIZE = 20

export const OKR_SCOPE_ICONS: Record<OkrScope, string> = {
  ORGANIZATION: 'domain',
  TEAM: 'groups',
  INDIVIDUAL: 'person',
}

/**
 * Quem responde pela meta: os responsáveis (no KR ou no objetivo); sem nenhum,
 * o dono. Uma vez cada, na ordem em que aparecem.
 */
export function responsiblesOf(objective: OkrObjectiveDTO, keyResult: OkrKeyResultDTO | null): OkrPersonDTO[] {
  const assignments: OkrAssignmentDTO[] = [...(keyResult?.assignments ?? []), ...objective.assignments]
  const pick = (role: OkrAssignmentDTO['role']) => {
    const seen = new Map<string, OkrPersonDTO>()
    for (const assignment of assignments) {
      if (assignment.role === role && !seen.has(assignment.person.id)) seen.set(assignment.person.id, assignment.person)
    }
    return [...seen.values()]
  }
  const assigned = pick('ASSIGNED_TO')
  return assigned.length > 0 ? assigned : pick('OWNER')
}

export function OkrPeople({ people }: { people: OkrPersonDTO[] }) {
  if (people.length === 0) return <span className="text-on-surface-variant">—</span>
  const shown = people.slice(0, 3)
  return (
    <div className="flex items-center justify-center -space-x-2">
      {shown.map((person) => (
        <Link
          key={person.id}
          to={`/metas/pessoa/${person.id}`}
          title={person.name}
          aria-label={`Metas de ${person.name}`}
          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-surface-container bg-primary-container hover:z-10"
        >
          <Avatar user={person} initialsClassName="font-label text-label-sm font-bold text-on-primary-container" />
        </Link>
      ))}
      {people.length > shown.length && (
        <span
          title={people.slice(shown.length).map((person) => person.name).join(', ')}
          className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-surface-container bg-surface-container-highest font-label text-label-sm text-on-surface-variant"
        >
          +{people.length - shown.length}
        </span>
      )}
    </div>
  )
}

type Open = (keyResultId: string, withForm: boolean) => void

function ProgressCell({
  objective,
  view,
  keyResult,
  name,
  onOpen,
}: {
  objective: OkrObjectiveDTO
  view: OkrResultView
  keyResult: OkrKeyResultDTO | null
  name: string
  onOpen: Open
}) {
  return (
    <div className="flex min-w-[12rem] flex-col gap-xs">
      <OkrProgressMeter attainment={view.attainment} overshoot={view.overshoot} color={view.color} label={`Resultado de ${name}`} />
      <div className="flex items-center justify-between gap-sm">
        <OkrConfidenceChip level={objective.confidenceLevel} />
        {keyResult?.permissions.createCheckIn && (
          <button
            type="button"
            onClick={() => onOpen(keyResult.id, true)}
            aria-label={`Atualizar ${keyResult.name}`}
            className="font-label text-label-md text-primary hover:underline"
          >
            Atualizar
          </button>
        )}
      </div>
    </div>
  )
}

const cell = 'px-sm py-sm align-middle'

/**
 * Uma linha por objetivo. Objetivo de um KR só (o caso do tenant inteiro hoje)
 * mostra os números do KR na própria linha; com vários, a linha do objetivo leva
 * o resultado agregado e cada KR ganha uma sub-linha.
 */
function ObjectiveRows({
  objective,
  cycle,
  mode,
  onOpen,
}: {
  objective: OkrObjectiveDTO
  cycle: OkrCycleDTO
  mode: OkrResultMode
  onOpen: Open
}) {
  const single = objective.keyResults.length === 1 ? objective.keyResults[0] : null
  const deadline = objective.finishDate ?? cycle.finishDate
  const weight = objective.weight == null ? '—' : `${Math.round(objective.weight * 100)}%`
  const objectiveView = okrObjectiveView(objective, cycle, mode)

  const values = (keyResult: OkrKeyResultDTO | null, view: OkrResultView) => {
    if (!keyResult) return [<td key="v" className={`${cell} text-center`}>—</td>, <td key="m" className={`${cell} text-center`}>—</td>]
    const fmt = (value: number | null) => formatOkrValue(value, keyResult, cycle.decimals)
    const teto = keyResult.direction === 'LOWER_IS_BETTER'
    return [
      <td key="v" className={`${cell} whitespace-nowrap text-center tabular-nums`}>
        {fmt(view.value)}
        {view.accumulated && <span className="block font-body text-body-sm text-on-surface-variant">acumulado</span>}
      </td>,
      <td key="m" className={`${cell} whitespace-nowrap text-center tabular-nums`} title={teto ? 'Teto: menor é melhor' : undefined}>
        {teto && (
          <>
            <span aria-hidden>≤ </span>
            <span className="sr-only">teto de </span>
          </>
        )}
        {fmt(keyResult.target)}
      </td>,
    ]
  }

  const history = (keyResult: OkrKeyResultDTO | null, name: string) =>
    keyResult ? (
      <button
        type="button"
        onClick={() => onOpen(keyResult.id, false)}
        aria-label={`Evolução de ${name}`}
        title="Evolução"
        className="rounded-full p-xs text-primary hover:bg-primary/10"
      >
        <Icon name="monitoring" className="text-[28px]" />
      </button>
    ) : null

  // O nome leva à página da meta; a sub-linha de KR abre a evolução dele.
  const nameCell = (label: string, code: string | null, keyResult: OkrKeyResultDTO | null, nested = false) => (
    <td className={`${cell} ${nested ? 'pl-xl' : ''}`}>
      <div className="flex items-start gap-sm">
        <Icon name={nested ? 'subdirectory_arrow_right' : 'track_changes'} className="mt-0.5 text-[18px] text-on-surface-variant" />
        <div className="min-w-0">
          {!nested ? (
            <Link to={okrObjectivePath(objective.id)} className="font-body text-body-md text-primary hover:underline">
              {label}
            </Link>
          ) : keyResult ? (
            <button
              type="button"
              onClick={() => onOpen(keyResult.id, false)}
              className="text-left font-body text-body-md text-primary hover:underline"
            >
              {label}
            </button>
          ) : (
            <span className="font-body text-body-md text-on-surface">{label}</span>
          )}
          {code && <span className="block font-body text-body-sm text-on-surface-variant">{code}</span>}
        </div>
      </div>
    </td>
  )

  return (
    <>
      <tr className="border-t border-outline-variant/30">
        {nameCell(objective.name, objective.code, single)}
        <td className={`${cell} text-center`} title={OKR_SCOPE_LABELS[objective.scope]}>
          <Icon name={OKR_SCOPE_ICONS[objective.scope]} className="text-[26px] text-on-surface-variant" />
          <span className="sr-only">{OKR_SCOPE_LABELS[objective.scope]}</span>
        </td>
        <td className={cell}>
          <OkrPeople people={responsiblesOf(objective, single)} />
        </td>
        <td className={`${cell} whitespace-nowrap text-center tabular-nums`}>{formatYmd(deadline)}</td>
        {values(single, objectiveView)}
        <td className={cell}>
          <ProgressCell objective={objective} view={objectiveView} keyResult={single} name={objective.name} onOpen={onOpen} />
        </td>
        <td className={`${cell} text-center tabular-nums`}>{weight}</td>
        <td className={`${cell} text-center`}>{history(single, objective.name)}</td>
      </tr>
      {!single &&
        objective.keyResults.map((keyResult) => (
          <tr key={keyResult.id} className="bg-surface-container-low/60">
            {nameCell(keyResult.name, keyResult.code, keyResult, true)}
            <td className={cell} />
            <td className={cell}>
              <OkrPeople people={responsiblesOf(objective, keyResult)} />
            </td>
            <td className={`${cell} whitespace-nowrap text-center tabular-nums`}>
              {formatYmd(keyResult.finishDate ?? deadline)}
            </td>
            {values(keyResult, okrKeyResultView(keyResult, cycle, mode))}
            <td className={cell}>
              <ProgressCell
                objective={objective}
                view={okrKeyResultView(keyResult, cycle, mode)}
                keyResult={keyResult}
                name={keyResult.name}
                onOpen={onOpen}
              />
            </td>
            <td className={`${cell} text-center tabular-nums`}>
              {keyResult.weight == null ? '—' : `${Math.round(keyResult.weight * 100)}%`}
            </td>
            <td className={`${cell} text-center`}>{history(keyResult, keyResult.name)}</td>
          </tr>
        ))}
    </>
  )
}

function ScopeGroup({
  scope,
  objectives,
  cycle,
  mode,
  onOpen,
}: {
  scope: OkrScope
  objectives: OkrObjectiveDTO[]
  cycle: OkrCycleDTO
  mode: OkrResultMode
  onOpen: Open
}) {
  // Escopo vazio nasce fechado: ele existe para dizer "aqui não há meta".
  const [aberto, setAberto] = useState(objectives.length > 0)
  const [limite, setLimite] = useState(PAGE_SIZE)
  const panelId = `okr-scope-${scope}`

  return (
    <section className="overflow-hidden rounded-lg border border-outline-variant/40">
      <h3>
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={panelId}
          onClick={() => setAberto((value) => !value)}
          className="flex w-full flex-wrap items-center justify-between gap-sm bg-surface-container-high px-md py-sm text-left"
        >
          <span className="flex items-center gap-sm font-label text-label-lg text-on-surface">
            <Icon name={aberto ? 'expand_more' : 'chevron_right'} className="text-[20px]" />
            <Icon name={OKR_SCOPE_ICONS[scope]} className="text-[20px] text-primary" />
            {OKR_SCOPE_LABELS[scope]}
            <span className="font-body text-body-sm text-on-surface-variant">{objectives.length}</span>
          </span>
          <span className="font-body text-body-sm text-on-surface-variant">
            Resultado médio {formatOkrAttainment(okrAverageAttainment(objectives.map((o) => okrObjectiveView(o, cycle, mode))))}
          </span>
        </button>
      </h3>
      {aberto && (
        <div id={panelId}>
          {/* `relative`: o sr-only das células é absoluto e, sem ancestral posicionado, escaparia do corte e alargaria a página. */}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[64rem] border-collapse text-left font-body text-body-md text-on-surface">
              <thead>
                <tr className="font-label text-label-md text-on-surface-variant">
                  <th scope="col" className="w-[26%] px-sm py-sm">Nome da meta</th>
                  <th scope="col" className="px-sm py-sm text-center">Tipo</th>
                  <th scope="col" className="px-sm py-sm text-center">Responsável</th>
                  <th scope="col" className="px-sm py-sm text-center">Prazo</th>
                  <th scope="col" className="px-sm py-sm text-center">Valor atual</th>
                  <th scope="col" className="px-sm py-sm text-center">Meta</th>
                  <th scope="col" className="w-[18%] px-sm py-sm text-center">Progresso</th>
                  <th scope="col" className="px-sm py-sm text-center">Peso</th>
                  <th scope="col" className="px-sm py-sm text-center">Evolução</th>
                </tr>
              </thead>
              <tbody>
                {objectives.slice(0, limite).map((objective) => (
                  <ObjectiveRows key={objective.id} objective={objective} cycle={cycle} mode={mode} onOpen={onOpen} />
                ))}
              </tbody>
            </table>
            {objectives.length === 0 && (
              <p className="p-md font-body text-body-sm text-on-surface-variant">Nenhuma meta neste escopo.</p>
            )}
          </div>
          {objectives.length > limite && (
            <div className="flex justify-center border-t border-outline-variant/30 p-sm">
              <button
                type="button"
                onClick={() => setLimite((n) => n + PAGE_SIZE)}
                className="rounded-full border border-outline-variant px-lg py-xs font-label text-label-md text-primary"
              >
                Mostrar mais ({objectives.length - limite} restantes)
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** Metas agrupadas por escopo, da empresa para o individual, como na ImpulseUp. */
export function ObjectivesTable({
  objectives,
  cycle,
  mode,
}: {
  objectives: OkrObjectiveDTO[]
  cycle: OkrCycleDTO
  mode: OkrResultMode
}) {
  const [open, setOpen] = useState<{ keyResultId: string; withForm: boolean } | null>(null)
  const [updated, setUpdated] = useState<string | null>(null)
  const openKr: Open = (keyResultId, withForm) => {
    setUpdated(null)
    setOpen({ keyResultId, withForm })
  }
  const close = useCallback(() => setOpen(null), [])

  // Resolve pelo id a cada render: depois do check-in a lista recarrega e o
  // diálogo mostra o valor novo.
  const selectedObjective = open ? objectives.find((o) => o.keyResults.some((kr) => kr.id === open.keyResultId)) : undefined
  const selectedKr = selectedObjective?.keyResults.find((kr) => kr.id === open?.keyResultId)

  return (
    <div className="flex flex-col gap-md">
      <p role="status" className={updated ? 'font-body text-body-sm text-on-surface' : 'sr-only'}>
        {updated ? `Progresso de ${updated} atualizado.` : ''}
      </p>
      {/* Os três escopos aparecem sempre, como na ImpulseUp: "Empresa 0" informa
          que não há meta ali; sumir com o grupo faria parecer que falta carregar. */}
      {OKR_SCOPES.map((scope) => (
        <ScopeGroup
          key={scope}
          scope={scope}
          objectives={objectives.filter((objective) => objective.scope === scope)}
          cycle={cycle}
          mode={mode}
          onOpen={openKr}
        />
      ))}
      {selectedObjective && selectedKr && open?.withForm && (
        <UpdateProgressDialog
          key={`update-${selectedKr.id}`}
          keyResult={selectedKr}
          objective={selectedObjective}
          cycle={cycle}
          onDone={() => {
            setOpen(null)
            setUpdated(selectedKr.name)
          }}
          onClose={close}
        />
      )}
      {selectedObjective && selectedKr && open && !open.withForm && (
        <KeyResultDialog
          key={`detail-${selectedKr.id}`}
          keyResult={selectedKr}
          objective={selectedObjective}
          cycle={cycle}
          onUpdate={() => setOpen({ keyResultId: selectedKr.id, withForm: true })}
          onClose={close}
        />
      )}
    </div>
  )
}
