import type { PdiAction, PdiActionEvidence, Prisma, User } from '@prisma/client'
import {
  isPdiReflectionComplete,
  MAX_PDI_EVIDENCES_PER_ACTION,
  MAX_PDI_PRACTICAL_APPLICATION_LENGTH,
  MIN_PDI_PRACTICAL_APPLICATION_LENGTH,
  pdiProgressOf,
  rolesAboveInHierarchy,
  PDI_REFLECTION_FIELDS,
  type CompletePdiActionRequest,
  type CreatePdiActionRequest,
  type CreatePdiPlanRequest,
  type PdiCycleDTO,
  type PdiDashboardDTO,
  type PdiActionDTO,
  type PdiActionHistoryEntryDTO,
  type PdiActionType,
  type PdiEvidenceInput,
  type PdiPersonDTO,
  type PdiPlanDTO,
  type PdiReviewDecision,
  type PdiReviewQueueItemDTO,
  type PdiShowcaseDTO,
  type PdiShowcaseVisibility,
  type UpdatePdiActionRequest,
  type UpdatePdiPlanRequest,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { oneOnOneHub } from '../lib/one-on-one-hub'
import { deleteS3Object, presignDocumentDownload, s3Config } from '../lib/s3-client'
import {
  toPdiActionDTO,
  toPdiHistoryEntryDTO,
  toPdiPersonDTO,
  toPdiPlanDTO,
  type PdiActionWithRelations,
  type PdiPlanWithRelations,
} from '../lib/serialize-pdi'
import { leaderApprovalRequired } from './development-settings-service'
import { syncPdiBadgesForUser } from './badge-service'
import { notifyPdiActionReviewed, notifyPdiActionAwaitingReview } from './notification-service'
import { settleBadgesEarned } from './badge-reward-service'

export class PdiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'PdiError'
  }
}

export interface PdiViewer {
  userId: string
  companyId: string
}

const PLAN_INCLUDE = {
  user: true,
  leader: true,
  actions: {
    orderBy: [{ createdAt: 'asc' as const }],
    include: { evidences: { orderBy: { createdAt: 'asc' as const } }, reviewedBy: true },
  },
} satisfies Prisma.PdiPlanInclude

const ACTION_INCLUDE = {
  evidences: { orderBy: { createdAt: 'asc' as const } },
  reviewedBy: true,
} satisfies Prisma.PdiActionInclude

/**
 * URLs de download das evidências. Só emitidas depois que o service já decidiu
 * que quem pediu pode ler a ação — a chave nunca sai do servidor.
 */
