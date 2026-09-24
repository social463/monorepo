/**
 * Contrato do módulo de Metas e OKRs.
 *
 * Três ideias sustentam o módulo, e as três são divergências deliberadas da
 * ImpulseUp (de onde os dados vêm importados):
 *
 * 1. **O check-in é o fato.** O valor atual de um KR é o `value` do check-in
 *    mais recente por competência (`effectiveAt`) — nunca uma coluna do KR.
 *    Lá o valor mora no KR e o comentário fica solto, sem valor: a série
 *    histórica simplesmente não existe.
 * 2. **Progresso não é atingimento.** `progressLinear` é a barra de sempre,
 *    `(valor − base) / (meta − base)`, mantida por paridade. `attainment`
 *    responde "cumprimos?" e respeita a direção: numa métrica "menor é melhor"
 *    a meta é um TETO. A ImpulseUp ignora `inverted` no cálculo, então um
 *    churn de 15% contra teto de 10% aparece como 150% — cor de conquista.
 *    O semáforo lê `attainment`/`goalMet`, nunca `progressLinear`.
 * 3. **Razão guarda numerador e denominador.** A média das porcentagens de
 *    cada sprint não é a porcentagem do ciclo; Σnum ÷ Σden é.
 *
 * Tudo aqui é função pura, usada pelo servidor para montar o DTO. O front não
 * recalcula regra: recebe os números e o mapa `permissions` prontos.
 *
 * Spec: `docs/superpowers/specs/2026-09-17-modulo-metas-okr-design.md`.
 */

import { isFullAdmin } from './permissions'

export const OKR_CYCLE_STATUSES = ['OPEN', 'CLOSED', 'DRAFT'] as const
export type OkrCycleStatus = (typeof OKR_CYCLE_STATUSES)[number]

export const OKR_SCOPES = ['ORGANIZATION', 'TEAM', 'INDIVIDUAL'] as const
export type OkrScope = (typeof OKR_SCOPES)[number]

export const OKR_STATUSES = ['ACTIVE', 'ARCHIVED', 'CANCELLED'] as const
export type OkrStatus = (typeof OKR_STATUSES)[number]

export const OKR_VISIBILITIES = ['EVERYONE', 'ASSIGNEES', 'PRIVATE'] as const
export type OkrVisibility = (typeof OKR_VISIBILITIES)[number]

export const OKR_AGGREGATIONS = ['KR_ONLY', 'WEIGHTED_KRS', 'CHILDREN', 'MANUAL'] as const
export type OkrAggregation = (typeof OKR_AGGREGATIONS)[number]

export const OKR_CONFIDENCE_LEVELS = ['ON_TRACK', 'ATTENTION_REQUIRED', 'AT_RISK', 'COMPLETED'] as const
export type OkrConfidenceLevel = (typeof OKR_CONFIDENCE_LEVELS)[number]

export const OKR_METRIC_TYPES = ['PERCENTAGE', 'NUMBER', 'CURRENCY'] as const
export type OkrMetricType = (typeof OKR_METRIC_TYPES)[number]

export const OKR_DIRECTIONS = ['HIGHER_IS_BETTER', 'LOWER_IS_BETTER'] as const
export type OkrDirection = (typeof OKR_DIRECTIONS)[number]

export const OKR_ROLES = ['OWNER', 'CREATOR', 'ASSIGNED_TO'] as const
export type OkrRole = (typeof OKR_ROLES)[number]

export const OKR_SUBJECT_TYPES = ['OBJECTIVE', 'KEY_RESULT'] as const
export type OkrSubjectType = (typeof OKR_SUBJECT_TYPES)[number]

export const OKR_CHECK_IN_SOURCES = ['MANUAL', 'AUTOMATION', 'IMPULSEUP_IMPORT'] as const
export type OkrCheckInSource = (typeof OKR_CHECK_IN_SOURCES)[number]

export const OKR_DEPENDENCY_STRATEGIES = ['AVERAGE', 'SUM', 'WEIGHTED_AVERAGE'] as const
export type OkrDependencyStrategy = (typeof OKR_DEPENDENCY_STRATEGIES)[number]

export const OKR_DEPENDENCY_CALC_TYPES = ['PROGRESS', 'VALUE'] as const
export type OkrDependencyCalcType = (typeof OKR_DEPENDENCY_CALC_TYPES)[number]

