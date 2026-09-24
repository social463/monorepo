/**
 * Grava no banco o plano do importador da ImpulseUp (`planImpulseUpImport`).
 *
 * Idempotente por `(companyId, externalSource, externalId)`: rodar de novo com o
 * mesmo snapshot não cria nada e conta tudo como inalterado. Não usa `upsert`
 * porque precisa DIZER o que mudou — o relatório separa criado, atualizado e
 * inalterado — e porque o dry-run percorre o mesmo caminho sem escrever.
 *
 * A origem manda: papéis e dependências dos itens importados são sincronizados
 * como conjunto, então o que alguém acrescentou à mão num item vindo da
 * ImpulseUp sai na próxima importação. Item criado no Legends (sem
 * `externalId`) nunca é tocado.
 *
 * Pessoa é casada por e-mail com `User` da empresa. Quem não existe no Legends
 * fica de fora do papel e entra no relatório — não há pessoa paralela.
 */

import type { Prisma } from '@prisma/client'
import { IMPULSEUP_SOURCE, type ImpulseUpPlan, type PlannedAssignment, type PlannedObjective } from '../lib/impulseup-okr'
import { prisma } from '../lib/prisma'
import { dayFromYmd } from '../lib/sao-paulo-date'

export interface ImportCounts {
  created: number
  updated: number
  unchanged: number
  removed: number
}

export type ImportEntity = 'cycle' | 'objectives' | 'keyResults' | 'assignments' | 'dependencies' | 'checkIns'

export interface ImpulseUpImportReport {
  apply: boolean
  cycleId: string | null
  counts: Record<ImportEntity, ImportCounts>
  checkIns: { total: number; withoutValue: number; synthetic: number }
  unmatchedEmails: string[]
  skippedDependencies: number
}

type Db = Prisma.TransactionClient

const newCounts = (): ImportCounts => ({ created: 0, updated: 0, unchanged: 0, removed: 0 })

/** JSON com chaves ordenadas: o `jsonb` do Postgres devolve as chaves na ordem dele. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  )
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value === undefined) return null
  if (typeof value === 'object' && value !== null) return stableJson(value)
  return value
}

/**
 * Número compara com tolerância relativa: o `double precision` volta do banco
 * com um dígito a menos (1.1764705882352942 → 1.176470588235294), e sem isso
 * toda reimportação "atualizaria" as metas com meta fracionária.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))
  }
  return normalize(a) === normalize(b)
}

function differs(existing: Record<string, unknown>, desired: Record<string, unknown>): boolean {
  return Object.entries(desired).some(([key, value]) => !sameValue(existing[key], value))
}

const date = (ymd: string | null) => (ymd ? dayFromYmd(ymd.slice(0, 10)) : null)

/**
 * Cria, atualiza ou deixa como está. No dry-run devolve um id de mentira
 * (`dry:<externalId>`) para que filhos ainda consigam apontar para o pai.
 */
async function syncRow<T extends { id: string }>(
  counts: ImportCounts,
  apply: boolean,
  externalId: string,
  existing: (T & Record<string, unknown>) | null,
  desired: Record<string, unknown>,
  write: { create: () => Promise<T>; update: (id: string) => Promise<T> },
): Promise<string> {
  if (!existing) {
    counts.created += 1
    return apply ? (await write.create()).id : `dry:${externalId}`
  }
  if (differs(existing, desired)) {
    counts.updated += 1
    if (apply) await write.update(existing.id)
  } else {
    counts.unchanged += 1
  }
  return existing.id
}

/** Pais antes dos filhos; laço ou pai ausente vira raiz (o plano já avisou). */
function topological(objectives: PlannedObjective[]): PlannedObjective[] {
  const byId = new Map(objectives.map((o) => [o.externalId, o]))
  const depth = new Map<string, number>()
  const depthOf = (o: PlannedObjective, seen = new Set<string>()): number => {
    const cached = depth.get(o.externalId)
    if (cached !== undefined) return cached
    const parent = o.parentExternalId ? byId.get(o.parentExternalId) : undefined
    const d = parent && !seen.has(o.externalId) ? depthOf(parent, seen.add(o.externalId)) + 1 : 0
    depth.set(o.externalId, d)
    return d
  }
  return [...objectives].sort((a, b) => depthOf(a) - depthOf(b))
}

export async function importImpulseUpPlan(
  plan: ImpulseUpPlan,
  options: { companyId: string; apply: boolean },
): Promise<ImpulseUpImportReport> {
  const run = (db: Db) => importWith(db, plan, options)
  if (!options.apply) return run(prisma)
  return prisma.$transaction(run, { timeout: 120_000, maxWait: 10_000 })
}

