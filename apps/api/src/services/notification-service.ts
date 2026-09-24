import type { Prisma } from '@prisma/client'
import { LEADER_ROLES, type CorporatePostAudience, type UserRole } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { monthLabel } from '../lib/month-label'
import { postTeamsNotification } from '../lib/teams-client'
import { hhmmInSaoPaulo } from '../lib/sao-paulo-date'
import { absoluteUrl } from '../lib/app-url'
import { scopedPrisma } from '../lib/tenant-scope'
import { teamsBrandFor } from './branding-service'

export const NOTIFICATION_RETENTION_DAYS = 90

/** Emoji da manchete do card do Teams por tipo de notificação. */
/** Dia curto (dd/MM) em São Paulo — o fuso é fixo porque isto vira texto lido por gente. */
function diaCurtoEmSaoPaulo(at: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(at)
}

export function emojiForNotificationType(type: Prisma.NotificationCreateInput['type']): string {
  const map: Partial<Record<string, string>> = {
    REVIEW_COMMENT: '💬',
    REVIEW_COMMENT_REPLY: '💬',
    REVIEW_REACTION: '❤️',
    REVIEW_SHARED: '📣',
    REVIEW_MENTION: '@',
    REVIEW_POLL_PUBLISHED: '📊',
    CORPORATE_POST_COMMENT: '💬',
    CORPORATE_POST_COMMENT_REPLY: '💬',
    CORPORATE_POST_REACTION: '❤️',
    CORPORATE_POST_MENTION: '@',
    CORPORATE_POST_PUBLISHED: '📣',
    CORPORATE_POST_AWAITING_REVIEW: '📥',
    CORPORATE_POST_APPROVED: '✅',
    CORPORATE_POST_REJECTED: '🚫',
    FEEDBACK_RECEIVED: '📝',
    FEEDBACK_REACTION: '❤️',
    FEEDBACK_COMMENT: '💬',
    BADGE_EARNED: '🏅',
    HIGHLIGHT_PUBLISHED: '🏆',
    BIRTHDAY_GREETING_RECEIVED: '🎂',
    DEVELOPMENT_THURSDAY_EVENT: '📚',
    PERIOD_OPENED: '📣',
    PERIOD_CLOSED: '📣',
    RETRO_INVITED: '🗓️',
    STREAK_AT_RISK: '🔥',
    VOTE_REMINDER_MIDWAY: '🗳️',
    VOTE_REMINDER_CLOSING: '🗳️',
    MEETING_INVITED: '📅',
    MEETING_UPDATED: '📅',
    MEETING_CANCELED: '🚫',
    MEETING_REMINDER: '⏰',
    ONE_ON_ONE_RESPONDED: '🤝',
    ONE_ON_ONE_PROPOSAL_ACCEPTED: '✅',
    ONE_ON_ONE_PROPOSAL_DECLINED: '🚫',
    OFFICE_DESK_REMINDER_RECEIVED: '🎁',
    OFFICE_DESK_REMINDER_READ: '✅',
    PDI_ACTION_AWAITING_REVIEW: '📋',
    PDI_ACTION_APPROVED: '✅',
    PDI_ACTION_CHANGES_REQUESTED: '✏️',
    MANDATORY_COURSE_ASSIGNED: '📚',
    CERTIFICATE_APPROVED: '🎓',
    CHALLENGE_SUBMISSION_APPROVED: '🎯',
    CHALLENGE_SUBMISSION_REJECTED: '↩️',
    CALENDAR_EVENT_REMINDER: '📌',
    ONE_ON_ONE_INVITED: '🗓️',
    ONE_ON_ONE_ACTION_ASSIGNED: '✅',
  }
  return map[type as string] ?? '🔔'
}

export type NotificationWithActor = Prisma.NotificationGetPayload<{ include: { actor: true } }>

interface CreateNotificationInput {
  userId: string
  type: Prisma.NotificationCreateInput['type']
  title: string
  actorId?: string | null
  link?: string | null
  metadata?: Prisma.InputJsonValue
  /** Passa true quando o chamador já gerencia o espelhamento no Teams (ex.: nudge). */
  skipTeamsMirror?: boolean
  /**
   * Detalhes **só do card do Teams** — a notificação in-app mostra apenas o
   * título, e lá o contexto já está na tela para onde o link leva. No Teams o
   * card é tudo que a pessoa vê antes de decidir clicar.
   */
  teamsFacts?: { title: string; value: string }[]
  companyId: string
}

