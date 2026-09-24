import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FEEDBACK_COMMENT_MAX_LENGTH,
  type FeedbackCommentDTO,
  type FeedbackCommentsResponse,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { useAuth } from '../../auth/AuthContext'

/**
 * Respostas a um reconhecimento. A visibilidade é a do próprio feedback — quem
 * não pode ver o feedback recebe 404 aqui —, então não há regra a repetir no
 * cliente: a lista simplesmente não carrega. É por isso que o mesmo componente
 * serve o mural (feedback público) e o perfil (onde o privado também aparece):
 * quem pode responder é o servidor que decide.
 *
 * `onChange` avisa quem está mostrando a lista que o número de respostas mudou
 * — o contador vive no feedback, numa query que este componente não conhece.
 */
function commentsKey(feedbackId: string) {
  return ['feedbacks', feedbackId, 'comments'] as const
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function CommentRow({
  comment,
  feedbackId,
  onChange,
}: {
  comment: FeedbackCommentDTO
  feedbackId: string
  onChange?: () => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/feedbacks/comments/${comment.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentsKey(feedbackId) })
      onChange?.()
    },
  })
  const canDelete = user?.id === comment.author.id || user?.role === 'ADMIN' || user?.role === 'SUBADMIN'

  return (
    <li className="group/comment flex gap-sm">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
        <Avatar user={comment.author} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-xs">
          <span className="font-label text-label-sm font-bold text-on-surface">{comment.author.name}</span>
          <span className="font-label text-label-sm text-on-surface-variant">{formatDate(comment.createdAt)}</span>
          {canDelete && (
            <button
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              aria-label="Excluir comentário"
              className="ml-auto text-on-surface-variant opacity-0 transition-opacity hover:text-error focus:opacity-100 group-hover/comment:opacity-100"
            >
              <Icon name="delete" className="text-[16px]" />
            </button>
          )}
        </p>
        <p className="whitespace-pre-wrap break-words text-body-sm text-on-surface">{comment.message}</p>
      </div>
    </li>
  )
}

export function FeedbackComments({ feedbackId, onChange }: { feedbackId: string; onChange?: () => void }) {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const comments = useQuery({
    queryKey: commentsKey(feedbackId),
    queryFn: () => apiFetch<FeedbackCommentsResponse>(`/feedbacks/${feedbackId}/comments`),
  })
  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ comment: FeedbackCommentDTO }>(`/feedbacks/${feedbackId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ message: message.trim() }),
      }),
    onSuccess: () => {
      setMessage('')
      queryClient.invalidateQueries({ queryKey: commentsKey(feedbackId) })
      queryClient.invalidateQueries({ queryKey: ['shared-feedbacks'] })
      onChange?.()
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!message.trim() || create.isPending) return
    create.mutate()
  }

  return (
    <div className="mt-sm border-t border-outline-variant/30 pt-sm">
      {comments.isLoading ? (
        <p className="text-body-sm text-on-surface-variant">Carregando respostas…</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {(comments.data?.comments ?? []).map((comment) => (
            <CommentRow key={comment.id} comment={comment} feedbackId={feedbackId} onChange={onChange} />
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="mt-sm flex items-center gap-sm">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_COMMENT_MAX_LENGTH))}
          placeholder="Escreva uma resposta…"
          aria-label="Escrever uma resposta"
          className="min-w-0 flex-1 rounded-full border border-outline-variant/60 bg-surface-container-highest px-md py-1 text-body-sm text-on-surface outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={!message.trim() || create.isPending}
          className="rounded-full bg-primary px-md py-1 font-label text-label-sm font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Responder
        </button>
      </form>
    </div>
  )
}
