import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReviewPollDTO } from '@legends/shared'
import { ReviewPollCard } from './ReviewPollCard'

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('../../lib/use-reviews', () => ({
  useVoteReviewPoll: () => ({ mutate, isPending: false, isError: false, data: undefined }),
  useReviewPollVotes: () => ({
    isLoading: false,
    isError: false,
    data: {
      pollId: 'p1',
      question: 'Qual opção?',
      totalVotes: 2,
      options: [
        {
          optionId: 'o1',
          text: 'Primeira',
          voters: [
            { id: 'u1', name: 'Ana', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null },
          ],
        },
        {
          optionId: 'o2',
          text: 'Segunda',
          voters: [
            { id: 'u2', name: 'Bruno', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null },
          ],
        },
      ],
    },
  }),
}))

const openPoll: ReviewPollDTO = {
  id: 'p1',
  question: 'Qual opção?',
  hasVoted: false,
  selectedOptionId: null,
  totalVotes: null,
  options: [
    { id: 'o1', text: 'Primeira', voteCount: null, percentage: null },
    { id: 'o2', text: 'Segunda', voteCount: null, percentage: null },
  ],
}

describe('ReviewPollCard', () => {
  it('não mostra resultados antes do voto e envia a opção escolhida', () => {
    render(<ReviewPollCard reviewId="r1" poll={openPoll} />)

    expect(screen.queryByText(/Total:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver votos' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Primeira' }))
    fireEvent.click(screen.getByRole('button', { name: 'Votar' }))
    expect(mutate).toHaveBeenCalledWith({ reviewId: 'r1', optionId: 'o1' })
  })

  it('mostra percentuais, contagens e a escolha depois do voto', () => {
    render(
      <ReviewPollCard
        reviewId="r1"
        poll={{
          ...openPoll,
          hasVoted: true,
          selectedOptionId: 'o1',
          totalVotes: 4,
          options: [
            { id: 'o1', text: 'Primeira', voteCount: 3, percentage: 75 },
            { id: 'o2', text: 'Segunda', voteCount: 1, percentage: 25 },
          ],
        }}
      />,
    )

    expect(screen.getByText('75% (3)')).toBeInTheDocument()
    expect(screen.getByText('25% (1)')).toBeInTheDocument()
    expect(screen.getByText('Total: 4 votos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Votar' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ver votos' }))
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Bruno')).toBeInTheDocument()
    expect(screen.getByText('Primeira · 1')).toBeInTheDocument()
    expect(screen.getByText('Segunda · 1')).toBeInTheDocument()
  })
})