/** Insere uma notificação e expurga, do mesmo usuário, as além da retenção. */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const db = scopedPrisma(input.companyId)
  await db.$transaction([
    db.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        actorId: input.actorId ?? null,
        link: input.link ?? null,
        metadata: input.metadata,
      },
    }),
    db.notification.deleteMany({ where: { userId: input.userId, createdAt: { lt: cutoff } } }),
  ])
  if (!input.skipTeamsMirror) {
    await mirrorToTeams(input)
  }
}

/**
 * Espelha uma notificação no Teams (DM via webhook do usuário), best-effort.
 * Qualquer falha é logada e engolida — nunca derruba a criação da notificação.
 */
async function mirrorToTeams(input: CreateNotificationInput): Promise<void> {
  try {
    const user = await scopedPrisma(input.companyId).user.findUnique({
      where: { id: input.userId },
      select: { teamsWebhookUrl: true, email: true },
    })
    if (!user?.teamsWebhookUrl) return
    const brand = await teamsBrandFor(input.companyId)
    await postTeamsNotification(user.teamsWebhookUrl, {
      title: input.title,
      ctaUrl: absoluteUrl(input.link ?? null),
      ctaLabel: `Abrir no ${brand.appName}`,
      emoji: emojiForNotificationType(input.type),
      facts: input.teamsFacts,
      recipient: user.email,
      brand,
    })
  } catch (err) {
    console.error(`[notification-service] falha ao espelhar no Teams (user ${input.userId})`, err)
  }
}

export async function notifyFeedbackReceived(
  feedback: { id: string; targetId: string; authorId: string; author: { name: string } },
  companyId: string,
): Promise<void> {
  if (feedback.authorId === feedback.targetId) return
  await createNotification({
    userId: feedback.targetId,
    type: 'FEEDBACK_RECEIVED',
    actorId: feedback.authorId,
    title: `${feedback.author.name} deixou um feedback pra você`,
    link: `/perfil/${feedback.targetId}?feedback=${feedback.id}`,
    metadata: { feedbackId: feedback.id },
    companyId,
  })
}

export async function notifyReaction(
  feedback: { id: string; targetId: string; authorId: string },
  reactorId: string,
  reactorName: string,
  companyId: string,
): Promise<void> {
  if (reactorId === feedback.authorId) return
  await createNotification({
    userId: feedback.authorId,
    type: 'FEEDBACK_REACTION',
    actorId: reactorId,
    title: `${reactorName} reagiu a um feedback seu`,
    link: `/perfil/${feedback.targetId}?feedback=${feedback.id}`,
    metadata: { feedbackId: feedback.id },
    companyId,
  })
}

/**
 * Quem soube da resposta a um feedback. Duas rodas de gente, e o título é o que
 * as separa: quem é DONO do feedback (escreveu ou recebeu) ouve "um feedback
 * seu"; quem só respondeu antes ouve que a conversa continuou. O tipo é o mesmo
 * — resposta a feedback é lista plana, sem thread, diferente de resenha e
 * comunicado, onde `_REPLY` é outra coisa.
 *
 * O link é o deep-link do perfil, o mesmo de `notifyFeedbackReceived`: é lá que
 * a conversa abre, e o servidor resolve em que página o feedback caiu.
 *
 * Quem respondeu nunca é avisado da própria resposta.
 */
export async function notifyFeedbackComment(
  input: {
    feedbackId: string
    feedbackTargetId: string
    /** Quem escreveu o feedback e quem o recebeu. */
    ownerIds: string[]
    /** Quem já tinha respondido antes — a conversa continuou sem eles. */
    previousCommenterIds: string[]
    actorId: string
  },
  companyId: string,
): Promise<void> {
  const owners = new Set(input.ownerIds.filter((id) => id !== input.actorId))
  const others = new Set(
    input.previousCommenterIds.filter((id) => id !== input.actorId && !owners.has(id)),
  )
  if (owners.size === 0 && others.size === 0) return
  const name = await actorName(input.actorId)
  const link = `/perfil/${input.feedbackTargetId}?feedback=${input.feedbackId}`
  for (const [userId, title] of [
    ...[...owners].map((id) => [id, `${name} respondeu a um feedback seu`] as const),
    ...[...others].map((id) => [id, `${name} também respondeu a um feedback que você respondeu`] as const),
  ]) {
    await createNotification({
      userId,
      type: 'FEEDBACK_COMMENT',
      actorId: input.actorId,
      title,
      link,
      metadata: { feedbackId: input.feedbackId },
      companyId,
    })
  }
}

