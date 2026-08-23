import type { CharacterOptions } from './character'

export const MAX_CHARACTER_FAVORITES = 5
export const CHARACTER_FAVORITE_SLOTS = [1, 2, 3, 4, 5] as const

export type CharacterFavoriteSlot = (typeof CHARACTER_FAVORITE_SLOTS)[number]

export interface CharacterFavoriteDTO {
  id: string
  slot: CharacterFavoriteSlot
  seed: string
  options: CharacterOptions
  signature: string
  createdAt: string
  updatedAt: string
}