export const OKR_NAME_MAX_LENGTH = 300
export const OKR_DESCRIPTION_MAX_LENGTH = 5000
export const OKR_CODE_MAX_LENGTH = 40
export const OKR_UNIT_MAX_LENGTH = 20
export const OKR_COMMENT_MAX_LENGTH = 5000
export const OKR_SOURCE_REF_MAX_LENGTH = 2000

/** Tolerância de ponto flutuante para soma de pesos (0,1 + 0,2 ≠ 0,3). */
const WEIGHT_EPSILON = 1e-9

// ------------------------------------------------------------------ valores

/** O mínimo que o cálculo precisa de um check-in. */
export interface OkrCheckInFact {
  value: number | null
  numerator?: number | null
  denominator?: number | null
  /** `YYYY-MM-DD` — a competência. */
  effectiveAt: string
  /** ISO — desempata duas competências iguais. */
  createdAt: string
  deletedAt?: string | null
}

/**
 * Valor atual: o `value` do check-in mais recente por (competência, escrita),
 * entre os que têm valor e não foram apagados. Check-in só de comentário não
 * zera nem apaga o valor — ele simplesmente não conta.
 */
export function okrCurrentValue(checkIns: readonly OkrCheckInFact[]): number | null {
  let best: OkrCheckInFact | null = null
  for (const checkIn of checkIns) {
    if (checkIn.value == null || checkIn.deletedAt) continue
    if (
      !best ||
      checkIn.effectiveAt > best.effectiveAt ||
      (checkIn.effectiveAt === best.effectiveAt && checkIn.createdAt > best.createdAt)
    ) {
      best = checkIn
    }
  }
  return best ? best.value : null
}

/**
 * Acumulado de uma meta que é razão: Σnumerador ÷ Σdenominador × 100, sobre os
 * check-ins que trazem as duas partes. Nulo quando não há nenhum (a meta não é
 * razão, e o valor atual é o último valor) ou quando o denominador soma zero.
 */
export function okrAccumulatedRatio(checkIns: readonly OkrCheckInFact[]): number | null {
  let numerator = 0
  let denominator = 0
  let any = false
  for (const checkIn of checkIns) {
    if (checkIn.deletedAt || checkIn.numerator == null || checkIn.denominator == null) continue
    numerator += checkIn.numerator
    denominator += checkIn.denominator
    any = true
  }
  return okrRatioPercent(any ? numerator : null, any ? denominator : null)
}

/** `num ÷ den × 100`, nulo quando falta parte ou o denominador é zero. */
export function okrRatioPercent(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null
  return (numerator / denominator) * 100
}

// -------------------------------------------------- progresso × atingimento

export interface OkrMetricDefinition {
  baseline: number
  target: number
  direction: OkrDirection
}

/**
 * Progresso linear, igual ao da ImpulseUp — sem direção, sem teto. Existe para
 * a barra e para conferência com a origem. Não use para decidir cor ou sucesso.
 */
export function okrProgressLinear(metric: Pick<OkrMetricDefinition, 'baseline' | 'target'>, value: number | null): number | null {
  if (value == null) return null
  const span = metric.target - metric.baseline
  if (span === 0) return value >= metric.target ? 100 : 0
  return ((value - metric.baseline) / span) * 100
}

