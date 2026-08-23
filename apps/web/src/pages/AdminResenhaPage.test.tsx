import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { AdminResenhaPage } from './AdminResenhaPage'

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin1', name: 'Admin', role: 'ADMIN' } }),
}))

const sampleReview = {
  id: 'r1',
  author: { id: 'u2', name: 'Bea', email: '', role: 'LEGEND', area: null, position: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
  content: 'resenha a moderar',
  createdAt: '2026-06-26T12:00:00.000Z',
  reactions: [],
  reactors: [],
  reactorCount: 0,
  commentCount: 0,
  shareCount: 0,
  sharedByMe: false,
}

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: vi.fn(async (path: string) => {
    if (path.startsWith('/reviews?')) return { items: [sampleReview], nextCursor: null }
    return {}
  }),
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminResenhaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AdminResenhaPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista resenhas com botão de excluir para o admin', async () => {
    renderPage()
    expect(await screen.findByText('resenha a moderar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /excluir resenha/i })).toBeInTheDocument()
  })
})