/** Resolve o nome do ator para compor o título da notificação. */
async function actorName(actorId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
  return u?.name ?? 'Alguém'
}

export async function notifyReviewComment(
  input: { reviewAuthorId: string; actorId: string; reviewId: string },
  companyId: string,
): Promise<void> {
  if (input.actorId === input.reviewAuthorId) return
  await createNotification({
    userId: input.reviewAuthorId,
    type: 'REVIEW_COMMENT',
    actorId: input.actorId,
    title: `${await actorName(input.actorId)} comentou na sua resenha`,
    link: `/resenha#${input.reviewId}`,
    metadata: { reviewId: input.reviewId },
    companyId,
  })
}

export async function notifyReviewCommentReply(
  input: { recipientIds: string[]; actorId: string; reviewId: string },
  companyId: string,
): Promise<void> {
  const recipients = [...new Set(input.recipientIds)].filter((id) => id !== input.actorId)
  if (recipients.length === 0) return
  const name = await actorName(input.actorId)
  for (const userId of recipients) {
    await createNotification({
      userId,
      type: 'REVIEW_COMMENT_REPLY',
      actorId: input.actorId,
      title: `${name} também comentou numa resenha que você comentou`,
      link: `/resenha#${input.reviewId}`,
      metadata: { reviewId: input.reviewId },
      companyId,
    })
  }
}

export async function notifyReviewReaction(
  input: { reviewAuthorId: string; actorId: string; reviewId: string },
  companyId: string,
): Promise<void> {
  if (input.actorId === input.reviewAuthorId) return
  await createNotification({
    userId: input.reviewAuthorId,
    type: 'REVIEW_REACTION',
    actorId: input.actorId,
    title: `${await actorName(input.actorId)} reagiu à sua resenha`,
    link: `/resenha#${input.reviewId}`,
    metadata: { reviewId: input.reviewId },
    companyId,
  })
}

export async function notifyReviewShared(
  input: { reviewAuthorId: string; actorId: string; reviewId: string },
  companyId: string,
): Promise<void> {
  if (input.actorId === input.reviewAuthorId) return
  await createNotification({
    userId: input.reviewAuthorId,
    type: 'REVIEW_SHARED',
    actorId: input.actorId,
    title: `${await actorName(input.actorId)} compartilhou sua resenha no mural`,
    link: `/resenha#${input.reviewId}`,
    metadata: { reviewId: input.reviewId },
    companyId,
  })
}

export async function notifyReviewMention(
  input: { recipientIds: string[]; actorId: string; reviewId: string },
  companyId: string,
): Promise<void> {
  const recipients = [...new Set(input.recipientIds)].filter((id) => id !== input.actorId)
  if (recipients.length === 0) return
  const name = await actorName(input.actorId)
  for (const userId of recipients) {
    await createNotification({
      userId,
      type: 'REVIEW_MENTION',
      actorId: input.actorId,
      title: `${name} te marcou numa resenha`,
      link: `/resenha#${input.reviewId}`,
      metadata: { reviewId: input.reviewId },
      companyId,
    })
  }
}

/** Recorte da pergunta no título da notificação — o campo aceita 140, o sino não. */
const POLL_QUESTION_PREVIEW_LENGTH = 60

/**
 * Enquete publicada na Resenha avisa o setor inteiro, menos quem publicou.
 * É o único conteúdo da Resenha que notifica sem menção: enquete sem quórum
 * não serve pra nada, e quem passa no feed depois já perdeu a votação.
 */
export async function notifyReviewPollPublished(
  input: { reviewId: string; question: string; actorId: string; sectorId: string },
  companyId: string,
): Promise<void> {
  const name = await actorName(input.actorId)
  const question = input.question.trim()
  const preview =
    question.length > POLL_QUESTION_PREVIEW_LENGTH
      ? `${question.slice(0, POLL_QUESTION_PREVIEW_LENGTH).trimEnd()}…`
      : question
  await broadcastToActive(
    'REVIEW_POLL_PUBLISHED',
    `${name} abriu uma enquete: ${preview}`,
    `/resenha#${input.reviewId}`,
    companyId,
    input.sectorId,
    { actorId: input.actorId, excludeUserId: input.actorId },
  )
}