export interface OkrAttainment {
  /** 0–1. */
  attainment: number
  /** Quanto passou da meta, em fração (0,07 = 7%). Sempre 0 em "menor é melhor". */
  overshoot: number
  goalMet: boolean
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * "Cumprimos a meta?" — respeita a direção.
 *
 * Em "menor é melhor" a meta é um teto: ficar abaixo dele é 100%, e estourá-lo
 * rende `meta ÷ valor` (um churn de 15 contra teto de 10 é 66,5%, não 150%).
 */
export function okrAttainment(metric: OkrMetricDefinition, value: number | null): OkrAttainment | null {
  if (value == null) return null
  if (metric.direction === 'LOWER_IS_BETTER') {
    const goalMet = value <= metric.target
    const attainment = goalMet || value <= 0 ? 1 : clamp01(metric.target / value)
    return { attainment, overshoot: 0, goalMet }
  }
  const span = metric.target - metric.baseline
  const ratio = span === 0 ? (value >= metric.target ? 1 : 0) : (value - metric.baseline) / span
  return { attainment: clamp01(ratio), overshoot: Math.max(0, ratio - 1), goalMet: value >= metric.target }
}

// ------------------------------------------------------------------- pesos

export interface OkrWeighted {
  weight: number | null
}

/**
 * A soma dos pesos explícitos não pode passar de 1. Devolve a mensagem de erro,
 * ou `null` quando está tudo certo.
 */
export function okrWeightsError(items: readonly OkrWeighted[]): string | null {
  const explicit = items.reduce((sum, item) => sum + (item.weight ?? 0), 0)
  if (items.some((item) => item.weight != null && item.weight < 0)) return 'Peso não pode ser negativo.'
  if (explicit > 1 + WEIGHT_EPSILON) return 'A soma dos pesos passa de 100%.'
  return null
}

/**
 * Peso efetivo de cada item: o explícito vale como está, e os nulos dividem
 * igualmente o que sobra até 1. Se todos forem explícitos e somarem menos de 1,
 * a média ponderada normaliza pela soma — não há "peso fantasma".
 */
export function okrResolveWeights(items: readonly OkrWeighted[]): number[] {
  const explicit = items.reduce((sum, item) => sum + (item.weight ?? 0), 0)
  const nulls = items.filter((item) => item.weight == null).length
  const share = nulls > 0 ? Math.max(0, 1 - explicit) / nulls : 0
  return items.map((item) => item.weight ?? share)
}

/** Média ponderada; nula quando não há item ou o peso total é zero. */
export function okrWeightedAverage(items: readonly (OkrWeighted & { value: number })[]): number | null {
  if (items.length === 0) return null
  const weights = okrResolveWeights(items)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return null
  return items.reduce((sum, item, i) => sum + item.value * weights[i], 0) / total
}

// --------------------------------------------------------------- semáforo

export interface OkrProgressRange {
  /** Pontos percentuais; nulo = sem limite. Mínimo inclusivo, máximo exclusivo. */
  min: number | null
  max: number | null
  color: string
}

/**
 * Cor do semáforo pelo ATINGIMENTO. A faixa "acima de 100" só é alcançada por
 * quem cumpriu a meta (100 + overshoot): um teto estourado nunca chega nela.
 */
/**
 * Semáforo padrão de um ciclo novo — as mesmas quatro faixas da ImpulseUp, que
 * é de onde vieram os ciclos importados. Acima de 100 só se alcança superando
 * a meta, e por isso a última faixa não tem teto.
 */
export const OKR_DEFAULT_PROGRESS_RANGES: readonly OkrProgressRange[] = [
  { min: null, max: 30, color: '#eb5656' },
  { min: 30, max: 60, color: '#fcb813' },
  { min: 60, max: 100, color: '#86bd49' },
  { min: 100, max: null, color: '#64b2cb' },
]

export const OKR_DEFAULT_DECIMALS = { percentage: 2, numeric: 2, currency: 2 }

/**
 * O semáforo precisa cobrir a reta inteira, sem buraco e sem sobreposição: com
 * buraco, um atingimento fica sem cor; com sobreposição, a primeira faixa ganha
 * e a outra some sem aviso. Devolve a mensagem de erro, ou `null`.
 */
export function okrProgressRangesError(ranges: readonly OkrProgressRange[]): string | null {
  if (ranges.length === 0) return 'Informe ao menos uma faixa do semáforo.'
  for (const range of ranges) {
    if (!/^#[0-9a-fA-F]{6}$/.test(range.color)) return `Cor inválida no semáforo: ${range.color}.`
    if (range.min != null && range.max != null && range.min >= range.max) {
      return 'Cada faixa precisa começar antes de terminar.'
    }
  }
  if (ranges[0].min != null) return 'A primeira faixa do semáforo precisa começar sem limite inferior.'
  if (ranges[ranges.length - 1].max != null) return 'A última faixa do semáforo precisa terminar sem limite superior.'
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i - 1].max !== ranges[i].min) return 'As faixas do semáforo precisam ser contínuas, sem buraco nem sobreposição.'
  }
  return null
}

export function okrRangeColor(ranges: readonly OkrProgressRange[], result: OkrAttainment | null): string | null {
  if (!result) return null
  const points = result.goalMet ? 100 + result.overshoot * 100 : Math.min(result.attainment * 100, 100 - WEIGHT_EPSILON)
  const range = ranges.find((r) => (r.min == null || points >= r.min) && (r.max == null || points < r.max))
  return range?.color ?? null
}

// ------------------------------------------------------- avaliação do ciclo

