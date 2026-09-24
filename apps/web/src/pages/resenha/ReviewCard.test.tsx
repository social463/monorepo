import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReviewDTO } from '@legends/shared'
import { ReviewCard } from './ReviewCard'

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Eu', role: 'LEGEND' } }) }))
vi.mock('../../lib/use-reviews', () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleReviewReaction: () => ({ mutate: vi.fn() }),
  useToggleShare: () => ({ mutate: vi.fn(), isPending: false }),
  useVoteReviewPoll: () => ({ mutate: vi.fn(), isPending: false, isError: false, data: undefined }),
  useReviewPollVotes: () => ({ isLoading: false, isError: false, data: undefined }),
}))

const base: ReviewDTO = {
  id: 'r1', author: { id: 'u2', name: 'Bia', email: '', role: 'LEGEND', area: null, position: null, positionCategory: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', leftAt: null, enabledFeatures: [], sectorId: 'sector-dev-produto', companyId: 'company-emr', companyName: null, sectorFeatures: [], adminAccess: false },
  content: 'olha', createdAt: '2026-06-29T00:00:00.000Z', reactions: [], reactors: [], reactorCount: 0,
  commentCount: 0, shareCount: 0, sharedByMe: false, mentions: [],
  gif: { url: 'https://media.giphy.com/a.gif', width: 100, height: 80 },
  image: null,
  poll: null,
}

describe('ReviewCard + GIF', () => {
  it('renderiza o <img> do GIF quando presente', () => {
    render(<MemoryRouter><ul><ReviewCard review={base} /></ul></MemoryRouter>)
    const img = screen.getByRole('img', { name: 'GIF' }) as HTMLImageElement
    expect(img.src).toContain('media.giphy.com/a.gif')
  })
})
