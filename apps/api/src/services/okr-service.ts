/**
 * Metas e OKRs — ciclos, objetivos, key results e check-ins.
 *
 * Três coisas que este serviço faz e valem a leitura:
 *
 * 1. **Avalia o ciclo inteiro por leitura.** KR calculado lê outros KRs e
 *    objetivo `CHILDREN` lê os filhos, então todo endpoint que devolve número
 *    carrega o grafo do ciclo (`loadCycleGraph`) e chama `evaluateOkrCycle`, do
 *    shared. Um ciclo tem dezenas de objetivos, não milhares.
 * 2. **O valor atual não é coluna.** Sai do check-in mais recente por
 *    competência; o acumulado da razão sai de Σnum ÷ Σden dentro das datas do
 *    ciclo, por SQL.
 * 3. **Autorização é o mapa `permissions`.** A escrita confere o MESMO predicado
 *    que o DTO devolve, para que o botão que o front mostra e o 403 que a API
 *    responde nunca discordem.
 *
 * Spec: `docs/superpowers/specs/2026-09-17-modulo-metas-okr-design.md`.
 */

import type { OkrAssignment, OkrCheckIn, OkrCycle, OkrKeyResult, OkrKrDependency, OkrObjective, Prisma, User } from '@prisma/client'
import {
  OKR_DEFAULT_DECIMALS,
  OKR_DEFAULT_PROGRESS_RANGES,
  canViewOkrObjective,
  evaluateOkrCycle,
  isOkrAdminSubject,
  okrCheckInPermissions,
  okrDependencyCreatesCycle,
  okrKeyResultPermissions,
  okrObjectivePermissions,
  okrProgressRangesError,
  okrAverageAttainment,
  okrRangeColor,
  okrRatioPercent,
  okrWeightsError,
  type CreateOkrCheckInRequest,
  type CreateOkrCycleRequest,
  type CreateOkrKeyResultRequest,
  type CreateOkrObjectiveRequest,
  type OkrAssignmentDTO,
  type OkrAssignmentInput,
  type OkrCheckInDTO,
  type OkrCycleDTO,
  type OkrCycleEvaluation,
  type OkrCycleStatus,
  type OkrCycleSummaryDTO,
  type OkrObjectiveDTO,
  type OkrPermissionContext,
  type OkrPersonResultsDTO,
  type OkrProgressRange,
  type OkrRole,
  type OkrScope,
  type OkrSubjectType,
  type UpdateOkrCheckInRequest,
  type UpdateOkrCycleRequest,
  type UpdateOkrKeyResultRequest,
  type UpdateOkrObjectiveRequest,
} from '@legends/shared'
import { dayFromYmd, todayInSaoPaulo, ymdOf } from '../lib/sao-paulo-date'
import { scopedPrisma } from '../lib/tenant-scope'
import {
  toOkrCheckInDTO,
  toOkrCycleDTO,
  toOkrKeyResultDTO,
  toOkrObjectiveDTO,
  toOkrPersonDTO,
  toProgressRanges,
} from '../lib/serialize-okr'

export class OkrError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'OkrError'
  }
}

export interface OkrViewer {
  userId: string
  companyId: string
  role: string
  adminAccess?: boolean
  features?: string[]
}

/**
 * Quem administra metas: o ADMIN pleno, e o SUBADMIN do setor com o bloco de
 * Gente e Gestão — metas da empresa são do mesmo time que cuida de T&D e PDI.
 */
export function isOkrAdmin(viewer: OkrViewer): boolean {
  // A regra mora no shared: a tela decide o botão com ela, e a escrita confere a mesma.
  return isOkrAdminSubject(viewer)
}

type Db = ReturnType<typeof scopedPrisma>
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0]
type AssignmentWithPerson = OkrAssignment & { person: User }

interface CycleGraph {
  cycle: OkrCycle
  objectives: OkrObjective[]
  keyResults: OkrKeyResult[]
  dependencies: OkrKrDependency[]
  assignments: AssignmentWithPerson[]
  evaluation: OkrCycleEvaluation
  ranges: OkrProgressRange[]
}

