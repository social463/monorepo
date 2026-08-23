import { Prisma } from '@prisma/client'
import type { OneOnOneTopicTemplateDTO } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

export interface TopicTemplateActor {
  id: string
  companyId: string
}

export class TopicTemplateError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'TopicTemplateError'
    this.status = status
  }
}

function toDTO(t: {
  id: string
  theme: string
  text: string
  active: boolean
  sortOrder: number
}): OneOnOneTopicTemplateDTO {
  return { id: t.id, theme: t.theme, text: t.text, active: t.active, sortOrder: t.sortOrder }
}

/** A tela do admin mostra inativo também — é ele que decide reativar. */
export async function listTopicTemplatesAdmin(actor: TopicTemplateActor): Promise<OneOnOneTopicTemplateDTO[]> {
  const templates = await scopedPrisma(actor.companyId).oneOnOneTopicTemplate.findMany({
    orderBy: [{ theme: 'asc' }, { sortOrder: 'asc' }],
  })
  return templates.map(toDTO)
}

export async function createTopicTemplate(
  actor: TopicTemplateActor,
  input: { theme: string; text: string; sortOrder?: number },
): Promise<OneOnOneTopicTemplateDTO> {
  const db = scopedPrisma(actor.companyId)
  return db.$transaction(async (tx) => {
    const created = await tx.oneOnOneTopicTemplate.create({
      data: {
        theme: input.theme.trim(),
        text: input.text.trim(),
        sortOrder: input.sortOrder ?? 0,
        companyId: actor.companyId,
      },
    })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'OneOnOneTopicTemplate',
      entityId: created.id,
      action: 'CREATE',
      after: created,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return toDTO(created)
  })
}

export async function updateTopicTemplate(
  actor: TopicTemplateActor,
  id: string,
  input: { theme?: string; text?: string; active?: boolean; sortOrder?: number },
): Promise<OneOnOneTopicTemplateDTO> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.oneOnOneTopicTemplate.findUnique({ where: { id } })
  if (!before) throw new TopicTemplateError('Tópico não encontrado.', 404)

  return db.$transaction(async (tx) => {
    const updated = await tx.oneOnOneTopicTemplate.update({
      where: { id },
      data: {
        theme: input.theme?.trim(),
        text: input.text?.trim(),
        active: input.active,
        sortOrder: input.sortOrder,
      },
    })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'OneOnOneTopicTemplate',
      entityId: id,
      action: 'UPDATE',
      before,
      after: updated,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return toDTO(updated)
  })
}

export async function deleteTopicTemplate(actor: TopicTemplateActor, id: string): Promise<void> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.oneOnOneTopicTemplate.findUnique({ where: { id } })
  if (!before) throw new TopicTemplateError('Tópico não encontrado.', 404)

  await db.$transaction(async (tx) => {
    await tx.oneOnOneTopicTemplate.delete({ where: { id } })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'OneOnOneTopicTemplate',
      entityId: id,
      action: 'DELETE',
      before,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}
