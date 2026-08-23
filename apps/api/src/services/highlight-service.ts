import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { Prisma, type User, type VotingPeriod } from '@prisma/client'
import { buildCongratsText } from '../lib/gemini-client'
import { cardBrandFrom, renderCard } from '../lib/card-renderer'
import { saveCardPng, highlightStorageEnabled } from '../lib/highlight-storage'
import { photoDataUriFor } from '../lib/dev-photo'
import { fetchImageDataUri } from '../lib/remote-image'
import { monthLabel, monthName } from '../lib/month-label'
import { getBrandingSettings } from './branding-service'
import { recordAuditLog } from './audit-log-service'
import { materializeVoteFeedbacks } from './vote-feedback-service'
import { evaluateBadgesForUser } from './badge-service'
import { notifyBadgesEarned, notifyRecognitionsPublished } from './notification-service'

export interface ElectionResult {
  winnerId: string
  winnerVotes: number
}

/**
 * Apura o vencedor de um período: o mais votado. Desempate: entre os empatados
 * no maior número de votos, vence quem ATINGIU esse total primeiro — isto é, o
 * `createdAt` do voto que o levou ao total vencedor (o seu último voto) mais
 * antigo. Retorna null se o período não tiver votos.
 */
export async function electWinner(periodId: string, companyId: string): Promise<ElectionResult | null> {
  const votes = await scopedPrisma(companyId).vote.findMany({
    where: { periodId, voted: { role: 'LEGEND' } },
    select: { votedId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  if (votes.length === 0) return null

  const count = new Map<string, number>()
  const reachedAt = new Map<string, Date>() // createdAt do último voto de cada candidato
  for (const v of votes) {
    count.set(v.votedId, (count.get(v.votedId) ?? 0) + 1)
    reachedAt.set(v.votedId, v.createdAt)
  }

  const maxVotes = Math.max(...count.values())
  let winnerId = ''
  let winnerReachedAt = Infinity
  for (const [userId, n] of count) {
    if (n !== maxVotes) continue
    const t = reachedAt.get(userId)!.getTime()
    if (t < winnerReachedAt) {
      winnerReachedAt = t
      winnerId = userId
    }
  }

  return { winnerId, winnerVotes: maxVotes }
}

export class HighlightError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'HighlightError'
  }
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function highlightMonthRefOf(period: Pick<VotingPeriod, 'monthRef' | 'highlightMonthRef'>): string {
  return period.highlightMonthRef ?? period.monthRef
}

/**
 * Gera o rascunho do destaque (1 chamada ao Gemini): apura o vencedor, monta o
 * texto a partir das justificativas ANÔNIMAS do mês e grava o período em DRAFT.
 * A imagem é gerada em uma etapa separada, para o admin poder revisar o texto
 * antes de renderizar e baixar o card.
 */
export async function generateHighlightDraft(periodId: string, actorId: string, companyId: string): Promise<VotingPeriod> {
  const db = scopedPrisma(companyId)
  const before = await db.votingPeriod.findUnique({ where: { id: periodId } })
  if (!before) throw new HighlightError('Período não encontrado.', 404)
  if (before.highlightStatus !== 'NONE') {
    throw new HighlightError('O destaque deste período já foi gerado.', 409)
  }

  const election = await electWinner(periodId, companyId)
  if (!election) throw new HighlightError('Não há votos neste período para apurar o destaque.', 422)

  const winner = await db.user.findUniqueOrThrow({ where: { id: election.winnerId } })

  // Justificativas SEM identificar autores — só os textos.
  const votes = await db.vote.findMany({
    where: { periodId, votedId: winner.id },
    select: { justification: true },
    orderBy: { createdAt: 'asc' },
  })
  const justifications = votes.map((v) => v.justification)
  const highlightMonthRef = highlightMonthRefOf(before)

  const text = await buildCongratsText({
    winnerName: winner.name,
    monthLabel: monthLabel(highlightMonthRef),
    justifications,
  })

  const after = await db.votingPeriod.update({
    where: { id: periodId },
    data: {
      winnerId: winner.id,
      winnerVotes: election.winnerVotes,
      highlightMonthRef,
      highlightText: text,
      highlightImagePath: null,
      highlightStatus: 'DRAFT',
    },
  })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: periodId, action: 'UPDATE', before, after, companyId })
  return after
}

