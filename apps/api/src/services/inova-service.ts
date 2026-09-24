import { randomUUID } from 'node:crypto'
import type { InovaGuiaVideoDTO, InovaProjectDetailResponse, InovaProjectPhase, InovaTaskStatus } from '@legends/shared'
import { INOVA_PROJECT_PHASES, INOVA_TASK_STATUSES, canAdminister, canManageInovaProject } from '@legends/shared'
import type { InovaProject, Prisma } from '@prisma/client'
import { absoluteUrl } from '../lib/app-url'
import { prisma } from '../lib/prisma'
import { buildInovaGuiaVideoKey, deleteS3Object, s3Config } from '../lib/s3-client'
import { stripHtmlTags } from '../lib/sanitize-text'
import {
  toInovaActivityDTO,
  toInovaDiaryEntryDTO,
  toInovaGuiaVideoDTO,
  toInovaPhaseHistoryDTO,
  toInovaProjectDTO,
  toInovaProjectTaskDTO,
} from '../lib/serialize'
import { postTeamsNotification } from '../lib/teams-client'
import { scopedPrisma } from '../lib/tenant-scope'
import { getDevelopmentSettings } from './development-settings-service'

/**
 * Empresa cujo slug é `emr` — hoje a única com o módulo INOVA, do mesmo jeito
 * que `EMR_SLUG` em `agent-service.ts` trava o bloco de acolhimento emocional.
 * Deliberadamente redundante com `inova_module_enabled`: mesmo que a config
 * seja ligada por engano em outra empresa, esta trava recusa.
 */
const INOVA_ALLOWED_COMPANY_SLUG = 'emr'

export class InovaError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}

/** Quem está agindo. `role`/`adminAccess` saem do JWT; o id é `request.user.sub`. */
export interface InovaActor {
  id: string
  role: string
  adminAccess?: boolean
}

/**
 * Carrega o projeto e recusa quem não é dono nem administra.
 *
 * A trava vive aqui, e não na rota, porque depende da LINHA: `requireAdminOrSubadmin`
 * só sabe o papel, e o dono de um projeto costuma ser um colaborador comum.
 */
async function loadManageableProject(companyId: string, projectId: string, actor: InovaActor) {
  const project = await scopedPrisma(companyId).inovaProject.findUnique({
    where: { id: projectId },
    select: { id: true, title: true, createdById: true, responsible1Id: true, responsible2Id: true },
  })
  if (!project) throw new InovaError('Projeto não encontrado.', 404)
  if (!canManageInovaProject({ id: actor.id, role: actor.role, adminAccess: actor.adminAccess }, project)) {
    throw new InovaError('Só quem administra o INOVA ou é dono do projeto pode fazer isso.', 403)
  }
  return project
}

/**
 * Entrada AUTOMÁTICA do diário de bordo — o registro que o projeto escreve
 * sozinho quando a tarefa anda ou a fase muda, como no INOVA original. Quem
 * atualiza o kanban não precisa lembrar de contar no diário; o filtro
 * "Automáticos" do diário separa esse rastro do que a pessoa escreveu.
 * Roda dentro da transação de quem chama: ou grava os dois, ou nenhum.
 */
async function logAutomaticDiaryEntry(
  tx: { inovaDiaryEntry: { create(args: { data: Prisma.InovaDiaryEntryUncheckedCreateInput }): Promise<unknown> } },
  input: { projectId: string; actorId: string; title: string; description: string },
) {
  await tx.inovaDiaryEntry.create({
    data: {
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      entryType: 'AUTOMATIC',
      createdById: input.actorId,
    },
  })
}

function taskStatusLabel(status: InovaTaskStatus): string {
  return INOVA_TASK_STATUSES.find((s) => s.value === status)?.label ?? status
}

function phaseLabel(phase: InovaProjectPhase): string {
  return INOVA_PROJECT_PHASES.find((p) => p.value === phase)?.label ?? phase
}

export async function ensureInovaModuleEnabled(companyId: string): Promise<void> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { slug: true } })
  if (company?.slug !== INOVA_ALLOWED_COMPANY_SLUG) {
    throw new InovaError('Módulo Comunidade INOVA não disponível para esta empresa.', 403)
  }
  const { inovaModuleEnabled } = await getDevelopmentSettings(companyId)
  if (!inovaModuleEnabled) {
    throw new InovaError('Módulo Comunidade INOVA está desativado.', 403)
  }
}