/** Carrega e avalia o ciclo inteiro — ver o item 1 do cabeçalho. */
async function loadCycleGraph(db: Db, cycleId: string): Promise<CycleGraph | null> {
  const cycle = await db.okrCycle.findFirst({ where: { id: cycleId } })
  if (!cycle) return null
  const objectives = await db.okrObjective.findMany({
    where: { cycleId, deletedAt: null },
    orderBy: [{ code: 'asc' }, { createdAt: 'asc' }],
  })
  const objectiveIds = objectives.map((objective) => objective.id)
  const keyResults = await db.okrKeyResult.findMany({
    where: { objectiveId: { in: objectiveIds } },
    orderBy: [{ createdAt: 'asc' }],
  })
  const krIds = keyResults.map((kr) => kr.id)
  const [dependencies, assignments, latest, ratios] = await Promise.all([
    db.okrKrDependency.findMany({ where: { keyResultId: { in: krIds } } }),
    db.okrAssignment.findMany({
      where: {
        OR: [
          { subjectType: 'OBJECTIVE', subjectId: { in: objectiveIds } },
          { subjectType: 'KEY_RESULT', subjectId: { in: krIds } },
        ],
      },
      include: { person: true },
      orderBy: [{ createdAt: 'asc' }],
    }),
    db.okrCheckIn.findMany({
      where: { keyResultId: { in: krIds }, deletedAt: null, value: { not: null } },
      orderBy: [{ keyResultId: 'asc' }, { effectiveAt: 'desc' }, { createdAt: 'desc' }],
      distinct: ['keyResultId'],
      select: { keyResultId: true, value: true },
    }),
    db.okrCheckIn.groupBy({
      by: ['keyResultId'],
      where: {
        keyResultId: { in: krIds },
        deletedAt: null,
        numerator: { not: null },
        denominator: { not: null },
        effectiveAt: { gte: cycle.startDate, lte: cycle.finishDate },
      },
      _sum: { numerator: true, denominator: true },
    }),
  ])
  const latestByKr = new Map(latest.map((row) => [row.keyResultId, row.value]))
  const ratioByKr = new Map(
    ratios.map((row) => [row.keyResultId, okrRatioPercent(row._sum.numerator, row._sum.denominator)]),
  )
  const evaluation = evaluateOkrCycle({
    objectives: objectives.map((objective) => ({
      id: objective.id,
      parentId: objective.parentId,
      aggregation: objective.aggregation,
      weight: objective.weight,
      manualProgress: objective.manualProgress,
    })),
    keyResults: keyResults.map((kr) => ({
      id: kr.id,
      objectiveId: kr.objectiveId,
      baseline: kr.baseline,
      target: kr.target,
      direction: kr.direction,
      weight: kr.weight,
      currentValue: latestByKr.get(kr.id) ?? null,
      accumulatedValue: ratioByKr.get(kr.id) ?? null,
    })),
    dependencies,
  })
  return {
    cycle,
    objectives,
    keyResults,
    dependencies,
    assignments,
    evaluation,
    ranges: toProgressRanges(cycle.progressRanges),
  }
}

/** Tudo que a leitura precisa saber sobre QUEM está lendo, calculado uma vez. */
class ViewerLens {
  readonly isAdmin: boolean
  readonly ctx: OkrPermissionContext

  constructor(
    readonly graph: CycleGraph,
    readonly viewer: OkrViewer,
  ) {
    this.isAdmin = isOkrAdmin(viewer)
    this.ctx = permissionContext(graph.cycle, this.isAdmin)
  }

  rolesOn(subjectType: OkrSubjectType, subjectId: string, personId = this.viewer.userId): Set<OkrRole> {
    return new Set(
      this.graph.assignments
        .filter((a) => a.subjectType === subjectType && a.subjectId === subjectId && a.personId === personId)
        .map((a) => a.role),
    )
  }

  /** Papéis no KR somados aos do objetivo dele. */
  rolesOnKeyResult(kr: OkrKeyResult): Set<OkrRole> {
    return new Set([...this.rolesOn('KEY_RESULT', kr.id), ...this.rolesOn('OBJECTIVE', kr.objectiveId)])
  }

  canView(objective: OkrObjective): boolean {
    return canViewOkrObjective(objective.visibility, this.rolesOn('OBJECTIVE', objective.id), this.isAdmin)
  }

  assignmentsOf(subjectType: OkrSubjectType, subjectId: string): OkrAssignmentDTO[] {
    return this.graph.assignments
      .filter((a) => a.subjectType === subjectType && a.subjectId === subjectId)
      .map((a) => ({ person: toOkrPersonDTO(a.person), role: a.role }))
  }

  keyResultPermissions(kr: OkrKeyResult) {
    const calculated = this.graph.dependencies.some((dep) => dep.keyResultId === kr.id)
    return okrKeyResultPermissions(this.ctx, this.rolesOnKeyResult(kr), calculated)
  }

  objectivePermissions(objective: OkrObjective) {
    return okrObjectivePermissions(this.ctx, this.rolesOn('OBJECTIVE', objective.id))
  }

  objectiveDTO(objective: OkrObjective): OkrObjectiveDTO {
    const { graph } = this
    const keyResults = graph.keyResults
      .filter((kr) => kr.objectiveId === objective.id)
      .map((kr) =>
        toOkrKeyResultDTO(kr, {
          result: graph.evaluation.keyResults.get(kr.id),
          ranges: graph.ranges,
          dependencies: graph.dependencies.filter((dep) => dep.keyResultId === kr.id),
          assignments: this.assignmentsOf('KEY_RESULT', kr.id),
          permissions: this.keyResultPermissions(kr),
        }),
      )
    return toOkrObjectiveDTO(objective, {
      result: graph.evaluation.objectives.get(objective.id),
      ranges: graph.ranges,
      assignments: this.assignmentsOf('OBJECTIVE', objective.id),
      permissions: this.objectivePermissions(objective),
      keyResults,
    })
  }

