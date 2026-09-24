/**
 * Leitura da ImpulseUp para o importador de metas (one-way: ImpulseUp → Legends).
 *
 * Dois pedaços, os dois sem banco e sem navegador, para serem testáveis:
 *
 * - `crawlImpulseUp` recebe uma função `get(path)` e monta um SNAPSHOT do ciclo.
 *   Só GET, por construção: a função não recebe método. Quem entrega a `get` de
 *   verdade é o script, via `lib.js` da automação de sprint (Playwright com o
 *   Bearer do Keycloak lido do localStorage DENTRO da página — o token nunca
 *   chega a este processo).
 * - `planImpulseUpImport` transforma o snapshot no que vai para as tabelas, com
 *   as regras da §7 da spec. Não decide nada de banco.
 *
 * O rastreio existe porque `individual-result/{ciclo}/{email}` não devolve a
 * árvore inteira: devolve o que aquela pessoa enxerga. Verificado no tenant em
 * 2026-09-17: 35 objetivos pela primeira pessoa, com pais ("Receita B2B",
 * "Receita B2C") e dependências de KR calculado fora do conjunto. Então o
 * crawler segue os e-mails que aparecem nos papéis e busca pai faltante por id.
 *
 * Spec: `docs/superpowers/specs/2026-09-17-modulo-metas-okr-design.md`, §7.
 */

import {
  OKR_CONFIDENCE_LEVELS,
  OKR_CYCLE_STATUSES,
  OKR_SCOPES,
  OKR_STATUSES,
  OKR_VISIBILITIES,
  evaluateOkrCycle,
  type OkrAggregation,
  type OkrConfidenceLevel,
  type OkrCycleStatus,
  type OkrDependencyCalcType,
  type OkrDependencyStrategy,
  type OkrDirection,
  type OkrMetricType,
  type OkrProgressRange,
  type OkrRole,
  type OkrScope,
  type OkrStatus,
  type OkrVisibility,
} from '@legends/shared'
import { ymdInSaoPaulo } from './sao-paulo-date'

export const IMPULSEUP_SOURCE = 'impulseup'

/** Janela para casar o comentário com a atualização de valor (§7.4). */
export const IMPULSEUP_MATCH_WINDOW_MS = 5000

// ------------------------------------------------------ shapes da ImpulseUp

export interface IuPerson {
  userId?: string
  email: string
  fullName?: string | null
}

export type IuPeople = Partial<Record<string, IuPerson[] | null>>

export interface IuCycle {
  id: string
  name: string
  description?: string | null
  status: string
  startDate: string
  finishDate: string
  configuration?: {
    forceCommentForKeyResultProgressUpdate?: boolean | null
    assigneeProgressUpdatesPeriod?: { start?: string | null; finish?: string | null } | null
    progressRanges?: { min: number | null; max: number | null; color: string }[] | null
    percentageDecimalPlaces?: number | null
    numericDecimalPlaces?: number | null
    currencyDecimalPlaces?: number | null
  } | null
}

export interface IuKeyResult {
  id: string
  objectiveId: string
  spreadsheetId?: string | null
  name: string
  description?: string | null
  status: string
  finishDate?: string | null
  people?: IuPeople | null
  metric: {
    '@class': string
    start?: number | null
    target: number
    unit?: string | null
    inverted?: boolean | null
  }
  metricValue: number | null
  progress?: number | null
  calculatedMetricValueConfiguration?: {
    dependsOn?: string[] | null
    strategy?: string | null
    calcType?: string | null
    weights?: Record<string, number> | null
  } | null
  createdAt: string
  lastProgressUpdate?: string | null
}

export interface IuObjective {
  id: string
  cycleId: string
  spreadsheetId?: string | null
  name: string
  description?: string | null
  status: string
  visibility: string
  scope: string
  confidenceLevel?: string | null
  progressConfiguration?: { strategy?: string | null } | null
  finishDate?: string | null
  people?: IuPeople | null
  keyResults?: IuKeyResult[] | null
  progress?: number | null
  weight?: number | null
  parentId?: string | null
  path?: string[] | null
}

export interface IuComment {
  id: string
  comment?: string | null
  person?: IuPerson | null
  keyResultId?: string | null
  createdAt: string
  deletedAt?: string | null
}

