import {
  APPRENTICE_TASK_CATEGORIES,
  APPRENTICE_TASK_MAX_ITEMS,
  APPRENTICE_TASK_TITLE_MAX_LENGTH,
  isApprenticeTaskOverdue,
  type ApprenticeTaskColumn,
  type ApprenticeTaskDTO,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { ApprenticeError } from '../lib/apprentice-error'
import type { ApprenticeContext } from '../lib/apprentice-context'
import { apprenticeToday } from './apprentice-service'

/**
 * Quadro operacional do RH: o que o facilitador precisa fazer para o encontro
 * acontecer (reservar sala, imprimir material, alinhar com o gestor).
 *
 * Não confunda com `ApprenticeActivity`, que é a ficha que o APRENDIZ preenche.
 * Este quadro nunca aparece para ele.
 */

const TASK_INCLUDE = {
  items: { orderBy: { sortOrder: 'asc' } },
  meeting: { select: { order: true } },
} as const

interface TaskRow {
  id: string
  title: string
  category: string
  meetingId: string | null
  dueOn: Date | null
  boardColumn: ApprenticeTaskColumn
  sortOrder: number
  items: { id: string; text: string; done: boolean }[]
  meeting: { order: number } | null
}

function toTaskDTO(task: TaskRow, today: string): ApprenticeTaskDTO {
  const dueOn = task.dueOn ? task.dueOn.toISOString().slice(0, 10) : null
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    meetingId: task.meetingId,
    meetingOrder: task.meeting?.order ?? null,
    dueOn,
    boardColumn: task.boardColumn,
    sortOrder: task.sortOrder,
    items: task.items.map((item) => ({ id: item.id, text: item.text, done: item.done })),
    // Derivado, e não coluna: "atrasada" muda sozinha com a passagem do dia.
    overdue: isApprenticeTaskOverdue({ dueOn, boardColumn: task.boardColumn }, today),
  }
}

export async function listApprenticeTasks(companyId: string): Promise<ApprenticeTaskDTO[]> {
  const db = scopedPrisma(companyId)
  const tasks = await db.apprenticeTask.findMany({
    include: TASK_INCLUDE,
    orderBy: [{ boardColumn: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  const today = apprenticeToday()
  return tasks.map((task) => toTaskDTO(task as TaskRow, today))
}

export interface TaskInput {
  title: string
  category?: string
  meetingId?: string | null
  dueOn?: string | null
  items?: string[]
}

function assertCategory(value: string | undefined): string {
  const category = (value ?? 'Outros').trim()
  if (!(APPRENTICE_TASK_CATEGORIES as readonly string[]).includes(category)) {
    throw new ApprenticeError('Categoria de tarefa desconhecida.', 400)
  }
  return category
}

function dateOf(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) throw new ApprenticeError('Prazo inválido.', 400)
  return parsed
}

export async function createApprenticeTask(
  context: ApprenticeContext,
  input: TaskInput,
): Promise<ApprenticeTaskDTO[]> {
  const title = input.title.trim().slice(0, APPRENTICE_TASK_TITLE_MAX_LENGTH)
  if (!title) throw new ApprenticeError('Informe o título da tarefa.', 400)

  const db = scopedPrisma(context.companyId)
  if (input.meetingId) {
    const meeting = await db.apprenticeMeeting.findFirst({ where: { id: input.meetingId } })
    if (!meeting) throw new ApprenticeError('Encontro não encontrado.', 404)
  }

  const items = (input.items ?? [])
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, APPRENTICE_TASK_MAX_ITEMS)

  const last = await db.apprenticeTask.findFirst({
    where: { boardColumn: 'AFAZER' },
    orderBy: { sortOrder: 'desc' },
  })

  await db.apprenticeTask.create({
    data: {
      title,
      category: assertCategory(input.category),
      meetingId: input.meetingId ?? null,
      dueOn: dateOf(input.dueOn),
      sortOrder: (last?.sortOrder ?? 0) + 1,
      createdById: context.userId,
      items: {
        create: items.map((text, index) => ({
          text: text.slice(0, 300),
          sortOrder: index,
          companyId: context.companyId,
        })),
      },
    },
  })
  return listApprenticeTasks(context.companyId)
}

export async function updateApprenticeTask(
  companyId: string,
  taskId: string,
  input: Partial<TaskInput> & { boardColumn?: ApprenticeTaskColumn; sortOrder?: number },
): Promise<ApprenticeTaskDTO[]> {
  const db = scopedPrisma(companyId)
  const found = await db.apprenticeTask.findFirst({ where: { id: taskId } })
  if (!found) throw new ApprenticeError('Tarefa não encontrada.', 404)

  await db.apprenticeTask.update({
    where: { id: taskId },
    data: {
      ...(input.title !== undefined
        ? { title: input.title.trim().slice(0, APPRENTICE_TASK_TITLE_MAX_LENGTH) }
        : {}),
      ...(input.category !== undefined ? { category: assertCategory(input.category) } : {}),
      ...(input.meetingId !== undefined ? { meetingId: input.meetingId } : {}),
      ...(input.dueOn !== undefined ? { dueOn: dateOf(input.dueOn) } : {}),
      ...(input.boardColumn !== undefined ? { boardColumn: input.boardColumn } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  })
  return listApprenticeTasks(companyId)
}

export async function deleteApprenticeTask(companyId: string, taskId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const found = await db.apprenticeTask.findFirst({ where: { id: taskId } })
  if (!found) throw new ApprenticeError('Tarefa não encontrada.', 404)
  await db.apprenticeTask.delete({ where: { id: taskId } })
}

export async function toggleApprenticeTaskItem(
  companyId: string,
  itemId: string,
  done: boolean,
): Promise<ApprenticeTaskDTO[]> {
  const db = scopedPrisma(companyId)
  const found = await db.apprenticeTaskItem.findFirst({ where: { id: itemId } })
  if (!found) throw new ApprenticeError('Item não encontrado.', 404)
  await db.apprenticeTaskItem.update({ where: { id: itemId }, data: { done } })
  return listApprenticeTasks(companyId)
}