export async function notifyCorporatePostComment(
  input: { postAuthorId: string; actorId: string; postId: string },
  companyId: string,
): Promise<void> {
  if (input.actorId === input.postAuthorId) return
  await createNotification({
    userId: input.postAuthorId,
    type: 'CORPORATE_POST_COMMENT',
    actorId: input.actorId,
    title: `${await actorName(input.actorId)} comentou na sua publicação do mural`,
    link: `/mural-corporativo#${input.postId}`,
    metadata: { postId: input.postId },
    companyId,
  })
}

export async function notifyCorporatePostCommentReply(
  input: { recipientIds: string[]; actorId: string; postId: string },
  companyId: string,
): Promise<void> {
  const recipients = [...new Set(input.recipientIds)].filter((id) => id !== input.actorId)
  if (recipients.length === 0) return
  const name = await actorName(input.actorId)
  for (const userId of recipients) {
    await createNotification({
      userId,
      type: 'CORPORATE_POST_COMMENT_REPLY',
      actorId: input.actorId,
      title: `${name} também comentou numa publicação que você comentou`,
      link: `/mural-corporativo#${input.postId}`,
      metadata: { postId: input.postId },
      companyId,
    })
  }
}

export async function notifyCorporatePostReaction(
  input: { postAuthorId: string; actorId: string; postId: string },
  companyId: string,
): Promise<void> {
  if (input.actorId === input.postAuthorId) return
  await createNotification({
    userId: input.postAuthorId,
    type: 'CORPORATE_POST_REACTION',
    actorId: input.actorId,
    title: `${await actorName(input.actorId)} reagiu à sua publicação do mural`,
    link: `/mural-corporativo#${input.postId}`,
    metadata: { postId: input.postId },
    companyId,
  })
}

export async function notifyCorporatePostMention(
  input: { recipientIds: string[]; actorId: string; postId: string },
  companyId: string,
): Promise<void> {
  const recipients = [...new Set(input.recipientIds)].filter((id) => id !== input.actorId)
  if (recipients.length === 0) return
  const name = await actorName(input.actorId)
  for (const userId of recipients) {
    await createNotification({
      userId,
      type: 'CORPORATE_POST_MENTION',
      actorId: input.actorId,
      title: `${name} te marcou numa publicação do mural`,
      link: `/mural-corporativo#${input.postId}`,
      metadata: { postId: input.postId },
      companyId,
    })
  }
}

/**
 * Comunicado novo no ar: cai no sininho de **quem está no público-alvo**, e é o
 * mesmo aviso que a web transforma em toast para quem está com a plataforma
 * aberta. `sectorIds` vazio significa empresa toda (escopo `ALL`).
 *
 * O autor fica fora da lista: ele acabou de escrever o comunicado.
 */
export async function notifyCorporatePostPublished(
  input: {
    postId: string
    title: string | null
    authorId: string
    sectorIds: string[]
    /** Escopo do público. `LEADERS` recorta por papel, não por setor. */
    audience?: CorporatePostAudience
  },
  companyId: string,
): Promise<void> {
  const name = await actorName(input.authorId)
  // Comunicado da liderança avisa quem lidera, e só. ADMIN e SUBADMIN ficam de
  // fora do aviso de propósito: eles administram a plataforma e não lideram
  // ninguém no organograma — é a razão de já estarem fora de `LEADER_ROLES`.
  // Continuam VENDO o post no feed, o que nunca dependeu da notificação.
  const paraLideranca = input.audience === 'LEADERS'
  await broadcastToActive(
    'CORPORATE_POST_PUBLISHED',
    input.title ? `Novo comunicado: ${input.title}` : `${name} publicou um comunicado no feed da empresa`,
    `/mural-corporativo#${input.postId}`,
    companyId,
    input.sectorIds.length ? input.sectorIds : undefined,
    {
      actorId: input.authorId,
      excludeUserId: input.authorId,
      ...(paraLideranca ? { roles: LEADER_ROLES } : {}),
    },
  )
}

/**
 * Avisa quem administra que um comunicado entrou na fila de aprovação. Vai para
 * ADMIN, SUBADMIN e quem tem acesso administrativo delegado — é exatamente
 * quem `canModerateCorporatePost` deixa aprovar.
 */
export async function notifyCorporatePostAwaitingReview(
  input: { postId: string; authorId: string },
  companyId: string,
): Promise<void> {
  const db = scopedPrisma(companyId)
  const reviewers = await db.user.findMany({
    where: {
      active: true,
      id: { not: input.authorId },
      OR: [{ role: { in: ['ADMIN', 'SUBADMIN'] } }, { adminAccess: true }],
    },
    select: { id: true },
  })
  if (reviewers.length === 0) return
  const name = await actorName(input.authorId)
  for (const reviewer of reviewers) {
    await createNotification({
      userId: reviewer.id,
      type: 'CORPORATE_POST_AWAITING_REVIEW',
      actorId: input.authorId,
      title: `${name} enviou um comunicado para aprovação`,
      link: '/admin/moderacao?tab=feed',
      metadata: { postId: input.postId },
      companyId,
    })
  }
}

