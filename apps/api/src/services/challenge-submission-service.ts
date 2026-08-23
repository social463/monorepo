import type { ChallengeSubmissionStatus, Prisma } from '@prisma/client'
import {
  CHALLENGE_EXPORT_MAX_ROWS,
  isFullAdmin,
  type ChallengeBatchDecision,
  type ChallengeBatchResult,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { csvCell, csvDate } from '../lib/csv'
import { recordAuditLog } from './audit-log-service'
import { awardFixedCoins } from './coin-service'
import { awardXp } from './xp-service'
import * as notificationService from './notification-service'
import {
  assertCanManageChallenge,
  submissionInclude,
  SubmissionNotFoundError,
  SubmissionNotPendingError,
  ChallengeError,
  type ChallengeActor,
  type SubmissionWithRefs,
} from './challenge-service'

/**
 * Carrega a submissão e confere o setor do ator. findFirst e nunca o findUnique
 * composto `challengeId_userId`: o índice é PARCIAL, aquele findUnique casaria
 * uma rejeitada qualquer.
 */
async function loadForReview(actor: ChallengeActor, id: string): Promise<SubmissionWithRefs> {
  const submission = await scopedPrisma(actor.companyId).challengeSubmission.findFirst({
    where: { id },
    include: submissionInclude,
  })
  if (!submission) throw new SubmissionNotFoundError()
  assertCanManageChallenge(actor, submission.challenge.sectorId)
  return submission
}

/** Avisa a pessoa da decisão. Best-effort: falha é logada e nunca desfaz a decisão. */
async function notifyBestEffort(submission: SubmissionWithRefs, status: 'APPROVED' | 'REJECTED', actorId: string) {
  try {
    await notificationService.notifyChallengeReviewed(
      { id: submission.id, userId: submission.userId, status, challenge: submission.challenge },
      actorId,
      submission.companyId,
    )
  } catch (err) {
    console.error(`[challenge-submission-service] falha ao notificar decisão (submission ${submission.id})`, err)
  }
}

/**
 * Fecha a decisão numa transação. O UPDATE CONDICIONAL vem PRIMEIRO de propósito:
 * é ele que tira o lock da linha. Sob Read Committed, a transação concorrente
 * bloqueia nele, reavalia o predicado contra a linha já commitada, vê que não é
 * mais PENDING e devolve count 0 — que é o que impede o crédito duplicado.
 * Reler a submissão com um SELECT simples NÃO teria esse efeito.
 *
 * O `where` do updateMany abaixo é só de colunas escalares (id, companyId, status)
 * de propósito: é isso que faz o Prisma emitir um `UPDATE ... WHERE ...` direto, que
 * toma o lock de linha na hora do recheck. Trocar a checagem de setor por um filtro
 * de relação aqui dentro (ex.: `challenge: { sectorId: ... }`, pra "resolver numa
 * query só") faz o Prisma emitir `UPDATE ... WHERE id IN (SELECT ...)` — o subselect
 * não herda o lock do UPDATE externo, e o recheck contra Read Committed deixa de
 * valer. A checagem de setor já está feita antes, em `loadForReview` via
 * `assertCanManageChallenge`; não duplicar aqui.
 */
async function decide(
  actor: ChallengeActor,
  current: SubmissionWithRefs,
  next: Extract<ChallengeSubmissionStatus, 'APPROVED' | 'REJECTED'>,
  rejectionReason: string | null,
): Promise<void> {
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.challengeSubmission.updateMany({
      where: { id: current.id, companyId: actor.companyId, status: 'PENDING' },
      data: { status: next, reviewedAt: now, reviewedById: actor.id, rejectionReason },
    })
    if (count === 0) throw new SubmissionNotPendingError()

    if (next === 'APPROVED') {
      // O dedupeKey `CHALLENGE_APPROVED:<submissionId>` é a SEGUNDA rede: se algo
      // escapar do lock acima, a unique (userId, dedupeKey) ainda barra o 2º crédito.
      const outcome = await awardFixedCoins({
        userId: current.userId,
        companyId: actor.companyId,
        amount: current.challenge.rewardCoins,
        event: 'CHALLENGE_APPROVED',
        reference: current.id,
        tx,
        now,
      })
      if (outcome.status === 'DUPLICATE') throw new SubmissionNotPendingError()
    }

    await recordAuditLog({
      actorId: actor.id,
      entityType: 'ChallengeSubmission',
      entityId: current.id,
      action: 'UPDATE',
      companyId: actor.companyId,
      before: { status: current.status },
      after: { status: next, rejectionReason },
      tx,
    })
  })
}

export async function approveSubmission(actor: ChallengeActor, id: string): Promise<SubmissionWithRefs> {
  const current = await loadForReview(actor, id)
  await decide(actor, current, 'APPROVED', null)
  await awardXpBestEffort(current)
  await notifyBestEffort(current, 'APPROVED', actor.id)
  return loadForReview(actor, id)
}

/**
 * XP da aprovação — DEPOIS da transação, e não dentro dela.
 *
 * Diferente dos coins, que entram no mesmo `$transaction` da aprovação porque a
 * recompensa é o combinado do desafio ("aprovou e pagou, ou nada"). O XP sai de
 * `XpRule`, que a empresa pode nem ter cadastrado: falhar a aprovação por causa
 * dele seria trocar o essencial pelo acessório. E um erro dentro da transação
 * abortaria o bloco inteiro — não dá para engolir a falha lá dentro.
 *
 * O `dedupeKey` `CHALLENGE_APPROVED:<submissionId>` mantém a idempotência: uma
 * reaprovação que escape do lock não paga XP de novo.
 */
