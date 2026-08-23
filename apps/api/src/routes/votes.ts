import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MIN_JUSTIFICATION_LENGTH, MIN_VOTE_CATEGORIES, MAX_VOTE_CATEGORIES } from '@legends/shared'
import { VoteError, createVote, getCurrentOpenPeriod, listVotesByVoter } from '../services/voting-service'
import { awardCoins } from '../services/coin-service'
import { evaluateBadgesForUser } from '../services/badge-service'
import { notifyBadgesEarned, notifyFeedbackReceived } from '../services/notification-service'
import { prisma } from '../lib/prisma'
import { awardXp } from '../services/xp-service'
import { toVoteDTO } from '../lib/serialize'
import { captureFor } from '../lib/analytics/request'

const createVoteSchema = z.object({
  votedId: z.string().min(1),
  categoryIds: z.array(z.string().min(1)).min(MIN_VOTE_CATEGORIES).max(MAX_VOTE_CATEGORIES),
  justification: z.string().trim().min(MIN_JUSTIFICATION_LENGTH),
})

export async function voteRoutes(app: FastifyInstance) {
  app.post('/votes', { onRequest: [app.authenticate, app.requireFeature('votar')] }, async (request, reply) => {
    const parsed = createVoteSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Justificativa e seleção obrigatórias.', issues: parsed.error.flatten() })
    }
    try {
      const vote = await createVote({
        voterId: request.user.sub,
        votedId: parsed.data.votedId,
        categoryIds: parsed.data.categoryIds,
        justification: parsed.data.justification,
      })
      // O voto já nasceu com o feedback junto (`createVote`), então o votado é
      // avisado e tem os selos avaliados agora — como em qualquer feedback. O
      // que continua esperando a publicação é **quem foi o Destaque do Mês**,
      // que não sai daqui. Best-effort: o voto e o feedback já estão
      // persistidos, e selo é recomputável.
      try {
        const earned = await evaluateBadgesForUser(vote.votedId)
        await notifyBadgesEarned(vote.votedId, earned.map((b) => b.badgeId), request.user.companyId)
      } catch (badgeErr) {
        request.log.error(badgeErr)
      }
      try {
        const feedback = await prisma.feedback.findUnique({ where: { voteId: vote.id }, select: { id: true } })
        if (feedback) {
          await notifyFeedbackReceived(
            {
              id: feedback.id,
              targetId: vote.votedId,
              authorId: request.user.sub,
              author: { name: vote.voter.name },
            },
            request.user.companyId,
          )
        }
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      // Crédito de EMR Coins é best-effort: o voto já está persistido e o
      // ledger é auditável pelo extrato, então falha aqui não pode falhar o voto.
      try {
        await awardCoins({
          userId: request.user.sub,
          companyId: request.user.companyId,
          event: 'VOTE_CAST',
          reference: vote.id,
        })
      } catch (coinErr) {
        request.log.error(coinErr)
      }
      // XP em try próprio, e não junto do crédito de coins: as duas moedas têm
      // regras independentes, e uma empresa que não paga coin pode pagar XP.
      try {
        await awardXp({
          userId: request.user.sub,
          companyId: request.user.companyId,
          event: 'VOTE_CAST',
          reference: vote.id,
        })
      } catch (xpErr) {
        request.log.error(xpErr)
      }
      // Um evento por categoria votada: é a granularidade que responde "qual
      // categoria cada empresa realmente usa". A justificativa entra só como
      // comprimento — o texto é do colaborador e não sai do banco.
      for (const categoryId of parsed.data.categoryIds) {
        captureFor(request, 'vote_cast', {
          categoryId,
          periodId: vote.periodId,
          justificationLength: parsed.data.justification.length,
        })
      }
      return reply.code(201).send({ vote: toVoteDTO(vote) })
    } catch (err) {
      if (err instanceof VoteError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })

  app.get('/votes/me', { onRequest: [app.authenticate, app.requireFeature('votar')] }, async (request, reply) => {
    const period = await getCurrentOpenPeriod(request.user.sectorId, request.user.companyId)
    if (!period) {
      return reply.send({ votes: [] })
    }
    const votes = await listVotesByVoter(request.user.sub, period.id)
    return reply.send({ votes: votes.map(toVoteDTO) })
  })
}