async function downloadUrlsFor(evidences: PdiActionEvidence[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  if (!s3Config()) return urls
  await Promise.all(
    evidences
      .filter((evidence) => evidence.storageKey)
      .map(async (evidence) => {
        try {
          urls.set(
            evidence.id,
            await presignDocumentDownload({ key: evidence.storageKey as string, fileName: evidence.fileName }),
          )
        } catch {
          // Storage indisponível não pode derrubar a leitura do PDI.
        }
      }),
  )
  return urls
}

async function serializePlan(plan: PdiPlanWithRelations): Promise<PdiPlanDTO> {
  const urls = await downloadUrlsFor(plan.actions.flatMap((action) => action.evidences))
  return toPdiPlanDTO(plan, urls)
}

async function serializeAction(action: PdiActionWithRelations): Promise<PdiActionDTO> {
  return toPdiActionDTO(action, await downloadUrlsFor(action.evidences))
}

/**
 * Avisa dono e líder do plano de que ele mudou, pelo canal de tempo real do 1:1.
 *
 * É a única razão de o PDI empurrar evento: o bloco "Plano de X" aparece na tela
 * do 1:1 e é lido pelos dois. Sem isso, mexer no plano durante a conversa só
 * apareceria para quem mexeu — que é justamente o momento em que as duas pessoas
 * estão olhando o plano juntas. Plano sem líder avisa só o dono (as outras abas
 * dele), e é `oneOnOneHub` mesmo: quem não tem o 1:1 aberto não está conectado, e
 * o evento morre sem destinatário.
 */
function avisarPlano(plan: { userId: string; leaderId: string | null }, ...outros: (string | null)[]): void {
  const destinatarios = [plan.userId, plan.leaderId, ...outros].filter((id): id is string => id !== null)
  oneOnOneHub.emit(destinatarios, { type: 'pdi:changed' })
}

async function recordHistory(input: {
  actionId: string
  eventType: Prisma.PdiActionHistoryCreateInput['eventType']
  actorId: string | null
  companyId: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await scopedPrisma(input.companyId).pdiActionHistory.create({
    data: {
      actionId: input.actionId,
      eventType: input.eventType,
      actorId: input.actorId,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  })
}

// --------------------------------------------------------------------------
// Autorização — o PDI é da pessoa. Regra de negócio, não de tela.
// --------------------------------------------------------------------------

/** Plano que a pessoa pode editar: só o dono. */
async function findOwnedPlan(viewer: PdiViewer, planId: string): Promise<PdiPlanWithRelations> {
  const plan = await scopedPrisma(viewer.companyId).pdiPlan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE })
  // Plano de outra pessoa responde 404: não confirma nem a existência.
  if (!plan) throw new PdiError('Plano não encontrado.', 404)
  if (plan.userId !== viewer.userId) throw new PdiError('Este plano de desenvolvimento não é seu.', 403)
  return plan
}

/** Plano que a pessoa pode ler: o dono e o líder daquele plano. */
async function findReadablePlan(viewer: PdiViewer, planId: string): Promise<PdiPlanWithRelations> {
  const plan = await scopedPrisma(viewer.companyId).pdiPlan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE })
  if (!plan) throw new PdiError('Plano não encontrado.', 404)
  if (plan.userId !== viewer.userId && plan.leaderId !== viewer.userId) {
    throw new PdiError('Você não tem acesso a este plano de desenvolvimento.', 403)
  }
  return plan
}

async function findOwnedAction(viewer: PdiViewer, actionId: string) {
  const action = await scopedPrisma(viewer.companyId).pdiAction.findUnique({
    where: { id: actionId },
    include: { ...ACTION_INCLUDE, plan: true },
  })
  if (!action) throw new PdiError('Ação não encontrada.', 404)
  if (action.plan.userId !== viewer.userId) throw new PdiError('Esta ação não é sua.', 403)
  return action
}

// --------------------------------------------------------------------------
// Planos
// --------------------------------------------------------------------------

export async function listMyPlans(viewer: PdiViewer): Promise<PdiPlanDTO[]> {
  const plans = await scopedPrisma(viewer.companyId).pdiPlan.findMany({
    where: { userId: viewer.userId },
    include: PLAN_INCLUDE,
    orderBy: { createdAt: 'desc' },
  })
  return Promise.all(plans.map(serializePlan))
}

export async function getPlan(viewer: PdiViewer, planId: string): Promise<PdiPlanDTO> {
  return serializePlan(await findReadablePlan(viewer, planId))
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new PdiError('Data inválida.')
  return date
}

/**
 * Quem pode validar o PDI de `viewer`: alguém do **mesmo setor** com papel **acima**
 * na hierarquia (Lenda → Líder/Gerente/Head; Líder → Gerente/Head; Gerente → Head).
 * Head não tem ninguém acima e recebe lista vazia.
 */