async function awardXpBestEffort(current: SubmissionWithRefs): Promise<void> {
  try {
    await awardXp({
      userId: current.userId,
      companyId: current.companyId,
      event: 'CHALLENGE_APPROVED',
      reference: current.id,
    })
  } catch {
    // Silencioso de propósito: este service não recebe logger, e o extrato de XP
    // é auditável. Mesmo tratamento de `notifyBestEffort`.
  }
}

export async function rejectSubmission(
  actor: ChallengeActor,
  id: string,
  rejectionReason: string,
): Promise<SubmissionWithRefs> {
  const current = await loadForReview(actor, id)
  await decide(actor, current, 'REJECTED', rejectionReason)
  await notifyBestEffort(current, 'REJECTED', actor.id)
  return loadForReview(actor, id)
}

// --- Fila paginada e decisão em lote ----------------------------------------------

/** Cursor opaco `"<iso>|<id>"` em base64url — mesmo formato de review-service. */
function encodeCursor(row: { submittedAt: Date; id: string }): string {
  return Buffer.from(`${row.submittedAt.toISOString()}|${row.id}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { submittedAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|', 2)
    const submittedAt = new Date(iso)
    if (!id || Number.isNaN(submittedAt.getTime())) return null
    return { submittedAt, id }
  } catch {
    return null
  }
}

export interface SubmissionFilters {
  status?: ChallengeSubmissionStatus
  userId?: string
  challengeId?: string
  /** Só ADMIN escolhe; no SUBADMIN é forçado para o próprio setor. */
  sectorId?: string
}

export function filtersToWhere(actor: ChallengeActor, filters: SubmissionFilters): Prisma.ChallengeSubmissionWhereInput {
  // SUBADMIN é preso ao próprio setor mesmo que mande sectorId na query.
  const sectorWhere: Prisma.ChallengeWhereInput = isFullAdmin(actor)
    ? filters.sectorId
      ? { sectorId: filters.sectorId }
      : {}
    : { sectorId: actor.sectorId }

  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.challengeId ? { challengeId: filters.challengeId } : {}),
    challenge: sectorWhere,
  }
}

export async function listSubmissions(
  actor: ChallengeActor,
  filters: SubmissionFilters,
  page: { cursor?: string; limit: number },
): Promise<{ items: SubmissionWithRefs[]; nextCursor: string | null }> {
  const decoded = page.cursor ? decodeCursor(page.cursor) : null
  const where = filtersToWhere(actor, filters)

  const rows = await scopedPrisma(actor.companyId).challengeSubmission.findMany({
    where: decoded
      ? {
          ...where,
          OR: [
            { submittedAt: { lt: decoded.submittedAt } },
            { submittedAt: decoded.submittedAt, id: { lt: decoded.id } },
          ],
        }
      : where,
    include: submissionInclude,
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    // limit + 1 para saber se há próxima página sem um count separado.
    take: page.limit + 1,
  })

  const hasMore = rows.length > page.limit
  const items = hasMore ? rows.slice(0, page.limit) : rows
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null }
}

/**
 * Lote: item a item, pelo MESMO caminho de código do individual. Nada de
 * Promise.all — erro de um não pode abortar nem sumir. O resultado sempre diz o
 * que passou e o que falhou.
 */
export async function reviewBatch(
  actor: ChallengeActor,
  ids: string[],
  decision: ChallengeBatchDecision,
  rejectionReason: string | null,
): Promise<ChallengeBatchResult> {
  const result: ChallengeBatchResult = { succeeded: [], failed: [] }

  for (const id of ids) {
    try {
      if (decision === 'APPROVE') {
        await approveSubmission(actor, id)
      } else {
        await rejectSubmission(actor, id, rejectionReason ?? '')
      }
      result.succeeded.push(id)
    } catch (err) {
      const message =
        err instanceof ChallengeError ? err.message : 'Falha inesperada ao processar esta participação.'
      if (!(err instanceof ChallengeError)) {
        console.error(`[challenge-submission-service] falha no lote (submission ${id})`, err)
      }
      result.failed.push({ id, message })
    }
  }

  return result
}

// --- Export CSV --------------------------------------------------------------------

const CSV_HEADER = ['Pessoa', 'E-mail', 'Desafio', 'Recompensa', 'Status', 'Enviado em', 'Decidido em', 'Decidido por', 'Motivo']

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
}

/**
 * CSV do recorte filtrado inteiro — não da página. Separador `;` e BOM UTF-8
 * porque o Excel em pt-BR abre assim sem pedir importação.
 */
export async function exportSubmissionsCsv(actor: ChallengeActor, filters: SubmissionFilters): Promise<string> {
  const rows = await scopedPrisma(actor.companyId).challengeSubmission.findMany({
    where: filtersToWhere(actor, filters),
    include: submissionInclude,
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    take: CHALLENGE_EXPORT_MAX_ROWS,
  })

  const lines = [CSV_HEADER.join(';')]
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.user.name),
        csvCell(row.user.email),
        csvCell(row.challenge.title),
        String(row.challenge.rewardCoins),
        STATUS_LABELS[row.status] ?? row.status,
        csvDate(row.submittedAt),
        csvDate(row.reviewedAt),
        csvCell(row.reviewedBy?.name ?? null),
        csvCell(row.rejectionReason),
      ].join(';'),
    )
  }

  return `﻿${lines.join('\n')}\n`
}
