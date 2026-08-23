import { Prisma } from '@prisma/client'
import {
  HIGHLIGHT_MESSAGE_MAX_LENGTH,
  MAX_HIGHLIGHTS_PER_REQUEST,
  isMonthRef,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

/**
 * Destaques do Mês curados pela G&G.
 *
 * Convive com o Destaque do Mês da votação (`highlight-service`) sem tocar
 * nele: são mecanismos diferentes para perguntas diferentes — lá "quem o time
 * votou", aqui "quem a G&G reconheceu". Ver a spec
 * `2026-08-17-destaques-do-mes-curados-design.md`.
 */

export class MonthlyHighlightError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'MonthlyHighlightError'
  }
}

export const monthlyHighlightInclude = {
  user: true,
  // O setor vem da LINHA do destaque (snapshot), não de `user.sector`: é o que
  // impede que mudar de setor hoje reescreva o quadro de meses passados.
  sector: { select: { id: true, name: true } },
} as const
export type MonthlyHighlightRow = Prisma.MonthlyHighlightGetPayload<{
  include: typeof monthlyHighlightInclude
}>

function assertMonthRef(monthRef: string): string {
  if (!isMonthRef(monthRef)) {
    throw new MonthlyHighlightError('Mês inválido. Use o formato AAAA-MM.', 400)
  }
  return monthRef
}

function normalizeMessage(message: string | null | undefined): string | null {
  const trimmed = message?.trim() ?? ''
  if (!trimmed) return null
  if (trimmed.length > HIGHLIGHT_MESSAGE_MAX_LENGTH) {
    throw new MonthlyHighlightError(
      `A justificativa precisa ter no máximo ${HIGHLIGHT_MESSAGE_MAX_LENGTH} caracteres.`,
      400,
    )
  }
  return trimmed
}

/** Quadro do mês: pessoas ativas primeiro, ordenadas por nome dentro do grupo. */
export function listByMonth(companyId: string, monthRef: string): Promise<MonthlyHighlightRow[]> {
  return scopedPrisma(companyId).monthlyHighlight.findMany({
    where: { monthRef: assertMonthRef(monthRef) },
    include: monthlyHighlightInclude,
    orderBy: [{ sector: { name: 'asc' } }, { user: { name: 'asc' } }],
  })
}

/**
 * Aba "Meus reconhecimentos". `monthRef` opcional: sem ele, a pessoa vê o
 * histórico inteiro, que é como ela costuma procurar ("em que mês eu fui?").
 */
export function listForUser(
  userId: string,
  companyId: string,
  opts: { monthRef?: string } = {},
): Promise<MonthlyHighlightRow[]> {
  return scopedPrisma(companyId).monthlyHighlight.findMany({
    where: { userId, ...(opts.monthRef ? { monthRef: assertMonthRef(opts.monthRef) } : {}) },
    include: monthlyHighlightInclude,
    orderBy: { monthRef: 'desc' },
  })
}

/**
 * Cadastro em lote — o pedido é "vários colaboradores por vez".
 *
 * O setor de cada pessoa é lido do cadastro aqui, e não enviado pelo cliente:
 * é isso que faz o formulário só precisar da busca da pessoa, sem digitar nome,
 * setor nem foto. `skipDuplicates` mais a unique `(companyId, monthRef, userId)`
 * tornam o cadastro repetível: incluir de novo quem já estava no mês não
 * duplica nem estoura erro, o admin não precisa conferir a lista antes.
 */
export async function createMany(input: {
  monthRef: string
  userIds: string[]
  message?: string
  actorId: string
  companyId: string
}): Promise<MonthlyHighlightRow[]> {
  const monthRef = assertMonthRef(input.monthRef)
  const message = normalizeMessage(input.message)
  const userIds = [...new Set(input.userIds)]
  if (userIds.length === 0) {
    throw new MonthlyHighlightError('Escolha ao menos uma pessoa.', 400)
  }
  if (userIds.length > MAX_HIGHLIGHTS_PER_REQUEST) {
    throw new MonthlyHighlightError(`Cadastre no máximo ${MAX_HIGHLIGHTS_PER_REQUEST} pessoas por vez.`, 400)
  }

  const db = scopedPrisma(input.companyId)
  const people = await db.user.findMany({
    where: { id: { in: userIds }, active: true },
    select: { id: true, sectorId: true },
  })
  if (people.length !== userIds.length) {
    throw new MonthlyHighlightError('Uma das pessoas escolhidas não está disponível.', 404)
  }

  await db.monthlyHighlight.createMany({
    data: people.map((person) => ({
      monthRef,
      userId: person.id,
      sectorId: person.sectorId,
      ...(message ? { message } : {}),
      createdById: input.actorId,
      companyId: input.companyId,
    })),
    skipDuplicates: true,
  })

  const created = await db.monthlyHighlight.findMany({
    where: { monthRef, userId: { in: userIds } },
    include: monthlyHighlightInclude,
    orderBy: [{ sector: { name: 'asc' } }, { user: { name: 'asc' } }],
  })
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'MonthlyHighlight',
    entityId: monthRef,
    action: 'CREATE',
    after: { monthRef, userIds: people.map((p) => p.id) },
    companyId: input.companyId,
  })
  return created
}

/** Edita a justificativa. `message: null` limpa — é o "ainda vou escrever". */
export async function updateHighlight(input: {
  id: string
  message?: string | null
  actorId: string
  companyId: string
}): Promise<MonthlyHighlightRow> {
  const db = scopedPrisma(input.companyId)
  const before = await db.monthlyHighlight.findUnique({ where: { id: input.id } })
  if (!before) throw new MonthlyHighlightError('Destaque não encontrado.', 404)

  const updated = await db.monthlyHighlight.update({
    where: { id: input.id },
    data: { message: normalizeMessage(input.message) },
    include: monthlyHighlightInclude,
  })
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'MonthlyHighlight',
    entityId: input.id,
    action: 'UPDATE',
    before: { message: before.message },
    after: { message: updated.message },
    companyId: input.companyId,
  })
  return updated
}

export async function removeHighlight(input: {
  id: string
  actorId: string
  companyId: string
}): Promise<void> {
  const db = scopedPrisma(input.companyId)
  const before = await db.monthlyHighlight.findUnique({ where: { id: input.id } })
  if (!before) throw new MonthlyHighlightError('Destaque não encontrado.', 404)

  await db.monthlyHighlight.delete({ where: { id: input.id } })
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'MonthlyHighlight',
    entityId: input.id,
    action: 'DELETE',
    before: { monthRef: before.monthRef, userId: before.userId, message: before.message },
    companyId: input.companyId,
  })
}

/** Meses que já têm destaque — alimenta o seletor sem chutar intervalo. */
export async function listMonthsWithHighlights(companyId: string): Promise<string[]> {
  const rows = await scopedPrisma(companyId).monthlyHighlight.groupBy({
    by: ['monthRef'],
    orderBy: { monthRef: 'desc' },
  })
  return rows.map((row) => row.monthRef)
}