  /** A pessoa tem algum papel no objetivo ou num KR dele? */
  involves(objective: OkrObjective, personId: string): boolean {
    const krIds = new Set(this.graph.keyResults.filter((kr) => kr.objectiveId === objective.id).map((kr) => kr.id))
    return this.graph.assignments.some(
      (a) =>
        a.personId === personId &&
        ((a.subjectType === 'OBJECTIVE' && a.subjectId === objective.id) ||
          (a.subjectType === 'KEY_RESULT' && krIds.has(a.subjectId))),
    )
  }
}

function permissionContext(cycle: OkrCycle, isAdmin: boolean): OkrPermissionContext {
  return {
    isAdmin,
    cycleStatus: cycle.status as OkrCycleStatus,
    updateWindowStart: cycle.updateWindowStart ? ymdOf(cycle.updateWindowStart) : null,
    updateWindowFinish: cycle.updateWindowFinish ? ymdOf(cycle.updateWindowFinish) : null,
    today: todayInSaoPaulo().ymd,
  }
}

async function lensFor(viewer: OkrViewer, cycleId: string): Promise<ViewerLens> {
  const graph = await loadCycleGraph(scopedPrisma(viewer.companyId), cycleId)
  if (!graph) throw new OkrError('Ciclo não encontrado.', 404)
  return new ViewerLens(graph, viewer)
}

/** O objetivo, já com o ciclo avaliado e a visibilidade conferida. */
async function objectiveLens(viewer: OkrViewer, objectiveId: string) {
  const db = scopedPrisma(viewer.companyId)
  const found = await db.okrObjective.findFirst({ where: { id: objectiveId, deletedAt: null } })
  if (!found) throw new OkrError('Objetivo não encontrado.', 404)
  const lens = await lensFor(viewer, found.cycleId)
  const objective = lens.graph.objectives.find((o) => o.id === objectiveId) as OkrObjective
  // Quem não enxerga o objetivo recebe 404, não 403: não confirma que ele existe.
  if (!lens.canView(objective)) throw new OkrError('Objetivo não encontrado.', 404)
  return { db, lens, objective }
}

async function keyResultLens(viewer: OkrViewer, keyResultId: string) {
  const db = scopedPrisma(viewer.companyId)
  const found = await db.okrKeyResult.findFirst({ where: { id: keyResultId }, select: { objectiveId: true } })
  if (!found) throw new OkrError('Key result não encontrado.', 404)
  const { lens, objective } = await objectiveLens(viewer, found.objectiveId).catch((err) => {
    if (err instanceof OkrError && err.status === 404) throw new OkrError('Key result não encontrado.', 404)
    throw err
  })
  const keyResult = lens.graph.keyResults.find((kr) => kr.id === keyResultId) as OkrKeyResult
  return { db, lens, objective, keyResult }
}

// ------------------------------------------------------------------ leitura

export async function listCycles(viewer: OkrViewer, status?: OkrCycleStatus): Promise<OkrCycleDTO[]> {
  const cycles = await scopedPrisma(viewer.companyId).okrCycle.findMany({
    where: status ? { status } : {},
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
  })
  return cycles.map(toOkrCycleDTO)
}

/**
 * Criar ciclo é da administração de metas. Não existe importação obrigatória:
 * o módulo precisa abrir o próximo ciclo sem depender da ImpulseUp.
 */
export async function createCycle(viewer: OkrViewer, input: CreateOkrCycleRequest): Promise<OkrCycleDTO> {
  assertOkrAdmin(viewer)
  const ranges = input.progressRanges ?? [...OKR_DEFAULT_PROGRESS_RANGES]
  assertCycleInput({ ...input, progressRanges: ranges })
  const cycle = await scopedPrisma(viewer.companyId).okrCycle.create({
    data: {
      companyId: viewer.companyId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: input.status ?? 'DRAFT',
      startDate: dayFromYmd(input.startDate),
      finishDate: dayFromYmd(input.finishDate),
      forceCommentOnCheckIn: input.forceCommentOnCheckIn ?? false,
      updateWindowStart: input.updateWindowStart ? dayFromYmd(input.updateWindowStart) : null,
      updateWindowFinish: input.updateWindowFinish ? dayFromYmd(input.updateWindowFinish) : null,
      progressRanges: ranges as unknown as Prisma.InputJsonValue,
      decimals: (input.decimals ?? OKR_DEFAULT_DECIMALS) as unknown as Prisma.InputJsonValue,
    },
  })
  return toOkrCycleDTO(cycle)
}

/**
 * Editar ciclo, inclusive o encerrado: fechar é `status`, e reabrir é o mesmo
 * caminho de volta. `externalSource`/`externalId` não entram — são do
 * importador, e mexer neles quebraria a idempotência da próxima importação.
 */
