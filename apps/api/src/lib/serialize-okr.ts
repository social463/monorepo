import type { OkrCheckIn, OkrCycle, OkrKeyResult, OkrKrDependency, OkrObjective, User } from '@prisma/client'
import {
  okrRangeColor,
  type OkrAssignmentDTO,
  type OkrCheckInDTO,
  type OkrCheckInPermissions,
  type OkrComputedDTO,
  type OkrCycleDTO,
  type OkrKeyResultDTO,
  type OkrKeyResultPermissions,
  type OkrObjectiveDTO,
  type OkrObjectivePermissions,
  type OkrPersonDTO,
  type OkrProgressRange,
  type OkrResult,
} from '@legends/shared'
import { ymdOf } from './sao-paulo-date'

export function toOkrPersonDTO(user: Pick<User, 'id' | 'name' | 'email' | 'photoUrl'>): OkrPersonDTO {
  return { id: user.id, name: user.name, email: user.email, photoUrl: user.photoUrl }
}

/** Lê a coluna Json das faixas descartando item malformado. */
export function toProgressRanges(value: unknown): OkrProgressRange[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const row = item as Record<string, unknown>
    if (typeof row.color !== 'string') return []
    const bound = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    return [{ min: bound(row.min), max: bound(row.max), color: row.color }]
  })
}

function toDecimals(value: unknown): OkrCycleDTO['decimals'] {
  const row = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const places = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback)
  return { percentage: places(row.percentage, 2), numeric: places(row.numeric, 2), currency: places(row.currency, 2) }
}

export function toOkrCycleDTO(cycle: OkrCycle): OkrCycleDTO {
  return {
    id: cycle.id,
    name: cycle.name,
    description: cycle.description,
    status: cycle.status,
    startDate: ymdOf(cycle.startDate),
    finishDate: ymdOf(cycle.finishDate),
    forceCommentOnCheckIn: cycle.forceCommentOnCheckIn,
    updateWindowStart: cycle.updateWindowStart ? ymdOf(cycle.updateWindowStart) : null,
    updateWindowFinish: cycle.updateWindowFinish ? ymdOf(cycle.updateWindowFinish) : null,
    progressRanges: toProgressRanges(cycle.progressRanges),
    decimals: toDecimals(cycle.decimals),
    externalSource: cycle.externalSource,
    externalId: cycle.externalId,
  }
}

export function toOkrComputedDTO(result: OkrResult | undefined, ranges: readonly OkrProgressRange[]): OkrComputedDTO {
  const attainment = result?.attainment ?? null
  return {
    currentValue: result?.currentValue ?? null,
    accumulatedValue: result?.accumulatedValue ?? null,
    progressLinear: result?.progressLinear ?? null,
    attainment,
    overshoot: result?.overshoot ?? null,
    goalMet: result?.goalMet ?? false,
    color:
      result && attainment != null
        ? okrRangeColor(ranges, { attainment, overshoot: result.overshoot ?? 0, goalMet: result.goalMet })
        : null,
  }
}

export function toOkrKeyResultDTO(
  kr: OkrKeyResult,
  extra: {
    result: OkrResult | undefined
    ranges: readonly OkrProgressRange[]
    dependencies: OkrKrDependency[]
    assignments: OkrAssignmentDTO[]
    permissions: OkrKeyResultPermissions
  },
): OkrKeyResultDTO {
  return {
    id: kr.id,
    objectiveId: kr.objectiveId,
    code: kr.code,
    name: kr.name,
    description: kr.description,
    metricType: kr.metricType,
    unit: kr.unit,
    baseline: kr.baseline,
    target: kr.target,
    direction: kr.direction,
    weight: kr.weight,
    status: kr.status,
    finishDate: kr.finishDate ? ymdOf(kr.finishDate) : null,
    ...toOkrComputedDTO(extra.result, extra.ranges),
    calculated: extra.dependencies.length > 0,
    dependencies: extra.dependencies.map((dep) => ({
      dependsOnKrId: dep.dependsOnKrId,
      weight: dep.weight,
      strategy: dep.strategy,
      calcType: dep.calcType,
    })),
    assignments: extra.assignments,
    permissions: extra.permissions,
  }
}

export function toOkrObjectiveDTO(
  objective: OkrObjective,
  extra: {
    result: OkrResult | undefined
    ranges: readonly OkrProgressRange[]
    assignments: OkrAssignmentDTO[]
    permissions: OkrObjectivePermissions
    keyResults: OkrKeyResultDTO[]
  },
): OkrObjectiveDTO {
  return {
    id: objective.id,
    cycleId: objective.cycleId,
    parentId: objective.parentId,
    code: objective.code,
    name: objective.name,
    description: objective.description,
    scope: objective.scope,
    status: objective.status,
    visibility: objective.visibility,
    finishDate: objective.finishDate ? ymdOf(objective.finishDate) : null,
    weight: objective.weight,
    aggregation: objective.aggregation,
    manualProgress: objective.manualProgress,
    confidenceLevel: objective.confidenceLevel,
    path: objective.path,
    ...toOkrComputedDTO(extra.result, extra.ranges),
    assignments: extra.assignments,
    permissions: extra.permissions,
    keyResults: extra.keyResults,
  }
}

export function toOkrCheckInDTO(
  checkIn: OkrCheckIn & { author: User | null },
  permissions: OkrCheckInPermissions,
): OkrCheckInDTO {
  return {
    id: checkIn.id,
    keyResultId: checkIn.keyResultId,
    value: checkIn.value,
    numerator: checkIn.numerator,
    denominator: checkIn.denominator,
    comment: checkIn.comment,
    author: checkIn.author ? toOkrPersonDTO(checkIn.author) : null,
    effectiveAt: ymdOf(checkIn.effectiveAt),
    source: checkIn.source,
    sourceRef: checkIn.sourceRef,
    createdAt: checkIn.createdAt.toISOString(),
    permissions,
  }
}