export interface OkrKeyResultInput extends OkrMetricDefinition {
  id: string
  objectiveId: string
  weight: number | null
  /** Valor do check-in mais recente (`okrCurrentValue`). */
  currentValue: number | null
  /** Acumulado da razão no ciclo (`okrAccumulatedRatio`), quando a meta é razão. */
  accumulatedValue: number | null
}

export interface OkrDependencyInput {
  keyResultId: string
  dependsOnKrId: string
  weight: number | null
  strategy: OkrDependencyStrategy
  calcType: OkrDependencyCalcType
}

export interface OkrObjectiveInput {
  id: string
  parentId: string | null
  aggregation: OkrAggregation
  weight: number | null
  manualProgress: number | null
}

export interface OkrResult {
  /** Último valor registrado; nos KRs calculados, o valor derivado. */
  currentValue: number | null
  /** Acumulado da razão no ciclo; nulo quando a meta não é razão. */
  accumulatedValue: number | null
  /** O que entra no cálculo: calculado › acumulado › último valor. */
  effectiveValue: number | null
  progressLinear: number | null
  attainment: number | null
  overshoot: number | null
  goalMet: boolean
  /** KR calculado a partir de outros — somente leitura. */
  calculated: boolean
}

export interface OkrCycleEvaluation {
  keyResults: Map<string, OkrResult>
  objectives: Map<string, OkrResult>
}

const EMPTY_RESULT: OkrResult = {
  currentValue: null,
  accumulatedValue: null,
  effectiveValue: null,
  progressLinear: null,
  attainment: null,
  overshoot: null,
  goalMet: false,
  calculated: false,
}

/** Valor de um KR calculado, pela estratégia, sobre os valores dos dependentes. */
export function okrDependencyValue(
  strategy: OkrDependencyStrategy,
  items: readonly (OkrWeighted & { value: number | null })[],
): number | null {
  const present = items.filter((item): item is OkrWeighted & { value: number } => item.value != null)
  if (present.length === 0) return null
  if (strategy === 'SUM') return present.reduce((sum, item) => sum + item.value, 0)
  if (strategy === 'AVERAGE') return present.reduce((sum, item) => sum + item.value, 0) / present.length
  return okrWeightedAverage(present)
}

/**
 * Calcula KRs e objetivos de um ciclo inteiro de uma vez.
 *
 * Um ciclo só: KR calculado lê outros KRs e objetivo `CHILDREN` lê os filhos,
 * então avaliar um item isolado exigiria carregar a árvore de qualquer jeito.
 * Ciclo de dependência (A depende de B que depende de A) não derruba a leitura —
 * o elo que fecha o laço sai vazio; quem impede isso é a validação de escrita.
 *
 * Na agregação, item sem valor conta como atingimento 0: meta sem check-in não
 * avançou, e ignorá-la inflaria o objetivo.
 */
export function evaluateOkrCycle(input: {
  keyResults: readonly OkrKeyResultInput[]
  dependencies: readonly OkrDependencyInput[]
  objectives: readonly OkrObjectiveInput[]
}): OkrCycleEvaluation {
  const krById = new Map(input.keyResults.map((kr) => [kr.id, kr]))
  const depsByKr = groupBy(input.dependencies, (dep) => dep.keyResultId)
  const krsByObjective = groupBy(input.keyResults, (kr) => kr.objectiveId)
  const childrenByObjective = groupBy(
    input.objectives.filter((objective) => objective.parentId != null),
    (objective) => objective.parentId as string,
  )
  const krResults = new Map<string, OkrResult>()
  const objectiveResults = new Map<string, OkrResult>()
  const visiting = new Set<string>()

  function evaluateKr(id: string): OkrResult {
    const cached = krResults.get(id)
    if (cached) return cached
    const kr = krById.get(id)
    if (!kr || visiting.has(id)) return EMPTY_RESULT
    visiting.add(id)
    const deps = (depsByKr.get(id) ?? []).filter((dep) => krById.has(dep.dependsOnKrId))
    let result: OkrResult
    if (deps.length > 0) {
      const { strategy, calcType } = deps[0]
      const value = okrDependencyValue(
        strategy,
        deps.map((dep) => {
          const inner = evaluateKr(dep.dependsOnKrId)
          return {
            weight: dep.weight,
            value: calcType === 'VALUE' ? inner.effectiveValue : (inner.attainment ?? 0) * 100,
          }
        }),
      )
      result = { ...resultFor(kr, value, null), calculated: true }
    } else {
      result = resultFor(kr, kr.currentValue, kr.accumulatedValue)
    }
    visiting.delete(id)
    krResults.set(id, result)
    return result
  }

  function evaluateObjective(objective: OkrObjectiveInput): OkrResult {
    const cached = objectiveResults.get(objective.id)
    if (cached) return cached
    if (visiting.has(objective.id)) return EMPTY_RESULT
    visiting.add(objective.id)
    let result: OkrResult
    const krs = krsByObjective.get(objective.id) ?? []
    if (objective.aggregation === 'KR_ONLY') {
      result = krs.length > 0 ? { ...evaluateKr(krs[0].id), calculated: false } : EMPTY_RESULT
    } else if (objective.aggregation === 'MANUAL') {
      result = aggregateResult(objective.manualProgress == null ? [] : [{ weight: null, result: manualResult(objective.manualProgress) }])
    } else if (objective.aggregation === 'WEIGHTED_KRS') {
      result = aggregateResult(krs.map((kr) => ({ weight: kr.weight, result: evaluateKr(kr.id) })))
    } else {
      const children = childrenByObjective.get(objective.id) ?? []
      result = aggregateResult(children.map((child) => ({ weight: child.weight, result: evaluateObjective(child) })))
    }
    visiting.delete(objective.id)
    objectiveResults.set(objective.id, result)
    return result
  }

  for (const kr of input.keyResults) evaluateKr(kr.id)
  for (const objective of input.objectives) evaluateObjective(objective)
  return { keyResults: krResults, objectives: objectiveResults }
}

