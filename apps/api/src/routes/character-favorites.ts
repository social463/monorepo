import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  isCharacterOptions,
  type CharacterOptions,
} from '@legends/shared'
import { toCharacterFavoriteDTO } from '../lib/serialize'
import {
  CharacterFavoriteError,
  deleteCharacterFavoriteSlot,
  listCharacterFavorites,
  parseCharacterFavoriteSlot,
  upsertCharacterFavoriteSlot,
} from '../services/character-favorite-service'

const slotParamsSchema = z.object({
  slot: z.coerce.number().int(),
})

const characterOptionsSchema = z.custom<CharacterOptions>(isCharacterOptions, {
  message: 'Personagem inválido',
})

const saveSlotSchema = z.object({
  seed: z.string().min(1).max(64).optional(),
  options: characterOptionsSchema,
})

function fallbackSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}

export async function characterFavoriteRoutes(app: FastifyInstance) {
  app.get('/character-favorites', { onRequest: [app.authenticate] }, async (request, reply) => {
    const favorites = await listCharacterFavorites(request.user.sub)
    return reply.send({ favorites: favorites.map(toCharacterFavoriteDTO) })
  })

  app.put('/character-favorites/:slot', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsedParams = slotParamsSchema.safeParse(request.params)
    const parsedBody = saveSlotSchema.safeParse(request.body)
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }

    try {
      const slot = parseCharacterFavoriteSlot(parsedParams.data.slot)
      const favorite = await upsertCharacterFavoriteSlot(request.user.sub, slot, {
        seed: parsedBody.data.seed ?? fallbackSeed(),
        options: parsedBody.data.options,
      })
      return reply.send({ favorite: toCharacterFavoriteDTO(favorite) })
    } catch (err) {
      if (err instanceof CharacterFavoriteError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })

  app.delete('/character-favorites/:slot', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsedParams = slotParamsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }

    try {
      const slot = parseCharacterFavoriteSlot(parsedParams.data.slot)
      await deleteCharacterFavoriteSlot(request.user.sub, slot)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof CharacterFavoriteError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })
}
