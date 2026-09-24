import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  OKR_DIRECTIONS,
  OKR_DIRECTION_LABELS,
  OKR_METRIC_TYPES,
  OKR_METRIC_TYPE_LABELS,
  type CreateOkrKeyResultRequest,
  type OkrAssignmentInput,
  type OkrDirection,
  type OkrKeyResultDTO,
  type OkrMetricType,
  type OkrObjectiveDTO,
  type PublicUser,
} from '@legends/shared'
import { Select } from '../../components/Select'
import { createOkrKeyResult, updateOkrKeyResult } from '../../lib/okr-api'
import { TargetPicker } from '../mural-feedbacks/TargetPicker'
import { errorMessage, inputCls } from '../admin/shared'
import { OkrDialogShell, OkrField } from './ObjectiveFormDialog'
import { parseDecimal } from './okr-format'

/**
 * Criar e editar key result — a métrica da meta: base, alvo e direção.
 *
 * A direção é a escolha que mais muda a leitura: em "menor é melhor" o alvo
 * vira teto, e estourá-lo derruba o atingimento em vez de passar de 100%.
 */
export function KeyResultFormDialog({
  objective,
  keyResult,
  onClose,
  onSaved,
}: {
  objective: OkrObjectiveDTO
  /** `null` = key result novo. */
  keyResult: OkrKeyResultDTO | null
  onClose: () => void
  onSaved: (objective: OkrObjectiveDTO) => void
}) {
  const queryClient = useQueryClient()
  const assignedPerson = keyResult?.assignments.find((assignment) => assignment.role === 'ASSIGNED_TO')?.person
  const [name, setName] = useState(keyResult?.name ?? objective.name)
  const [code, setCode] = useState(keyResult?.code ?? '')
  const [metricType, setMetricType] = useState<OkrMetricType>(keyResult?.metricType ?? 'PERCENTAGE')
  const [unit, setUnit] = useState(keyResult?.unit ?? '')
  const [baseline, setBaseline] = useState(keyResult ? String(keyResult.baseline) : '0')
  const [target, setTarget] = useState(keyResult ? String(keyResult.target) : '')
  const [direction, setDirection] = useState<OkrDirection>(keyResult?.direction ?? 'HIGHER_IS_BETTER')
  const [assignee, setAssignee] = useState<PublicUser | null>(
    assignedPerson
      ? ({ id: assignedPerson.id, name: assignedPerson.name, email: assignedPerson.email, photoUrl: assignedPerson.photoUrl } as PublicUser)
      : null,
  )
  const [erro, setErro] = useState<string | null>(null)

  const salvar = useMutation({
    mutationFn: (body: CreateOkrKeyResultRequest) =>
      keyResult ? updateOkrKeyResult(keyResult.id, body) : createOkrKeyResult(objective.id, body),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['okr'] })
      onSaved(data.objective)
    },
  })

  function enviar(event: FormEvent) {
    event.preventDefault()
    setErro(null)
    if (!name.trim()) return setErro('Informe o nome do key result.')
    const base = parseDecimal(baseline)
    const alvo = parseDecimal(target)
    if (base == null || Number.isNaN(base)) return setErro('Informe o valor de partida (base).')
    if (alvo == null || Number.isNaN(alvo)) return setErro('Informe a meta.')
    const assignments: OkrAssignmentInput[] = assignee ? [{ personId: assignee.id, role: 'ASSIGNED_TO' }] : []

    salvar.mutate({
      name: name.trim(),
      code: code.trim() || null,
      metricType,
      unit: unit.trim() || null,
      baseline: base,
      target: alvo,
      direction,
      assignments,
    })
  }

  const mensagem = erro ?? (salvar.isError ? errorMessage(salvar.error, 'Não foi possível salvar o key result.') : null)
  const teto = direction === 'LOWER_IS_BETTER'

  return (
    <OkrDialogShell
      title={keyResult ? 'Editar key result' : 'Novo key result'}
      formLabel={keyResult ? `Editar ${keyResult.name}` : `Novo key result de ${objective.name}`}
      onClose={onClose}
      onSubmit={enviar}
      saving={salvar.isPending}
      submitLabel={keyResult ? 'Salvar key result' : 'Criar key result'}
      message={mensagem}
    >
      <OkrField label="Nome">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      </OkrField>

      <div className="grid gap-md sm:grid-cols-2">
        <OkrField label="Tipo de métrica">
          <Select
            ariaLabel="Tipo de métrica"
            value={metricType}
            onChange={(next) => setMetricType(next as OkrMetricType)}
            options={OKR_METRIC_TYPES.map((option) => ({ value: option, label: OKR_METRIC_TYPE_LABELS[option] }))}
          />
        </OkrField>
        <OkrField
          label="Direção"
          hint={teto ? 'A meta vira um teto: estourá-la derruba o atingimento.' : 'Quanto maior o valor, melhor.'}
        >
          <Select
            ariaLabel="Direção"
            value={direction}
            onChange={(next) => setDirection(next as OkrDirection)}
            options={OKR_DIRECTIONS.map((option) => ({ value: option, label: OKR_DIRECTION_LABELS[option] }))}
          />
        </OkrField>
      </div>

      <div className="grid gap-md sm:grid-cols-3">
        <OkrField label="Valor inicial / base">
          <input className={inputCls} inputMode="decimal" value={baseline} onChange={(e) => setBaseline(e.target.value)} />
        </OkrField>
        <OkrField label={teto ? 'Teto' : 'Meta'}>
          <input className={inputCls} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        </OkrField>
        <OkrField label="Unidade (opcional)" hint={metricType === 'PERCENTAGE' ? 'Porcentagem já mostra %.' : 'Ex.: dias, NPS, R$.'}>
          <input className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} />
        </OkrField>
      </div>

      <div className="grid gap-md sm:grid-cols-2">
        <OkrField label="Responsável pelo check-in">
          <TargetPicker
            value={assignee}
            onChange={setAssignee}
            scope="all"
            ariaLabel="Responsável pelo key result"
            placeholder="Procurar pessoa…"
          />
        </OkrField>
        <OkrField label="Código (opcional)">
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} />
        </OkrField>
      </div>
    </OkrDialogShell>
  )
}