export interface IuDashboard {
  total?: number | null
  totalRealized?: number | null
  percentTotal?: number | null
  dataTotal?: { name: string; value: number; color: string }[] | null
}

export interface ImpulseUpSnapshot {
  fetchedAt: string
  cycle: IuCycle
  objectives: IuObjective[]
  /** Comentários por id de KR. */
  comments: Record<string, IuComment[]>
  dashboard: IuDashboard | null
  /** O que o rastreio não alcançou — vai para o relatório. */
  unreachable: { objectives: string[]; keyResults: string[] }
}

// ----------------------------------------------------------------- rastreio

export type ImpulseUpGet = (path: string) => Promise<unknown>

export interface CrawlOptions {
  cycleId: string
  seedEmails: string[]
  /** Teto de pessoas consultadas — cada resposta tem ~650 KB. */
  maxPeople?: number
  log?: (line: string) => void
}

function emailsOf(people: IuPeople | null | undefined): string[] {
  return Object.values(people ?? {}).flatMap((list) => (list ?? []).map((p) => p.email.toLowerCase()))
}

export async function crawlImpulseUp(get: ImpulseUpGet, options: CrawlOptions): Promise<ImpulseUpSnapshot> {
  const log = options.log ?? (() => {})
  const maxPeople = options.maxPeople ?? 150
  const cycle = (await get(`/okr/api/cycles/${options.cycleId}`)) as IuCycle

  const objectives = new Map<string, IuObjective>()
  const add = (objective: IuObjective) => {
    if (objective.cycleId === options.cycleId && !objectives.has(objective.id)) objectives.set(objective.id, objective)
  }
  const queue = [...new Set(options.seedEmails.map((e) => e.toLowerCase()))]
  const visited = new Set<string>()
  const missingObjectives = new Set<string>()

  while (queue.length > 0 || missingParents().length > 0) {
    while (queue.length > 0 && visited.size < maxPeople) {
      const email = queue.shift() as string
      if (visited.has(email)) continue
      visited.add(email)
      let result: { objectives?: IuObjective[] | null }
      try {
        result = (await get(
          `/okr/api/people/handling/individual-result/${options.cycleId}/${encodeURIComponent(email)}`,
        )) as { objectives?: IuObjective[] | null }
      } catch (err) {
        // Pessoa que saiu da empresa, ou sem participação no ciclo: segue o rastreio.
        if (isSessionError(err)) throw err
        log(`  ${email}: ${err instanceof Error ? err.message.slice(0, 120) : 'falhou'}`)
        continue
      }
      for (const objective of result.objectives ?? []) add(objective)
      enqueueNewEmails()
      log(`  pessoa ${visited.size}: ${objectives.size} objetivos conhecidos`)
    }
    queue.length = 0
    const parents = missingParents()
    if (parents.length === 0) break
    for (const id of parents) {
      const found = await getObjective(id)
      // Pai de outro ciclo conta como inalcançável; senão seria pedido de novo a cada volta.
      if (found?.cycleId === options.cycleId) add(found)
      else missingObjectives.add(id)
    }
    enqueueNewEmails()
  }

  function missingParents(): string[] {
    return [...objectives.values()]
      .map((o) => o.parentId)
      .filter((id): id is string => !!id && !objectives.has(id) && !missingObjectives.has(id))
  }

  function enqueueNewEmails() {
    for (const objective of objectives.values()) {
      for (const email of [
        ...emailsOf(objective.people),
        ...(objective.keyResults ?? []).flatMap((kr) => emailsOf(kr.people)),
      ]) {
        if (!visited.has(email) && !queue.includes(email)) queue.push(email)
      }
    }
  }

  /** O detalhe exige permissão de admin; a variante `no-admin` cobre o resto. */
  async function getObjective(id: string): Promise<IuObjective | null> {
    for (const suffix of ['', '/no-admin']) {
      try {
        return (await get(`/okr/api/objectives/${id}${suffix}`)) as IuObjective
      } catch (err) {
        if (isSessionError(err)) throw err
      }
    }
    return null
  }

  const keyResultIds = new Set([...objectives.values()].flatMap((o) => (o.keyResults ?? []).map((kr) => kr.id)))
  const comments: Record<string, IuComment[]> = {}
  for (const objective of objectives.values()) {
    for (const kr of objective.keyResults ?? []) {
      comments[kr.id] = ((await get(
        `/okr/api/objectives/${objective.id}/comments?keyResultId=${kr.id}`,
      )) ?? []) as IuComment[]
    }
  }
  const unreachableKrs = [...objectives.values()]
    .flatMap((o) => o.keyResults ?? [])
    .flatMap((kr) => kr.calculatedMetricValueConfiguration?.dependsOn ?? [])
    .filter((id) => !keyResultIds.has(id))

  let dashboard: IuDashboard | null = null
  try {
    dashboard = (await get(`/okr/api/dashboard/objectives?cycleId=${options.cycleId}`)) as IuDashboard
  } catch (err) {
    if (isSessionError(err)) throw err
  }

  if (visited.size >= maxPeople) log(`  aviso: parou em ${maxPeople} pessoas (--max-people)`)
  return {
    fetchedAt: new Date().toISOString(),
    cycle,
    objectives: [...objectives.values()],
    comments,
    dashboard,
    unreachable: { objectives: [...missingObjectives], keyResults: [...new Set(unreachableKrs)] },
  }
}