export async function updateCycle(viewer: OkrViewer, cycleId: string, input: UpdateOkrCycleRequest): Promise<OkrCycleDTO> {
  assertOkrAdmin(viewer)
  const db = scopedPrisma(viewer.companyId)
  const current = await db.okrCycle.findFirst({ where: { id: cycleId } })
  if (!current) throw new OkrError('Ciclo não encontrado.', 404)
  const merged = {
    startDate: input.startDate ?? ymdOf(current.startDate),
    finishDate: input.finishDate ?? ymdOf(current.finishDate),
    updateWindowStart:
      input.updateWindowStart !== undefined
        ? input.updateWindowStart
        : current.updateWindowStart
          ? ymdOf(current.updateWindowStart)
          : null,
    updateWindowFinish:
      input.updateWindowFinish !== undefined
        ? input.updateWindowFinish
        : current.updateWindowFinish
          ? ymdOf(current.updateWindowFinish)
          : null,
    // Só confere o semáforo quando é ele que está sendo trocado: um ciclo antigo
    // com faixa fora do padrão não pode travar a edição do nome ou da data.
    progressRanges: input.progressRanges,
    name: input.name ?? current.name,
  }
  assertCycleInput(merged)
  const cycle = await db.okrCycle.update({
    where: { id: cycleId },
    data: {
      name: input.name?.trim(),
      description: input.description === undefined ? undefined : input.description?.trim() || null,
      status: input.status,
      startDate: input.startDate ? dayFromYmd(input.startDate) : undefined,
      finishDate: input.finishDate ? dayFromYmd(input.finishDate) : undefined,
      forceCommentOnCheckIn: input.forceCommentOnCheckIn,
      updateWindowStart:
        input.updateWindowStart === undefined ? undefined : input.updateWindowStart ? dayFromYmd(input.updateWindowStart) : null,
      updateWindowFinish:
        input.updateWindowFinish === undefined
          ? undefined
          : input.updateWindowFinish
            ? dayFromYmd(input.updateWindowFinish)
            : null,
      progressRanges: input.progressRanges ? (input.progressRanges as unknown as Prisma.InputJsonValue) : undefined,
      decimals: input.decimals ? (input.decimals as unknown as Prisma.InputJsonValue) : undefined,
    },
  })
  return toOkrCycleDTO(cycle)
}

function assertOkrAdmin(viewer: OkrViewer): void {
  if (!isOkrAdmin(viewer)) throw new OkrError('Só a administração de metas mexe em ciclo.', 403)
}

function assertCycleInput(input: {
  name: string
  startDate: string
  finishDate: string
  updateWindowStart?: string | null
  updateWindowFinish?: string | null
  progressRanges?: readonly OkrProgressRange[]
}): void {
  if (!input.name.trim()) throw new OkrError('O ciclo precisa de um nome.', 422)
  if (input.finishDate < input.startDate) throw new OkrError('O ciclo não pode terminar antes de começar.', 422)
  const { updateWindowStart: janelaInicio, updateWindowFinish: janelaFim } = input
  if (janelaInicio && janelaFim && janelaFim < janelaInicio) {
    throw new OkrError('A janela de atualização não pode terminar antes de começar.', 422)
  }
  // A janela mora dentro do ciclo: fora dele, ou trava todo mundo o tempo todo,
  // ou libera check-in em data que o ciclo nem cobre.
  for (const day of [janelaInicio, janelaFim]) {
    if (day && (day < input.startDate || day > input.finishDate)) {
      throw new OkrError('A janela de atualização precisa ficar dentro do ciclo.', 422)
    }
  }
  const rangesError = input.progressRanges ? okrProgressRangesError(input.progressRanges) : null
  if (rangesError) throw new OkrError(rangesError, 422)
}

export async function getCycle(viewer: OkrViewer, cycleId: string): Promise<OkrCycleDTO> {
  const cycle = await scopedPrisma(viewer.companyId).okrCycle.findFirst({ where: { id: cycleId } })
  if (!cycle) throw new OkrError('Ciclo não encontrado.', 404)
  return toOkrCycleDTO(cycle)
}

export async function listCycleObjectives(
  viewer: OkrViewer,
  cycleId: string,
  filters: { scope?: OkrScope; personId?: string; parentId?: string },
): Promise<OkrObjectiveDTO[]> {
  const lens = await lensFor(viewer, cycleId)
  return lens.graph.objectives
    .filter((objective) => lens.canView(objective))
    .filter((objective) => !filters.scope || objective.scope === filters.scope)
    .filter((objective) => !filters.parentId || objective.parentId === filters.parentId)
    .filter((objective) => !filters.personId || lens.involves(objective, filters.personId))
    .map((objective) => lens.objectiveDTO(objective))
}

export async function cycleSummary(viewer: OkrViewer, cycleId: string): Promise<OkrCycleSummaryDTO> {
  const lens = await lensFor(viewer, cycleId)
  const { graph } = lens
  const visible = graph.objectives.filter((objective) => lens.canView(objective))
  const visibleIds = new Set(visible.map((objective) => objective.id))
  const results = visible.map((objective) => graph.evaluation.objectives.get(objective.id))
  const byColor = new Map<string | null, number>()
  for (const result of results) {
    const color =
      result && result.attainment != null
        ? okrRangeColor(graph.ranges, { attainment: result.attainment, overshoot: result.overshoot ?? 0, goalMet: result.goalMet })
        : null
    byColor.set(color, (byColor.get(color) ?? 0) + 1)
  }
  return {
    cycleId,
    objectives: visible.length,
    keyResults: graph.keyResults.filter((kr) => visibleIds.has(kr.objectiveId)).length,
    averageAttainment: okrAverageAttainment(results.map((result) => ({ attainment: result?.attainment ?? null }))),
    goalsMet: results.filter((result) => result?.goalMet).length,
    byColor: [...byColor.entries()].map(([color, count]) => ({ color, count })),
  }
}