/** Avisa o autor que o comunicado dele foi aprovado (e já está no feed). */
export async function notifyCorporatePostApproved(
  input: { postId: string; authorId: string; actorId: string },
  companyId: string,
): Promise<void> {
  await createNotification({
    userId: input.authorId,
    type: 'CORPORATE_POST_APPROVED',
    actorId: input.actorId,
    title: 'Seu comunicado foi aprovado e já está no feed da empresa',
    link: `/mural-corporativo#${input.postId}`,
    metadata: { postId: input.postId },
    companyId,
  })
}

/** Avisa o autor da recusa, com o motivo quando a G&G escreveu um. */
export async function notifyCorporatePostRejected(
  input: { postId: string; authorId: string; actorId: string; reason?: string | null },
  companyId: string,
): Promise<void> {
  await createNotification({
    userId: input.authorId,
    type: 'CORPORATE_POST_REJECTED',
    actorId: input.actorId,
    title: input.reason
      ? `Seu comunicado não foi publicado: ${input.reason}`
      : 'Seu comunicado não foi publicado',
    link: '/mural-corporativo/meus-envios',
    metadata: { postId: input.postId },
    companyId,
  })
}

/** Avisa o líder que uma ação de PDI entrou na fila de validação dele. */
export async function notifyPdiActionAwaitingReview(input: {
  leaderId: string
  actorId: string
  actionId: string
  description: string
  companyId: string
}): Promise<void> {
  const name = await actorName(input.actorId)
  await createNotification({
    userId: input.leaderId,
    type: 'PDI_ACTION_AWAITING_REVIEW',
    actorId: input.actorId,
    title: `${name} concluiu uma ação de PDI e aguarda sua validação`,
    link: '/pdi?aba=validacoes',
    metadata: { actionId: input.actionId, description: input.description },
    companyId: input.companyId,
  })
}

/** Avisa a pessoa que o líder aprovou a ação ou pediu ajustes. */
export async function notifyPdiActionReviewed(input: {
  userId: string
  actorId: string
  actionId: string
  description: string
  approved: boolean
  companyId: string
}): Promise<void> {
  const name = await actorName(input.actorId)
  await createNotification({
    userId: input.userId,
    type: input.approved ? 'PDI_ACTION_APPROVED' : 'PDI_ACTION_CHANGES_REQUESTED',
    actorId: input.actorId,
    title: input.approved
      ? `${name} aprovou a conclusão da sua ação de PDI`
      : `${name} pediu ajustes na sua ação de PDI`,
    link: '/pdi',
    metadata: { actionId: input.actionId, description: input.description },
    companyId: input.companyId,
  })
}

/** Avisa que um curso obrigatório foi atribuído. */
export async function notifyMandatoryCourseAssigned(input: {
  userIds: string[]
  courseId: string
  courseTitle: string
  companyId: string
}): Promise<void> {
  for (const userId of [...new Set(input.userIds)]) {
    await createNotification({
      userId,
      type: 'MANDATORY_COURSE_ASSIGNED',
      title: `Novo curso obrigatório: "${input.courseTitle}"`,
      link: `/aprendizado/curso/${input.courseId}`,
      metadata: { courseId: input.courseId },
      companyId: input.companyId,
    })
  }
}

/**
 * Avisa que a solicitação de certificado foi aprovada. Disparada por
 * `approveCertificateRequest` (`certificate-request-service.ts`), sempre
 * DEPOIS da transação que já emitiu o certificado — chamar isto é best-effort
 * do lado de quem chama, não daqui: esta função só propaga o que `createNotification`
 * fizer (ela mesma não engole erro).
 */
export async function notifyCertificateApproved(input: {
  /**
   * Nulo no certificado de curso EXTERNO (Documento 4, seção 9.8): não há curso
   * no portal para onde apontar, então o link leva à página de envio, onde a
   * pessoa vê o próprio pedido aprovado.
   */
  courseId: string | null
  userId: string
  courseTitle: string
  companyId: string
}): Promise<void> {
  await createNotification({
    userId: input.userId,
    type: 'CERTIFICATE_APPROVED',
    title: `Seu certificado de "${input.courseTitle}" foi aprovado!`,
    link: input.courseId ? `/aprendizado/curso/${input.courseId}` : '/aprendizado/certificados',
    metadata: input.courseId ? { courseId: input.courseId } : {},
    companyId: input.companyId,
  })
}

