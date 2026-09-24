/**
 * Reivindicação de selo pelo próprio colaborador (Documento 4, seção 11.2).
 *
 * Existe porque nem todo selo é contável pelo sistema. Antes disto, o único
 * caminho para um selo de comportamento era pedir no Teams e torcer para alguém
 * conceder na mão — sem relato, sem comprovação e sem fila.
 *
 * **Qual selo dá para reivindicar:** qualquer um que a pessoa ainda não tem. Não
 * há flag `claimable` no `Badge`, e a escolha é deliberada: uma flag nova
 * nasceria `false` e a funcionalidade ficaria invisível até alguém virar
 * duzentas chaves na mão. Reivindicar um selo que o sistema conta sozinho é
 * ruído que a G&G recusa em um clique; feature que ninguém encontra é ruído que
 * ninguém resolve.
 */

import { Prisma, type BadgeClaim } from '@prisma/client'
import {
  BADGE_CLAIM_REJECTION_REASON_MAX_LENGTH,
  BADGE_CLAIM_STORY_MAX_LENGTH,
  type BadgeClaimDTO,
  type BadgeClaimStatus,
  type CreateBadgeClaimRequest,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { presignDocumentDownload, s3Config } from '../lib/s3-client'
import { scopedPrisma } from '../lib/tenant-scope'
import { toBadgeDTO } from '../lib/serialize'
import { creditBadgeRewards } from './badge-reward-service'
import { createNotification } from './notification-service'
import { recordAuditLog } from './audit-log-service'

export class BadgeClaimError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'BadgeClaimError'
  }
}

const CLAIM_INCLUDE = {
  badge: { include: { sectors: { select: { sectorId: true } }, badgeCategory: { select: { name: true } } } },
  user: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
} satisfies Prisma.BadgeClaimInclude

type ClaimWithRefs = Prisma.BadgeClaimGetPayload<{ include: typeof CLAIM_INCLUDE }>

/**
 * Entidade → DTO. O anexo sai como **URL assinada de 5 minutos**, nunca a chave:
 * comprovação de conquista é material de uma pessoa, e o bucket da empresa é
 * público inteiro — uma URL pública aqui vazaria o certificado de todo mundo.
 * Sem storage configurado, `attachmentUrl` é `null` e a tela trata como
 * "sem anexo" em vez de mostrar link quebrado.
 */
export async function toBadgeClaimDTO(claim: ClaimWithRefs): Promise<BadgeClaimDTO> {
  let attachmentUrl: string | null = null
  if (claim.attachmentKey && s3Config()) {
    attachmentUrl = await presignDocumentDownload({ key: claim.attachmentKey })
  }
  return {
    id: claim.id,
    badge: toBadgeDTO(claim.badge),
    user: claim.user,
    story: claim.story,
    attachmentUrl,
    attachmentKind: claim.attachmentKind,
    link: claim.link,
    status: claim.status,
    rejectionReason: claim.rejectionReason,
    reviewedBy: claim.reviewedBy,
    reviewedAt: claim.reviewedAt?.toISOString() ?? null,
    createdAt: claim.createdAt.toISOString(),
  }
}

export interface BadgeClaimViewer {
  userId: string
  companyId: string
}

/**
 * Registra a reivindicação.
 *
 * A chave do anexo precisa ter nascido no presign DESTA pessoa. Sem a
 * checagem de prefixo, um POST direto apontaria `attachmentKey` para o objeto
 * de outro colaborador — mesma defesa que `challenge-service` faz na evidência.
 */
export async function createBadgeClaim(
  viewer: BadgeClaimViewer,
  badgeId: string,
  input: CreateBadgeClaimRequest,
): Promise<BadgeClaimDTO> {
  const story = input.story.trim()
  if (!story) throw new BadgeClaimError('Conte como você conquistou este emblema.', 400)
  if (story.length > BADGE_CLAIM_STORY_MAX_LENGTH) {
    throw new BadgeClaimError(`O relato tem no máximo ${BADGE_CLAIM_STORY_MAX_LENGTH} caracteres.`, 400)
  }
  if (input.attachmentKey && !input.attachmentKey.startsWith(`badge-claims/${viewer.userId}/`)) {
    throw new BadgeClaimError('Anexo inválido. Envie o arquivo de novo.', 400)
  }

  const db = scopedPrisma(viewer.companyId)
  const badge = await db.badge.findFirst({ where: { id: badgeId } })
  if (!badge) throw new BadgeClaimError('Selo não encontrado.', 404)

  const jaTem = await db.userBadge.findFirst({ where: { userId: viewer.userId, badgeId } })
  if (jaTem) throw new BadgeClaimError('Você já tem este selo.', 409)

  try {
    const criado = await db.badgeClaim.create({
      data: {
        badgeId,
        userId: viewer.userId,
        story,
        attachmentKey: input.attachmentKey ?? null,
        attachmentKind: input.attachmentKey ? (input.attachmentKind ?? null) : null,
        link: input.link?.trim() || null,
      },
      include: CLAIM_INCLUDE,
    })
    return toBadgeClaimDTO(criado)
  } catch (err) {
    // O índice único parcial (WHERE status <> 'REJECTED') chega como P2002:
    // já existe uma reivindicação em análise ou aprovada para este par.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BadgeClaimError('Você já tem uma solicitação em análise para este selo.', 409)
    }
    throw err
  }
}

/** As reivindicações de quem está pedindo — alimenta o estado na galeria. */
export async function listMyBadgeClaims(viewer: BadgeClaimViewer): Promise<BadgeClaimDTO[]> {
  const rows = await scopedPrisma(viewer.companyId).badgeClaim.findMany({
    where: { userId: viewer.userId },
    include: CLAIM_INCLUDE,
    orderBy: { createdAt: 'desc' },
  })
  return Promise.all(rows.map(toBadgeClaimDTO))
}