async function isInovaModuleEnabled(companyId: string): Promise<boolean> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { slug: true } })
  if (company?.slug !== INOVA_ALLOWED_COMPANY_SLUG) return false
  return (await getDevelopmentSettings(companyId)).inovaModuleEnabled
}

export async function listInovaProjects(
  companyId: string,
  options: { archived?: boolean } = {},
): Promise<ReturnType<typeof toInovaProjectDTO>[]> {
  if (!(await isInovaModuleEnabled(companyId))) return []
  const projects = await scopedPrisma(companyId).inovaProject.findMany({
    where: { archived: options.archived ?? false },
    include: {
      createdBy: true,
      responsible1: true,
      responsible2: true,
      // Só as datas: o painel administrativo filtra o período por "criou,
      // mudou de fase ou registrou no diário" e traça os avanços por mês.
      phaseHistory: { select: { phase: true, occurredAt: true }, orderBy: { occurredAt: 'asc' } },
      diaryEntries: { select: { occurredAt: true }, orderBy: { occurredAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return projects.map((project) => toInovaProjectDTO(project))
}

export async function getInovaProjectDetail(companyId: string, projectId: string): Promise<InovaProjectDetailResponse> {
  await ensureInovaModuleEnabled(companyId)
  const db = scopedPrisma(companyId)
  const project = await db.inovaProject.findUnique({
    where: { id: projectId },
    include: { createdBy: true, responsible1: true, responsible2: true },
  })
  if (!project) throw new InovaError('Projeto não encontrado.', 404)

  const [phaseHistory, diaryEntries, tasks, activity] = await Promise.all([
    db.inovaPhaseHistory.findMany({ where: { projectId }, orderBy: { occurredAt: 'asc' } }),
    db.inovaDiaryEntry.findMany({ where: { projectId }, include: { createdBy: true }, orderBy: { occurredAt: 'desc' } }),
    db.inovaProjectTask.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
    db.inovaActivity.findMany({ where: { projectId }, include: { actor: true }, orderBy: { createdAt: 'desc' } }),
  ])

  return {
    project: toInovaProjectDTO(project),
    phaseHistory: phaseHistory.map(toInovaPhaseHistoryDTO),
    diaryEntries: diaryEntries.map(toInovaDiaryEntryDTO),
    tasks: tasks.map(toInovaProjectTaskDTO),
    activity: activity.map(toInovaActivityDTO),
  }
}

export interface CreateInovaProjectInput {
  companyId: string
  actorId: string
  title: string
  category: string
  sector: string
  description: string
  problemDescription?: string | null
  results?: string | null
  hoursSaved?: number | null
  costReduction?: number | null
  otherMetrics?: string | null
  projectCosts?: string | null
  toolsUsed?: string | null
  deadline?: Date | null
  priority?: boolean
  leadershipChallenge?: boolean
  estimatedDeadline?: string | null
  sectorRepresentative?: string | null
  responsible1Id?: string | null
  responsible2Id?: string | null
}

function requireNonEmpty(value: string, message: string): string {
  const trimmed = stripHtmlTags(value)
  if (!trimmed) throw new InovaError(message)
  return trimmed
}

function optionalText(value: string | null | undefined): string | null {
  if (value == null) return value ?? null
  const stripped = stripHtmlTags(value)
  return stripped || null
}

export async function createInovaProject(input: CreateInovaProjectInput): Promise<ReturnType<typeof toInovaProjectDTO>> {
  await ensureInovaModuleEnabled(input.companyId)
  const title = requireNonEmpty(input.title, 'Informe o título do projeto.')
  const category = requireNonEmpty(input.category, 'Informe a categoria do projeto.')
  const sector = requireNonEmpty(input.sector, 'Informe o setor do projeto.')
  const description = requireNonEmpty(input.description, 'Informe a descrição do projeto.')

  const db = scopedPrisma(input.companyId)
  const project = await db.$transaction(async (tx) => {
    const created = await tx.inovaProject.create({
      data: {
        title,
        category,
        sector,
        description,
        problemDescription: optionalText(input.problemDescription),
        results: optionalText(input.results),
        hoursSaved: input.hoursSaved ?? null,
        costReduction: input.costReduction ?? null,
        otherMetrics: optionalText(input.otherMetrics),
        projectCosts: optionalText(input.projectCosts),
        toolsUsed: optionalText(input.toolsUsed),
        deadline: input.deadline ?? null,
        priority: input.priority ?? false,
        leadershipChallenge: input.leadershipChallenge ?? false,
        estimatedDeadline: input.estimatedDeadline ?? null,
        sectorRepresentative: input.sectorRepresentative ?? null,
        responsible1Id: input.responsible1Id ?? null,
        responsible2Id: input.responsible2Id ?? null,
        createdById: input.actorId,
      },
      include: { createdBy: true, responsible1: true, responsible2: true },
    })
    await tx.inovaPhaseHistory.create({
      data: { projectId: created.id, phase: 'IDEA' },
    })
    await tx.inovaActivity.create({
      data: {
        projectId: created.id,
        action: 'PROJECT_CREATED',
        entity: 'InovaProject',
        summary: `${created.createdBy.name} criou o projeto "${created.title}".`,
        actorId: input.actorId,
      },
    })
    return created
  })

  try {
    await notifyInovaProjectChange(project, 'criado')
  } catch (err) {
    console.error('[inova-service] notificação Teams falhou', err)
  }
  return toInovaProjectDTO(project)
}

export interface UpdateInovaProjectInput extends Partial<Omit<CreateInovaProjectInput, 'companyId' | 'actorId'>> {
  id: string
  companyId: string
  actor: InovaActor
  archived?: boolean
}

export async function updateInovaProject(input: UpdateInovaProjectInput): Promise<ReturnType<typeof toInovaProjectDTO>> {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  await loadManageableProject(input.companyId, input.id, input.actor)
  // Prioridade e arquivamento são CURADORIA do programa, não edição do projeto:
  // o dono conta a própria história, mas quem destaca e quem tira do quadro é
  // quem administra o INOVA.
  if (!canAdminister(input.actor) && (input.priority !== undefined || input.archived !== undefined)) {
    throw new InovaError('Prioridade e arquivamento são de quem administra o INOVA.', 403)
  }

  const data: Record<string, unknown> = {}
  if (input.title !== undefined) data.title = requireNonEmpty(input.title, 'Informe o título do projeto.')
  if (input.category !== undefined) data.category = requireNonEmpty(input.category, 'Informe a categoria do projeto.')
  if (input.sector !== undefined) data.sector = requireNonEmpty(input.sector, 'Informe o setor do projeto.')
  if (input.description !== undefined) data.description = requireNonEmpty(input.description, 'Informe a descrição do projeto.')
  for (const key of ['problemDescription', 'results', 'otherMetrics', 'projectCosts', 'toolsUsed'] as const) {
    if (input[key] !== undefined) data[key] = optionalText(input[key])
  }
  for (const key of [
    'hoursSaved',
    'costReduction',
    'deadline',
    'priority',
    'leadershipChallenge',
    'estimatedDeadline',
    'sectorRepresentative',
    'responsible1Id',
    'responsible2Id',
    'archived',
  ] as const) {
    if (input[key] !== undefined) data[key] = input[key]
  }

  const project = await db.$transaction(async (tx) => {
    const updated = await tx.inovaProject.update({
      where: { id: input.id },
      data,
      include: { createdBy: true, responsible1: true, responsible2: true },
    })
    await tx.inovaActivity.create({
      data: {
        projectId: updated.id,
        action: 'PROJECT_UPDATED',
        entity: 'InovaProject',
        summary: `Projeto "${updated.title}" foi atualizado.`,
        actorId: input.actor.id,
      },
    })
    return updated
  })

  try {
    await notifyInovaProjectChange(project, 'atualizado')
  } catch (err) {
    console.error('[inova-service] notificação Teams falhou', err)
  }
  return toInovaProjectDTO(project)
}

export async function changeInovaProjectPhase(input: {
  id: string
  phase: InovaProjectPhase
  note?: string
  actor: InovaActor
  companyId: string
}): Promise<ReturnType<typeof toInovaProjectDTO>> {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  await loadManageableProject(input.companyId, input.id, input.actor)
  const before = await db.inovaProject.findUnique({ where: { id: input.id }, select: { phase: true } })
  // Mesma fase de novo não é mudança: o formulário de edição manda a fase
  // junto com o resto, e isso não pode encher o histórico de repetição.
  if (before?.phase === input.phase) {
    const current = await db.inovaProject.findUniqueOrThrow({
      where: { id: input.id },
      include: { createdBy: true, responsible1: true, responsible2: true },
    })
    return toInovaProjectDTO(current)
  }

  const project = await db.$transaction(async (tx) => {
    const updated = await tx.inovaProject.update({
      where: { id: input.id },
      data: { phase: input.phase },
      include: { createdBy: true, responsible1: true, responsible2: true },
    })
    await tx.inovaPhaseHistory.create({
      data: { projectId: updated.id, phase: input.phase, note: input.note?.trim() || null },
    })
    await tx.inovaActivity.create({
      data: {
        projectId: updated.id,
        action: 'PHASE_CHANGED',
        entity: 'InovaProject',
        summary: `Projeto "${updated.title}" mudou de fase.`,
        actorId: input.actor.id,
        details: { phase: input.phase, from: before?.phase ?? null },
      },
    })
    await logAutomaticDiaryEntry(tx, {
      projectId: updated.id,
      actorId: input.actor.id,
      title: `Fase alterada: ${phaseLabel(input.phase)}`,
      description: before
        ? `O projeto passou de "${phaseLabel(before.phase)}" para "${phaseLabel(input.phase)}".`
        : `O projeto passou para "${phaseLabel(input.phase)}".`,
    })
    return updated
  })

  return toInovaProjectDTO(project)
}

export async function addInovaDiaryEntry(input: {
  companyId: string
  actorId: string
  projectId: string
  title: string
  description?: string | null
  learnings?: string | null
  tools?: string | null
  imageUrls?: string[]
  videoLinks?: string[]
  externalLinks?: string[]
}) {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  const project = await db.inovaProject.findUnique({ where: { id: input.projectId }, select: { id: true, title: true } })
  if (!project) throw new InovaError('Projeto não encontrado.', 404)
  const title = requireNonEmpty(input.title, 'Informe o título da entrada.')

  const entry = await db.$transaction(async (tx) => {
    const created = await tx.inovaDiaryEntry.create({
      data: {
        projectId: input.projectId,
        title,
        description: input.description ?? null,
        learnings: input.learnings ?? null,
        tools: input.tools ?? null,
        imageUrls: input.imageUrls ?? [],
        videoLinks: input.videoLinks ?? [],
        externalLinks: input.externalLinks ?? [],
        createdById: input.actorId,
      },
      include: { createdBy: true },
    })
    await tx.inovaActivity.create({
      data: {
        projectId: input.projectId,
        action: 'DIARY_ENTRY_ADDED',
        entity: 'InovaDiaryEntry',
        summary: `${created.createdBy.name} adicionou uma entrada no diário de "${project.title}".`,
        actorId: input.actorId,
      },
    })
    return created
  })

  return toInovaDiaryEntryDTO(entry)
}

export async function createInovaProjectTask(input: {
  companyId: string
  actorId: string
  projectId: string
  title: string
  description?: string | null
  responsible?: string | null
  dueDate?: Date | null
  /** Coluna em que a tarefa nasce — o "+" de cada coluna do kanban. */
  status?: InovaTaskStatus
}) {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  const project = await db.inovaProject.findUnique({ where: { id: input.projectId }, select: { id: true, title: true } })
  if (!project) throw new InovaError('Projeto não encontrado.', 404)
  const title = requireNonEmpty(input.title, 'Informe o título da tarefa.')

  const task = await db.$transaction(async (tx) => {
    const created = await tx.inovaProjectTask.create({
      data: {
        projectId: input.projectId,
        title,
        description: input.description ?? null,
        responsible: optionalText(input.responsible),
        dueDate: input.dueDate ?? null,
        status: input.status ?? 'PENDING',
      },
    })
    await tx.inovaActivity.create({
      data: {
        projectId: input.projectId,
        action: 'TASK_CREATED',
        entity: 'InovaProjectTask',
        summary: `Tarefa "${created.title}" criada em "${project.title}".`,
        actorId: input.actorId,
      },
    })
    const responsavel = created.responsible ? ` (responsável: ${created.responsible})` : ''
    await logAutomaticDiaryEntry(tx, {
      projectId: input.projectId,
      actorId: input.actorId,
      title: `Tarefa criada: ${created.title}`,
      description: `A tarefa "${created.title}" foi criada em "${taskStatusLabel(created.status)}"${responsavel}.`,
    })
    return created
  })

  return toInovaProjectTaskDTO(task)
}

export async function updateInovaProjectTaskStatus(input: {
  companyId: string
  actorId: string
  taskId: string
  status: import('@legends/shared').InovaTaskStatus
}) {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  const current = await db.inovaProjectTask.findUnique({ where: { id: input.taskId } })
  if (!current) throw new InovaError('Tarefa não encontrada.', 404)
  if (current.status === input.status) return toInovaProjectTaskDTO(current)

  const task = await db.$transaction(async (tx) => {
    const updated = await tx.inovaProjectTask.update({ where: { id: input.taskId }, data: { status: input.status } })
    await logAutomaticDiaryEntry(tx, {
      projectId: current.projectId,
      actorId: input.actorId,
      title: `Tarefa movida: ${updated.title}`,
      description: `A tarefa "${updated.title}" foi movida de "${taskStatusLabel(current.status)}" para "${taskStatusLabel(input.status)}".`,
    })
    await tx.inovaActivity.create({
      data: {
        projectId: current.projectId,
        action: 'TASK_STATUS_CHANGED',
        entity: 'InovaProjectTask',
        summary: `Tarefa "${updated.title}" mudou de status.`,
        actorId: input.actorId,
        details: { status: input.status },
      },
    })
    return updated
  })

  return toInovaProjectTaskDTO(task)
}

/**
 * Edita título, descrição, responsável e prazo de uma tarefa.
 *
 * Mesma régua de criar e mover tarefa: qualquer colaborador logado. O kanban
 * do projeto é colaborativo; o que é só do dono é apagar (`deleteInovaProjectTask`).
 */
export async function updateInovaProjectTask(input: {
  companyId: string
  actorId: string
  taskId: string
  title?: string
  description?: string | null
  responsible?: string | null
  dueDate?: Date | null
}) {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  const current = await db.inovaProjectTask.findUnique({ where: { id: input.taskId } })
  if (!current) throw new InovaError('Tarefa não encontrada.', 404)

  const data: Prisma.InovaProjectTaskUpdateInput = {}
  if (input.title !== undefined) data.title = requireNonEmpty(input.title, 'Informe o título da tarefa.')
  if (input.description !== undefined) data.description = input.description?.trim() || null
  if (input.responsible !== undefined) data.responsible = optionalText(input.responsible)
  if (input.dueDate !== undefined) data.dueDate = input.dueDate

  const task = await db.$transaction(async (tx) => {
    const updated = await tx.inovaProjectTask.update({ where: { id: input.taskId }, data })
    await tx.inovaActivity.create({
      data: {
        projectId: current.projectId,
        action: 'TASK_UPDATED',
        entity: 'InovaProjectTask',
        summary: `Tarefa "${updated.title}" foi editada.`,
        actorId: input.actorId,
      },
    })
    return updated
  })

  return toInovaProjectTaskDTO(task)
}

/**
 * Exclusão de verdade, não arquivamento.
 *
 * Arquivar tira do quadro e preserva a história; excluir some com o projeto e,
 * por cascata (ver `onDelete: Cascade` no schema), com diário, tarefas,
 * histórico de fase e atividade. É irreversível — quem chama confirma antes.
 */
export async function deleteInovaProject(input: { companyId: string; id: string; actor: InovaActor }): Promise<void> {
  await ensureInovaModuleEnabled(input.companyId)
  await loadManageableProject(input.companyId, input.id, input.actor)
  await scopedPrisma(input.companyId).inovaProject.delete({ where: { id: input.id } })
}

/**
 * Apaga uma entrada do diário.
 *
 * Quem escreveu pode apagar o que escreveu — o diário é aberto a qualquer
 * colaborador, então quem errou a entrada não deveria depender de um admin.
 * Dono do projeto e quem administra também apagam, porque respondem pelo
 * projeto inteiro.
 */
export async function deleteInovaDiaryEntry(input: {
  companyId: string
  entryId: string
  actor: InovaActor
}): Promise<void> {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  const entry = await db.inovaDiaryEntry.findUnique({
    where: { id: input.entryId },
    select: {
      id: true,
      title: true,
      createdById: true,
      projectId: true,
      project: { select: { createdById: true, responsible1Id: true, responsible2Id: true } },
    },
  })
  if (!entry) throw new InovaError('Entrada não encontrada.', 404)
  const autor = entry.createdById === input.actor.id
  const dono = canManageInovaProject(
    { id: input.actor.id, role: input.actor.role, adminAccess: input.actor.adminAccess },
    entry.project,
  )
  if (!autor && !dono) throw new InovaError('Só quem escreveu a entrada ou é dono do projeto pode apagá-la.', 403)

  await db.$transaction(async (tx) => {
    await tx.inovaDiaryEntry.delete({ where: { id: entry.id } })
    await tx.inovaActivity.create({
      data: {
        projectId: entry.projectId,
        action: 'DIARY_ENTRY_DELETED',
        entity: 'InovaDiaryEntry',
        summary: `Entrada "${entry.title}" foi apagada do diário.`,
        actorId: input.actor.id,
      },
    })
  })
}

/**
 * Apaga uma tarefa.
 *
 * Aqui não há "autor": `InovaProjectTask` não guarda quem criou (o campo
 * `responsible` é texto livre, não usuário). Então a régua é a do projeto —
 * dono ou quem administra. Se um dia a tarefa passar a guardar o criador,
 * vale abrir para ele, como no diário.
 */
export async function deleteInovaProjectTask(input: {
  companyId: string
  taskId: string
  actor: InovaActor
}): Promise<void> {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  const task = await db.inovaProjectTask.findUnique({ where: { id: input.taskId } })
  if (!task) throw new InovaError('Tarefa não encontrada.', 404)
  await loadManageableProject(input.companyId, task.projectId, input.actor)

  await db.$transaction(async (tx) => {
    await tx.inovaProjectTask.delete({ where: { id: task.id } })
    await tx.inovaActivity.create({
      data: {
        projectId: task.projectId,
        action: 'TASK_DELETED',
        entity: 'InovaProjectTask',
        summary: `Tarefa "${task.title}" foi apagada.`,
        actorId: input.actor.id,
      },
    })
    await logAutomaticDiaryEntry(tx, {
      projectId: task.projectId,
      actorId: input.actor.id,
      title: `Tarefa excluída: ${task.title}`,
      description: `A tarefa "${task.title}" foi removida do projeto.`,
    })
  })
}

// ---------------------------------------------------------------------------
// Biblioteca de vídeos do Guia AI First
// ---------------------------------------------------------------------------

/**
 * A chave precisa ter nascido no presign DESTA empresa — mesma defesa que
 * `assertOwnKey` faz no kit visual da Cultura: sem ela, um PATCH direto
 * apontaria o card para o objeto de outro tenant.
 */
function assertOwnInovaGuiaVideoKey(storagePath: string, companyId: string): void {
  if (!storagePath.startsWith(`inova-guia-videos/${companyId}/`)) {
    throw new InovaError('Vídeo inválido. Envie o arquivo de novo.', 400)
  }
}

export async function listInovaGuiaVideos(companyId: string): Promise<InovaGuiaVideoDTO[]> {
  await ensureInovaModuleEnabled(companyId)
  const rows = await scopedPrisma(companyId).inovaGuiaVideo.findMany({ orderBy: { createdAt: 'asc' } })
  return rows.map(toInovaGuiaVideoDTO)
}

/**
 * Cria um card CUSTOM — um vídeo que não veio do catálogo estático, só existe
 * porque esta linha existe. `videoId` nasce no servidor (nunca do cliente):
 * é o que garante que não colide com um id do catálogo por acidente.
 */
export async function createInovaGuiaVideoCard(companyId: string, actorId: string): Promise<InovaGuiaVideoDTO> {
  await ensureInovaModuleEnabled(companyId)
  const video = await scopedPrisma(companyId).inovaGuiaVideo.create({
    data: {
      videoId: `custom-${randomUUID()}`,
      title: 'Novo vídeo',
      createdById: actorId,
    },
  })
  return toInovaGuiaVideoDTO(video)
}

export interface InovaGuiaVideoPatch {
  title?: string | null
  description?: string | null
  category?: string | null
  duration?: string | null
  behavior?: string | null
  videoUrl?: string | null
  storagePath?: string | null
}

/**
 * Cria ou atualiza a linha de um `videoId` — SOBRESCRITA de um card do
 * catálogo (primeira vez que alguém edita) ou edição de um card custom já
 * criado. `videoUrl` e `storagePath` são mutuamente exclusivos: definir um
 * limpa o outro, porque um vídeo é um link OU um arquivo, nunca os dois.
 *
 * Apaga o arquivo antigo no S3 quando o vídeo é substituído ou removido —
 * depois de gravar no banco e best-effort, mesma ordem e mesma decisão do
 * kit visual da Cultura: o pior caso é um objeto sobrando no bucket, nunca um
 * card fantasma na tela.
 */
export async function upsertInovaGuiaVideo(
  companyId: string,
  videoId: string,
  actorId: string,
  patch: InovaGuiaVideoPatch,
): Promise<InovaGuiaVideoDTO> {
  await ensureInovaModuleEnabled(companyId)
  if (patch.storagePath) assertOwnInovaGuiaVideoKey(patch.storagePath, companyId)

  const db = scopedPrisma(companyId)
  const existing = await db.inovaGuiaVideo.findUnique({ where: { companyId_videoId: { companyId, videoId } } })

  const data: InovaGuiaVideoPatch = { ...patch }
  if (patch.videoUrl !== undefined && patch.videoUrl !== null) data.storagePath = null
  if (patch.storagePath !== undefined && patch.storagePath !== null) data.videoUrl = null

  // `scopedPrisma` não suporta `upsert` ainda (ver TenantScopeError na
  // extensão) — cria ou atualiza explicitamente, na mesma checagem que
  // qualquer outro service tenant-scoped já faz para "existe?".
  const video = existing
    ? await db.inovaGuiaVideo.update({ where: { companyId_videoId: { companyId, videoId } }, data })
    : await db.inovaGuiaVideo.create({ data: { videoId, createdById: actorId, ...data } })

  const oldStoragePath = existing?.storagePath
  if (oldStoragePath && oldStoragePath !== video.storagePath && s3Config()) {
    try {
      await deleteS3Object(oldStoragePath)
    } catch (err) {
      console.error('[inova] falha ao apagar vídeo antigo no storage', { key: oldStoragePath, err })
    }
  }

  return toInovaGuiaVideoDTO(video)
}

/**
 * Remove a linha de um `videoId`. Para um card do catálogo, é "remover
 * vídeo" (volta a exibir os textos estáticos, sem vídeo); para um card
 * custom, é "excluir card" (some da lista, porque só existia via esta
 * linha) — a mesma operação serve às duas intenções da tela, e quem decide
 * qual rótulo mostrar é o front, que já sabe se o id é do catálogo.
 *
 * Idempotente: apagar um `videoId` sem linha (catálogo nunca editado) não é
 * erro, só não há nada a fazer.
 */
export async function deleteInovaGuiaVideo(companyId: string, videoId: string): Promise<void> {
  await ensureInovaModuleEnabled(companyId)
  const db = scopedPrisma(companyId)
  const existing = await db.inovaGuiaVideo.findUnique({ where: { companyId_videoId: { companyId, videoId } } })
  if (!existing) return

  await db.inovaGuiaVideo.delete({ where: { id: existing.id } })
  if (existing.storagePath && s3Config()) {
    try {
      await deleteS3Object(existing.storagePath)
    } catch (err) {
      console.error('[inova] falha ao apagar vídeo removido no storage', { key: existing.storagePath, err })
    }
  }
}

async function notifyInovaProjectChange(project: InovaProject & { createdBy: { name: string } }, acao: string): Promise<void> {
  const { inovaTeamsWebhookUrl } = await getDevelopmentSettings(project.companyId)
  if (!inovaTeamsWebhookUrl) return
  await postTeamsNotification(inovaTeamsWebhookUrl, {
    title: `Projeto do INOVA ${acao}: ${project.title}`,
    body: project.description,
    ctaUrl: absoluteUrl('/comunidade-inova/projetos'),
    ctaLabel: 'Ver projeto',
    emoji: '💡',
  })
}
