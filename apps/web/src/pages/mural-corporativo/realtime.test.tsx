import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MuralCorporativoFeed } from './MuralCorporativoFeed'
import { CorporatePostToasts } from '../../components/CorporatePostToasts'
import * as api from '../../lib/api'

/**
 * O caminho inteiro do tempo real, do jeito que o app monta: o socket vive no
 * `AppLayout` (via toasts) e o feed é outro componente. O que este teste trava é
 * a ligação entre os dois — evento chega numa ponta, comunicado novo aparece na
 * outra, sem refresh.
 */

const mockUseAuth = vi.fn()
vi.mock('../../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

vi.mock('./CorporatePostComposer', () => ({ CorporatePostComposer: () => <div /> }))
vi.mock('./CorporatePostCard', () => ({
  CorporatePostCard: ({ post }: { post: { content: string } }) => <li>{post.content}</li>,
}))

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

function page(contents: string[]) {
  return {
    items: contents.map((content, i) => ({
      id: `p${i}`,
      content,
      author: { id: 'u2', name: 'Bia', role: 'HEAD' },
      createdAt: '2026-08-17T00:00:00.000Z',
      pinnedAt: null,
      gif: null,
      image: null,
      reactions: [],
      reactors: [],
      reactorCount: 0,
      commentCount: 0,
      mentions: [],
    })),
    nextCursor: null,
    canPublish: true,
    canPublishDirectly: true,
  }
}

describe('Feed Corporativo em tempo real', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    FakeWS.instances = []
    ;(globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS
    mockUseAuth.mockReturnValue({ user: { id: 'u1', name: 'Eu', role: 'LEGEND' }, loading: false })
    vi.spyOn(api, 'getAccessToken').mockReturnValue('tok')
    vi.spyOn(api, 'refreshAccessToken').mockResolvedValue(true)
  })

  it('comunicado publicado por um colega entra no feed sem refresh', async () => {
    let contents = ['Comunicado antigo']
    vi.spyOn(api, 'apiFetch').mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/corporate-posts?') ? page(contents) : undefined),
    )

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CorporatePostToasts />
          <MuralCorporativoFeed />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Comunicado antigo')).toBeInTheDocument()
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))

    // Alguém publicou: o servidor avisa, e o feed tem de se virar sozinho.
    contents = ['Mutirão de doação', 'Comunicado antigo']
    FakeWS.instances[0].onmessage?.({ data: JSON.stringify({ type: 'feed:changed' }) })

    expect(await screen.findByText('Mutirão de doação')).toBeInTheDocument()
  })
})
