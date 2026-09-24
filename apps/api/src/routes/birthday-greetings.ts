import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  CELEBRATION_KINDS,
  GREETING_MAX_LENGTH,
  canSignBirthdayWall,
  type BirthdayWallResponse,
} from '@legends/shared'
import {
  BirthdayGreetingError,
  canModerate,
  getWall,
  removeGreeting,
  signWall,
  toggleReaction,
  updateGreeting,
} from '../services/birthday-greeting-service'
import { toBirthdayGreetingDTO, toBirthdayWallOccurrenceDTO } from '../lib/serialize'

const kindSchema = z.enum(CELEBRATION_KINDS)

const wallQuerySchema = z.object({
  kind: kindSchema.optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
})

const signSchema = z.object({
  kind: kindSchema,
  year: z.number().int().min(1900).max(2200),
  message: z.string().min(1).max(GREETING_MAX_LENGTH),
})

const updateSchema = z.object({ message: z.string().min(1).max(GREETING_MAX_LENGTH) })

const reactionSchema = z.object({ emoji: z.string().min(1).max(8) })

/**
 * Mural de aniversário — separado do feedback de propósito (ver a spec
 * `2026-08-31-mural-de-aniversarios-design.md`). Todo mundo lê; assinar é de
 * qualquer pessoa logada menos o próprio aniversariante.
 */
export async function birthdayGreetingRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.get('/users/:id/birthday-wall', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = wallQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    }
    try {
      const viewerId = request.user.sub
      const moderates = canModerate(request.user)
      const wall = await getWall({
        targetId: id,
        companyId: request.user.companyId,
        kind: parsed.data.kind,
        year: parsed.data.year,
      })
      const body: BirthdayWallResponse = {
        occurrences: wall.occurrences.map(toBirthdayWallOccurrenceDTO),
        selected: wall.selected ? toBirthdayWallOccurrenceDTO(wall.selected) : null,
        greetings: wall.greetings.map((greeting) => toBirthdayGreetingDTO(greeting, viewerId, moderates)),
        // A janela é do servidor; a web só desenha o que ela responde.
        canSign: Boolean(wall.selected?.isOpen) && canSignBirthdayWall({ id: viewerId }, id),
        mySignatureId: wall.greetings.find((greeting) => greeting.authorId === viewerId)?.id ?? null,
      }
      return reply.send(body)
    } catch (err) {
      if (err instanceof BirthdayGreetingError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/users/:id/birthday-wall', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = signSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    }
    try {
      const greeting = await signWall({
        targetId: id,
        authorId: request.user.sub,
        companyId: request.user.companyId,
        kind: parsed.data.kind,
        year: parsed.data.year,
        message: parsed.data.message,
      })
      return reply.code(201).send({
        greeting: toBirthdayGreetingDTO(greeting, request.user.sub, canModerate(request.user)),
      })
    } catch (err) {
      if (err instanceof BirthdayGreetingError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/birthday-greetings/:greetingId', auth, async (request, reply) => {
    const { greetingId } = request.params as { greetingId: string }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    }
    try {
      const greeting = await updateGreeting({
        id: greetingId,
        authorId: request.user.sub,
        companyId: request.user.companyId,
        message: parsed.data.message,
      })
      return reply.send({
        greeting: toBirthdayGreetingDTO(greeting, request.user.sub, canModerate(request.user)),
      })
    } catch (err) {
      if (err instanceof BirthdayGreetingError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/birthday-greetings/:greetingId', auth, async (request, reply) => {
    const { greetingId } = request.params as { greetingId: string }
    try {
      await removeGreeting({
        id: greetingId,
        actorId: request.user.sub,
        actor: request.user,
        companyId: request.user.companyId,
      })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof BirthdayGreetingError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/birthday-greetings/:greetingId/reactions', auth, async (request, reply) => {
    const { greetingId } = request.params as { greetingId: string }
    const parsed = reactionSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    }
    try {
      const greeting = await toggleReaction({
        greetingId,
        userId: request.user.sub,
        emoji: parsed.data.emoji,
        companyId: request.user.companyId,
      })
      return reply.send({
        greeting: toBirthdayGreetingDTO(greeting, request.user.sub, canModerate(request.user)),
      })
    } catch (err) {
      if (err instanceof BirthdayGreetingError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
