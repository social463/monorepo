import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

/** O mínimo do voto para virar feedback. */
interface VoteForFeedback {
  id: string
  voterId: string
  votedId: string
  companyId: string
  createdAt: Date
  justification: string
  categories: { categoryId: string }[]
}

/**
 * O feedback que um voto vira.
 *
 * Depois da unificação
 * (`specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`) o produto
 * tem um lugar só onde se lê o que o time diz de alguém: a lista de feedbacks.
 * O voto continua existindo — é o que elege o Destaque do Mês —, mas a
 * justificativa que ele carrega vive como feedback do votante para o votado.
 *
 * Nasce **privado** (`sharedAt` nulo): aparecer no perfil de quem recebeu é uma
 * coisa, ir para o mural da empresa é outra, e essa é decisão de quem recebeu.
 */
export function voteFeedbackData(vote: VoteForFeedback): Prisma.FeedbackUncheckedCreateInput {
  return {
    authorId: vote.voterId,
    targetId: vote.votedId,
    voteId: vote.id,
    message: vote.justification,
    // O "porquê" mora nas categorias; o enum antigo continua servindo à
    // visibilidade, e voto é sempre reconhecimento positivo.
    category: 'ELOGIO',
    createdAt: vote.createdAt,
    companyId: vote.companyId,
    recipients: { create: [{ userId: vote.votedId, companyId: vote.companyId }] },
    ...(vote.categories.length
      ? {
          recognitionCategories: {
            create: vote.categories.map((c) => ({ categoryId: c.categoryId, companyId: vote.companyId })),
          },
        }
      : {}),
  }
}

/**
 * Rede de segurança: materializa o feedback dos votos de um período que ainda
 * não têm um.
 *
 * O caminho normal é o feedback nascer **junto com o voto**, na mesma transação
 * (`createVote`) — quem recebe vê na hora, sem esperar a publicação do destaque.
 * Esta função existe para o que ficou para trás: votos registrados antes dessa
 * mudança, e qualquer linha que tenha escapado. Roda na publicação do destaque.
 *
 * Idempotente por `Feedback.voteId` (único): publicar duas vezes não duplica.
 */
export async function materializeVoteFeedbacks(periodId: string): Promise<string[]> {
  const votes = await prisma.vote.findMany({
    where: { periodId, feedback: null },
    include: { categories: { select: { categoryId: true } } },
  })
  if (votes.length === 0) return []

  const created: string[] = []
  for (const vote of votes) {
    // Um a um, e não `createMany`: cada feedback tem destinatário e categorias
    // penduradas. Um voto que falhe (autor desativado, por exemplo) não pode
    // levar junto a publicação do destaque — quem chama trata como best-effort.
    const feedback = await prisma.feedback.create({
      data: voteFeedbackData(vote),
      select: { id: true, targetId: true },
    })
    created.push(feedback.targetId)
  }
  return created
}