export async function listEligibleLeaders(viewer: PdiViewer): Promise<PdiPersonDTO[]> {
  const db = scopedPrisma(viewer.companyId)
  const me = await db.user.findUnique({ where: { id: viewer.userId }, select: { role: true, sectorId: true } })
  if (!me) throw new PdiError('Colaborador não encontrado.', 404)

  const roles = rolesAboveInHierarchy(me.role)
  if (roles.length === 0) return []

  const leaders = await db.user.findMany({
    where: {
      sectorId: me.sectorId,
      role: { in: roles as unknown as Prisma.EnumUserRoleFilter['in'] },
      active: true,
      leftAt: null,
      id: { not: viewer.userId },
    },
    orderBy: { name: 'asc' },
  })
  return leaders.map(toPdiPersonDTO)
}

/**
 * A restrição de quem pode ser líder é regra de negócio, não de tela: sem esta
 * checagem, um POST direto escolheria qualquer pessoa da empresa como validadora.
 */
async function assertLeaderEligible(viewer: PdiViewer, leaderId: string | null): Promise<void> {
  if (!leaderId) return
  if (leaderId === viewer.userId) throw new PdiError('Escolha outra pessoa como líder do plano.')
  const eligible = await listEligibleLeaders(viewer)
  if (!eligible.some((leader) => leader.id === leaderId)) {
    throw new PdiError('Escolha um líder do seu setor com papel acima do seu.', 400)
  }
}

export async function createPlan(viewer: PdiViewer, input: CreatePdiPlanRequest): Promise<PdiPlanDTO> {
  const title = input.title.trim()
  if (!title) throw new PdiError('Informe o título do plano.')
  await assertLeaderEligible(viewer, input.leaderId ?? null)

  const plan = await scopedPrisma(viewer.companyId).pdiPlan.create({
    data: {
      userId: viewer.userId,
      leaderId: input.leaderId ?? null,
      title,
      status: input.status ?? 'DRAFT',
      cyclePeriod: input.cyclePeriod?.trim() || null,
      startsAt: parseDate(input.startsAt),
      endsAt: parseDate(input.endsAt),
    },
    include: PLAN_INCLUDE,
  })
  avisarPlano(plan)
  return serializePlan(plan)
}

export async function updatePlan(viewer: PdiViewer, planId: string, input: UpdatePdiPlanRequest): Promise<PdiPlanDTO> {
  const anterior = await findOwnedPlan(viewer, planId)
  if (input.leaderId !== undefined) await assertLeaderEligible(viewer, input.leaderId ?? null)

  const data: Prisma.PdiPlanUpdateInput = {}
  if (input.title !== undefined) {
    const title = input.title.trim()
    if (!title) throw new PdiError('Informe o título do plano.')
    data.title = title
  }
  if (input.status !== undefined) data.status = input.status
  if (input.cyclePeriod !== undefined) data.cyclePeriod = input.cyclePeriod?.trim() || null
  if (input.startsAt !== undefined) data.startsAt = parseDate(input.startsAt)
  if (input.endsAt !== undefined) data.endsAt = parseDate(input.endsAt)
  if (input.leaderId !== undefined) {
    data.leader = input.leaderId ? { connect: { id: input.leaderId } } : { disconnect: true }
  }

  const plan = await scopedPrisma(viewer.companyId).pdiPlan.update({
    where: { id: planId },
    data,
    include: PLAN_INCLUDE,
  })
  // O líder ANTERIOR entra na lista: trocar de líder faz o bloco do plano sumir
  // do 1:1 dele, e sumir também é mudança que a tela precisa saber.
  avisarPlano(plan, anterior.leaderId)
  return serializePlan(plan)
}

export async function deletePlan(viewer: PdiViewer, planId: string): Promise<void> {
  const plan = await findOwnedPlan(viewer, planId)
  await removeEvidenceObjects(plan.actions.flatMap((action) => action.evidences))
  await scopedPrisma(viewer.companyId).pdiPlan.delete({ where: { id: planId } })
  avisarPlano(plan)
}

// --------------------------------------------------------------------------
// Ações
// --------------------------------------------------------------------------

function normalizeChecklist(items: CreatePdiActionRequest['checklist']): Prisma.InputJsonValue {
  return (items ?? []).map((item) => ({ id: item.id, text: item.text.trim(), done: item.done === true }))
}

