import { FEEDBACK_REACTIONS, type FeedbackReactionEmoji, type ReactionSummary } from '@legends/shared'

/**
 * Recalcula o array de reações de um feedback ao aplicar/remover a reação do usuário
 * atual — usado pelas atualizações otimistas do perfil e do Mural de Feedbacks.
 */
export function applyToggle(
  reactions: ReactionSummary[],
  emoji: FeedbackReactionEmoji,
  me: { id: string; name: string },
): ReactionSummary[] {
  const existing = reactions.find((r) => r.emoji === emoji)
  if (existing?.reactedByMe) {
    return reactions
      .map((r) =>
        r.emoji === emoji
          ? { ...r, count: r.count - 1, reactedByMe: false, users: r.users.filter((u) => u.id !== me.id) }
          : r,
      )
      .filter((r) => r.count > 0)
  }
  if (existing) {
    return reactions.map((r) =>
      r.emoji === emoji
        ? { ...r, count: r.count + 1, reactedByMe: true, users: [...r.users, { id: me.id, name: me.name }] }
        : r,
    )
  }
  const added: ReactionSummary = { emoji, count: 1, reactedByMe: true, users: [{ id: me.id, name: me.name }] }
  return [...reactions, added].sort(
    (a, b) =>
      FEEDBACK_REACTIONS.indexOf(a.emoji as FeedbackReactionEmoji) -
      FEEDBACK_REACTIONS.indexOf(b.emoji as FeedbackReactionEmoji),
  )
}
