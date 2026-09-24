import {
  isOkrAdminSubject,
  okrAttainment,
  okrRangeColor,
  type OkrCycleDTO,
  type OkrKeyResultDTO,
  type OkrObjectiveDTO,
} from '@legends/shared'

/**
 * Exibição do resultado, como na ImpulseUp:
 *
 * - **acumulado**: o que o servidor calcula — meta que é razão soma o ciclo
 *   inteiro (Σnum ÷ Σden), e é ele que vale como resultado do ciclo;
 * - **por ciclo**: o ÚLTIMO check-in, para responder "como estamos agora".
 *
 * Os dois usam as mesmas funções puras do `@legends/shared` que o servidor usa,
 * então a diferença é só qual valor entra na conta.
 */
export type OkrResultMode = 'acumulado' | 'ciclo'

export const OKR_RESULT_MODES = [
  { key: 'ciclo', label: 'por ciclo' },
  { key: 'acumulado', label: 'acumulado' },
] as const satisfies readonly { key: OkrResultMode; label: string }[]

export const isOkrResultMode = (value: string | null): value is OkrResultMode =>
  OKR_RESULT_MODES.some((mode) => mode.key === value)

export interface OkrResultView {
  value: number | null
  attainment: number | null
  overshoot: number | null
  goalMet: boolean
  color: string | null
  /** O valor mostrado é a soma do ciclo, e não o último check-in. */
  accumulated: boolean
}

/** Resultado de um KR na exibição escolhida. */
export function okrKeyResultView(keyResult: OkrKeyResultDTO, cycle: OkrCycleDTO, mode: OkrResultMode): OkrResultView {
  const accumulated = mode === 'acumulado' && keyResult.accumulatedValue != null
  // Sem acumulado, o DTO já é o último check-in: nada a recalcular.
  if (accumulated || keyResult.accumulatedValue == null) {
    return {
      value: accumulated ? keyResult.accumulatedValue : keyResult.currentValue,
      attainment: keyResult.attainment,
      overshoot: keyResult.overshoot,
      goalMet: keyResult.goalMet,
      color: keyResult.color,
      accumulated,
    }
  }
  const result = okrAttainment(keyResult, keyResult.currentValue)
  return {
    value: keyResult.currentValue,
    attainment: result?.attainment ?? null,
    overshoot: result?.overshoot ?? null,
    goalMet: result?.goalMet ?? false,
    color: okrRangeColor(cycle.progressRanges, result),
    accumulated: false,
  }
}

/**
 * Resultado de um objetivo. Objetivo de um KR só (o caso do tenant hoje) segue
 * o KR e muda com a exibição; com vários KRs vale a agregação do servidor, que
 * é acumulada — recalcular peso e agregação aqui duplicaria a regra.
 */
export function okrObjectiveView(objective: OkrObjectiveDTO, cycle: OkrCycleDTO, mode: OkrResultMode): OkrResultView {
  const single = objective.keyResults.length === 1 ? objective.keyResults[0] : null
  if (single) return okrKeyResultView(single, cycle, mode)
  return {
    value: objective.accumulatedValue ?? objective.currentValue,
    attainment: objective.attainment,
    overshoot: objective.overshoot,
    goalMet: objective.goalMet,
    color: objective.color,
    accumulated: objective.accumulatedValue != null,
  }
}

/** A tela mostra o botão pela MESMA regra que a API confere na escrita. */
export function canAdminOkr(user?: { role?: string | null; adminAccess?: boolean | null; sectorFeatures?: readonly string[] } | null) {
  return isOkrAdminSubject(user ? { role: user.role, adminAccess: user.adminAccess, features: user.sectorFeatures } : null)
}
