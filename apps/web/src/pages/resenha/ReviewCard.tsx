import { useState } from 'react'
import { Link } from 'react-router-dom'
import { REVIEW_REACTIONS, type ReviewDTO, type ReviewReactionEmoji } from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { FeedbackReactions } from '../profile/FeedbackReactions'
import { useAuth } from '../../auth/AuthContext'
import { useDeleteReview, useToggleReviewReaction, useToggleShare } from '../../lib/use-reviews'
import { renderWithMentions } from '../../lib/mentions'
import { ReviewComments } from './ReviewComments'
import { ReviewPollCard } from './ReviewPollCard'

/** Tempo relativo compacto, estilo timeline (agora, 5min, 3h, 2d, depois data). */
function formatRelative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/** Botão da barra de ações com o "anel" que tinge no hover (padrão da timeline). */
function ActionButton({
  icon,
  label,
  count,
  active,
  tint = 'primary',
  disabled,
  onClick,
}: {
  icon: string
  label: string
  count?: number
  active?: boolean
  tint?: 'primary' | 'error'
  disabled?: boolean
  onClick: () => void
}) {
  const tintText = tint === 'error' ? 'group-hover:text-error' : 'group-hover:text-primary'
  const tintBg = tint === 'error' ? 'group-hover:bg-error/10' : 'group-hover:bg-primary/10'
  const activeText = tint === 'error' ? 'text-error' : 'text-primary'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={`group flex items-center gap-xs text-on-surface-variant transition-colors disabled:opacity-50 ${tintText} ${
        active ? activeText : ''
      }`}
    >
      <span className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${tintBg}`}>
        <Icon name={icon} className="text-[18px]" />
      </span>
      {count !== undefined && count > 0 && <span className="font-label text-label-sm">{count}</span>}
    </button>
  )
}

export function ReviewCard({ review }: { review: ReviewDTO }) {
  const { user } = useAuth()
  const [showComments, setShowComments] = useState(false)
  const toggleReaction = useToggleReviewReaction(user ? { id: user.id, name: user.name } : null)
  const toggleShare = useToggleShare()
  const remove = useDeleteReview()

  const canDelete = user?.id === review.author.id || user?.role === 'ADMIN'

  return (
    <li
      id={review.id}
      className="group/post flex gap-md px-lg py-md transition-colors hover:bg-surface-container-high"
    >
      <Link
        to={`/perfil/${review.author.id}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest"
      >
        <Avatar user={review.author} />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-xs">
          <Link
            to={`/perfil/${review.author.id}`}
            className="truncate font-label text-label-md font-bold text-on-surface hover:underline"
          >
            {review.author.name}
          </Link>
          <span className="shrink-0 text-on-surface-variant">·</span>
          <span className="shrink-0 font-label text-label-sm text-on-surface-variant">
            {formatRelative(review.createdAt)}
          </span>
          {canDelete && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Excluir esta resenha? Esta ação não pode ser desfeita.')) remove.mutate(review.id)
              }}
              disabled={remove.isPending}
              aria-label="Excluir resenha"
              className="group ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant opacity-0 transition-opacity hover:bg-error/10 hover:text-error focus:opacity-100 disabled:opacity-50 group-hover/post:opacity-100"
            >
              <Icon name="delete" className="text-[18px]" />
            </button>
          )}
        </div>

        <p className="mt-0.5 whitespace-pre-wrap break-words text-body-md text-on-surface">
          {renderWithMentions(review.content, review.mentions)}
        </p>

        {review.gif && (
          <img
            src={review.gif.url}
            alt="GIF"
            width={review.gif.width || undefined}
            height={review.gif.height || undefined}
            loading="lazy"
            className="mt-sm max-h-80 max-w-full rounded-lg border border-outline-variant/40"
          />
        )}

        {review.image && (
          <img
            src={review.image.url}
            alt="Imagem da resenha"
            loading="lazy"
            className="mt-sm max-h-80 max-w-full rounded-lg border border-outline-variant/40"
          />
        )}

        {review.poll && <ReviewPollCard reviewId={review.id} poll={review.poll} />}

        {review.reactorCount > 0 && (
          <div className="mt-sm flex items-center gap-xs">
            <div className="flex -space-x-2">
              {review.reactors.map((r) => (
                <div
                  key={r.id}
                  className="h-6 w-6 overflow-hidden rounded-full border-2 border-surface-container bg-surface-container-highest"
                >
                  <Avatar user={r} />
                </div>
              ))}
            </div>
            <span className="font-label text-label-sm text-on-surface-variant">
              {review.reactorCount} {review.reactorCount === 1 ? 'reação' : 'reações'}
            </span>
          </div>
        )}

        <div className="mt-sm flex flex-wrap items-center gap-x-xl gap-y-sm">
          <ActionButton
            icon="chat_bubble"
            label="Comentar"
            count={review.commentCount}
            active={showComments}
            onClick={() => setShowComments((v) => !v)}
          />
          <FeedbackReactions
            reactions={review.reactions}
            options={REVIEW_REACTIONS}
            onToggle={(emoji: ReviewReactionEmoji) => {
              if (user) toggleReaction.mutate({ reviewId: review.id, emoji })
            }}
          />
          <ActionButton
            icon={review.sharedByMe ? 'check_circle' : 'share'}
            label={review.sharedByMe ? 'Remover do mural' : 'Compartilhar no mural'}
            count={review.shareCount}
            active={review.sharedByMe}
            disabled={toggleShare.isPending}
            onClick={() => toggleShare.mutate({ reviewId: review.id, shared: !review.sharedByMe })}
          />
        </div>

        {showComments && <ReviewComments reviewId={review.id} />}
      </div>
    </li>
  )
}
