import { Prisma } from '@prisma/client'
import { isChallengeCategory, isFullAdmin } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

export class ChallengeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class ChallengeNotFoundError extends ChallengeError {
  constructor() {
    super('Desafio não encontrado.', 404)
  }
}
export class ChallengeClosedError extends ChallengeError {
  constructor() {
    super('Este desafio não está aberto para participação.', 409)
  }
}
export class ChallengeHasSubmissionsError extends ChallengeError {
  constructor() {
    super('Desafio com participações não pode ser apagado. Desative-o.', 409)
  }
}
export class SubmissionNotFoundError extends ChallengeError {
  constructor() {
    super('Participação não encontrada.', 404)
  }
}
export class SubmissionAlreadyOpenError extends ChallengeError {
  constructor() {
    super('Você já participou deste desafio.', 409)
  }
}
export class SubmissionNotPendingError extends ChallengeError {
  constructor() {
    super('Esta participação já foi avaliada.', 409)
  }
}
export class ChallengeSectorForbiddenError extends ChallengeError {
  constructor() {
    super('Você só pode gerenciar desafios do seu setor.', 403)
  }
}
export class ChallengeInvalidCategoryError extends ChallengeError {
  constructor() {
    super('Categoria inválida.', 400)
  }
}
export class InvalidEvidenceKeyError extends ChallengeError {
  constructor() {
    super('Chave de evidência inválida.', 400)
  }
}

export interface ChallengeActor {
  id: string
  role: string
  /** Acesso administrativo delegado — vale como ADMIN pleno aqui. */
  adminAccess?: boolean
  sectorId: string
  companyId: string
}

export const challengeInclude = { sector: { select: { id: true, name: true } } } as const
export type ChallengeWithSector = Prisma.ChallengeGetPayload<{ include: typeof challengeInclude }>

/** Include de admin: acrescenta a contagem de participações ao `sector` de `challengeInclude`. */
export const challengeAdminInclude = {
  sector: { select: { id: true, name: true } },
  _count: { select: { submissions: true } },
} as const

/**
 * SUBADMIN só toca desafio do próprio setor. Desafio da empresa inteira
 * (`sectorId === null`) é território exclusivo do ADMIN — sem isso um subadmin
 * moderaria participação de gente de todos os setores.
 */
export function assertCanManageChallenge(actor: ChallengeActor, sectorId: string | null): void {
  if (isFullAdmin(actor)) return
  if (sectorId === null || sectorId !== actor.sectorId) throw new ChallengeSectorForbiddenError()
}

/**
 * Escopo de destino de uma criação. Para o SUBADMIN, `sectorId` omitido assume
 * o setor dele; qualquer escopo explícito diferente (inclusive `null`, que é o
 * desafio da empresa inteira) é 403. Espelha `resolveSectorIdForWrite` de
 * hr-dashboard-service.
 */
function resolveSectorIdForWrite(actor: ChallengeActor, requested: string | null | undefined): string | null {
  if (actor.role === 'SUBADMIN') {
    if (requested === undefined || requested === actor.sectorId) return actor.sectorId
    throw new ChallengeSectorForbiddenError()
  }
  return requested ?? null
}

/** Recorte de desafios que o ator enxerga: tudo para ADMIN, só o setor para SUBADMIN. */
function adminScopeWhere(actor: ChallengeActor, filters: { sectorId?: string }): Prisma.ChallengeWhereInput {
  if (!isFullAdmin(actor)) return { sectorId: actor.sectorId }
  return filters.sectorId ? { sectorId: filters.sectorId } : {}
}

export interface CreateChallengeInput {
  title: string
  description: string
  category: string
  detailsMarkdown?: string | null
  imageKey?: string | null
  rewardCoins: number
  isActive?: boolean
  position?: number
  requiresReview?: boolean
  isPrivate?: boolean
  isFeatured?: boolean
  startsAt?: Date | null
  endsAt?: Date | null
  sectorId?: string | null
}

export type UpdateChallengeInput = Partial<Omit<CreateChallengeInput, 'sectorId'>> & {
  sectorId?: string | null
}

function assertCategory(category: string): void {
  if (!isChallengeCategory(category)) throw new ChallengeInvalidCategoryError()
}