export async function getObjective(viewer: OkrViewer, objectiveId: string): Promise<OkrObjectiveDTO> {
  const { lens, objective } = await objectiveLens(viewer, objectiveId)
  return lens.objectiveDTO(objective)
}

export async function personResults(
  viewer: OkrViewer,
  personId: string,
  cycleId: string | undefined,
): Promise<OkrPersonResultsDTO> {
  const db = scopedPrisma(viewer.companyId)
  const person = await db.user.findFirst({ where: { id: personId } })
  if (!person) throw new OkrError('Pessoa não encontrada.', 404)
  const cycle = cycleId
    ? await db.okrCycle.findFirst({ where: { id: cycleId } })
    : await db.okrCycle.findFirst({ where: { status: 'OPEN' }, orderBy: [{ startDate: 'desc' }] })
  if (!cycle) throw new OkrError('Ciclo não encontrado.', 404)
  const lens = await lensFor(viewer, cycle.id)
  return {
    person: toOkrPersonDTO(person),
    cycleId: cycle.id,
    objectives: lens.graph.objectives
      .filter((objective) => lens.canView(objective) && lens.involves(objective, personId))
      .map((objective) => lens.objectiveDTO(objective)),
  }
}

export async function listCheckIns(viewer: OkrViewer, keyResultId: string): Promise<OkrCheckInDTO[]> {
  const { db, lens } = await keyResultLens(viewer, keyResultId)
  const checkIns = await db.okrCheckIn.findMany({
    where: { keyResultId, deletedAt: null },
    orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
    include: { author: true },
  })
  return checkIns.map((checkIn) => toOkrCheckInDTO(checkIn, okrCheckInPermissions(lens.ctx, checkIn.authorId === viewer.userId)))
}

// ------------------------------------------------------------------- escrita

const ymdOrNull = (value: string | null | undefined) => (value ? dayFromYmd(value) : value === null ? null : undefined)

/** Pessoas dos papéis precisam existir na empresa — não há pessoa paralela. */
async function assertPeople(db: Db, assignments: OkrAssignmentInput[] | undefined): Promise<void> {
  if (!assignments || assignments.length === 0) return
  const ids = [...new Set(assignments.map((a) => a.personId))]
  const found = await db.user.count({ where: { id: { in: ids } } })
  if (found !== ids.length) throw new OkrError('Pessoa não encontrada nesta empresa.', 422)
}

async function replaceAssignments(
  tx: Tx,
  companyId: string,
  subjectType: OkrSubjectType,
  subjectId: string,
  assignments: OkrAssignmentInput[],
): Promise<void> {
  await tx.okrAssignment.deleteMany({ where: { companyId, subjectType, subjectId } })
  const unique = new Map(assignments.map((a) => [`${a.personId}:${a.role}`, a]))
  if (unique.size === 0) return
  await tx.okrAssignment.createMany({
    data: [...unique.values()].map((a) => ({ companyId, subjectType, subjectId, personId: a.personId, role: a.role })),
  })
}

function assertWritableCycle(lens: ViewerLens): void {
  if (lens.graph.cycle.status === 'CLOSED') throw new OkrError('O ciclo está encerrado.', 403)
}

function assertSiblingWeights(items: { id: string; weight: number | null }[], id: string | null, weight: number | null): void {
  const siblings = items.filter((item) => item.id !== id).map((item) => ({ weight: item.weight }))
  const error = okrWeightsError([...siblings, { weight }])
  if (error) throw new OkrError(error, 422)
}

/**
 * Criar objetivo: admin cria em qualquer lugar; quem é dono de um objetivo
 * desdobra filhos debaixo dele — é editar a árvore que já é sua.
 */
