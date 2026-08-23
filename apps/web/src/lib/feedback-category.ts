import type { FeedbackCategory } from '@legends/shared'

/**
 * Estilo do badge por categoria de feedback. `locked` marca as categorias restritas
 * (só autor, alvo e ADMIN veem) — elas nunca chegam ao mural, mas aparecem no perfil.
 */
export const FEEDBACK_CATEGORY_BADGE: Record<FeedbackCategory, { cls: string; locked: boolean }> = {
  POSITIVO: { cls: 'bg-emerald-500/15 text-emerald-600', locked: false },
  ELOGIO: { cls: 'bg-amber-500/15 text-amber-600', locked: false },
  ORIENTACAO: { cls: 'bg-sky-500/15 text-sky-600', locked: true },
  MELHORIA: { cls: 'bg-violet-500/15 text-violet-600', locked: true },
}