/** A fila do admin, por status. */
export async function listBadgeClaims(companyId: string, status?: BadgeClaimStatus): Promise<BadgeClaimDTO[]> {
  const rows = await scopedPrisma(companyId).badgeClaim.findMany({
    where: status ? { status } : {},
    include: CLAIM_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return Promise.all(rows.map(toBadgeClaimDTO))
}

async function loadForReview(companyId: string, id: string): Promise<BadgeClaim> {
  const claim = await scopedPrisma(companyId).badgeClaim.findFirst({ where: { id } })
  if (!claim) throw new BadgeClaimError('Solicitação não encontrada.', 404)
  return claim
}

async function reload(companyId: string, id: string): Promise<BadgeClaimDTO> {
  const row = await scopedPrisma(companyId).badgeClaim.findFirstOrThrow({ where: { id }, include: CLAIM_INCLUDE })
  return toBadgeClaimDTO(row)
}

/**
 * Aprova: concede o selo e credita as duas moedas, tudo na mesma transação.
 *
 * O `updateMany` condicional em `status: PENDING` é o ponto de serialização —
 * é ele que toma o lock da linha, e sob Read Committed a transação concorrente
 * bloqueia nele, reavalia o predicado contra a linha já commitada, vê que não é
 * mais PENDING e devolve `count 0`. Reler com um SELECT simples não teria esse
 * efeito. Mesma anatomia de `challenge-submission-service.decide`, e pelo mesmo
 * motivo: sem isso, dois cliques concorrentes concedem o selo duas vezes.
 *
 * O `where` é só de colunas escalares de propósito: é o que faz o Prisma emitir
 * um `UPDATE ... WHERE ...` direto, que toma o lock de linha no recheck.
 */
export async function approveBadgeClaim(
  actor: { id: string; companyId: string },
  id: string,
): Promise<BadgeClaimDTO> {
  const atual = await loadForReview(actor.companyId, id)
  if (atual.status !== 'PENDING') throw new BadgeClaimError('Esta solicitação já foi revisada.', 409)

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.badgeClaim.updateMany({
      where: { id, companyId: actor.companyId, status: 'PENDING' },
      data: { status: 'APPROVED', reviewedAt: now, reviewedById: actor.id, rejectionReason: null },
    })
    if (count === 0) throw new BadgeClaimError('Esta solicitação já foi revisada.', 409)

    // `MANUAL` e não `AUTO`: quem concedeu foi uma pessoa, olhando a
    // comprovação — e é `MANUAL` que o admin consegue revogar depois.
    await tx.userBadge.create({
      data: {
        userId: atual.userId,
        badgeId: atual.badgeId,
        source: 'MANUAL',
        awardedById: actor.id,
        companyId: actor.companyId,
      },
    })

    await creditBadgeRewards(atual.userId, [atual.badgeId], actor.companyId, tx)

    await recordAuditLog({
      actorId: actor.id,
      entityType: 'BadgeClaim',
      entityId: id,
      action: 'UPDATE',
      companyId: actor.companyId,
      before: { status: atual.status },
      after: { status: 'APPROVED' },
      tx,
    })
  })

  // Aviso fora da transação e best-effort: o selo já é da pessoa, e uma falha de
  // notificação não pode desfazer a concessão. `BADGE_EARNED` é o tipo certo —
  // é o que ela quer ler, e não "sua solicitação foi aprovada".
  const badge = await scopedPrisma(actor.companyId).badge.findFirst({ where: { id: atual.badgeId } })
  try {
    await createNotification({
      userId: atual.userId,
      type: 'BADGE_EARNED',
      title: `Você conquistou o selo "${badge?.name ?? 'novo'}"!`,
      link: '/engajamento',
      companyId: actor.companyId,
    })
  } catch (err) {
    console.error('[badge-claim] falha ao avisar da aprovação', err)
  }

  return reload(actor.companyId, id)
}

/** Recusa com motivo — que volta para quem pediu, senão a recusa não ensina nada. */
export async function rejectBadgeClaim(
  actor: { id: string; companyId: string },
  id: string,
  reason: string,
): Promise<BadgeClaimDTO> {
  const motivo = reason.trim()
  if (!motivo) throw new BadgeClaimError('Informe o motivo da recusa.', 400)
  if (motivo.length > BADGE_CLAIM_REJECTION_REASON_MAX_LENGTH) {
    throw new BadgeClaimError(`O motivo tem no máximo ${BADGE_CLAIM_REJECTION_REASON_MAX_LENGTH} caracteres.`, 400)
  }

  const atual = await loadForReview(actor.companyId, id)
  if (atual.status !== 'PENDING') throw new BadgeClaimError('Esta solicitação já foi revisada.', 409)

  const now = new Date()
  const { count } = await scopedPrisma(actor.companyId).badgeClaim.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'REJECTED', reviewedAt: now, reviewedById: actor.id, rejectionReason: motivo },
  })
  if (count === 0) throw new BadgeClaimError('Esta solicitação já foi revisada.', 409)

  await recordAuditLog({
    actorId: actor.id,
    entityType: 'BadgeClaim',
    entityId: id,
    action: 'UPDATE',
    companyId: actor.companyId,
    before: { status: atual.status },
    after: { status: 'REJECTED', rejectionReason: motivo },
  })

  try {
    await createNotification({
      userId: atual.userId,
      type: 'BADGE_CLAIM_REJECTED',
      title: `Sua solicitação de selo não foi aprovada: ${motivo}`,
      link: '/engajamento',
      companyId: actor.companyId,
    })
  } catch (err) {
    console.error('[badge-claim] falha ao avisar da recusa', err)
  }

  return reload(actor.companyId, id)
}