/** Edita o mês/texto do destaque em DRAFT (sem Gemini e sem re-renderizar a imagem). */
export async function updateHighlightText(
  periodId: string,
  text: string,
  actorId: string,
  companyId: string,
  highlightMonthRef?: string,
): Promise<VotingPeriod> {
  const db = scopedPrisma(companyId)
  const before = await db.votingPeriod.findUnique({ where: { id: periodId } })
  if (!before) throw new HighlightError('Período não encontrado.', 404)
  if (before.highlightStatus !== 'DRAFT') {
    throw new HighlightError('Só é possível editar um destaque em rascunho.', 409)
  }
  const effectiveMonthRef = highlightMonthRef ?? highlightMonthRefOf(before)

  const after = await db.votingPeriod.update({
    where: { id: periodId },
    data: { highlightMonthRef: effectiveMonthRef, highlightText: text, highlightImagePath: null },
  })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: periodId, action: 'UPDATE', before, after, companyId })
  return after
}

/** Renderiza/atualiza a imagem do destaque em DRAFT, sem publicar. */
export async function generateHighlightImage(periodId: string, actorId: string, companyId: string): Promise<VotingPeriod> {
  const db = scopedPrisma(companyId)
  const before = await db.votingPeriod.findUnique({ where: { id: periodId } })
  if (!before) throw new HighlightError('Período não encontrado.', 404)
  if (before.highlightStatus !== 'DRAFT') {
    throw new HighlightError('Só é possível gerar a imagem de um destaque em rascunho.', 409)
  }
  if (!before.winnerId || !before.highlightText) {
    throw new HighlightError('Gere o destaque e revise o texto antes de gerar a imagem.', 409)
  }
  if (!highlightStorageEnabled()) {
    throw new HighlightError('O armazenamento de imagens (S3) não está configurado.', 503)
  }
  const winner = await db.user.findUniqueOrThrow({ where: { id: before.winnerId } })

  // Card na marca da empresa. `configured: false` cai no default do renderer,
  // que é a arte histórica — quem nunca cadastrou marca não vê o card mudar.
  const brandingSettings = await getBrandingSettings(companyId)
  const cardBrand = brandingSettings.configured
    ? cardBrandFrom(
        brandingSettings,
        // O card tem fundo escuro tingido de marca, então usa a arte do tema escuro.
        await fetchImageDataUri(brandingSettings.logos.dark.wide ?? brandingSettings.logos.light.wide),
      )
    : undefined

  const png = await renderCard({
    name: winner.name,
    monthName: monthName(highlightMonthRefOf(before)),
    position: winner.position,
    text: before.highlightText,
    photoDataUri: photoDataUriFor(winner.email),
    initials: initialsOf(winner.name),
    brand: cardBrand,
  })
  const imagePath = await saveCardPng(companyId, highlightMonthRefOf(before), png)

  const after = await db.votingPeriod.update({
    where: { id: periodId },
    data: { highlightImagePath: imagePath },
  })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: periodId, action: 'UPDATE', before, after, companyId })
  return after
}

/**
 * Fecha o período: garante o feedback de cada voto, reavalia os selos de quem
 * recebeu e avisa que o Destaque do Mês saiu.
 *
 * A materialização aqui é **rede de segurança**, não o caminho normal: desde
 * que feedback deixou de esperar a publicação, ele nasce junto com o voto
 * (`createVote`). O que sobra para cá são os votos anteriores a essa mudança e
 * qualquer linha que tenha escapado — por isso ela é idempotente.
 *
 * Best-effort por pessoa — o destaque já está publicado e os selos são recomputáveis,
 * então uma falha em alguém não pode abortar a liberação dos demais.
 */
