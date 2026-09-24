import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { CorporatePostCommentDTO, CorporatePostCommentsResponse } from '@legends/shared'
import { CorporatePostComments } from './CorporatePostComments'
import * as api from '../../lib/api'

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Quem Vê', role: 'LEGEND' } }),
}))
vi.mock('../../lib/use-gifs', () => ({ useGifsEnabled: () => false }))
vi.mock('../../lib/use-image-upload', () => ({ useImageUploadsEnabled: () => false }))
vi.mock('../../lib/use-colleagues', () => ({ useColleagues: () => ({ data: [] }) }))

const author = {
  id: 'u2', name: 'Bia', email: 'b@x.com', role: 'HEAD' as const, area: null, position: null, positionCategory: null,
  squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null,
  avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z',
  leftAt: null, sectorId: 's1', companyId: 'c1', companyName: null,
  enabledFeatures: [], sectorFeatures: [], adminAccess: false,
}

function makeComment(overrides: Partial<CorporatePostCommentDTO> = {}): CorporatePostCommentDTO {
  return {
    id: 'c1',
    author,
    content: 'Boa!',
    mentions: [],
    gif: null,
    image: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    reactions: [],
    ...overrides,
  }
}

function wrap(comments: CorporatePostCommentDTO[]) {
  vi.spyOn(api, 'apiFetch').mockResolvedValue({
    items: comments,
    hasMore: false,
  } as CorporatePostCommentsResponse as never)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CorporatePostComments postId="p1" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CorporatePostComments: gif', () => {
  it('usa aspect-ratio em vez de width/height de atributo — os dois juntos com max-h/max-w distorcem', async () => {
    wrap([makeComment({ gif: { url: 'https://media.giphy.com/x/giphy.gif', width: 480, height: 270 } })])
    const img = await screen.findByAltText('GIF')
    expect(img.style.aspectRatio).toBe('480 / 270')
    expect(img).not.toHaveAttribute('width')
    expect(img).not.toHaveAttribute('height')
  })
})