/**
 * Validação (ou recusa) de um registro de treinamento pela G&G.
 *
 * O link leva a "Meus treinamentos", que é onde a pessoa vê a situação e — na
 * recusa — corrige e reenvia. O motivo entra no título porque uma recusa sem
 * motivo visível obriga a abrir a tela para descobrir o que fazer.
 */
export async function notifyTrainingReviewed(input: {
  userId: string
  courseTitle: string
  approved: boolean
  rejectionReason: string | null
  companyId: string
}): Promise<void> {
  await createNotification({
    userId: input.userId,
    type: input.approved ? 'TRAINING_VALIDATED' : 'TRAINING_REJECTED',
    title: input.approved
      ? `Seu treinamento "${input.courseTitle}" foi validado pelo T&D!`
      : `Seu treinamento "${input.courseTitle}" precisa de ajuste: ${input.rejectionReason ?? 'confira os dados'}`,
    link: '/treinamentos',
    metadata: {},
    companyId: input.companyId,
  })
}

/** Cria uma notificação por selo concedido, ignorando o selo do Destaque do Mês. */
export async function notifyBadgesEarned(userId: string, badgeIds: string[], companyId: string): Promise<void> {
  if (badgeIds.length === 0) return
  const badges = await scopedPrisma(companyId).badge.findMany({
    where: { id: { in: badgeIds }, slug: { not: 'destaque-do-mes' } },
    select: { name: true },
  })
  for (const badge of badges) {
    await createNotification({
      userId,
      type: 'BADGE_EARNED',
      title: `Você conquistou o selo "${badge.name}"!`,
      link: '/engajamento',
      companyId,
    })
  }
}

/**
 * Avisa quem recebeu voto no período que o **Destaque do Mês** saiu.
 *
 * O texto não fala mais em "seus reconhecimentos já estão disponíveis": o
 * feedback do voto chega no perfil na hora em que alguém vota, não na
 * publicação. O que a publicação libera é a apuração — e o aviso leva para o
 * quadro do mês, não para o perfil de quem recebeu.
 */
export async function notifyRecognitionsPublished(userIds: string[], monthRef: string, companyId: string): Promise<void> {
  for (const userId of [...new Set(userIds)]) {
    await createNotification({
      userId,
      type: 'HIGHLIGHT_PUBLISHED',
      title: `O Destaque de ${monthLabel(monthRef)} já saiu!`,
      link: '/destaques',
      companyId,
    })
  }
}

async function broadcastToActive(
  type: Prisma.NotificationCreateInput['type'],
  title: string,
  link: string | null,
  companyId: string,
  /**
   * Recorte por setor. Aceita **lista** porque o comunicado do Feed Corporativo
   * tem público-alvo de N setores; o resto do sistema manda um só.
   */
  sectorId?: string | string[],
  /**
   * `actorId` faz o sino mostrar o avatar de quem gerou; `excludeUserId` tira
   * essa pessoa da lista; `roles` recorta por PAPEL — é o que o comunicado
   * dirigido à liderança precisa, e que o recorte por setor não expressa.
   */
  opts: { actorId?: string; excludeUserId?: string; roles?: readonly UserRole[] } = {},
): Promise<void> {
  const db = scopedPrisma(companyId)
  const users = await db.user.findMany({
    where: {
      active: true,
      ...(Array.isArray(sectorId)
        ? { sectorId: { in: sectorId } }
        : sectorId
          ? { sectorId }
          : {}),
      ...(opts.roles?.length ? { role: { in: [...opts.roles] } } : {}),
      ...(opts.excludeUserId ? { id: { not: opts.excludeUserId } } : {}),
    },
    select: { id: true, teamsWebhookUrl: true, email: true },
  })
  if (users.length === 0) return
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  await db.$transaction([
    db.notification.createMany({
      data: users.map((u) => ({ userId: u.id, type, title, link, actorId: opts.actorId ?? null })),
    }),
    db.notification.deleteMany({ where: { userId: { in: users.map((u) => u.id) }, createdAt: { lt: cutoff } } }),
  ])
  const ctaUrl = absoluteUrl(link)
  const emoji = emojiForNotificationType(type)
  // Uma leitura só para o lote inteiro: a marca é da empresa, não do destinatário.
  const brand = await teamsBrandFor(companyId)
  for (const user of users) {
    if (!user.teamsWebhookUrl) continue
    await postTeamsNotification(user.teamsWebhookUrl, {
      title,
      ctaUrl,
      ctaLabel: `Abrir no ${brand.appName}`,
      emoji,
      recipient: user.email,
      brand,
    })
  }
}