export async function createAction(
  viewer: PdiViewer,
  planId: string,
  input: CreatePdiActionRequest,
): Promise<PdiActionDTO> {
  const plan = await findOwnedPlan(viewer, planId)
  const description = input.description.trim()
  if (!description) throw new PdiError('Descreva a ação de desenvolvimento.')

  const action = await scopedPrisma(viewer.companyId).pdiAction.create({
    data: {
      planId,
      description,
      type: input.type,
      priority: input.priority,
      dueDate: parseDate(input.dueDate),
      competency: input.competency?.trim() || null,
      notes: input.notes?.trim() || null,
      checklist: normalizeChecklist(input.checklist),
    },
    include: ACTION_INCLUDE,
  })
  await recordHistory({ actionId: action.id, eventType: 'CREATED', actorId: viewer.userId, companyId: viewer.companyId })
  avisarPlano(plan)
  return serializeAction(action)
}

export async function updateAction(
  viewer: PdiViewer,
  actionId: string,
  input: UpdatePdiActionRequest,
): Promise<PdiActionDTO> {
  const current = await findOwnedAction(viewer, actionId)
  if (current.status === 'AWAITING_REVIEW') {
    throw new PdiError('A ação está aguardando validação do líder.', 409)
  }
  if (current.status === 'DONE') {
    throw new PdiError('A ação já foi concluída.', 409)
  }

  const data: Prisma.PdiActionUpdateInput = {}
  if (input.description !== undefined) {
    const description = input.description.trim()
    if (!description) throw new PdiError('Descreva a ação de desenvolvimento.')
    data.description = description
  }
  if (input.type !== undefined) data.type = input.type
  if (input.priority !== undefined) data.priority = input.priority
  if (input.dueDate !== undefined) data.dueDate = parseDate(input.dueDate)
  if (input.competency !== undefined) data.competency = input.competency?.trim() || null
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null
  if (input.checklist !== undefined) data.checklist = normalizeChecklist(input.checklist)
  if (input.progressPct !== undefined) {
    if (!Number.isInteger(input.progressPct) || input.progressPct < 0 || input.progressPct > 100) {
      throw new PdiError('O progresso precisa ser um número inteiro de 0 a 100.')
    }
    data.progressPct = input.progressPct
    // O progresso da ação é informado pela pessoa (diferente do curso, que é derivado).
    if (input.progressPct > 0 && current.status === 'NOT_STARTED') {
      data.status = 'IN_PROGRESS'
      data.startedAt = current.startedAt ?? new Date()
    }
  }
  if (input.status !== undefined) {
    data.status = input.status
    if (input.status === 'IN_PROGRESS' && !current.startedAt) data.startedAt = new Date()
  }

  const action = await scopedPrisma(viewer.companyId).pdiAction.update({
    where: { id: actionId },
    data,
    include: ACTION_INCLUDE,
  })
  if (input.progressPct !== undefined && input.progressPct !== current.progressPct) {
    await recordHistory({
      actionId,
      eventType: 'PROGRESS_UPDATED',
      actorId: viewer.userId,
      companyId: viewer.companyId,
      metadata: { from: current.progressPct, to: input.progressPct },
    })
  }
  avisarPlano(current.plan)
  return serializeAction(action)
}

export async function deleteAction(viewer: PdiViewer, actionId: string): Promise<void> {
  const action = await findOwnedAction(viewer, actionId)
  // Excluir a ação leva as evidências do storage junto.
  await removeEvidenceObjects(action.evidences)
  await scopedPrisma(viewer.companyId).pdiAction.delete({ where: { id: actionId } })
  avisarPlano(action.plan)
}

/**
 * Concede/revoga os selos de PDI de `userId` e avisa a pessoa. Best-effort:
 * falhar aqui não pode desfazer a conclusão nem a decisão do líder — mesmo
 * padrão da avaliação de selos pós-voto.
 */
