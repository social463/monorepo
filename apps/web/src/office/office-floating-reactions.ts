import type { AvatarStyleKey, CharacterOptions } from '@legends/shared'

export interface OfficeFloatingReaction {
  id: string
  userId: string
  name: string
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  avatarOptions: CharacterOptions | null
  emoji: string
  xPercent: number
}

export const OFFICE_FLOAT_REACTION_TTL_MS = 2500

/**
 * Mesmo modelo de "reação flutuante" já usado na Retrospectiva
 * (`apps/web/src/pages/retro/floating-reactions.ts`) — HTML puro, decolando
 * de uma posição horizontal aleatória perto do rodapé, sem nenhuma
 * dependência de coordenada de mundo/canvas. Existe porque a versão antiga
 * (bolha desenhada dentro do canvas Phaser, grudada no personagem) ficava
 * escondida atrás de qualquer overlay HTML por cima (ex.: grade de câmeras
 * expandida) — um `<canvas>` é uma única superfície de desenho, sem como um
 * GameObject individual furar acima de um `<div>` irmão.
 */
export function makeOfficeFloatingReaction(
  input: {
    userId: string
    name: string
    photoUrl: string | null
    avatarStyle: AvatarStyleKey | null
    avatarSeed: string | null
    avatarOptions: CharacterOptions | null
    emoji: string
  },
  deps: { id: string; rand: number },
): OfficeFloatingReaction {
  return {
    id: deps.id,
    userId: input.userId,
    name: input.name,
    photoUrl: input.photoUrl,
    avatarStyle: input.avatarStyle,
    avatarSeed: input.avatarSeed,
    avatarOptions: input.avatarOptions,
    emoji: input.emoji,
    xPercent: 8 + Math.round(deps.rand * 80),
  }
}
