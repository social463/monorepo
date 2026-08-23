import {
  characterHash,
  characterSignature,
  defaultCharacterFromSeed,
  migrateCharacterOptions,
  type CharacterOptions,
  type OfficeOccupant,
} from '@legends/shared'

type OccupantAvatar = Pick<OfficeOccupant, 'userId' | 'avatarStyle' | 'avatarSeed' | 'avatarOptions'>

/**
 * Personagem de um occupant: options lpc válidas quando existem; senão,
 * determinístico por seed → userId (diferente do componente Avatar, que cai
 * para foto/iniciais — no mapa ninguém fica sem boneco).
 */
export function occupantCharacterOptions(occupant: OccupantAvatar): CharacterOptions {
  const migrated = migrateCharacterOptions(occupant.avatarOptions)
  if (migrated) return migrated
  return defaultCharacterFromSeed(occupant.avatarSeed ?? occupant.userId)
}

/** Key de textura estável por personagem — trocar o avatar troca a key. */
export function occupantTextureKey(occupant: OccupantAvatar): string {
  const signature = characterSignature(occupantCharacterOptions(occupant))
  return `char-${occupant.userId}-${characterHash(signature)}`
}