function resultFor(kr: OkrKeyResultInput, currentValue: number | null, accumulatedValue: number | null): OkrResult {
  const effectiveValue = accumulatedValue ?? currentValue
  const attained = okrAttainment(kr, effectiveValue)
  return {
    currentValue,
    accumulatedValue,
    effectiveValue,
    progressLinear: okrProgressLinear(kr, effectiveValue),
    attainment: attained?.attainment ?? null,
    overshoot: attained?.overshoot ?? null,
    goalMet: attained?.goalMet ?? false,
    calculated: false,
  }
}

function manualResult(progress: number): OkrResult {
  const attainment = clamp01(progress)
  return {
    ...EMPTY_RESULT,
    progressLinear: progress * 100,
    attainment,
    overshoot: Math.max(0, progress - 1),
    goalMet: progress >= 1,
  }
}

/** Objetivo agregado: médias ponderadas de atingimento e de progresso linear. */
function aggregateResult(items: readonly { weight: number | null; result: OkrResult }[]): OkrResult {
  if (items.length === 0) return EMPTY_RESULT
  const attainment = okrWeightedAverage(items.map((item) => ({ weight: item.weight, value: item.result.attainment ?? 0 })))
  const progressLinear = okrWeightedAverage(
    items.map((item) => ({ weight: item.weight, value: item.result.progressLinear ?? 0 })),
  )
  const anyValue = items.some((item) => item.result.attainment != null)
  return {
    ...EMPTY_RESULT,
    progressLinear: anyValue ? progressLinear : null,
    attainment: anyValue ? attainment : null,
    overshoot: anyValue ? 0 : null,
    goalMet: anyValue && items.every((item) => item.result.goalMet),
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

/**
 * Um KR calculado fecharia um laço? `edges` são as dependências existentes
 * (KR → de quem depende); `from` é o KR que passaria a depender de `to`.
 */
export function okrDependencyCreatesCycle(
  edges: readonly Pick<OkrDependencyInput, 'keyResultId' | 'dependsOnKrId'>[],
  from: string,
  to: readonly string[],
): boolean {
  const graph = groupBy(edges, (edge) => edge.keyResultId)
  const stack = [...to]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (id === from) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const edge of graph.get(id) ?? []) stack.push(edge.dependsOnKrId)
  }
  return false
}

// -------------------------------------------------------------- permissões

export interface OkrObjectivePermissions {
  updateObjective: boolean
  deleteObjective: boolean
  createKeyResult: boolean
}

export interface OkrKeyResultPermissions {
  updateKeyResult: boolean
  updateKeyResultStatus: boolean
  createCheckIn: boolean
}

export interface OkrCheckInPermissions {
  updateCheckIn: boolean
  deleteCheckIn: boolean
}

export interface OkrPermissionContext {
  isAdmin: boolean
  cycleStatus: OkrCycleStatus
  /** `YYYY-MM-DD`; lado nulo = aberto. */
  updateWindowStart: string | null
  updateWindowFinish: string | null
  /** `YYYY-MM-DD`, no fuso da empresa. */
  today: string
}

