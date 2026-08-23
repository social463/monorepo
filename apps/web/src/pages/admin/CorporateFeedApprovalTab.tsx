import { useState } from 'react'
import { CORPORATE_POST_AUDIENCE_LABELS, type PendingCorporatePostDTO } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { RichTextView } from '../../components/rich-text/RichTextView'
import { useCorporatePendingPosts, useReviewCorporatePost } from '../../lib/use-corporate-mural'

/**
 * Fila de aprovação do Feed Corporativo: o que o colaborador escreveu e ainda
 * não foi ao ar. Aprovar publica na hora (e avisa o autor e o público-alvo);
 * recusar guarda o motivo, que o autor lê em "Meus envios".
 */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function PendingCard({ post }: { post: PendingCorporatePostDTO }) {
  const review = useReviewCorporatePost()
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)

  return (
    <li className="flex flex-col gap-sm rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <div className="flex flex-wrap items-center gap-xs">
        <span className="font-label text-label-md font-bold text-on-surface">{post.author.name}</span>
        {post.authorSectorName && (
          <span className="font-label text-label-sm text-on-surface-variant">· {post.authorSectorName}</span>
        )}
        <span className="font-label text-label-sm text-on-surface-variant">· {formatDate(post.createdAt)}</span>
        <span className="rounded-full bg-surface-container-highest px-sm font-label text-label-sm text-on-surface-variant">
          {post.audience === 'ALL'
            ? CORPORATE_POST_AUDIENCE_LABELS.ALL
            : post.audienceSectors.map((s) => s.name).join(', ')}
        </span>
      </div>

      {post.title && <p className="font-headline text-title-sm font-bold text-on-surface">{post.title}</p>}
      {post.body ? (
        <RichTextView doc={post.body} className="flex flex-col gap-1" />
      ) : (
        <p className="whitespace-pre-wrap text-body-sm text-on-surface">{post.content}</p>
      )}

      {post.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-xs">
          {post.attachments.map((att) => (
            <li key={att.id}>
              <a
                href={att.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-xs rounded-full border border-outline-variant/60 px-sm py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
              >
                <Icon name="attach_file" className="text-[16px]" />
                {att.name}
              </a>
            </li>
          ))}
        </ul>
      )}

      {review.isError && (
        <span role="alert" className="text-label-sm text-error">
          {(review.error as Error).message}
        </span>
      )}

      {rejecting ? (
        <div className="flex flex-col gap-xs">
          <label htmlFor={`reason-${post.id}`} className="font-label text-label-sm text-on-surface-variant">
            Motivo da recusa (opcional — o autor recebe no sininho)
          </label>
          <input
            id={`reason-${post.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 280))}
            className="rounded-md border border-outline-variant/60 bg-transparent px-sm py-1 text-body-sm text-on-surface outline-none focus:border-primary"
          />
          <div className="flex gap-sm">
            <button
              type="button"
              disabled={review.isPending}
              onClick={() => review.mutate({ postId: post.id, approve: false, reason: reason.trim() || undefined })}
              className="rounded-md border border-error/40 px-3 py-1 font-label text-label-sm text-error transition-colors hover:border-error disabled:opacity-50"
            >
              Confirmar recusa
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="font-label text-label-sm text-on-surface-variant hover:text-on-surface"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-sm">
          <button
            type="button"
            disabled={review.isPending}
            onClick={() => review.mutate({ postId: post.id, approve: true })}
            className="rounded-md bg-primary px-3 py-1 font-label text-label-sm font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            Aprovar e publicar
          </button>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-error hover:text-error"
          >
            Recusar
          </button>
        </div>
      )}
    </li>
  )
}

export function CorporateFeedApprovalTab() {
  const pending = useCorporatePendingPosts()

  if (pending.isLoading) return <p className="text-body-sm text-on-surface-variant">Carregando…</p>
  if (pending.isError) {
    return (
      <p role="alert" className="text-body-sm text-error">
        Erro ao carregar a fila de aprovação.
      </p>
    )
  }
  const items = pending.data?.items ?? []
  if (items.length === 0) {
    return <p className="text-body-sm text-on-surface-variant">Nenhum comunicado aguardando aprovação.</p>
  }

  return (
    <ul className="flex flex-col gap-sm">
      {items.map((post) => (
        <PendingCard key={post.id} post={post} />
      ))}
    </ul>
  )
}