/**
 * O `scopedPrisma` injeta o companyId na linha criada, mas não impede referenciar
 * um setor de OUTRA empresa via FK — sem isso um ADMIN da empresa A criaria
 * desafio apontando pro setor da empresa B (e o DTO devolveria o nome de lá).
 * Espelha assertSectorExists de hr-dashboard-service.
 */
async function assertSectorExists(companyId: string, sectorId: string | null): Promise<void> {
  if (sectorId === null) return
  const sector = await scopedPrisma(companyId).sector.findFirst({ where: { id: sectorId } })
  if (!sector) throw new ChallengeError('Setor não encontrado.', 404)
}

export async function listChallengesForAdmin(actor: ChallengeActor, filters: { sectorId?: string }) {
  return scopedPrisma(actor.companyId).challenge.findMany({
    where: adminScopeWhere(actor, filters),
    include: { ...challengeInclude, _count: { select: { submissions: true } } },
    orderBy: [{ isActive: 'desc' }, { position: 'asc' }, { createdAt: 'desc' }],
  })
}

/** findFirst e não findUnique: a extensão de tenant injeta companyId no where. */
async function findChallengeOrThrow(companyId: string, id: string) {
  const challenge = await scopedPrisma(companyId).challenge.findFirst({ where: { id }, include: challengeAdminInclude })
  if (!challenge) throw new ChallengeNotFoundError()
  return challenge
}

export async function createChallenge(actor: ChallengeActor, input: CreateChallengeInput) {
  const sectorId = resolveSectorIdForWrite(actor, input.sectorId)
  assertCategory(input.category)
  await assertSectorExists(actor.companyId, sectorId)
  const db = scopedPrisma(actor.companyId)

  return db.$transaction(async (tx) => {
    const created = await tx.challenge.create({
      data: {
        title: input.title,
        description: input.description,
        category: input.category,
        detailsMarkdown: input.detailsMarkdown ?? null,
        imageKey: input.imageKey ?? null,
        rewardCoins: input.rewardCoins,
        isActive: input.isActive ?? true,
        position: input.position ?? 0,
        requiresReview: input.requiresReview ?? true,
        isPrivate: input.isPrivate ?? false,
        isFeatured: input.isFeatured ?? false,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        sectorId,
        createdById: actor.id,
      },
      include: challengeAdminInclude,
    })
    // Cast igual ao de hr-dashboard-service: o tx da extensão de tenant não é um
    // Prisma.TransactionClient cru, mas o companyId vai explícito no recordAuditLog.
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'Challenge',
      entityId: created.id,
      action: 'CREATE',
      after: created,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return created
  })
}

export async function updateChallenge(actor: ChallengeActor, id: string, input: UpdateChallengeInput) {
  const db = scopedPrisma(actor.companyId)
  const before = await db.challenge.findFirst({ where: { id }, include: challengeAdminInclude })
  if (!before) throw new ChallengeNotFoundError()
  assertCanManageChallenge(actor, before.sectorId)
  if (input.category !== undefined) assertCategory(input.category)
  // Mover para outro setor exige poder sobre o destino também.
  if (input.sectorId !== undefined) {
    assertCanManageChallenge(actor, input.sectorId)
    await assertSectorExists(actor.companyId, input.sectorId)
  }

  const data: Prisma.ChallengeUncheckedUpdateInput = {}
  if (input.title !== undefined) data.title = input.title
  if (input.description !== undefined) data.description = input.description
  if (input.category !== undefined) data.category = input.category
  if (input.detailsMarkdown !== undefined) data.detailsMarkdown = input.detailsMarkdown ?? null
  if (input.imageKey !== undefined) data.imageKey = input.imageKey ?? null
  if (input.rewardCoins !== undefined) data.rewardCoins = input.rewardCoins
  if (input.isActive !== undefined) data.isActive = input.isActive
  if (input.position !== undefined) data.position = input.position
  if (input.requiresReview !== undefined) data.requiresReview = input.requiresReview
  if (input.isPrivate !== undefined) data.isPrivate = input.isPrivate
  if (input.isFeatured !== undefined) data.isFeatured = input.isFeatured
  if (input.startsAt !== undefined) data.startsAt = input.startsAt ?? null
  if (input.endsAt !== undefined) data.endsAt = input.endsAt ?? null
  if (input.sectorId !== undefined) data.sectorId = input.sectorId

  return db.$transaction(async (tx) => {
    await tx.challenge.update({ where: { id }, data })
    const after = await tx.challenge.findUniqueOrThrow({
      where: { id },
      include: challengeAdminInclude,
    })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'Challenge',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return after
  })
}

