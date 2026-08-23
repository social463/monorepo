import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ResenhaFeed } from './ResenhaFeed'
import * as api from '../../lib/api'

vi.mock('../../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: {
      id: 'u1',
      name: 'Test User',
      role: 'LEGEND',
      position: null,
      squad: null,
      photoUrl: null,
      avatarStyle: null,
      avatarSeed: null,
      avatarOptions: null,
      active: true,
      joinedAt: '2026-01-01T00:00:00.000Z',
    },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}))

vi.mock('./ReviewComposer', () => ({
  ReviewComposer: ({ pending }: { pending: boolean }) => (
    <textarea placeholder="Escreva uma resenha..." disabled={pending} />
  ),
}))

vi.mock('./ReviewCard', () => ({
  ReviewCard: ({ review }: { review: { id: string; content: string } }) => (
    <li key={review.id}>{review.content}</li>
  ),
}))

// WebSocket de tempo real: fake instalado por teste para inspecionar a conexão.
class FakeWS {
  static instances: FakeWS[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(public url: string) {
    FakeWS.instances.push(this)
  }
  close() {}
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const author = {
  id: 'u2', name: 'Bia', email: 'b@x.com', role: 'LEGEND', position: null,
  squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null,
  avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z',
}

describe('ResenhaFeed', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('renderiza o composer e a lista de resenhas', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      items: [
        {
          id: 'r1', author, content: 'Primeira resenha do time!',
          createdAt: '2026-06-20T00:00:00.000Z', reactions: [], reactors: [],
          reactorCount: 0, commentCount: 0, shareCount: 0, sharedByMe: false,
          mentions: [],
        },
      ],
      nextCursor: null,
    })

    wrap(<ResenhaFeed />)

    expect(await screen.findByText('Primeira resenha do time!')).toBeInTheDocument()
    // O composer expõe um textarea para escrever a resenha.
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument())
  })

  it('abre a conexão de tempo real ao montar (feed ao vivo onde quer que apareça)', async () => {
    FakeWS.instances = []
    ;(globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS
    vi.spyOn(api, 'getAccessToken').mockReturnValue('tok')
    vi.spyOn(api, 'refreshAccessToken').mockResolvedValue(true)
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ items: [], nextCursor: null })

    wrap(<ResenhaFeed />)

    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    expect(FakeWS.instances[0].url).toContain('/api/reviews/ws?token=tok')
  })
})
