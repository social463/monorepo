import type { CharacterFavoriteDTO, CharacterFavoriteSlot, CharacterOptions } from '@legends/shared'
import { apiFetch } from './api'

export function listCharacterFavorites() {
  return apiFetch<{ favorites: CharacterFavoriteDTO[] }>('/character-favorites')
}

export function saveCharacterFavoriteSlot(
  slot: CharacterFavoriteSlot,
  body: { seed?: string; options: CharacterOptions },
) {
  return apiFetch<{ favorite: CharacterFavoriteDTO }>(`/character-favorites/${slot}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function deleteCharacterFavoriteSlot(slot: CharacterFavoriteSlot) {
  return apiFetch<void>(`/character-favorites/${slot}`, { method: 'DELETE' })
}
