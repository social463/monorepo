import { Prisma, type GlassReview } from '@prisma/client'
import type { CreateGlassReviewRequest, GlassParseResponse } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { reviewAlerts } from '../lib/glass-alerts'
import { extractGlassReview, missingRequiredFields } from '../lib/glass-extraction'
import type { AgentCompletionFn } from '../lib/agent-client'
import { resolveAiCredentials } from './ai-settings-service'
import { recordAuditLog } from './audit-log-service'

export interface GlassActor {
  id: string
  companyId: string
}

export const GLASS_REVIEW_LIST_DEFAULT_LIMIT = 50

/**
 * Avaliações externas. A ingestão tem dois passos separados de propósito:
 * `parseGlassReview` interpreta e **não escreve**, `createGlassReview` grava o
 * que a pessoa revisou. Entre um e outro existe um humano — é ele que impede
 * que a leitura do modelo vire dado de RH sem ninguém conferir.
 */

/** Interpreta o texto colado. Não grava — nem a avaliação, nem log. */
export async function parseGlassReview(
  actor: GlassActor,
  raw: string,
  deps: { complete?: AgentCompletionFn } = {},
): Promise<GlassParseResponse> {
  const credentials = await resolveAiCredentials(actor.companyId)

  const draft = await extractGlassReview({ raw, credentials, complete: deps.complete })

  return { draft, missingFields: missingRequiredFields(draft) }
}

/** `AAAA-MM-DD` → meia-noite UTC. A avaliação tem dia, não hora. */
function toReviewDate(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null
}

export async function createGlassReview(
  actor: GlassActor,
  input: CreateGlassReviewRequest,
): Promise<GlassReview> {
  const db = scopedPrisma(actor.companyId)

  // Alertas são recalculados aqui, sempre. O que o cliente mandar em `alerts` é
  // ignorado: alerta é conclusão do servidor sobre o dado, não campo de formulário.
  const alerts = reviewAlerts({
    rating: input.rating,
    status: input.status,
    title: input.title,
    positives: input.positives,
    negatives: input.negatives,
    advice: input.advice,
  })

  return db.$transaction(async (tx) => {
    const created = await tx.glassReview.create({
      data: {
        // Explícito por redundância defensiva: a extensão de isolamento valida
        // que o valor bate com o escopo (ver `lib/tenant-scope.ts`).
        companyId: actor.companyId,
        reviewDate: toReviewDate(input.reviewDate),
        rating: input.rating === null ? null : new Prisma.Decimal(input.rating),
        role: input.role,
        level: input.level,
        sector: input.sector,
        tenure: input.tenure,
        status: input.status,
        recommends: input.recommends,
        leadershipApproval: input.leadershipApproval,
        title: input.title,
        positives: input.positives,
        negatives: input.negatives,
        advice: input.advice,
        sentiment: input.sentiment,
        themesPositive: input.themesPositive,
        themesNegative: input.themesNegative,
        alerts,
        aiSummary: input.aiSummary,
        createdById: actor.id,
      },
    })

    await recordAuditLog({
      actorId: actor.id,
      entityType: 'GlassReview',
      entityId: created.id,
      action: 'CREATE',
      after: created,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })

    return created
  })
}

export interface GlassReviewFilters {
  sector?: string
  status?: string
  withAlerts?: boolean
  limit?: number
}

function listWhere(filters: GlassReviewFilters): Prisma.GlassReviewWhereInput {
  return {
    ...(filters.sector ? { sector: filters.sector } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.withAlerts ? { NOT: { alerts: { isEmpty: true } } } : {}),
  }
}

export function listGlassReviews(actor: GlassActor, filters: GlassReviewFilters): Promise<GlassReview[]> {
  return scopedPrisma(actor.companyId).glassReview.findMany({
    where: listWhere(filters),
    // `reviewDate` primeiro, com as sem data no fim: a série é do que aconteceu,
    // não de quando alguém colou.
    orderBy: [{ reviewDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: filters.limit ?? GLASS_REVIEW_LIST_DEFAULT_LIMIT,
  })
}

/**
 * Página + contagem real do filtro. São duas coisas diferentes de propósito: a
 * lista vem cortada em `limit`, mas o cabeçalho do painel de alertas precisa
 * dizer quantas avaliações alertam de verdade — "(50)" quando são 80 é um painel
 * de risco mentindo para menos.
 */
export async function listGlassReviewsPage(
  actor: GlassActor,
  filters: GlassReviewFilters,
): Promise<{ reviews: GlassReview[]; total: number }> {
  const [reviews, total] = await Promise.all([
    listGlassReviews(actor, filters),
    scopedPrisma(actor.companyId).glassReview.count({ where: listWhere(filters) }),
  ])
  return { reviews, total }
}