async function releaseRecognitions(period: VotingPeriod): Promise<void> {
  const db = scopedPrisma(period.companyId)
  try {
    await materializeVoteFeedbacks(period.id)
  } catch (err) {
    console.error(`Falha ao materializar os feedbacks do período ${period.id}`, err)
  }
  const rows = await db.vote.findMany({
    where: { periodId: period.id },
    distinct: ['votedId'],
    select: { votedId: true },
  })
  const recognized: string[] = []
  for (const { votedId } of rows) {
    try {
      const awarded = await evaluateBadgesForUser(votedId)
      await notifyBadgesEarned(votedId, awarded.map((b) => b.badgeId), period.companyId)
      recognized.push(votedId)
    } catch (err) {
      console.error(`Falha ao liberar os selos de ${votedId} no período ${period.id}`, err)
    }
  }
  try {
    await notifyRecognitionsPublished(recognized, highlightMonthRefOf(period), period.companyId)
  } catch (err) {
    console.error(`Falha ao notificar os reconhecimentos do período ${period.id}`, err)
  }
}

/**
 * Publica o destaque (DRAFT → PUBLISHED), concede o selo ao vencedor e libera os
 * reconhecimentos do período (selos derivados de voto + notificações).
 */
export async function publishHighlight(periodId: string, actorId: string, companyId: string): Promise<VotingPeriod> {
  const db = scopedPrisma(companyId)
  const before = await db.votingPeriod.findUnique({ where: { id: periodId } })
  if (!before) throw new HighlightError('Período não encontrado.', 404)
  if (before.highlightStatus !== 'DRAFT') {
    throw new HighlightError('Só é possível publicar um destaque em rascunho.', 409)
  }
  if (!before.highlightImagePath) {
    throw new HighlightError('Gere a imagem do destaque antes de publicar.', 409)
  }
  // `findFirst`, e não `findUnique`: o slug é único por empresa, e quem injeta o
  // `companyId` no where é o `scopedPrisma` — o selo achado aqui é sempre o desta empresa.
  const badge = await db.badge.findFirst({ where: { slug: 'destaque-do-mes' } })
  if (!badge) throw new HighlightError('Selo "destaque-do-mes" não encontrado (rode o seed).', 500)

  const updated = await db.$transaction(async (tx) => {
    const period = await tx.votingPeriod.update({ where: { id: periodId }, data: { highlightStatus: 'PUBLISHED' } })
    // UserBadge está na allowlist de scopedPrisma, que não suporta `upsert` — busca e cria/
    // não-faz-nada explicitamente (idempotente: republicar o mesmo destaque não duplica o selo).
    const existingBadge = await tx.userBadge.findUnique({
      where: { userId_badgeId_periodId: { userId: before.winnerId!, badgeId: badge.id, periodId } },
    })
    if (!existingBadge) {
      await tx.userBadge.create({ data: { userId: before.winnerId!, badgeId: badge.id, periodId } })
    }
    // `tx` aqui é o client estendido por `scopedPrisma`, mas `recordAuditLog` passa `companyId`
    // explícito no `data` do create — o cast só reconcilia com a assinatura de
    // `recordAuditLog`, que prevê `Prisma.TransactionClient`.
    await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: periodId, action: 'UPDATE', before, after: period, companyId, tx: tx as unknown as Prisma.TransactionClient })
    return period
  })
  // Só depois do commit: a partir daqui os votos do período estão publicados e,
  // portanto, contam para selo.
  await releaseRecognitions(updated)
  return updated
}

export interface PublishedHighlight {
  period: VotingPeriod
  winner: User | null
}

/** Lista os destaques publicados (mais recente primeiro) para o histórico. */
export async function listPublishedHighlights(companyId?: string, sectorId?: string): Promise<PublishedHighlight[]> {
  const periods = await prisma.votingPeriod.findMany({
    where: {
      highlightStatus: 'PUBLISHED',
      ...(companyId ? { companyId } : {}),
      ...(sectorId ? { sectorId } : {}),
    },
    include: { winner: true },
    orderBy: { monthRef: 'desc' },
  })
  return periods.map((p) => ({ period: p, winner: p.winner }))
}
