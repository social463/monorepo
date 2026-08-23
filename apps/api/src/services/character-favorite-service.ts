import { Prisma } from '@prisma/client'
import {
  CHARACTER_FAVORITE_SLOTS,
  characterSignature,
  sanitizeCharacterOptions,
  type CharacterFavoriteSlot,
  type CharacterOptions,
} from '@legends/shared'
import { prisma } from '../lib/prisma'

export class CharacterFavoriteError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message)
  }
}

export class InvalidFavoriteSlotError extends CharacterFavoriteError {
  constructor() {
    super('Slot inválido', 400)
  }
}

export function parseCharacterFavoriteSlot(value: number): CharacterFavoriteSlot {
  if (CHARACTER_FAVORITE_SLOTS.includes(value as CharacterFavoriteSlot)) {
    return value as CharacterFavoriteSlot
  }
  throw new InvalidFavoriteSlotError()
}

export async function listCharacterFavorites(userId: string) {
  return prisma.characterFavorite.findMany({
    where: { userId },
    orderBy: { slot: 'asc' },
  })
}

export async function upsertCharacterFavoriteSlot(
  userId: string,
  slot: CharacterFavoriteSlot,
  input: { seed: string; options: CharacterOptions },
) {
  const options = sanitizeCharacterOptions(input.options)
  return prisma.characterFavorite.upsert({
    where: { userId_slot: { userId, slot } },
    create: {
      userId,
      slot,
      seed: input.seed,
      options: options as unknown as Prisma.InputJsonValue,
      signature: characterSignature(options),
    },
    update: {
      seed: input.seed,
      options: options as unknown as Prisma.InputJsonValue,
      signature: characterSignature(options),
    },
  })
}

export async function deleteCharacterFavoriteSlot(userId: string, slot: CharacterFavoriteSlot) {
  await prisma.characterFavorite.deleteMany({ where: { userId, slot } })
}