/** O `SessionExpired` do `lib.js` é identificado pelo nome, não por instanceof: vem de outro módulo. */
export function isSessionError(err: unknown): boolean {
  return err instanceof Error && err.constructor.name === 'SessionExpired'
}

// ----------------------------------------------------------------- mapeamento

export interface PlannedAssignment {
  email: string
  role: OkrRole
}

export interface PlannedCycle {
  externalId: string
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
}

export interface PlannedObjective {
  externalId: string
  parentExternalId: string | null
  code: string | null
  name: string
  description: string | null
  scope: OkrScope
  status: OkrStatus
  visibility: OkrVisibility
  finishDate: string | null
  weight: number | null
  aggregation: OkrAggregation
  confidenceLevel: OkrConfidenceLevel | null
  assignments: PlannedAssignment[]
  /** `progress` da ImpulseUp, só para conferência. */
  sourceProgress: number | null
}

export interface PlannedKeyResult {
  externalId: string
  objectiveExternalId: string
  code: string | null
  name: string
  description: string | null
  metricType: OkrMetricType
  unit: string | null
  baseline: number
  target: number
  direction: OkrDirection
  status: OkrStatus
  finishDate: string | null
  assignments: PlannedAssignment[]
  dependencies: {
    dependsOnExternalId: string
    weight: number | null
    strategy: OkrDependencyStrategy
    calcType: OkrDependencyCalcType
  }[]
  sourceProgress: number | null
  sourceValue: number | null
}

export interface PlannedCheckIn {
  externalId: string
  keyResultExternalId: string
  value: number | null
  comment: string | null
  authorEmail: string | null
  effectiveAt: string
  deletedAt: string | null
  synthetic: boolean
}

export interface ImpulseUpPlan {
  cycle: PlannedCycle
  objectives: PlannedObjective[]
  keyResults: PlannedKeyResult[]
  checkIns: PlannedCheckIn[]
  warnings: string[]
}

const METRIC_TYPES: Record<string, OkrMetricType> = {
  KeyResultPercentageMetric: 'PERCENTAGE',
  KeyResultNumberMetric: 'NUMBER',
  KeyResultCurrencyMetric: 'CURRENCY',
}

const ROLES: readonly OkrRole[] = ['OWNER', 'CREATOR', 'ASSIGNED_TO']

function oneOf<T extends string>(values: readonly T[], value: string | null | undefined): T | null {
  return value != null && (values as readonly string[]).includes(value) ? (value as T) : null
}

/** A ImpulseUp deixa espaço de largura zero no fim de alguns nomes. */
function cleanText(value: string | null | undefined): string | null {
  const cleaned = (value ?? '').replace(/[​-‍﻿]/g, '').trim()
  return cleaned.length > 0 ? cleaned : null
}

function assignmentsOf(people: IuPeople | null | undefined): PlannedAssignment[] {
  const seen = new Set<string>()
  const out: PlannedAssignment[] = []
  for (const role of ROLES) {
    for (const p of people?.[role] ?? []) {
      const email = p.email.toLowerCase()
      if (seen.has(`${email}:${role}`)) continue
      seen.add(`${email}:${role}`)
      out.push({ email, role })
    }
  }
  return out
}