export async function createObjective(viewer: OkrViewer, input: CreateOkrObjectiveRequest): Promise<OkrObjectiveDTO> {
  const db = scopedPrisma(viewer.companyId)
  const lens = await lensFor(viewer, input.cycleId)
  assertWritableCycle(lens)
  const parent = input.parentId ? lens.graph.objectives.find((o) => o.id === input.parentId) : null
  if (input.parentId && !parent) throw new OkrError('Objetivo pai não encontrado neste ciclo.', 422)
  if (!lens.isAdmin && !(parent && lens.objectivePermissions(parent).updateObjective)) {
    throw new OkrError('Sem permissão para criar objetivo aqui.', 403)
  }
  const siblings = lens.graph.objectives.filter((o) => o.parentId === (input.parentId ?? null))
  assertSiblingWeights(siblings, null, input.weight ?? null)
  await assertPeople(db, input.assignments)

  const id = await db.$transaction(async (tx) => {
    const created = await tx.okrObjective.create({
      data: {
        companyId: viewer.companyId,
        cycleId: input.cycleId,
        parentId: parent?.id ?? null,
        code: input.code ?? null,
        name: input.name,
        description: input.description ?? null,
        scope: input.scope,
        status: input.status,
        visibility: input.visibility,
        finishDate: ymdOrNull(input.finishDate),
        weight: input.weight ?? null,
        aggregation: input.aggregation,
        manualProgress: input.manualProgress ?? null,
        confidenceLevel: input.confidenceLevel ?? null,
        path: [],
      },
    })
    await tx.okrObjective.update({ where: { id: created.id }, data: { path: [...(parent?.path ?? []), created.id] } })
    await replaceAssignments(tx, viewer.companyId, 'OBJECTIVE', created.id, [
      ...(input.assignments ?? []),
      { personId: viewer.userId, role: 'CREATOR' },
    ])
    return created.id
  })
  return getObjective(viewer, id)
}

export async function updateObjective(
  viewer: OkrViewer,
  objectiveId: string,
  input: UpdateOkrObjectiveRequest,
): Promise<OkrObjectiveDTO> {
  const { db, lens, objective } = await objectiveLens(viewer, objectiveId)
  assertWritableCycle(lens)
  if (!lens.objectivePermissions(objective).updateObjective) throw new OkrError('Sem permissão para editar este objetivo.', 403)

  const graph = lens.graph
  const parentId = input.parentId === undefined ? objective.parentId : input.parentId
  const parent = parentId ? graph.objectives.find((o) => o.id === parentId) : null
  if (parentId && !parent) throw new OkrError('Objetivo pai não encontrado neste ciclo.', 422)
  if (parent && (parent.id === objective.id || parent.path.includes(objective.id))) {
    throw new OkrError('Um objetivo não pode ficar debaixo dele mesmo.', 422)
  }
  if (input.weight !== undefined || input.parentId !== undefined) {
    const weight = input.weight === undefined ? objective.weight : input.weight
    assertSiblingWeights(graph.objectives.filter((o) => o.parentId === (parentId ?? null)), objective.id, weight)
  }
  const aggregation = input.aggregation ?? objective.aggregation
  if (aggregation === 'KR_ONLY' && graph.keyResults.filter((kr) => kr.objectiveId === objective.id).length > 1) {
    throw new OkrError('KR_ONLY exige um único key result; o objetivo tem mais de um.', 422)
  }
  await assertPeople(db, input.assignments)

  await db.$transaction(async (tx) => {
    await tx.okrObjective.update({
      where: { id: objective.id },
      data: {
        parentId,
        code: input.code,
        name: input.name,
        description: input.description,
        scope: input.scope,
        status: input.status,
        visibility: input.visibility,
        finishDate: ymdOrNull(input.finishDate),
        weight: input.weight,
        aggregation: input.aggregation,
        manualProgress: input.manualProgress,
        confidenceLevel: input.confidenceLevel,
      },
    })
    if (input.parentId !== undefined && parentId !== objective.parentId) {
      // O caminho materializado da subárvore inteira muda de prefixo.
      const prefix = [...(parent?.path ?? []), objective.id]
      for (const node of graph.objectives.filter((o) => o.path.includes(objective.id))) {
        const tail = node.path.slice(node.path.indexOf(objective.id) + 1)
        await tx.okrObjective.update({ where: { id: node.id }, data: { path: [...prefix, ...tail] } })
      }
    }
    if (input.assignments) {
      // O criador é histórico, não se edita: fica de fora da substituição.
      const creators = graph.assignments
        .filter((a) => a.subjectType === 'OBJECTIVE' && a.subjectId === objective.id && a.role === 'CREATOR')
        .map((a) => ({ personId: a.personId, role: a.role }))
      await replaceAssignments(tx, viewer.companyId, 'OBJECTIVE', objective.id, [
        ...input.assignments.filter((a) => a.role !== 'CREATOR'),
        ...creators,
      ])
    }
  })
  return getObjective(viewer, objective.id)
}

/** Apagar é soft delete da subárvore: filho sem pai sumiria da árvore de qualquer jeito. */
export async function deleteObjective(viewer: OkrViewer, objectiveId: string): Promise<void> {
  const { db, lens, objective } = await objectiveLens(viewer, objectiveId)
  assertWritableCycle(lens)
  if (!lens.objectivePermissions(objective).deleteObjective) throw new OkrError('Sem permissão para excluir este objetivo.', 403)
  await db.okrObjective.updateMany({
    where: { cycleId: objective.cycleId, deletedAt: null, path: { has: objective.id } },
    data: { deletedAt: new Date() },
  })
}

