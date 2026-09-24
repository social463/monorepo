import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FEEDBACK_WALL_PREVIEW_SIZE } from '@legends/shared'
import { Icon } from './Icon'
import { NewBadge } from './NewBadge'
import { FeedbackListSkeleton } from './Skeleton'
import { SharedFeedbackCard } from '../pages/mural-feedbacks/SharedFeedbackCard'
import {
  fetchSharedFeedbacks,
  sharedFeedbacksPreviewKey,
  useToggleSharedReaction,
} from '../pages/mural-feedbacks/shared-feedbacks'

/**
 * Prévia do Mural de Feedbacks na home: os feedbacks mais recentes que a empresa
 * inteira compartilhou. A lista completa (e o formulário) vive em /mural-feedbacks.
 */
export function FeedbackWallSection() {
  const { data, isLoading, isError } = useQuery({
    queryKey: sharedFeedbacksPreviewKey,
    queryFn: () => fetchSharedFeedbacks(0, FEEDBACK_WALL_PREVIEW_SIZE),
  })
  const toggleReaction = useToggleSharedReaction()
  const feedbacks = data?.feedbacks ?? []
  // "Novo" é por ABA: é novo o que foi compartilhado depois da última vez que a
  // pessoa abriu `/mural-feedbacks`. Sem nunca ter aberto (`null`), tudo é novo.
  const wallSeenAt = data?.wallSeenAt ?? null

  return (
    <section
      aria-labelledby="mural-feedbacks-heading"
      className="flex min-w-0 flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg"
    >
      <div className="flex items-center justify-between gap-md">
        <h2
          id="mural-feedbacks-heading"
          className="flex items-center gap-sm font-headline text-headline-md text-on-surface"
        >
          <span className="text-primary">
            <Icon name="favorite" className="text-[22px]" />
          </span>
          Mural de Feedbacks
        </h2>
        <Link
          to="/mural-feedbacks"
          className="group flex shrink-0 items-center gap-1 font-label text-label-md text-primary"
        >
          <span className="group-hover:underline">Ver todas</span>
          <Icon
            name="arrow_forward"
            className="text-[16px] transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      </div>

      {isLoading ? (
        <FeedbackListSkeleton count={FEEDBACK_WALL_PREVIEW_SIZE} />
      ) : isError ? (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          Erro ao carregar o mural de feedbacks.
        </p>
      ) : feedbacks.length === 0 ? (
        <p
          data-testid="feedback-wall-empty"
          className="rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-low px-lg py-lg text-body-sm text-on-surface-variant"
        >
          Ainda não há feedbacks compartilhados. Quando alguém compartilhar um feedback que recebeu,
          ele aparece aqui para toda a empresa.
        </p>
      ) : (
        <ul className="flex flex-col gap-md">
          {feedbacks.map((feedback) => (
            <SharedFeedbackCard
              key={feedback.id}
              feedback={feedback}
              clamp
              // Comparação de ISO 8601 como string: os dois vêm do servidor no
              // mesmo formato UTC, então a ordem lexicográfica é a cronológica.
              badge={wallSeenAt === null || feedback.sharedAt > wallSeenAt ? <NewBadge /> : undefined}
              onToggleReaction={(emoji) => toggleReaction.mutate({ feedbackId: feedback.id, emoji })}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