function aggregationOf(strategy: string | null | undefined, warn: (line: string) => void, name: string): OkrAggregation {
  const s = (strategy ?? 'KR_ONLY').toUpperCase()
  if (s === 'KR_ONLY') return 'KR_ONLY'
  if (s === 'MANUAL') return 'MANUAL'
  if (s.includes('CHILD')) return 'CHILDREN'
  if (s.includes('KEY_RESULT') || s.includes('KR')) return 'WEIGHTED_KRS'
  warn(`objetivo "${name}": estratégia de progresso desconhecida "${strategy}", importado como KR_ONLY`)
  return 'KR_ONLY'
}

export function planImpulseUpImport(snapshot: ImpulseUpSnapshot): ImpulseUpPlan {
  const warnings: string[] = []
  const warn = (line: string) => warnings.push(line)
  const config = snapshot.cycle.configuration ?? {}
  const places = (v: number | null | undefined) => (typeof v === 'number' ? v : 2)

  const cycle: PlannedCycle = {
    externalId: snapshot.cycle.id,
    name: snapshot.cycle.name,
    description: cleanText(snapshot.cycle.description),
    status: oneOf(OKR_CYCLE_STATUSES, snapshot.cycle.status) ?? 'DRAFT',
    startDate: snapshot.cycle.startDate,
    finishDate: snapshot.cycle.finishDate,
    forceCommentOnCheckIn: config.forceCommentForKeyResultProgressUpdate === true,
    updateWindowStart: config.assigneeProgressUpdatesPeriod?.start ?? null,
    updateWindowFinish: config.assigneeProgressUpdatesPeriod?.finish ?? null,
    progressRanges: (config.progressRanges ?? []).map((r) => ({ min: r.min ?? null, max: r.max ?? null, color: r.color })),
    decimals: {
      percentage: places(config.percentageDecimalPlaces),
      numeric: places(config.numericDecimalPlaces),
      currency: places(config.currencyDecimalPlaces),
    },
  }

  const known = new Set(snapshot.objectives.map((o) => o.id))
  const objectives: PlannedObjective[] = []
  const keyResults: PlannedKeyResult[] = []
  const checkIns: PlannedCheckIn[] = []

  for (const o of snapshot.objectives) {
    const name = cleanText(o.name) ?? '(sem nome)'
    if (o.parentId && !known.has(o.parentId)) warn(`objetivo "${name}": pai ${o.parentId} fora do snapshot, importado como raiz`)
    const scope = oneOf(OKR_SCOPES, o.scope)
    if (!scope) warn(`objetivo "${name}": escopo desconhecido "${o.scope}", importado como TEAM`)
    const visibility = oneOf(OKR_VISIBILITIES, o.visibility)
    // Visibilidade desconhecida fecha, não abre.
    if (!visibility) warn(`objetivo "${name}": visibilidade desconhecida "${o.visibility}", importado como ASSIGNEES`)
    objectives.push({
      externalId: o.id,
      parentExternalId: o.parentId && known.has(o.parentId) ? o.parentId : null,
      code: cleanText(o.spreadsheetId),
      name,
      description: cleanText(o.description),
      scope: scope ?? 'TEAM',
      status: oneOf(OKR_STATUSES, o.status) ?? 'ACTIVE',
      visibility: visibility ?? 'ASSIGNEES',
      finishDate: o.finishDate ?? null,
      weight: o.weight ?? null,
      aggregation: aggregationOf(o.progressConfiguration?.strategy, warn, name),
      confidenceLevel: oneOf(OKR_CONFIDENCE_LEVELS, o.confidenceLevel),
      assignments: assignmentsOf(o.people),
      sourceProgress: o.progress ?? null,
    })

    for (const kr of o.keyResults ?? []) {
      const krName = cleanText(kr.name) ?? '(sem nome)'
      const metricType = METRIC_TYPES[kr.metric['@class']]
      if (!metricType) warn(`KR "${krName}": métrica desconhecida "${kr.metric['@class']}", importada como NUMBER`)
      const calc = kr.calculatedMetricValueConfiguration
      const dependsOn = calc?.dependsOn ?? []
      const strategy = oneOf(['AVERAGE', 'SUM', 'WEIGHTED_AVERAGE'] as const, calc?.strategy) ?? 'AVERAGE'
      const calcType = oneOf(['PROGRESS', 'VALUE'] as const, calc?.calcType) ?? 'PROGRESS'
      if (dependsOn.length > 0 && (strategy !== calc?.strategy || calcType !== calc?.calcType)) {
        warn(`KR "${krName}": cálculo "${calc?.strategy}/${calc?.calcType}" desconhecido, importado como ${strategy}/${calcType}`)
      }
      keyResults.push({
        externalId: kr.id,
        objectiveExternalId: o.id,
        code: cleanText(kr.spreadsheetId),
        name: krName,
        description: cleanText(kr.description),
        metricType: metricType ?? 'NUMBER',
        unit: cleanText(kr.metric.unit),
        baseline: kr.metric.start ?? 0,
        target: kr.metric.target,
        direction: kr.metric.inverted ? 'LOWER_IS_BETTER' : 'HIGHER_IS_BETTER',
        status: oneOf(OKR_STATUSES, kr.status) ?? 'ACTIVE',
        finishDate: kr.finishDate ?? null,
        assignments: assignmentsOf(kr.people),
        dependencies: dependsOn.map((id) => ({
          dependsOnExternalId: id,
          weight: calc?.weights?.[id] ?? null,
          strategy,
          calcType,
        })),
        sourceProgress: kr.progress ?? null,
        sourceValue: kr.metricValue,
      })
      checkIns.push(...planCheckIns(kr, snapshot.comments[kr.id] ?? [], dependsOn.length > 0))
    }
  }

  return { cycle, objectives, keyResults, checkIns, warnings }
}

