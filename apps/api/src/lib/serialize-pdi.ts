import type { PdiAction, PdiActionEvidence, PdiActionHistory, PdiPlan, User } from '@prisma/client'
import {
  pdiProgressOf,
  type PdiActionDTO,
  type PdiActionEvidenceDTO,
  type PdiActionHistoryEntryDTO,
  type PdiChecklistItem,
  type PdiPersonDTO,
  type PdiPlanDTO,
  type PdiReflection,
} from '@legends/shared'

export function toPdiPersonDTO(user: Pick<User, 'id' | 'name' | 'photoUrl' | 'position'>): PdiPersonDTO {
  return { id: user.id, name: user.name, photoUrl: user.photoUrl, position: user.position }
}

/** Lê a coluna Json do checklist descartando item malformado. */
export function toChecklist(value: unknown): PdiChecklistItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.text !== 'string') return []
    return [{ id: row.id, text: row.text, done: row.done === true }]
  })
}

export function toReflection(value: unknown): PdiReflection | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  return entries.length > 0 ? (Object.fromEntries(entries) as PdiReflection) : null
}

export function toPdiEvidenceDTO(evidence: PdiActionEvidence, downloadUrl: string | null): PdiActionEvidenceDTO {
  return {
    id: evidence.id,
    kind: evidence.kind,
    fileName: evidence.fileName,
    mimeType: evidence.mimeType,
    externalUrl: evidence.externalUrl,
    downloadUrl,
    createdAt: evidence.createdAt.toISOString(),
  }
}

export type PdiActionWithRelations = PdiAction & {
  evidences: PdiActionEvidence[]
  reviewedBy: User | null
}

export function toPdiActionDTO(
  action: PdiActionWithRelations,
  downloadUrls: Map<string, string> = new Map(),
): PdiActionDTO {
  return {
    id: action.id,
    planId: action.planId,
    description: action.description,
    type: action.type,
    priority: action.priority,
    status: action.status,
    dueDate: action.dueDate?.toISOString() ?? null,
    progressPct: action.progressPct,
    competency: action.competency,
    notes: action.notes,
    checklist: toChecklist(action.checklist),
    reflection: toReflection(action.reflection),
    practicalApplication: action.practicalApplication,
    submittedForReviewAt: action.submittedForReviewAt?.toISOString() ?? null,
    reviewedAt: action.reviewedAt?.toISOString() ?? null,
    reviewedBy: action.reviewedBy ? toPdiPersonDTO(action.reviewedBy) : null,
    reviewComment: action.reviewComment,
    completedAt: action.completedAt?.toISOString() ?? null,
    evidences: action.evidences.map((evidence) => toPdiEvidenceDTO(evidence, downloadUrls.get(evidence.id) ?? null)),
    createdAt: action.createdAt.toISOString(),
    updatedAt: action.updatedAt.toISOString(),
  }
}

export type PdiPlanWithRelations = PdiPlan & {
  user: User
  leader: User | null
  actions: PdiActionWithRelations[]
}

export function toPdiPlanDTO(plan: PdiPlanWithRelations, downloadUrls?: Map<string, string>): PdiPlanDTO {
  const actions = plan.actions.map((action) => toPdiActionDTO(action, downloadUrls))
  return {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    cyclePeriod: plan.cyclePeriod,
    startsAt: plan.startsAt?.toISOString() ?? null,
    endsAt: plan.endsAt?.toISOString() ?? null,
    owner: toPdiPersonDTO(plan.user),
    leader: plan.leader ? toPdiPersonDTO(plan.leader) : null,
    actions,
    progressPct: pdiProgressOf(actions),
    createdAt: plan.createdAt.toISOString(),
  }
}

export function toPdiHistoryEntryDTO(entry: PdiActionHistory & { actor: User | null }): PdiActionHistoryEntryDTO {
  return {
    id: entry.id,
    eventType: entry.eventType,
    actor: entry.actor ? toPdiPersonDTO(entry.actor) : null,
    metadata: (typeof entry.metadata === 'object' && entry.metadata !== null && !Array.isArray(entry.metadata)
      ? entry.metadata
      : {}) as Record<string, unknown>,
    createdAt: entry.createdAt.toISOString(),
  }
}