async function validateKeyResultShape(
  lens: ViewerLens,
  objective: OkrObjective,
  keyResultId: string | null,
  input: UpdateOkrKeyResultRequest,
  current: OkrKeyResult | null,
): Promise<void> {
  const { graph } = lens
  const siblings = graph.keyResults.filter((kr) => kr.objectiveId === objective.id)
  if (!current && objective.aggregation === 'KR_ONLY' && siblings.length >= 1) {
    throw new OkrError('Este objetivo usa KR_ONLY e já tem um key result. Mude a agregação para WEIGHTED_KRS.', 422)
  }
  if (input.weight !== undefined) assertSiblingWeights(siblings, keyResultId, input.weight ?? null)
  const deps = input.dependencies
  if (deps) {
    const targets = deps.items.map((item) => item.dependsOnKrId)
    if (keyResultId && targets.includes(keyResultId)) throw new OkrError('Um key result não pode depender dele mesmo.', 422)
    const inCycle = new Set(graph.keyResults.map((kr) => kr.id))
    if (targets.some((id) => !inCycle.has(id))) throw new OkrError('Dependência fora deste ciclo.', 422)
    if (deps.strategy === 'WEIGHTED_AVERAGE') {
      const error = okrWeightsError(deps.items.map((item) => ({ weight: item.weight ?? null })))
      if (error) throw new OkrError(error, 422)
    }
    const otherEdges = graph.dependencies.filter((dep) => dep.keyResultId !== keyResultId)
    if (keyResultId && okrDependencyCreatesCycle(otherEdges, keyResultId, targets)) {
      throw new OkrError('Essa dependência cria um ciclo entre key results.', 422)
    }
  }
}

async function writeDependencies(
  tx: Tx,
  companyId: string,
  keyResultId: string,
  deps: CreateOkrKeyResultRequest['dependencies'],
): Promise<void> {
  if (deps === undefined) return
  await tx.okrKrDependency.deleteMany({ where: { companyId, keyResultId } })
  if (!deps || deps.items.length === 0) return
  await tx.okrKrDependency.createMany({
    data: deps.items.map((item) => ({
      companyId,
      keyResultId,
      dependsOnKrId: item.dependsOnKrId,
      weight: item.weight ?? null,
      strategy: deps.strategy,
      calcType: deps.calcType,
    })),
  })
}

export async function createKeyResult(
  viewer: OkrViewer,
  objectiveId: string,
  input: CreateOkrKeyResultRequest,
): Promise<OkrObjectiveDTO> {
  const { db, lens, objective } = await objectiveLens(viewer, objectiveId)
  assertWritableCycle(lens)
  if (!lens.objectivePermissions(objective).createKeyResult) throw new OkrError('Sem permissão para criar key result aqui.', 403)
  await validateKeyResultShape(lens, objective, null, input, null)
  await assertPeople(db, input.assignments)

  await db.$transaction(async (tx) => {
    const created = await tx.okrKeyResult.create({
      data: {
        companyId: viewer.companyId,
        objectiveId,
        code: input.code ?? null,
        name: input.name,
        description: input.description ?? null,
        metricType: input.metricType,
        unit: input.unit ?? null,
        baseline: input.baseline ?? 0,
        target: input.target,
        direction: input.direction,
        weight: input.weight ?? null,
        status: input.status,
        finishDate: ymdOrNull(input.finishDate),
      },
    })
    await replaceAssignments(tx, viewer.companyId, 'KEY_RESULT', created.id, [
      ...(input.assignments ?? []),
      { personId: viewer.userId, role: 'CREATOR' },
    ])
    await writeDependencies(tx, viewer.companyId, created.id, input.dependencies)
  })
  return getObjective(viewer, objectiveId)
}

/**
 * Editar a definição é do dono (`updateKeyResult`); mudar só o status é o
 * comando separado `updateKeyResultStatus` — hoje com a mesma regra, mas
 * conferido à parte para que as duas possam divergir sem mexer na rota.
 */
export async function updateKeyResult(
  viewer: OkrViewer,
  keyResultId: string,
  input: UpdateOkrKeyResultRequest,
): Promise<OkrObjectiveDTO> {
  const { db, lens, objective, keyResult } = await keyResultLens(viewer, keyResultId)
  assertWritableCycle(lens)
  const permissions = lens.keyResultPermissions(keyResult)
  const onlyStatus = Object.keys(input).every((key) => key === 'status')
  if (!(onlyStatus ? permissions.updateKeyResultStatus : permissions.updateKeyResult)) {
    throw new OkrError('Sem permissão para editar este key result.', 403)
  }
  await validateKeyResultShape(lens, objective, keyResult.id, input, keyResult)
  await assertPeople(db, input.assignments)

  await db.$transaction(async (tx) => {
    await tx.okrKeyResult.update({
      where: { id: keyResult.id },
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        metricType: input.metricType,
        unit: input.unit,
        baseline: input.baseline,
        target: input.target,
        direction: input.direction,
        weight: input.weight,
        status: input.status,
        finishDate: ymdOrNull(input.finishDate),
      },
    })
    if (input.assignments) {
      const creators = lens.graph.assignments
        .filter((a) => a.subjectType === 'KEY_RESULT' && a.subjectId === keyResult.id && a.role === 'CREATOR')
        .map((a) => ({ personId: a.personId, role: a.role }))
      await replaceAssignments(tx, viewer.companyId, 'KEY_RESULT', keyResult.id, [
        ...input.assignments.filter((a) => a.role !== 'CREATOR'),
        ...creators,
      ])
    }
    await writeDependencies(tx, viewer.companyId, keyResult.id, input.dependencies)
  })
  return getObjective(viewer, objective.id)
}

