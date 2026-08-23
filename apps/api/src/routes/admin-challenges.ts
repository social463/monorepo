import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  CHALLENGE_CATEGORIES,
  CHALLENGE_DESCRIPTION_MAX_LENGTH,
  CHALLENGE_DETAILS_MAX_LENGTH,
  CHALLENGE_TITLE_MAX_LENGTH,
} from '@legends/shared'
import { toChallengeDTO } from '../lib/serialize'
import {
  ChallengeError,
  createChallenge,
  deleteChallenge,
  listChallengesForAdmin,
  reorderChallenges,
  updateChallenge,
  type ChallengeActor,
} from '../services/challenge-service'

const idParamsSchema = z.object({ id: z.string().min(1) })
const listQuerySchema = z.object({ sectorId: z.string().min(1).optional() })

const baseSchema = {
  title: z.string().trim().min(1).max(CHALLENGE_TITLE_MAX_LENGTH),
  description: z.string().trim().min(1).max(CHALLENGE_DESCRIPTION_MAX_LENGTH),
  // Enum vindo da const canônica: categoria fora da lista morre aqui, com 400.
  category: z.enum(CHALLENGE_CATEGORIES),
  detailsMarkdown: z.string().max(CHALLENGE_DETAILS_MAX_LENGTH).nullable().optional(),
  imageKey: z.string().min(1).nullable().optional(),
  rewardCoins: z.number().int().min(0),
  isActive: z.boolean().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  requiresReview: z.boolean().optional(),
  isPrivate: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  sectorId: z.string().min(1).nullable().optional(),
}
const createSchema = z.object(baseSchema)
const updateSchema = z.object(baseSchema).partial()
const reorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) })

function handleChallengeError(err: unknown, reply: FastifyReply) {
  if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
  throw err
}

function actorFrom(request: {
  user: { sub: string; role: string; adminAccess?: boolean; sectorId: string; companyId: string }
}): ChallengeActor {
  return {
    id: request.user.sub,
    role: request.user.role,
    adminAccess: request.user.adminAccess,
    sectorId: request.user.sectorId,
    companyId: request.user.companyId,
  }
}

export async function adminChallengeRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/admin/challenges', guard, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: query.error.issues })
    }
    const challenges = await listChallengesForAdmin(actorFrom(request), query.data)
    return reply.send({ challenges: challenges.map(toChallengeDTO) })
  })

  app.post('/admin/challenges', guard, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const created = await createChallenge(actorFrom(request), parsed.data)
      return reply.code(201).send({ challenge: toChallengeDTO(created) })
    } catch (err) {
      return handleChallengeError(err, reply)
    }
  })

  app.patch('/admin/challenges/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Requisição inválida.' })
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const updated = await updateChallenge(actorFrom(request), params.data.id, parsed.data)
      return reply.send({ challenge: toChallengeDTO(updated) })
    } catch (err) {
      return handleChallengeError(err, reply)
    }
  })

  app.post('/admin/challenges/reorder', guard, async (request, reply) => {
    const parsed = reorderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      await reorderChallenges(actorFrom(request), parsed.data.ids)
      return reply.code(204).send()
    } catch (err) {
      return handleChallengeError(err, reply)
    }
  })

  app.delete('/admin/challenges/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Requisição inválida.' })
    try {
      await deleteChallenge(actorFrom(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleChallengeError(err, reply)
    }
  })
}