/** Hoje está dentro da janela de atualização do ciclo? */
export function okrInsideUpdateWindow(ctx: Pick<OkrPermissionContext, 'updateWindowStart' | 'updateWindowFinish' | 'today'>): boolean {
  if (ctx.updateWindowStart && ctx.today < ctx.updateWindowStart) return false
  if (ctx.updateWindowFinish && ctx.today > ctx.updateWindowFinish) return false
  return true
}

/**
 * Quem enxerga o objetivo. `ASSIGNEES` = qualquer papel nele; `PRIVATE` = só
 * dono e criador. Admin enxerga tudo.
 */
export function canViewOkrObjective(visibility: OkrVisibility, roles: ReadonlySet<OkrRole>, isAdmin: boolean): boolean {
  if (isAdmin || visibility === 'EVERYONE') return true
  if (visibility === 'ASSIGNEES') return roles.size > 0
  return roles.has('OWNER') || roles.has('CREATOR')
}

/** Dono edita a definição; admin faz tudo; ciclo encerrado bloqueia toda escrita. */
/**
 * Quem administra metas: ADMIN pleno (inclui acesso delegado) ou SUBADMIN com o
 * bloco de Gente e Gestão. Mora aqui porque a API decide a escrita e a tela
 * decide o botão — e as duas precisam da MESMA regra.
 */
export function isOkrAdminSubject(subject?: {
  role?: string | null
  adminAccess?: boolean | null
  features?: readonly string[] | null
} | null): boolean {
  if (!subject) return false
  if (isFullAdmin({ role: subject.role as never, adminAccess: subject.adminAccess ?? false })) return true
  return subject.role === 'SUBADMIN' && (subject.features ?? []).includes('gente-gestao')
}

export function okrObjectivePermissions(ctx: OkrPermissionContext, roles: ReadonlySet<OkrRole>): OkrObjectivePermissions {
  const can = ctx.cycleStatus !== 'CLOSED' && (ctx.isAdmin || roles.has('OWNER'))
  return { updateObjective: can, deleteObjective: can, createKeyResult: can }
}

/**
 * `roles` do KR já inclui os papéis no objetivo dele: quem é responsável pelo
 * objetivo responde pelos KRs (é também o que a automação de sprint confere).
 *
 * Check-in: responsável (`ASSIGNED_TO`) ou admin, dentro da janela — admin
 * passa fora dela. KR calculado recusa check-in manual para todo mundo.
 */
export function okrKeyResultPermissions(
  ctx: OkrPermissionContext,
  roles: ReadonlySet<OkrRole>,
  calculated: boolean,
): OkrKeyResultPermissions {
  if (ctx.cycleStatus === 'CLOSED') return { updateKeyResult: false, updateKeyResultStatus: false, createCheckIn: false }
  const owner = ctx.isAdmin || roles.has('OWNER')
  const checkIn =
    !calculated && (ctx.isAdmin || (roles.has('ASSIGNED_TO') && okrInsideUpdateWindow(ctx)))
  return { updateKeyResult: owner, updateKeyResultStatus: owner, createCheckIn: checkIn }
}

/** Check-in: só o autor ou admin, e nunca com o ciclo encerrado. */
export function okrCheckInPermissions(ctx: OkrPermissionContext, isAuthor: boolean): OkrCheckInPermissions {
  const can = ctx.cycleStatus !== 'CLOSED' && (ctx.isAdmin || isAuthor)
  return { updateCheckIn: can, deleteCheckIn: can }
}

// --------------------------------------------------------------------- DTOs

export interface OkrPersonDTO {
  id: string
  name: string
  email: string
  photoUrl: string | null
}

export interface OkrAssignmentDTO {
  person: OkrPersonDTO
  role: OkrRole
}

export interface OkrCycleDTO {
  id: string
  name: string
  description: string | null
  status: OkrCycleStatus
  startDate: string
  finishDate: string
  forceCommentOnCheckIn: boolean
  updateWindowStart: string | null
  updateWindowFinish: string | null
  progressRanges: OkrProgressRange[]
  decimals: { percentage: number; numeric: number; currency: number }
  externalSource: string | null
  externalId: string | null
}

/** Campos calculados, iguais em KR e objetivo. */
export interface OkrComputedDTO {
  currentValue: number | null
  accumulatedValue: number | null
  progressLinear: number | null
  attainment: number | null
  overshoot: number | null
  goalMet: boolean
  color: string | null
}