async function syncPdiBadges(userId: string, companyId: string): Promise<void> {
  try {
    const { awarded } = await syncPdiBadgesForUser(userId)
    if (awarded.length === 0) return
    await settleBadgesEarned(userId, awarded.map((entry) => entry.badgeId), companyId)
  } catch {
    // silencioso de propósito
  }
}

/** Best-effort: falha ao apagar no storage não impede remover a ação do banco. */
async function removeEvidenceObjects(evidences: PdiActionEvidence[]): Promise<void> {
  if (!s3Config()) return
  await Promise.all(
    evidences
      .filter((evidence) => evidence.storageKey)
      .map(async (evidence) => {
        try {
          await deleteS3Object(evidence.storageKey as string)
        } catch {
          // silencioso de propósito
        }
      }),
  )
}

// --------------------------------------------------------------------------
// Conclusão guiada
// --------------------------------------------------------------------------

function validateEvidences(evidences: PdiEvidenceInput[]): void {
  if (evidences.length > MAX_PDI_EVIDENCES_PER_ACTION) {
    throw new PdiError(`Anexe no máximo ${MAX_PDI_EVIDENCES_PER_ACTION} evidências.`)
  }
  for (const evidence of evidences) {
    if (!evidence.storageKey && !evidence.externalUrl) {
      throw new PdiError('Cada evidência precisa de um arquivo ou de um link.')
    }
  }
  if (!evidences.some((evidence) => evidence.kind === 'COMPLETION')) {
    throw new PdiError('Anexe ao menos uma evidência da conclusão (arquivo ou link).')
  }
}

export async function completeAction(
  viewer: PdiViewer,
  actionId: string,
  input: CompletePdiActionRequest,
): Promise<{ action: PdiActionDTO; awaitingReview: boolean }> {
  const current = await findOwnedAction(viewer, actionId)
  if (current.status === 'DONE') throw new PdiError('A ação já foi concluída.', 409)
  if (current.status === 'AWAITING_REVIEW') throw new PdiError('A ação já está aguardando validação.', 409)

  const practicalApplication = input.practicalApplication.trim()
  if (practicalApplication.length < MIN_PDI_PRACTICAL_APPLICATION_LENGTH) {
    throw new PdiError('Descreva como você aplicou (ou aplicará) esse aprendizado.')
  }
  if (practicalApplication.length > MAX_PDI_PRACTICAL_APPLICATION_LENGTH) {
    throw new PdiError('A descrição da aplicação prática ficou longa demais.')
  }
  if (!isPdiReflectionComplete(input.reflection)) {
    throw new PdiError('Responda ao menos a primeira pergunta da reflexão.')
  }
  validateEvidences(input.evidences)

  const reflection = Object.fromEntries(
    PDI_REFLECTION_FIELDS.map((field) => [field.key, input.reflection[field.key]?.trim() ?? '']).filter(
      ([, value]) => value !== '',
    ),
  ) as Prisma.InputJsonValue

  const requiresReview = await leaderApprovalRequired(viewer.companyId)
  // Sem líder no plano não há quem valide: a ação conclui direto.
  const awaitingReview = requiresReview && current.plan.leaderId != null
  const now = new Date()

  const db = scopedPrisma(viewer.companyId)
  const action = await db.pdiAction.update({
    where: { id: actionId },
    data: {
      practicalApplication,
      reflection,
      progressPct: 100,
      status: awaitingReview ? 'AWAITING_REVIEW' : 'DONE',
      submittedForReviewAt: awaitingReview ? now : null,
      completedAt: awaitingReview ? null : now,
      reviewComment: null,
      reviewedAt: null,
      reviewedById: null,
      evidences: {
        // A conclusão substitui as evidências anteriores (a pessoa pode refazer o fluxo).
        deleteMany: {},
        create: input.evidences.map((evidence) => ({
          kind: evidence.kind,
          storageKey: evidence.storageKey ?? null,
          fileName: evidence.fileName ?? null,
          mimeType: evidence.mimeType ?? null,
          externalUrl: evidence.externalUrl ?? null,
          uploadedById: viewer.userId,
          companyId: viewer.companyId,
        })),
      },
    },
    include: ACTION_INCLUDE,
  })
  await removeEvidenceObjects(current.evidences)

  await recordHistory({
    actionId,
    eventType: awaitingReview ? 'SUBMITTED_FOR_REVIEW' : 'COMPLETED',
    actorId: viewer.userId,
    companyId: viewer.companyId,
  })

  // Só conta selo quando a ação chega de fato em DONE; se foi para a fila do
  // líder, o selo espera a aprovação.
  if (!awaitingReview) await syncPdiBadges(viewer.userId, viewer.companyId)

  if (awaitingReview && current.plan.leaderId) {
    // Notificação é best-effort: falha no envio não desfaz a conclusão.
    try {
      await notifyPdiActionAwaitingReview({
        leaderId: current.plan.leaderId,
        actorId: viewer.userId,
        actionId,
        description: action.description,
        companyId: viewer.companyId,
      })
    } catch {
      // silencioso de propósito
    }
  }

  avisarPlano(current.plan)
  return { action: await serializeAction(action), awaitingReview }
}

