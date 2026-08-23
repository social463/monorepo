import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { REVIEW_MAX_LENGTH } from '@legends/shared'
import { ResenhaPage } from './ResenhaPage'

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Ana', role: 'LEGEND' } }),
}))

const sampleReview = {
  id: 'r1',
  author: { id: 'u2', name: 'Bea', email: '', role: 'LEGEND', area: null, position: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
  content: 'minha resenha',
  createdAt: '2026-06-26T12:00:00.000Z',
  reactions: [],
  reactors: [],
  reactorCount: 0,
  commentCount: 0,
  shareCount: 0,
  sharedByMe: false,
  mentions: [],
}

vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: vi.fn(async (path: string) => {
    if (path === '/users') return { users: [] }
    if (path.startsWith('/reviews?')) return { items: [sampleReview], nextCursor: null }
    return {}
  }),
  getAccessToken: () => 'tok',
  refreshAccessToken: vi.fn().mockResolvedValue(true),
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ResenhaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ResenhaPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('mostra o contador de caracteres e desabilita publicar quando vazio', () => {
    renderPage()
    const button = screen.getByRole('button', { name: /publicar/i })
    expect(button).toBeDisabled()
    expect(screen.getByText(new RegExp(`0/${REVIEW_MAX_LENGTH}`))).toBeInTheDocument()
  })

  it('renderiza a resenha carregada do feed', async () => {
    renderPage()
    expect(await screen.findByText('minha resenha')).toBeInTheDocument()
    expect(screen.getByText('Bea')).toBeInTheDocument()
  })

  it('habilita publicar ao digitar', async () => {
    renderPage()
    const textarea = screen.getByLabelText(/sua resenha/i)
    fireEvent.change(textarea, { target: { value: 'algo' } })
    expect(screen.getByRole('button', { name: /publicar/i })).toBeEnabled()
  })

  it('renderiza menção como link para o perfil', async () => {
    // sobrescreve o mock para devolver uma resenha com menção
    const { apiFetch } = await import('../../lib/api')
    ;(apiFetch as unknown as { mockImplementation: (fn: (p: string) => unknown) => void }).mockImplementation(
      (path: string) => {
        if (path === '/users') return Promise.resolve({ users: [] })
        if (path.startsWith('/reviews?'))
          return Promise.resolve({
            items: [{ ...sampleReview, content: 'boa @Bea', mentions: [{ userId: 'u2', name: 'Bea' }] }],
            nextCursor: null,
          })
        return Promise.resolve({})
      },
    )
    renderPage()
    const link = (await screen.findByText('@Bea')).closest('a')
    expect(link).toHaveAttribute('href', '/perfil/u2')
  })
})