/**
 * §7.4 — o comentário da ImpulseUp não guarda valor, e só existe o valor ATUAL.
 *
 * Cada comentário vira um check-in sem valor. O que foi escrito a menos de 5 s
 * de `lastProgressUpdate` é o que produziu o valor atual e recebe `metricValue`
 * (o mais próximo, se houver mais de um). Sem nenhum casando, e com valor, nasce
 * um check-in sintético. KR calculado não recebe valor: lá ele é derivado.
 */
export function planCheckIns(kr: IuKeyResult, comments: readonly IuComment[], calculated: boolean): PlannedCheckIn[] {
  const lastUpdate = kr.lastProgressUpdate ? Date.parse(kr.lastProgressUpdate) : NaN
  const carriesValue = !calculated && kr.metricValue != null && Number.isFinite(lastUpdate)

  let matchId: string | null = null
  if (carriesValue) {
    let best = Infinity
    for (const c of comments) {
      if (c.deletedAt) continue
      const distance = Math.abs(Date.parse(c.createdAt) - lastUpdate)
      if (distance < IMPULSEUP_MATCH_WINDOW_MS && distance < best) {
        best = distance
        matchId = c.id
      }
    }
  }

  const planned: PlannedCheckIn[] = comments.map((c) => ({
    externalId: c.id,
    keyResultExternalId: kr.id,
    value: c.id === matchId ? kr.metricValue : null,
    comment: cleanText(c.comment),
    authorEmail: c.person?.email?.toLowerCase() ?? null,
    effectiveAt: ymdInSaoPaulo(new Date(c.createdAt)),
    deletedAt: c.deletedAt ?? null,
    synthetic: false,
  }))

  if (carriesValue && !matchId) {
    planned.push({
      externalId: `synthetic:${kr.id}:${kr.lastProgressUpdate}`,
      keyResultExternalId: kr.id,
      value: kr.metricValue,
      comment: null,
      authorEmail: null,
      effectiveAt: ymdInSaoPaulo(new Date(lastUpdate)),
      deletedAt: null,
      synthetic: true,
    })
  }
  return planned
}

// ---------------------------------------------------------------- conferência

export interface ImpulseUpConference {
  /** KRs cujo progresso linear recalculado bate com o `progress` da ImpulseUp. */
  keyResults: { total: number; matched: number; mismatches: { name: string; source: number; ours: number | null }[] }
  /**
   * KRs calculados ficam fora da paridade de propósito: lá a média é do
   * progresso linear dos dependentes, aqui é do atingimento (§6.3) — e parte
   * dos dependentes costuma estar fora do alcance do rastreio.
   */
  calculatedSkipped: string[]
  /** Objetivos do `dashboard/objectives` conferidos pelo nome. */
  dashboard: { total: number; matched: number; mismatches: { name: string; source: number; ours: number | null }[] }
  /**
   * KRs que a ImpulseUp pinta como superados (progresso ≥ 100) e que, pela
   * direção, NÃO cumpriram a meta — e o inverso. É a §6.3 em números.
   */
  divergentColors: { name: string; sourceProgress: number; attainment: number | null; goalMet: boolean }[]
}