export interface OkrKeyResultDTO extends OkrComputedDTO {
  id: string
  objectiveId: string
  code: string | null
  name: string
  description: string | null
  metricType: OkrMetricType
  unit: string | null
  baseline: number
  target: number
  direction: OkrDirection
  weight: number | null
  status: OkrStatus
  finishDate: string | null
  calculated: boolean
  dependencies: { dependsOnKrId: string; weight: number | null; strategy: OkrDependencyStrategy; calcType: OkrDependencyCalcType }[]
  assignments: OkrAssignmentDTO[]
  permissions: OkrKeyResultPermissions
}

export interface OkrObjectiveSummaryDTO extends OkrComputedDTO {
  id: string
  cycleId: string
  parentId: string | null
  code: string | null
  name: string
  scope: OkrScope
  status: OkrStatus
  visibility: OkrVisibility
  finishDate: string | null
  weight: number | null
  aggregation: OkrAggregation
  confidenceLevel: OkrConfidenceLevel | null
  path: string[]
  assignments: OkrAssignmentDTO[]
  permissions: OkrObjectivePermissions
}

export interface OkrObjectiveDTO extends OkrObjectiveSummaryDTO {
  description: string | null
  manualProgress: number | null
  keyResults: OkrKeyResultDTO[]
}

export interface OkrCheckInDTO {
  id: string
  keyResultId: string
  value: number | null
  numerator: number | null
  denominator: number | null
  comment: string | null
  author: OkrPersonDTO | null
  effectiveAt: string
  source: OkrCheckInSource
  sourceRef: string | null
  createdAt: string
  permissions: OkrCheckInPermissions
}

export interface OkrCycleSummaryDTO {
  cycleId: string
  objectives: number
  keyResults: number
  /** Média simples do atingimento dos objetivos com valor, 0–1. */
  averageAttainment: number | null
  goalsMet: number
  /** Quantos objetivos caem em cada cor do semáforo (`null` = sem valor). */
  byColor: { color: string | null; count: number }[]
}

export interface OkrPersonResultsDTO {
  person: OkrPersonDTO
  cycleId: string
  objectives: OkrObjectiveDTO[]
}

// ----------------------------------------------------------------- requests

export interface OkrAssignmentInput {
  personId: string
  role: OkrRole
}

export interface OkrDependenciesInput {
  strategy: OkrDependencyStrategy
  calcType: OkrDependencyCalcType
  items: { dependsOnKrId: string; weight?: number | null }[]
}

export interface CreateOkrCycleRequest {
  name: string
  description?: string | null
  status?: OkrCycleStatus
  /** `YYYY-MM-DD`. */
  startDate: string
  finishDate: string
  forceCommentOnCheckIn?: boolean
  updateWindowStart?: string | null
  updateWindowFinish?: string | null
  progressRanges?: OkrProgressRange[]
  decimals?: { percentage: number; numeric: number; currency: number }
}

export type UpdateOkrCycleRequest = Partial<CreateOkrCycleRequest>

export interface CreateOkrObjectiveRequest {
  cycleId: string
  parentId?: string | null
  code?: string | null
  name: string
  description?: string | null
  scope: OkrScope
  status?: OkrStatus
  visibility?: OkrVisibility
  finishDate?: string | null
  weight?: number | null
  aggregation?: OkrAggregation
  manualProgress?: number | null
  confidenceLevel?: OkrConfidenceLevel | null
  /** Substitui o conjunto inteiro de papéis. */
  assignments?: OkrAssignmentInput[]
}

export type UpdateOkrObjectiveRequest = Partial<Omit<CreateOkrObjectiveRequest, 'cycleId'>>

export interface CreateOkrKeyResultRequest {
  code?: string | null
  name: string
  description?: string | null
  metricType: OkrMetricType
  unit?: string | null
  baseline?: number
  target: number
  direction?: OkrDirection
  weight?: number | null
  status?: OkrStatus
  finishDate?: string | null
  assignments?: OkrAssignmentInput[]
  /** `null` transforma o KR calculado de volta em KR de check-in. */
  dependencies?: OkrDependenciesInput | null
}

export type UpdateOkrKeyResultRequest = Partial<CreateOkrKeyResultRequest>

