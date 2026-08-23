import type { CharacterOptions } from "./character";

/**
 * O avatar é o personagem LPC customizável (ver ./character.ts).
 * 'lpc' é o único estilo gravável; valores antigos ('open-peeps') podem
 * existir no banco e são tratados como "sem personagem salvo" (o cliente
 * deriva um padrão da seed — defaultCharacterFromSeed).
 */
export const LPC_AVATAR_STYLE = "lpc" as const;

export const ALL_AVATAR_STYLE_KEYS = [LPC_AVATAR_STYLE] as const;

export type AvatarStyleKey = (typeof ALL_AVATAR_STYLE_KEYS)[number];

/** Body for PATCH /auth/me. `null` clears the field. */
export interface UpdateProfileRequest {
  avatarStyle?: AvatarStyleKey | null;
  avatarSeed?: string | null;
  avatarOptions?: CharacterOptions | null;
}
