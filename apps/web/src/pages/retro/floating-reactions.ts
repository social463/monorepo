/** Reação flutuante efêmera (estilo Meet) — vive só no cliente enquanto anima. */
export interface FloatingReaction {
  id: string
  userId: string
  name: string
  emoji: string
  /** Posição horizontal de origem, em % da largura do overlay (sorteada localmente). */
  xPercent: number
}

/** Duração de vida = duração da animação de subida/fade. */
export const FLOAT_REACTION_TTL_MS = 2500
/** Intervalo mínimo entre envios do mesmo cliente (anti-spam). */
export const FLOAT_REACTION_THROTTLE_MS = 400

export function makeFloatingReaction(
  input: { userId: string; name: string; emoji: string },
  deps: { id: string; rand: number },
): FloatingReaction {
  return {
    id: deps.id,
    userId: input.userId,
    name: input.name,
    emoji: input.emoji,
    xPercent: 8 + Math.round(deps.rand * 80),
  }
}