// --------------------------------------------------------------------------
// Validação do líder
// --------------------------------------------------------------------------

export async function listPendingReviews(viewer: PdiViewer): Promise<PdiReviewQueueItemDTO[]> {
  const actions = await scopedPrisma(viewer.companyId).pdiAction.findMany({
    where: { status: 'AWAITING_REVIEW', plan: { leaderId: viewer.userId } },
    include: {
      ...ACTION_INCLUDE,
      // As ações do plano vêm junto só para o progresso do ciclo aparecer na
      // lista do líder — a fila em si continua sendo só o que aguarda validação.
      plan: { include: { user: true, actions: { select: { progressPct: true, status: true } } } },
    },
    orderBy: { submittedForReviewAt: 'asc' },
  })

  const urls = await downloadUrlsFor(actions.flatMap((action) => action.evidences))
  return actions.map((action) => ({
    action: toPdiActionDTO(action, urls),
    plan: {
      id: action.plan.id,
      title: action.plan.title,
      cyclePeriod: action.plan.cyclePeriod,
      progressPct: pdiProgressOf(action.plan.actions),
    },
    owner: toPdiPersonDTO(action.plan.user),
  }))
}

export async function reviewAction(
  viewer: PdiViewer,
  actionId: string,
  input: { decision: PdiReviewDecision; comment?: string | null },
): Promise<PdiActionDTO> {
  const db = scopedPrisma(viewer.companyId)
  const current = await db.pdiAction.findUnique({ where: { id: actionId }, include: { plan: true } })
  if (!current) throw new PdiError('Ação não encontrada.', 404)
  // O líder só valida ação de plano em que ele é o líder.
  if (current.plan.leaderId !== viewer.userId) {
    throw new PdiError('Só o líder do plano valida esta ação.', 403)
  }
  if (current.status !== 'AWAITING_REVIEW') {
    throw new PdiError('Esta ação não está aguardando validação.', 409)
  }

  const comment = input.comment?.trim() || null
  if (input.decision === 'REQUEST_CHANGES' && !comment) {
    throw new PdiError('Escreva o que precisa ser ajustado.')
  }

  const approved = input.decision === 'APPROVE'
  const now = new Date()
  const action = await db.pdiAction.update({
    where: { id: actionId },
    data: {
      status: approved ? 'DONE' : 'IN_PROGRESS',
      completedAt: approved ? now : null,
      submittedForReviewAt: approved ? current.submittedForReviewAt : null,
      // Pedir ajustes devolve a ação para a pessoa continuar.
      progressPct: approved ? 100 : Math.min(current.progressPct, 99),
      reviewedAt: now,
      reviewedById: viewer.userId,
      reviewComment: comment,
    },
    include: ACTION_INCLUDE,
  })

  await recordHistory({
    actionId,
    eventType: approved ? 'APPROVED' : 'CHANGES_REQUESTED',
    actorId: viewer.userId,
    companyId: viewer.companyId,
    metadata: comment ? { comment } : {},
  })
  if (approved) {
    await recordHistory({ actionId, eventType: 'COMPLETED', actorId: viewer.userId, companyId: viewer.companyId })
  }
  // O selo é de quem fez a ação (dono do plano), não de quem validou. Pedir
  // ajustes tira a ação de DONE, então o sync roda nos dois casos.
  await syncPdiBadges(current.plan.userId, viewer.companyId)

  try {
    await notifyPdiActionReviewed({
      userId: current.plan.userId,
      actorId: viewer.userId,
      actionId,
      description: action.description,
      approved,
      companyId: viewer.companyId,
    })
  } catch {
    // Falha na notificação não desfaz a aprovação.
  }

  avisarPlano(current.plan)
  return serializeAction(action)
}