export async function deleteChallenge(actor: ChallengeActor, id: string): Promise<void> {
  const current = await findChallengeOrThrow(actor.companyId, id)
  assertCanManageChallenge(actor, current.sectorId)

  // O onDelete: Cascade existe como salvaguarda de integridade, não como caminho
  // normal: apagar um desafio já moderado sumiria com o histórico da fila enquanto
  // os coins creditados continuariam no extrato (o livro-razão é append-only).
  const count = await scopedPrisma(actor.companyId).challengeSubmission.count({ where: { challengeId: id } })
  if (count > 0) throw new ChallengeHasSubmissionsError()

  await scopedPrisma(actor.companyId).$transaction(async (tx) => {
    await tx.challenge.delete({ where: { id } })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'Challenge',
      entityId: id,
      action: 'DELETE',
      before: current,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}

/**
 * Reordena numa transação: a vitrine nunca é lida com metade da ordem nova.
 * O índice no array vira `position`, então a ordem enviada é a ordem exibida.
 */
export async function reorderChallenges(actor: ChallengeActor, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = scopedPrisma(actor.companyId)

  const challenges = await db.challenge.findMany({ where: { id: { in: ids } } })
  if (challenges.length !== ids.length) throw new ChallengeNotFoundError()
  // Um id de fora do setor derruba a operação inteira — nada de reordenar metade.
  for (const challenge of challenges) assertCanManageChallenge(actor, challenge.sectorId)

  await db.$transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.challenge.update({ where: { id }, data: { position: index } })
    }
    // 'UPDATE' e não 'REORDER': AdminAuditAction é enum do Prisma com apenas
    // CREATE/UPDATE/DELETE. Inventar um valor aqui não compila e violaria o enum
    // no banco. A ordem nova vai no `after`.
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'Challenge',
      entityId: ids[0],
      action: 'UPDATE',
      after: { reorder: ids },
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}

// --- Participação do colaborador -------------------------------------------------

export const submissionInclude = {
  user: { select: { id: true, name: true, email: true, photoUrl: true } },
  challenge: { select: { id: true, title: true, rewardCoins: true, sectorId: true } },
  reviewedBy: { select: { id: true, name: true } },
} as const
export type SubmissionWithRefs = Prisma.ChallengeSubmissionGetPayload<{ include: typeof submissionInclude }>

/** Desafios que a pessoa vê: os da empresa inteira mais os do próprio setor. */
function visibleToUserWhere(sectorId: string): Prisma.ChallengeWhereInput {
  return { OR: [{ sectorId: null }, { sectorId }] }
}

export function isChallengeOpen(
  challenge: { isActive: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (!challenge.isActive) return false
  if (challenge.startsAt && now < challenge.startsAt) return false
  if (challenge.endsAt && now > challenge.endsAt) return false
  return true
}

/**
 * A vitrine é `isActive && !isPrivate && dentro da janela && setor` (spec). O
 * `where` original do plano esqueceu a janela: um desafio vencido continuava
 * na vitrine com o botão "Participar", que voltava 409 (createSubmission
 * checa a janela, listMyChallenges não checava). `OR` fica em `AND` — o
 * `visibleToUserWhere` já usa a chave `OR` no top-level do where, e um
 * segundo `OR` ali sobrescreveria o primeiro em vez de compor.
 */
export async function listMyChallenges(user: { id: string; sectorId: string; companyId: string }, now: Date = new Date()) {
  const db = scopedPrisma(user.companyId)
  const challenges = await db.challenge.findMany({
    // `visibleToUserWhere` já usa a chave `OR` — espalhar um segundo `OR` aqui
    // (p.ex. `{ ...visibleToUserWhere(...), OR: [...] }`) sobrescreveria o
    // primeiro em vez de combinar os dois. Compor com `AND` preserva ambos:
    // "é visível ao setor da pessoa" E ("está aberto pelos filtros de vitrine
    // OU ela já tem submissão nele") — assim quem já participou não perde de
    // vista o próprio status quando o desafio é desativado, sai da janela ou
    // deixa de ser listado depois.
    where: {
      AND: [
        visibleToUserWhere(user.sectorId),
        {
          OR: [
            {
              isActive: true,
              isPrivate: false,
              AND: [
                { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
              ],
            },
            { submissions: { some: { userId: user.id } } },
          ],
        },
      ],
    },
    include: challengeAdminInclude,
    orderBy: [{ isFeatured: 'desc' }, { position: 'asc' }, { createdAt: 'desc' }],
  })
  if (challenges.length === 0) return []

  // Uma query só para todas as submissões da pessoa: nada de N+1 na tela.
  const mine = await db.challengeSubmission.findMany({
    where: { userId: user.id, challengeId: { in: challenges.map((c) => c.id) } },
    include: submissionInclude,
    orderBy: { submittedAt: 'desc' },
  })
  const byChallenge = new Map<string, SubmissionWithRefs>()
  for (const submission of mine) {
    // A mais recente vence: uma rejeitada antiga não esconde a pendente nova.
    if (!byChallenge.has(submission.challengeId)) byChallenge.set(submission.challengeId, submission)
  }

  return challenges.map((challenge) => ({
    challenge,
    mySubmission: byChallenge.get(challenge.id) ?? null,
  }))
}

/**
 * Detalhe de um desafio para a pessoa. `isPrivate` **não** filtra aqui: privado
 * significa não listado, e um link compartilhado precisa continuar abrindo para
 * quem está no escopo. Desafio de outro setor é tratado como inexistente.
 */
export async function getVisibleChallenge(
  user: { id: string; sectorId: string; companyId: string },
  id: string,
) {
  const challenge = await scopedPrisma(user.companyId).challenge.findFirst({
    where: { id, ...visibleToUserWhere(user.sectorId), isActive: true },
    include: challengeAdminInclude,
  })
  if (!challenge) throw new ChallengeNotFoundError()
  return challenge
}

/**
 * A chave nasce no servidor em `/uploads/challenge-evidence/presign`
 * (`challenges/<userId>/<uuid>.pdf`) — mas quem manda o valor no submit é o
 * cliente, então nada impede alguém de colar a chave de QUALQUER objeto do
 * bucket ali (ex. um manual interno) e ganhar de brinde uma URL assinada de
 * download via `presignDocumentDownload` em `toChallengeSubmissionDTO`. Barra
 * qualquer coisa fora do prefixo da própria pessoa.
 */
function assertOwnEvidenceKey(userId: string, evidenceKey: string | undefined): void {
  if (evidenceKey === undefined) return
  if (!evidenceKey.startsWith(`challenges/${userId}/`)) throw new InvalidEvidenceKeyError()
}

export async function createSubmission(
  user: { id: string; sectorId: string; companyId: string },
  challengeId: string,
  input: { note?: string; evidenceKey?: string },
): Promise<SubmissionWithRefs> {
  assertOwnEvidenceKey(user.id, input.evidenceKey)

  const db = scopedPrisma(user.companyId)
  // Desafio de outro setor é tratado como inexistente — não vaza a existência dele.
  const challenge = await db.challenge.findFirst({
    where: { id: challengeId, ...visibleToUserWhere(user.sectorId) },
  })
  if (!challenge) throw new ChallengeNotFoundError()
  if (!isChallengeOpen(challenge)) throw new ChallengeClosedError()

  try {
    return await db.challengeSubmission.create({
      data: {
        challengeId,
        userId: user.id,
        note: input.note ?? null,
        evidenceKey: input.evidenceKey ?? null,
      },
      include: submissionInclude,
    })
  } catch (err) {
    // P2002 na unique PARCIAL: já existe uma pendente ou aprovada. Rejeitada não conta.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SubmissionAlreadyOpenError()
    }
    throw err
  }
}
