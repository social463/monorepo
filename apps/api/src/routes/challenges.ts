import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CHALLENGE_NOTE_MAX_LENGTH, type MyChallengeDTO } from '@legends/shared'
import { toChallengeDTO, toChallengeSubmissionDTO } from '../lib/serialize'
import { ChallengeError, createSubmission, getVisibleChallenge, listMyChallenges } from '../services/challenge-service'

const createSubmissionSchema = z.object({
  note: z.string().trim().min(1).max(CHALLENGE_NOTE_MAX_LENGTH).optional(),
  evidenceKey: z.string().trim().min(1).max(512).optional(),
})

const idParamsSchema = z.object({ id: z.string().trim().min(1) })

export async function challengeRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireFeature('desafios')] }

  app.get('/challenges', guard, async (request, reply) => {
    const me = {
      id: request.user.sub,
      sectorId: request.user.sectorId,
      companyId: request.user.companyId,
    }
    const rows = await listMyChallenges(me)
    const items: MyChallengeDTO[] = await Promise.all(
      rows.map(async ({ challenge, mySubmission }) => ({
        ...toChallengeDTO(challenge),
        mySubmission: mySubmission ? await toChallengeSubmissionDTO(mySubmission) : null,
      })),
    )
    return reply.send(items)
  })

  // D6: `isPrivate` só tira o desafio da vitrine — o link direto continua abrindo
  // para quem está no escopo (empresa inteira ou o próprio setor).
  app.get('/challenges/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: params.error.flatten() })
    }
    const me = {
      id: request.user.sub,
      sectorId: request.user.sectorId,
      companyId: request.user.companyId,
    }
    try {
      const challenge = await getVisibleChallenge(me, params.data.id)
      return reply.send(toChallengeDTO(challenge))
    } catch (err) {
      if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/challenges/:id/submissions', guard, async (request, reply) => {
    const parsed = createSubmissionSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    const me = {
      id: request.user.sub,
      sectorId: request.user.sectorId,
      companyId: request.user.companyId,
    }

    try {
      const submission = await createSubmission(me, id, parsed.data)
      return reply.code(201).send(await toChallengeSubmissionDTO(submission))
    } catch (err) {
      if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