export async function listActionHistory(viewer: PdiViewer, actionId: string): Promise<PdiActionHistoryEntryDTO[]> {
  const db = scopedPrisma(viewer.companyId)
  const action = await db.pdiAction.findUnique({ where: { id: actionId }, include: { plan: true } })
  if (!action) throw new PdiError('Ação não encontrada.', 404)
  if (action.plan.userId !== viewer.userId && action.plan.leaderId !== viewer.userId) {
    throw new PdiError('Você não tem acesso a esta ação.', 403)
  }
  const entries = await db.pdiActionHistory.findMany({
    where: { actionId },
    include: { actor: true },
    orderBy: { createdAt: 'asc' },
  })
  return entries.map(toPdiHistoryEntryDTO)
}

// --------------------------------------------------------------------------
// Painel e ciclos
// --------------------------------------------------------------------------

function isOverdue(action: Pick<PdiAction, 'dueDate' | 'status'>, now: Date): boolean {
  return action.status !== 'DONE' && action.dueDate != null && action.dueDate.getTime() < now.getTime()
}

export async function pdiDashboard(
  viewer: PdiViewer,
  now: Date = new Date(),
): Promise<{ dashboard: PdiDashboardDTO; cycles: PdiCycleDTO[] }> {
  const plans = await scopedPrisma(viewer.companyId).pdiPlan.findMany({
    where: { userId: viewer.userId },
    include: { actions: true },
  })
  const actions = plans.flatMap((plan) => plan.actions)

  const byType = new Map<PdiActionType, { total: number; done: number }>()
  const competencies = new Map<string, number>()
  for (const action of actions) {
    const entry = byType.get(action.type) ?? { total: 0, done: 0 }
    entry.total += 1
    if (action.status === 'DONE') entry.done += 1
    byType.set(action.type, entry)
    if (action.competency) {
      competencies.set(action.competency, (competencies.get(action.competency) ?? 0) + 1)
    }
  }

  const cycles = new Map<string, { plans: number; actions: PdiAction[] }>()
  for (const plan of plans) {
    const key = plan.cyclePeriod ?? 'Sem ciclo'
    const entry = cycles.get(key) ?? { plans: 0, actions: [] }
    entry.plans += 1
    entry.actions.push(...plan.actions)
    cycles.set(key, entry)
  }

  return {
    dashboard: {
      plans: plans.length,
      actions: actions.length,
      doneActions: actions.filter((action) => action.status === 'DONE').length,
      awaitingReview: actions.filter((action) => action.status === 'AWAITING_REVIEW').length,
      overdue: actions.filter((action) => isOverdue(action, now)).length,
      progressPct: pdiProgressOf(actions),
      byType: [...byType.entries()].map(([type, entry]) => ({ type, ...entry })),
      competencies: [...competencies.entries()]
        .map(([competency, total]) => ({ competency, total }))
        .sort((a, b) => b.total - a.total),
    },
    cycles: [...cycles.entries()]
      .map(([cyclePeriod, entry]) => ({
        cyclePeriod,
        plans: entry.plans,
        actions: entry.actions.length,
        doneActions: entry.actions.filter((action) => action.status === 'DONE').length,
        progressPct: pdiProgressOf(entry.actions),
      }))
      .sort((a, b) => b.cyclePeriod.localeCompare(a.cyclePeriod, 'pt-BR')),
  }
}