export interface CreateOkrCheckInRequest {
  value?: number | null
  numerator?: number | null
  denominator?: number | null
  comment?: string | null
  /** `YYYY-MM-DD`; padrão: hoje. */
  effectiveAt?: string
  source?: Exclude<OkrCheckInSource, 'IMPULSEUP_IMPORT'>
  sourceRef?: string | null
  /**
   * Confiança no atingimento, declarada junto com o progresso (como na
   * ImpulseUp). Grava no OBJETIVO do KR; ausente não mexe, `null` limpa. Quem
   * pode registrar o check-in pode declarar a confiança — não exige ser dono.
   */
  confidenceLevel?: OkrConfidenceLevel | null
}

export interface UpdateOkrCheckInRequest {
  comment: string | null
}

// ---------------------------------------------------------------- respostas

export interface OkrCycleResponse {
  cycle: OkrCycleDTO
}

export interface OkrCyclesResponse {
  cycles: OkrCycleDTO[]
}

export interface OkrCycleSummaryResponse {
  summary: OkrCycleSummaryDTO
}

export interface OkrObjectiveResponse {
  objective: OkrObjectiveDTO
}

export interface OkrObjectivesResponse {
  objectives: OkrObjectiveDTO[]
}

export interface OkrPersonResultsResponse {
  results: OkrPersonResultsDTO
}

export interface OkrCheckInsResponse {
  checkIns: OkrCheckInDTO[]
}

export interface OkrCheckInResponse {
  checkIn: OkrCheckInDTO
}

// ------------------------------------------------------------------ rótulos

export const OKR_SCOPE_LABELS: Record<OkrScope, string> = {
  ORGANIZATION: 'Empresa',
  TEAM: 'Time',
  INDIVIDUAL: 'Individual',
}

export const OKR_METRIC_TYPE_LABELS: Record<OkrMetricType, string> = {
  PERCENTAGE: 'Porcentagem',
  NUMBER: 'Número',
  CURRENCY: 'Moeda',
}

export const OKR_DIRECTION_LABELS: Record<OkrDirection, string> = {
  HIGHER_IS_BETTER: 'Maior é melhor',
  LOWER_IS_BETTER: 'Menor é melhor',
}

export const OKR_CONFIDENCE_LABELS: Record<OkrConfidenceLevel, string> = {
  ON_TRACK: 'No caminho',
  ATTENTION_REQUIRED: 'Requer atenção',
  AT_RISK: 'Em risco',
  COMPLETED: 'Concluído',
}

export const OKR_ROLE_LABELS: Record<OkrRole, string> = {
  OWNER: 'Dono',
  CREATOR: 'Criador',
  ASSIGNED_TO: 'Responsável',
}

/**
 * Valor de uma métrica como a tela mostra: casas decimais do ciclo, `%` na
 * porcentagem, moeda em reais e unidade livre no número.
 */
export function formatOkrValue(
  value: number | null,
  metric: { metricType: OkrMetricType; unit: string | null },
  decimals: { percentage: number; numeric: number; currency: number },
): string {
  if (value == null) return '—'
  const places =
    metric.metricType === 'PERCENTAGE' ? decimals.percentage : metric.metricType === 'CURRENCY' ? decimals.currency : decimals.numeric
  const number = value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: places })
  if (metric.metricType === 'PERCENTAGE') return `${number}%`
  if (metric.metricType === 'CURRENCY') return `${metric.unit || 'R$'} ${number}`
  return metric.unit ? `${number} ${metric.unit}` : number
}

/**
 * Média simples do atingimento de quem já tem valor (0–1), ou `null` se ninguém
 * tem. É a regra do resumo do ciclo, e a tela usa a mesma para os recortes por
 * escopo: item sem valor fica de fora, e não conta como zero.
 */
export function okrAverageAttainment(items: readonly { attainment: number | null }[]): number | null {
  const withValue = items.filter((item) => item.attainment != null)
  if (withValue.length === 0) return null
  return withValue.reduce((sum, item) => sum + (item.attainment ?? 0), 0) / withValue.length
}

/**
 * Resultado para o rótulo da barra: atingimento mais o que passou da meta
 * (131% numa meta superada). A barra continua cheia em 100%; num TETO o
 * overshoot é sempre 0, então teto estourado nunca aparece acima de 100%.
 */
export function okrResultRatio(item: { attainment: number | null; overshoot: number | null }): number | null {
  return item.attainment == null ? null : item.attainment + (item.overshoot ?? 0)
}

/** Atingimento (0–1) como porcentagem inteira da tela. */
export function formatOkrAttainment(attainment: number | null): string {
  return attainment == null ? '—' : `${Math.round(attainment * 100)}%`
}