export async function notifyPeriodOpened(period: { monthRef: string; sectorId: string; companyId: string }): Promise<void> {
  await broadcastToActive('PERIOD_OPENED', `A votação de ${monthLabel(period.monthRef)} está aberta!`, '/votar', period.companyId, period.sectorId)
}

export async function notifyPeriodClosed(period: { monthRef: string; sectorId: string; companyId: string }): Promise<void> {
  await broadcastToActive('PERIOD_CLOSED', `A votação de ${monthLabel(period.monthRef)} foi encerrada.`, null, period.companyId, period.sectorId)
}

export async function notifyRetroInvited(
  input: { roomId: string; title: string; actorId: string; invitedUserIds: string[] },
  companyId: string,
): Promise<void> {
  const targets = input.invitedUserIds.filter((id) => id !== input.actorId)
  for (const userId of targets) {
    await createNotification({
      userId,
      type: 'RETRO_INVITED',
      actorId: input.actorId,
      title: `Você foi convidado para a retrospectiva "${input.title}"`,
      link: `/retrospectivas/${input.roomId}`,
      metadata: { roomId: input.roomId },
      companyId,
    })
  }
}

/** Avisa a pessoa do resultado da participação num desafio. */
export async function notifyChallengeReviewed(
  submission: {
    id: string
    userId: string
    status: 'APPROVED' | 'REJECTED'
    challenge: { title: string; rewardCoins: number }
  },
  actorId: string,
  companyId: string,
): Promise<void> {
  const approved = submission.status === 'APPROVED'
  const title = approved
    ? `Sua participação em "${submission.challenge.title}" foi aprovada` +
      (submission.challenge.rewardCoins > 0 ? ` — +${submission.challenge.rewardCoins} coins` : '')
    : `Sua participação em "${submission.challenge.title}" não foi aprovada`

  await createNotification({
    userId: submission.userId,
    type: approved ? 'CHALLENGE_SUBMISSION_APPROVED' : 'CHALLENGE_SUBMISSION_REJECTED',
    title,
    actorId,
    link: '/desafios',
    companyId,
  })
}

const STORE_ORDER_NOTIFICATION_TYPES = {
  APPROVED: 'STORE_ORDER_APPROVED',
  DELIVERED: 'STORE_ORDER_DELIVERED',
  CANCELLED: 'STORE_ORDER_CANCELLED',
} as const

export async function notifyStoreOrderStatus(
  order: { id: string; userId: string; productTitle: string; pricePaid: number },
  status: 'APPROVED' | 'DELIVERED' | 'CANCELLED',
  actorId: string,
  companyId: string,
): Promise<void> {
  const title =
    status === 'APPROVED'
      ? `Seu resgate de "${order.productTitle}" foi aprovado`
      : status === 'DELIVERED'
        ? `Seu resgate de "${order.productTitle}" foi entregue`
        // O cancelamento é o aviso que mais importa: diz que os coins voltaram.
        : `Seu resgate de "${order.productTitle}" foi cancelado — ${order.pricePaid} coins devolvidos`

  await createNotification({
    userId: order.userId,
    type: STORE_ORDER_NOTIFICATION_TYPES[status],
    title,
    actorId,
    link: '/loja?tab=pedidos',
    companyId,
  })
}

function encodeCursor(n: { createdAt: Date; id: string }): string {
  return Buffer.from(`${n.createdAt.toISOString()}|${n.id}`).toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    const createdAt = new Date(iso)
    if (!id || Number.isNaN(createdAt.getTime())) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

export async function listNotifications(
  userId: string,
  companyId: string,
  opts: { cursor?: string; limit: number; read?: boolean },
): Promise<{ items: NotificationWithActor[]; nextCursor: string | null; unreadCount: number }> {
  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null
  const readFilter =
    opts.read === undefined ? {} : { readAt: opts.read ? { not: null } : null }
  const where: Prisma.NotificationWhereInput = decoded
    ? {
        userId,
        ...readFilter,
        OR: [
          { createdAt: { lt: decoded.createdAt } },
          { createdAt: decoded.createdAt, id: { lt: decoded.id } },
        ],
      }
    : { userId, ...readFilter }
  const [rows, unreadCount] = await Promise.all([
    scopedPrisma(companyId).notification.findMany({
      where,
      include: { actor: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
    }),
    countUnread(userId, companyId),
  ])
  const hasMore = rows.length > opts.limit
  const items = hasMore ? rows.slice(0, opts.limit) : rows
  const nextCursor = hasMore ? encodeCursor(items[items.length - 1]) : null
  return { items, nextCursor, unreadCount }
}

export function countUnread(userId: string, companyId: string): Promise<number> {
  return scopedPrisma(companyId).notification.count({ where: { userId, readAt: null } })
}

export async function markAllRead(userId: string, companyId: string): Promise<void> {
  await scopedPrisma(companyId).notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } })
}