// --------------------------------------------------------------------------
// Vitrine do perfil
// --------------------------------------------------------------------------

/**
 * Quem enxerga a vitrine de desenvolvimento de `target`, conforme a visibilidade
 * que a própria pessoa escolheu. A regra vive aqui (não na tela) porque ação de
 * PDI concluída carrega evidência e reflexão — dado sensível.
 */
export function canSeeShowcase(
  target: Pick<User, 'id' | 'sectorId' | 'pdiShowcaseVisibility'>,
  viewer: Pick<User, 'id' | 'sectorId'>,
  isLeaderOfTarget: boolean,
): boolean {
  if (target.id === viewer.id) return true
  switch (target.pdiShowcaseVisibility as PdiShowcaseVisibility) {
    case 'ALL':
      return true
    case 'TEAM':
      return target.sectorId === viewer.sectorId || isLeaderOfTarget
    case 'LEADER':
      return isLeaderOfTarget
    case 'PRIVATE':
      return false
  }
}

export async function getShowcase(viewer: PdiViewer, targetUserId: string): Promise<PdiShowcaseDTO> {
  const db = scopedPrisma(viewer.companyId)
  const [target, watcher] = await Promise.all([
    db.user.findUnique({ where: { id: targetUserId } }),
    db.user.findUnique({ where: { id: viewer.userId } }),
  ])
  if (!target || !watcher) throw new PdiError('Colaborador não encontrado.', 404)

  const leaderPlans = await db.pdiPlan.count({ where: { userId: target.id, leaderId: viewer.userId } })
  const visible = canSeeShowcase(target, watcher, leaderPlans > 0)

  if (!visible) {
    return {
      user: toPdiPersonDTO(target),
      visibility: target.pdiShowcaseVisibility,
      visible: false,
      competencies: [],
      actions: [],
    }
  }

  const actions = await db.pdiAction.findMany({
    where: { status: 'DONE', plan: { userId: target.id } },
    orderBy: { completedAt: 'desc' },
    take: 50,
  })

  return {
    user: toPdiPersonDTO(target),
    visibility: target.pdiShowcaseVisibility,
    visible: true,
    competencies: [...new Set(actions.map((action) => action.competency).filter((c): c is string => Boolean(c)))],
    actions: actions.map((action) => ({
      id: action.id,
      description: action.description,
      type: action.type,
      competency: action.competency,
      completedAt: (action.completedAt ?? action.updatedAt).toISOString(),
    })),
  }
}

export async function updateShowcaseVisibility(
  viewer: PdiViewer,
  visibility: PdiShowcaseVisibility,
): Promise<PdiShowcaseVisibility> {
  const user = await scopedPrisma(viewer.companyId).user.update({
    where: { id: viewer.userId },
    data: { pdiShowcaseVisibility: visibility },
    select: { pdiShowcaseVisibility: true },
  })
  return user.pdiShowcaseVisibility
}

export async function myShowcaseVisibility(viewer: PdiViewer): Promise<PdiShowcaseVisibility> {
  const user = await scopedPrisma(viewer.companyId).user.findUnique({
    where: { id: viewer.userId },
    select: { pdiShowcaseVisibility: true },
  })
  return user?.pdiShowcaseVisibility ?? 'TEAM'
}
