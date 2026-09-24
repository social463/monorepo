import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { FeedbackReactionEmoji, MyFeedbackDTO, SharedFeedbackDTO } from '@legends/shared'
import { FEEDBACK_REACTIONS } from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { FeedbackReactions } from '../profile/FeedbackReactions'
import { FeedbackComments } from './FeedbackComments'

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Person({ user }: { user: SharedFeedbackDTO['author'] }) {
  return (
    <span className="flex min-w-0 items-center gap-xs">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
        <Avatar user={user} />
      </span>
      <span className="truncate font-label text-label-sm font-bold uppercase text-on-surface">{user.name}</span>
    </span>
  )
}

/**
 * Destinatários do reconhecimento. Mostra os dois primeiros e resume o resto em
 * "e mais N": com um time de oito, listar todo mundo empurraria a mensagem —
 * que é o conteúdo — para fora da primeira dobra do card.
 */
function Targets({ feedback }: { feedback: SharedFeedbackDTO | MyFeedbackDTO }) {
  const targets = feedback.targets.length > 0 ? feedback.targets : [feedback.target]
  const shown = targets.slice(0, 2)
  const rest = targets.length - shown.length
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-xs">
      {shown.map((person) => (
        <Person key={person.id} user={person} />
      ))}
      {rest > 0 && (
        <span
          className="font-label text-label-sm text-on-surface-variant"
          title={targets.map((t) => t.name).join(', ')}
        >
          e mais {rest}
        </span>
      )}
    </span>
  )
}

/**
 * Card do Mural de Feedbacks: quem reconheceu → quem foi reconhecido,
 * competências, mensagem, reações e respostas. O corpo é um link para o
 * feedback no perfil de quem recebeu; reações e comentários ficam fora dele
 * para não aninhar controles interativos dentro de um `<a>`.
 */
export function SharedFeedbackCard({
  feedback,
  onToggleReaction,
  clamp = false,
  badge,
}: {
  feedback: SharedFeedbackDTO | MyFeedbackDTO
  /** Ausente = card só de leitura (sem barra de reações nem respostas). */
  onToggleReaction?: (emoji: FeedbackReactionEmoji) => void
  /** Corta a mensagem em duas linhas (usado na prévia da home). */
  clamp?: boolean
  /**
   * Marcação sobreposta ao canto do card — o selo "Novo" da Home. Entra por
   * prop, e não por um `<li>` em volta, porque o card JÁ é o `<li>` da lista:
   * aninhar um dentro do outro é HTML inválido.
   */
  badge?: ReactNode
}) {
  const [showComments, setShowComments] = useState(false)
  const chips = [...feedback.categories.map((c) => c.name), ...(feedback.customCategory ? [feedback.customCategory] : [])]

  return (
    <li
      data-testid="shared-feedback-card"
      className="relative rounded-xl border border-outline-variant/30 bg-surface-container-low transition-colors hover:border-outline-variant/60"
    >
      {badge}
      <Link
        to={`/perfil/${feedback.target.id}?feedback=${feedback.id}`}
        className="block rounded-xl p-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="mb-sm flex flex-wrap items-center gap-sm">
          <Person user={feedback.author} />
          <span aria-hidden className="text-on-surface-variant">
            <Icon name="arrow_forward" className="text-[16px]" />
          </span>
          <Targets feedback={feedback} />
          {feedback.sharedAt === null && (
            <span className="ml-auto shrink-0 rounded-lg bg-surface-container-highest px-sm py-0.5 font-label text-label-sm text-on-surface-variant">
              Privado
            </span>
          )}
        </div>

        {chips.length > 0 && (
          <ul className="mb-sm flex flex-wrap gap-xs">
            {chips.map((name) => (
              <li
                key={name}
                className="rounded-full bg-primary/10 px-sm py-0.5 font-label text-label-sm text-primary"
              >
                {name}
              </li>
            ))}
          </ul>
        )}

        <p className={`text-body-sm text-on-surface ${clamp ? 'line-clamp-2' : 'whitespace-pre-wrap'}`}>
          {feedback.message}
        </p>
        {!clamp && (
          <p className="mt-xs font-label text-label-sm text-on-surface-variant">
            {formatDate(feedback.sharedAt ?? feedback.createdAt)}
          </p>
        )}
      </Link>

      {onToggleReaction && (
        <div className="flex flex-col gap-sm px-md pb-md">
          <div className="flex flex-wrap items-center gap-md">
            <FeedbackReactions
              reactions={feedback.reactions}
              options={FEEDBACK_REACTIONS}
              onToggle={onToggleReaction}
            />
            <button
              type="button"
              onClick={() => setShowComments((v) => !v)}
              aria-label="Responder"
              aria-pressed={showComments}
              className={`flex items-center gap-xs font-label text-label-sm transition-colors hover:text-primary ${
                showComments ? 'text-primary' : 'text-on-surface-variant'
              }`}
            >
              <Icon name="chat_bubble" className="text-[18px]" />
              {feedback.commentCount > 0 ? feedback.commentCount : 'Responder'}
            </button>
          </div>
          {showComments && <FeedbackComments feedbackId={feedback.id} />}
        </div>
      )}
    </li>
  )
}
