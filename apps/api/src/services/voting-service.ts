import { Prisma, type VotingPeriod } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { voteFeedbackData } from './vote-feedback-service'

export class VoteError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'VoteError'
  }
}

export const voteInclude = {
  voter: true,
  voted: true,
  period: true,
  categories: { include: { category: true } },
} as const

export type VoteWithRelations = Prisma.VoteGetPayload<{ include: typeof voteInclude }>

/**
 * Período aberto para votar agora NO SETOR informado: status OPEN cuja janela
 * [startsAt, endsAt] contém `now`. Ativação por data — um período agendado entra
 * sozinho na janela. Em caso de sobreposição, o de início mais recente vence.
 */
export function getCurrentOpenPeriod(sectorId: string, companyId: string, now: Date = new Date()): Promise<VotingPeriod | null> {
  return scopedPrisma(companyId).votingPeriod.findFirst({
    where: { sectorId, status: 'OPEN', startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { startsAt: 'desc' },
  })
}

/**
 * Próximo período agendado NO SETOR informado: status OPEN cuja janela ainda não
 * começou (startsAt > now), o de início mais cedo.
 */
export function getNextScheduledPeriod(sectorId: string, companyId: string, now: Date = new Date()): Promise<VotingPeriod | null> {
  return scopedPrisma(companyId).votingPeriod.findFirst({
    where: { sectorId, status: 'OPEN', startsAt: { gt: now } },
    orderBy: { startsAt: 'asc' },
  })
}

interface CreateVoteInput {
  voterId: string
  votedId: string
  categoryIds: string[]
  justification: string
}

export async function createVote(input: CreateVoteInput): Promise<VoteWithRelations> {
  if (input.voterId === input.votedId) {
    throw new VoteError('Você não pode votar em si mesmo.', 400)
  }

  const voter = await prisma.user.findUnique({ where: { id: input.voterId } })
  if (!voter || !voter.active) {
    throw new VoteError('Votante inválido.', 400)
  }
  if (voter.role === 'ADMIN' || voter.role === 'SUBADMIN') {
    throw new VoteError('Administradores não votam.', 403)
  }

  const db = scopedPrisma(voter.companyId)

  const period = await getCurrentOpenPeriod(voter.sectorId, voter.companyId)
  if (!period) {
    throw new VoteError('Nenhum período de votação aberto no momento.', 409)
  }

  const voted = await prisma.user.findUnique({ where: { id: input.votedId } })
  if (!voted || !voted.active || voted.role !== 'LEGEND') {
    throw new VoteError('Colega inválido para votação.', 400)
  }
  if (voted.sectorId !== voter.sectorId) {
    throw new VoteError('Você só pode votar em colegas do seu setor.', 400)
  }

  const categoryIds = [...new Set(input.categoryIds)]
  // Catálogo único da empresa — o mesmo do feedback desde a unificação
  // (`specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`).
  // scopedPrisma injeta companyId no where, então categoria de OUTRA empresa
  // nunca entra nesse resultado.
  const categories = await db.recognitionCategory.findMany({
    where: { id: { in: categoryIds }, active: true },
  })
  if (categories.length !== categoryIds.length) {
    throw new VoteError('Categoria inválida.', 400)
  }

  try {
    // O voto e o feedback nascem juntos, na mesma transação: quem recebeu vê o
    // texto na hora, no perfil, sem esperar a publicação do destaque. Antes o
    // voto ficava embargado até lá — regra que fazia sentido quando aquilo era
    // "reconhecimento do mês" e não podia adiantar a apuração. Agora é feedback,
    // e feedback não espera; o que continua guardado até a publicação é **quem
    // foi o Destaque**, que é outro dado.
    return await db.$transaction(async (tx) => {
      const vote = await tx.vote.create({
        data: {
          voterId: input.voterId,
          votedId: input.votedId,
          periodId: period.id,
          justification: input.justification,
          categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
        },
        include: voteInclude,
      })
      await tx.feedback.create({
        data: voteFeedbackData({ ...vote, categories: categoryIds.map((categoryId) => ({ categoryId })) }),
      })
      return vote
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new VoteError('Você já registrou seu voto neste período.', 409)
    }
    throw err
  }
}

export async function listVotesByVoter(voterId: string, periodId: string): Promise<VoteWithRelations[]> {
  const voter = await prisma.user.findUniqueOrThrow({ where: { id: voterId } })
  return scopedPrisma(voter.companyId).vote.findMany({ where: { voterId, periodId }, include: voteInclude, orderBy: { createdAt: 'desc' } })
}