const PARITY_TOLERANCE = 0.01

/**
 * Recalcula o plano com as regras do módulo e confere com o que a ImpulseUp
 * mostra. Paridade é no PROGRESSO LINEAR, que é a régua de lá; o atingimento é
 * nosso e só aparece para expor onde as duas réguas discordam.
 */
export function conferImpulseUpPlan(plan: ImpulseUpPlan, dashboard: IuDashboard | null): ImpulseUpConference {
  const byExternal = new Map(plan.keyResults.map((kr) => [kr.externalId, kr]))
  const evaluation = evaluateOkrCycle({
    objectives: plan.objectives.map((o) => ({
      id: o.externalId,
      parentId: o.parentExternalId,
      aggregation: o.aggregation,
      weight: o.weight,
      manualProgress: null,
    })),
    keyResults: plan.keyResults.map((kr) => ({
      id: kr.externalId,
      objectiveId: kr.objectiveExternalId,
      baseline: kr.baseline,
      target: kr.target,
      direction: kr.direction,
      weight: null,
      currentValue: kr.sourceValue,
      accumulatedValue: null,
    })),
    dependencies: plan.keyResults.flatMap((kr) =>
      kr.dependencies
        .filter((dep) => byExternal.has(dep.dependsOnExternalId))
        .map((dep) => ({
          keyResultId: kr.externalId,
          dependsOnKrId: dep.dependsOnExternalId,
          weight: dep.weight,
          strategy: dep.strategy,
          calcType: dep.calcType,
        })),
    ),
  })

  const krMismatches: ImpulseUpConference['keyResults']['mismatches'] = []
  let krTotal = 0
  const divergentColors: ImpulseUpConference['divergentColors'] = []
  const calculatedSkipped: string[] = []
  const calculatedObjectives = new Set<string>()
  for (const kr of plan.keyResults) {
    const result = evaluation.keyResults.get(kr.externalId)
    if (kr.dependencies.length > 0) {
      calculatedSkipped.push(kr.name)
      calculatedObjectives.add(kr.objectiveExternalId)
      continue
    }
    if (kr.sourceValue == null || kr.sourceProgress == null) continue
    krTotal += 1
    const ours = result?.progressLinear ?? null
    if (ours == null || Math.abs(ours - kr.sourceProgress) > PARITY_TOLERANCE) {
      krMismatches.push({ name: kr.name, source: kr.sourceProgress, ours })
    }
    if (result && (kr.sourceProgress >= 100) !== result.goalMet) {
      divergentColors.push({ name: kr.name, sourceProgress: kr.sourceProgress, attainment: result.attainment, goalMet: result.goalMet })
    }
  }

  const dashMismatches: ImpulseUpConference['dashboard']['mismatches'] = []
  const rows = dashboard?.dataTotal ?? []
  for (const row of rows) {
    const name = cleanText(row.name)
    const candidates = plan.objectives.filter((o) => o.name === name)
    if (candidates.some((o) => calculatedObjectives.has(o.externalId))) continue
    const ours = candidates.map((o) => evaluation.objectives.get(o.externalId)?.progressLinear ?? 0)
    if (!ours.some((value) => Math.abs(value - row.value) <= PARITY_TOLERANCE)) {
      dashMismatches.push({ name: name ?? row.name, source: row.value, ours: ours[0] ?? null })
    }
  }

  const dashTotal = rows.length - rows.filter((row) =>
    plan.objectives.some((o) => o.name === cleanText(row.name) && calculatedObjectives.has(o.externalId)),
  ).length
  return {
    keyResults: { total: krTotal, matched: krTotal - krMismatches.length, mismatches: krMismatches },
    calculatedSkipped,
    dashboard: { total: dashTotal, matched: dashTotal - dashMismatches.length, mismatches: dashMismatches },
    divergentColors,
  }
}