export async function createCheckIn(
  viewer: OkrViewer,
  keyResultId: string,
  input: CreateOkrCheckInRequest,
): Promise<OkrCheckInDTO> {
  const { db, lens, keyResult } = await keyResultLens(viewer, keyResultId)
  assertWritableCycle(lens)
  if (lens.graph.dependencies.some((dep) => dep.keyResultId === keyResult.id)) {
    throw new OkrError('Este key result é calculado a partir de outros e não aceita check-in manual.', 422)
  }
  if (!lens.keyResultPermissions(keyResult).createCheckIn) {
    throw new OkrError(
      lens.rolesOnKeyResult(keyResult).has('ASSIGNED_TO')
        ? 'Fora da janela de atualização do ciclo.'
        : 'Só quem é responsável pelo key result registra check-in.',
      403,
    )
  }

  const comment = input.comment?.trim() || null
  if (lens.graph.cycle.forceCommentOnCheckIn && !comment) {
    throw new OkrError('Este ciclo exige comentário no check-in.', 422)
  }
  const hasRatio = input.numerator != null || input.denominator != null
  if (hasRatio && (input.numerator == null || input.denominator == null)) {
    throw new OkrError('Informe numerador e denominador juntos.', 422)
  }
  if (hasRatio && input.denominator === 0) throw new OkrError('O denominador não pode ser zero.', 422)
  // O fluxo normal SEMPRE traz valor: é a série que faz o módulo existir.
  const value =
    input.value ??
    (hasRatio
      ? keyResult.metricType === 'PERCENTAGE'
        ? ((input.numerator as number) / (input.denominator as number)) * 100
        : (input.numerator as number) / (input.denominator as number)
      : null)
  if (value == null) throw new OkrError('Informe o valor, ou numerador e denominador.', 422)

  // Progresso e confiança são uma declaração só: ou entram os dois, ou nenhum.
  const created = await db.$transaction(async (tx) => {
    const checkIn = await tx.okrCheckIn.create({
      data: {
        companyId: viewer.companyId,
        keyResultId,
        value,
        numerator: input.numerator ?? null,
        denominator: input.denominator ?? null,
        comment,
        authorId: viewer.userId,
        createdById: viewer.userId,
        effectiveAt: dayFromYmd(input.effectiveAt ?? todayInSaoPaulo().ymd),
        source: input.source ?? 'MANUAL',
        sourceRef: input.sourceRef ?? null,
      },
      include: { author: true },
    })
    if (input.confidenceLevel !== undefined) {
      await tx.okrObjective.update({
        where: { id: keyResult.objectiveId },
        data: { confidenceLevel: input.confidenceLevel },
      })
    }
    return checkIn
  })
  return toOkrCheckInDTO(created, okrCheckInPermissions(lens.ctx, true))
}

async function checkInLens(viewer: OkrViewer, checkInId: string) {
  const db = scopedPrisma(viewer.companyId)
  const checkIn = await db.okrCheckIn.findFirst({ where: { id: checkInId, deletedAt: null } })
  if (!checkIn) throw new OkrError('Check-in não encontrado.', 404)
  const { lens } = await keyResultLens(viewer, checkIn.keyResultId).catch((err) => {
    if (err instanceof OkrError && err.status === 404) throw new OkrError('Check-in não encontrado.', 404)
    throw err
  })
  const permissions = okrCheckInPermissions(lens.ctx, checkIn.authorId === viewer.userId)
  return { db, lens, checkIn, permissions }
}

/** Só o comentário é editável: valor e competência errados se corrigem com outro check-in. */
export async function updateCheckIn(
  viewer: OkrViewer,
  checkInId: string,
  input: UpdateOkrCheckInRequest,
): Promise<OkrCheckInDTO> {
  const { db, lens, checkIn, permissions } = await checkInLens(viewer, checkInId)
  if (!permissions.updateCheckIn) throw new OkrError('Sem permissão para editar este check-in.', 403)
  const comment = input.comment?.trim() || null
  if (lens.graph.cycle.forceCommentOnCheckIn && !comment) {
    throw new OkrError('Este ciclo exige comentário no check-in.', 422)
  }
  const updated = await db.okrCheckIn.update({ where: { id: checkIn.id }, data: { comment }, include: { author: true } })
  return toOkrCheckInDTO(updated as OkrCheckIn & { author: User | null }, permissions)
}

/** Soft delete: a série continua auditável, e o valor atual volta ao check-in anterior. */
export async function deleteCheckIn(viewer: OkrViewer, checkInId: string): Promise<void> {
  const { db, checkIn, permissions } = await checkInLens(viewer, checkInId)
  if (!permissions.deleteCheckIn) throw new OkrError('Sem permissão para excluir este check-in.', 403)
  await db.okrCheckIn.update({ where: { id: checkIn.id }, data: { deletedAt: new Date() } })
}
