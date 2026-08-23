import { useEffect, useState } from 'react'
import type { ReviewPollDTO } from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { useReviewPollVotes, useVoteReviewPoll } from '../../lib/use-reviews'

export function ReviewPollCard({ reviewId, poll }: { reviewId: string; poll: ReviewPollDTO }) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [showVoters, setShowVoters] = useState(false)
  const vote = useVoteReviewPoll()
  const current = vote.data?.review.poll?.id === poll.id ? vote.data.review.poll : poll
  const voters = useReviewPollVotes(reviewId, current.hasVoted && showVoters)

  useEffect(() => {
    if (current.hasVoted) setSelectedOptionId(null)
  }, [current.hasVoted])

  if (current.hasVoted) {
    return (
      <section className="mt-sm rounded-xl border border-outline-variant/50 bg-surface-container-high p-md" aria-label="Resultado da enquete">
        <h3 className="font-label text-label-lg font-bold text-on-surface">{current.question}</h3>
        <div className="mt-sm flex flex-col gap-sm">
          {current.options.map((option) => {
            const selected = option.id === current.selectedOptionId
            const percentage = option.percentage ?? 0
            return (
              <div key={option.id}>
                <div className="mb-1 flex items-center justify-between gap-sm font-label text-label-sm">
                  <span className={`flex min-w-0 items-center gap-xs ${selected ? 'font-bold text-primary' : 'text-on-surface'}`}>
                    {selected && <Icon name="check_circle" filled className="shrink-0 text-[16px]" />}
                    <span className="truncate">{option.text}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-on-surface-variant">
                    {percentage}% ({option.voteCount ?? 0})
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-container-highest">
                  <div
                    className={`h-full rounded-full transition-all ${selected ? 'bg-primary' : 'bg-outline'}`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-sm flex items-center justify-between gap-sm border-t border-outline-variant/40 pt-sm">
          <button
            type="button"
            onClick={() => setShowVoters((visible) => !visible)}
            aria-expanded={showVoters}
            className="flex items-center gap-xs font-label text-label-sm font-bold text-primary hover:underline"
          >
            <Icon name="group" className="text-[17px]" />
            {showVoters ? 'Ocultar votos' : 'Ver votos'}
          </button>
          <p className="font-label text-label-sm font-bold text-on-surface-variant">
            Total: {current.totalVotes ?? 0} {current.totalVotes === 1 ? 'voto' : 'votos'}
          </p>
        </div>
        {showVoters && (
          <div className="mt-sm rounded-lg border border-outline-variant/40 bg-surface p-sm" aria-label="Votos por opção">
            {voters.isLoading ? (
              <p className="text-body-sm text-on-surface-variant">Carregando votos…</p>
            ) : voters.isError ? (
              <p role="alert" className="text-body-sm text-error">Não foi possível carregar os votos.</p>
            ) : (
              <div className="flex flex-col gap-md">
                {voters.data?.options.map((option) => (
                  <div key={option.optionId}>
                    <p className="font-label text-label-sm font-bold text-on-surface">
                      {option.text} · {option.voters.length}
                    </p>
                    {option.voters.length === 0 ? (
                      <p className="mt-xs text-body-sm text-on-surface-variant">Nenhum voto.</p>
                    ) : (
                      <div className="mt-xs flex flex-wrap gap-sm">
                        {option.voters.map((voter) => (
                          <div key={voter.id} className="flex items-center gap-xs">
                            <div className="h-6 w-6 overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
                              <Avatar user={voter} />
                            </div>
                            <span className="text-body-sm text-on-surface">{voter.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="mt-sm rounded-xl border border-outline-variant/50 bg-surface-container-high p-md" aria-label="Enquete">
      <h3 className="font-label text-label-lg font-bold text-on-surface">{current.question}</h3>
      <div className="mt-sm flex flex-col gap-xs" role="radiogroup" aria-label={current.question}>
        {current.options.map((option) => (
          <label
            key={option.id}
            className={`flex cursor-pointer items-center gap-sm rounded-lg border px-md py-2 text-body-sm transition-colors ${
              selectedOptionId === option.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-outline-variant/60 bg-surface text-on-surface hover:border-primary/60'
            }`}
          >
            <input
              type="radio"
              name={`poll-${current.id}`}
              value={option.id}
              checked={selectedOptionId === option.id}
              onChange={() => setSelectedOptionId(option.id)}
              className="h-4 w-4 accent-primary"
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
      <div className="mt-sm flex items-center justify-between gap-sm">
        {vote.isError ? (
          <p role="alert" className="text-body-sm text-error">
            {vote.error instanceof Error ? vote.error.message : 'Não foi possível registrar seu voto.'}
          </p>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={!selectedOptionId || vote.isPending}
          onClick={() => {
            if (selectedOptionId) vote.mutate({ reviewId, optionId: selectedOptionId })
          }}
          className="rounded-full bg-primary px-lg py-2 font-label text-label-sm font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {vote.isPending ? 'Votando…' : 'Votar'}
        </button>
      </div>
    </section>
  )
}