async function importWith(
  db: Db,
  plan: ImpulseUpPlan,
  { companyId, apply }: { companyId: string; apply: boolean },
): Promise<ImpulseUpImportReport> {
  const source = IMPULSEUP_SOURCE
  const counts = {
    cycle: newCounts(),
    objectives: newCounts(),
    keyResults: newCounts(),
    assignments: newCounts(),
    dependencies: newCounts(),
    checkIns: newCounts(),
  } satisfies Record<ImportEntity, ImportCounts>
  const key = (externalId: string) => ({ companyId, externalSource: source, externalId })

  // Pessoas, por e-mail, sem diferenciar caixa.
  const emails = new Set([
    ...plan.objectives.flatMap((o) => o.assignments.map((a) => a.email)),
    ...plan.keyResults.flatMap((kr) => kr.assignments.map((a) => a.email)),
    ...plan.checkIns.flatMap((c) => (c.authorEmail ? [c.authorEmail] : [])),
  ])
  const users = await db.user.findMany({
    where: { companyId, email: { in: [...emails], mode: 'insensitive' } },
    select: { id: true, email: true },
  })
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]))
  const unmatchedEmails = [...emails].filter((email) => !userByEmail.has(email)).sort()

  // Ciclo.
  const c = plan.cycle
  const cycleData = {
    name: c.name,
    description: c.description,
    status: c.status,
    startDate: date(c.startDate) as Date,
    finishDate: date(c.finishDate) as Date,
    forceCommentOnCheckIn: c.forceCommentOnCheckIn,
    updateWindowStart: date(c.updateWindowStart),
    updateWindowFinish: date(c.updateWindowFinish),
    progressRanges: c.progressRanges as unknown as Prisma.InputJsonValue,
    decimals: c.decimals,
  }
  const cycleId = await syncRow(
    counts.cycle,
    apply,
    c.externalId,
    await db.okrCycle.findFirst({ where: key(c.externalId) }),
    cycleData,
    {
      create: () => db.okrCycle.create({ data: { ...key(c.externalId), ...cycleData } }),
      update: (id) => db.okrCycle.update({ where: { id }, data: cycleData }),
    },
  )

  // Objetivos, pais antes dos filhos, com o caminho materializado.
  const objectiveIds = new Map<string, { id: string; path: string[] }>()
  for (const o of topological(plan.objectives)) {
    const parent = o.parentExternalId ? objectiveIds.get(o.parentExternalId) : undefined
    const existing = await db.okrObjective.findFirst({ where: key(o.externalId) })
    const data = {
      cycleId,
      parentId: parent?.id ?? null,
      code: o.code,
      name: o.name,
      description: o.description,
      scope: o.scope,
      status: o.status,
      visibility: o.visibility,
      finishDate: date(o.finishDate),
      weight: o.weight,
      aggregation: o.aggregation,
      confidenceLevel: o.confidenceLevel,
      // Objetivo apagado no Legends e ainda vivo na origem volta.
      deletedAt: null,
    }
    const desired = existing ? { ...data, path: [...(parent?.path ?? []), existing.id] } : data
    const id = await syncRow(counts.objectives, apply, o.externalId, existing, desired, {
      create: async () => {
        const created = await db.okrObjective.create({ data: { ...key(o.externalId), ...data, path: [] } })
        return db.okrObjective.update({ where: { id: created.id }, data: { path: [...(parent?.path ?? []), created.id] } })
      },
      update: (rowId) => db.okrObjective.update({ where: { id: rowId }, data: desired }),
    })
    objectiveIds.set(o.externalId, { id, path: [...(parent?.path ?? []), id] })
    await syncAssignments(db, counts.assignments, apply, companyId, 'OBJECTIVE', id, o.assignments, userByEmail)
  }

  // Key results.
  const krIds = new Map<string, string>()
  for (const kr of plan.keyResults) {
    const objective = objectiveIds.get(kr.objectiveExternalId)
    if (!objective) continue
    const data = {
      objectiveId: objective.id,
      code: kr.code,
      name: kr.name,
      description: kr.description,
      metricType: kr.metricType,
      unit: kr.unit,
      baseline: kr.baseline,
      target: kr.target,
      direction: kr.direction,
      status: kr.status,
      finishDate: date(kr.finishDate),
    }
    const id = await syncRow(
      counts.keyResults,
      apply,
      kr.externalId,
      await db.okrKeyResult.findFirst({ where: key(kr.externalId) }),
      data,
      {
        create: () => db.okrKeyResult.create({ data: { ...key(kr.externalId), ...data } }),
        update: (rowId) => db.okrKeyResult.update({ where: { id: rowId }, data }),
      },
    )
    krIds.set(kr.externalId, id)
    await syncAssignments(db, counts.assignments, apply, companyId, 'KEY_RESULT', id, kr.assignments, userByEmail)
  }

  // Dependências de KR calculado — só entre KRs que vieram no snapshot.
  let skippedDependencies = 0
  for (const kr of plan.keyResults) {
    const id = krIds.get(kr.externalId)
    if (!id) continue
    const desired = kr.dependencies.flatMap((dep) => {
      const target = krIds.get(dep.dependsOnExternalId)
      if (!target) {
        skippedDependencies += 1
        return []
      }
      return [{ dependsOnKrId: target, weight: dep.weight, strategy: dep.strategy, calcType: dep.calcType }]
    })
    const existing = id.startsWith('dry:') ? [] : await db.okrKrDependency.findMany({ where: { companyId, keyResultId: id } })
    for (const row of existing.filter((e) => !desired.some((d) => d.dependsOnKrId === e.dependsOnKrId))) {
      counts.dependencies.removed += 1
      if (apply) await db.okrKrDependency.delete({ where: { id: row.id } })
    }
    for (const dep of desired) {
      const current = existing.find((e) => e.dependsOnKrId === dep.dependsOnKrId) ?? null
      await syncRow(counts.dependencies, apply, `${kr.externalId}->${dep.dependsOnKrId}`, current, dep, {
        create: () => db.okrKrDependency.create({ data: { companyId, keyResultId: id, ...dep } }),
        update: (rowId) => db.okrKrDependency.update({ where: { id: rowId }, data: dep }),
      })
    }
  }

  // Check-ins.
  for (const checkIn of plan.checkIns) {
    const keyResultId = krIds.get(checkIn.keyResultExternalId)
    if (!keyResultId) continue
    const data = {
      keyResultId,
      value: checkIn.value,
      comment: checkIn.comment,
      authorId: checkIn.authorEmail ? (userByEmail.get(checkIn.authorEmail) ?? null) : null,
      effectiveAt: date(checkIn.effectiveAt) as Date,
      deletedAt: checkIn.deletedAt ? new Date(checkIn.deletedAt) : null,
      source: 'IMPULSEUP_IMPORT' as const,
    }
    await syncRow(
      counts.checkIns,
      apply,
      checkIn.externalId,
      await db.okrCheckIn.findFirst({ where: key(checkIn.externalId) }),
      data,
      {
        create: () => db.okrCheckIn.create({ data: { ...key(checkIn.externalId), ...data } }),
        update: (rowId) => db.okrCheckIn.update({ where: { id: rowId }, data }),
      },
    )
  }

  return {
    apply,
    cycleId: apply ? cycleId : cycleId.startsWith('dry:') ? null : cycleId,
    counts,
    checkIns: {
      total: plan.checkIns.length,
      withoutValue: plan.checkIns.filter((c) => c.value == null).length,
      synthetic: plan.checkIns.filter((c) => c.synthetic).length,
    },
    unmatchedEmails,
    skippedDependencies,
  }
}

async function syncAssignments(
  db: Db,
  counts: ImportCounts,
  apply: boolean,
  companyId: string,
  subjectType: 'OBJECTIVE' | 'KEY_RESULT',
  subjectId: string,
  planned: PlannedAssignment[],
  userByEmail: Map<string, string>,
): Promise<void> {
  const desired = planned.flatMap((a) => {
    const personId = userByEmail.get(a.email)
    return personId ? [{ personId, role: a.role }] : []
  })
  const existing = subjectId.startsWith('dry:')
    ? []
    : await db.okrAssignment.findMany({ where: { companyId, subjectType, subjectId } })
  const same = (a: { personId: string; role: string }, b: { personId: string; role: string }) =>
    a.personId === b.personId && a.role === b.role
  for (const row of existing) {
    if (desired.some((d) => same(d, row))) {
      counts.unchanged += 1
    } else {
      counts.removed += 1
      if (apply) await db.okrAssignment.delete({ where: { id: row.id } })
    }
  }
  for (const d of desired.filter((d) => !existing.some((row) => same(d, row)))) {
    counts.created += 1
    if (apply) await db.okrAssignment.create({ data: { companyId, subjectType, subjectId, ...d } })
  }
}
