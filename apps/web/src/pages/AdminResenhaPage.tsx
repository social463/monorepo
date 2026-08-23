import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ReviewDTO } from '@legends/shared'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import {
  useDeleteComment,
  useDeleteReview,
  useReviewComments,
  useReviewFeed,
} from '../lib/use-reviews'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function ModerationComments({ reviewId }: { reviewId: string }) {
  const commentsQuery = useReviewComments(reviewId, true)
  const remove = useDeleteComment(reviewId)
  const comments = commentsQuery.data?.pages.flatMap((p) => p.items) ?? []
  if (comments.length === 0) return <p className="mt-sm text-body-sm text-on-surface-variant">Sem comentários.</p>
  return (
    <ul className="mt-sm flex flex-col gap-xs border-t border-outline-variant/20 pt-sm">
      {comments.map((c) => (
        <li key={c.id} className="flex items-start gap-sm rounded-md bg-surface-container-low p-sm">
          <div className="min-w-0 flex-grow">
            <span className="font-label text-label-sm text-on-surface">{c.author.name}</span>
            <p className="whitespace-pre-wrap text-body-sm text-on-surface">{c.content}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Excluir este comentário?')) remove.mutate(c.id)
            }}
            aria-label="Excluir comentário"
            className="shrink-0 rounded-md border border-error/40 p-0.5 text-error hover:border-error"
          >
            <Icon name="delete" className="text-[14px]" />
          </button>
        </li>
      ))}
    </ul>
  )
}

function ModerationCard({ review }: { review: ReviewDTO }) {
  const [expanded, setExpanded] = useState(false)
  const remove = useDeleteReview()
  return (
    <li className="rounded-xl border border-outline-variant/20 bg-surface-container p-md">
      <div className="mb-sm flex items-center gap-sm">
        <Link to={`/perfil/${review.author.id}`} className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60">
          <Avatar user={review.author} />
        </Link>
        <div className="min-w-0 flex-grow">
          <span className="block truncate font-label text-label-md text-on-surface">{review.author.name}</span>
          <span className="font-label text-label-sm text-on-surface-variant">{formatDate(review.createdAt)}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Excluir esta resenha? Esta ação não pode ser desfeita.')) remove.mutate(review.id)
          }}
          disabled={remove.isPending}
          aria-label="Excluir resenha"
          className="shrink-0 rounded-md border border-error/40 p-1 text-error hover:border-error disabled:opacity-50"
        >
          <Icon name="delete" className="text-[18px]" />
        </button>
      </div>
      <p className="whitespace-pre-wrap text-body-md text-on-surface">{review.content}</p>
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
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-sm flex items-center gap-xs font-label text-label-sm text-primary hover:underline"
      >
        <Icon name="chat_bubble" className="text-[16px]" />
        {review.commentCount} comentário(s)
      </button>
      {expanded && <ModerationComments reviewId={review.id} />}
    </li>
  )
}

export function AdminResenhaPage() {
  const feed = useReviewFeed()
  const reviews = feed.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="mx-auto w-full max-w-3xl px-md py-lg">
      <h1 className="mb-lg font-headline text-headline-lg text-on-surface">Moderação · Resenha</h1>
      {feed.isLoading ? (
        <p className="text-body-sm text-on-surface-variant">Carregando…</p>
      ) : reviews.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Nenhuma resenha.</p>
      ) : (
        <ul className="flex flex-col gap-md">
          {reviews.map((r) => (
            <ModerationCard key={r.id} review={r} />
          ))}
        </ul>
      )}
      {feed.hasNextPage && (
        <button
          type="button"
          onClick={() => feed.fetchNextPage()}
          disabled={feed.isFetchingNextPage}
          className="mt-md w-full rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {feed.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  )
}