/** Marca uma notificação como lida (idempotente). Restrita ao dono. */
export async function markRead(userId: string, companyId: string, notificationId: string): Promise<void> {
  await scopedPrisma(companyId).notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  })
}

/** Remove todas as notificações já lidas do usuário. */
export async function clearRead(userId: string, companyId: string): Promise<void> {
  await scopedPrisma(companyId).notification.deleteMany({ where: { userId, readAt: { not: null } } })
}

/** Avisa a outra pessoa que um 1:1 foi marcado. Uma vez por SÉRIE, não por ocorrência. */
export async function notifyOneOnOneInvited(input: {
  userId: string
  actorId: string
  actorName: string
  meetingId: string
  companyId: string
}): Promise<void> {
  await createNotification({
    userId: input.userId,
    type: 'ONE_ON_ONE_INVITED',
    title: `${input.actorName} marcou um 1:1 com você`,
    actorId: input.actorId,
    link: `/1-1/${input.meetingId}`,
    companyId: input.companyId,
  })
}

/** Avisa quem virou dono de uma ação combinada no 1:1. */
export async function notifyOneOnOneActionAssigned(input: {
  userId: string
  actorId: string
  actorName: string
  meetingId: string
  description: string
  companyId: string
}): Promise<void> {
  await createNotification({
    userId: input.userId,
    type: 'ONE_ON_ONE_ACTION_ASSIGNED',
    title: `${input.actorName} combinou uma ação com você no 1:1`,
    actorId: input.actorId,
    link: `/1-1/${input.meetingId}`,
    companyId: input.companyId,
    teamsFacts: [{ title: 'Ação', value: input.description }],
  })
}

/**
 * Avisa quem marcou que o convidado respondeu. A sugestão de horário entra no
 * TÍTULO, e não só no corpo: a lista de notificações mostra a primeira linha, e
 * "não pode" sem a alternativa obriga a abrir o encontro para descobrir se há
 * uma saída.
 */
export async function notifyOneOnOneResponded(input: {
  userId: string
  actorId: string
  actorName: string
  meetingId: string
  accepted: boolean
  startsAt: Date
  proposedStartsAt: Date | null
  companyId: string
}): Promise<void> {
  const quando = hhmmInSaoPaulo(input.startsAt)
  const title = input.accepted
    ? `${input.actorName} confirmou o 1:1 das ${quando}`
    : input.proposedStartsAt
      ? `${input.actorName} não pode às ${quando} e sugeriu ${hhmmInSaoPaulo(input.proposedStartsAt)} de ${diaCurtoEmSaoPaulo(input.proposedStartsAt)}`
      : `${input.actorName} não pode no 1:1 das ${quando}`
  await createNotification({
    userId: input.userId,
    type: 'ONE_ON_ONE_RESPONDED',
    actorId: input.actorId,
    title,
    link: `/1-1/${input.meetingId}`,
    companyId: input.companyId,
  })
}

/** Avisa o convidado se a sugestão dele foi aceita ou descartada. */
export async function notifyOneOnOneProposalDecided(input: {
  userId: string
  actorId: string
  actorName: string
  meetingId: string
  accepted: boolean
  companyId: string
}): Promise<void> {
  await createNotification({
    userId: input.userId,
    type: input.accepted ? 'ONE_ON_ONE_PROPOSAL_ACCEPTED' : 'ONE_ON_ONE_PROPOSAL_DECLINED',
    actorId: input.actorId,
    title: input.accepted
      ? `${input.actorName} aceitou o horário que você sugeriu`
      : `${input.actorName} não pôde no horário que você sugeriu`,
    link: `/1-1/${input.meetingId}`,
    companyId: input.companyId,
  })
}
