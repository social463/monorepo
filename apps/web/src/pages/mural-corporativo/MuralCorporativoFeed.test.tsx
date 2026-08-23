import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MuralCorporativoFeed } from './MuralCorporativoFeed'
import * as api from '../../lib/api'

const mockUseAuth = vi.fn()
vi.mock('../../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

function user(role: string) {
  return {
    user: {
      id: 'u1',
      name: 'Test User',
      role,
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
  }
}

vi.mock('./CorporatePostComposer', () => ({
  CorporatePostComposer: ({ pending, canPublishDirectly }: { pending: boolean; canPublishDirectly: boolean }) => (
    <textarea placeholder={canPublishDirectly ? 'Publicar' : 'Enviar para aprovação'} disabled={pending} />
  ),
}))

vi.mock('./CorporatePostCard', () => ({
  CorporatePostCard: ({ post }: { post: { id: string; content: string } }) => <li>{post.content}</li>,
}))

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const author = {
  id: 'u2', name: 'Bia', email: 'b@x.com', role: 'HEAD', position: null,
  squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null,
  avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z',
}

const feedPage = (canPublishDirectly: boolean) => ({
  items: [
    {
      id: 'p1',
      author,
      content: 'Comunicado da empresa toda',
      createdAt: '2026-07-20T00:00:00.000Z',
      pinnedAt: null,
      gif: null,
      image: null,
      reactions: [],
      reactors: [],
      reactorCount: 0,
      commentCount: 0,
      mentions: [],
    },
  ],
  nextCursor: null,
  canPublish: true,
  canPublishDirectly,
})

describe('MuralCorporativoFeed', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUseAuth.mockReturnValue(user('LEGEND'))
  })

  it('lista as publicações do mural', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue(feedPage(false))
    wrap(<MuralCorporativoFeed />)
    expect(await screen.findByText('Comunicado da empresa toda')).toBeInTheDocument()
  })

  // A 2ª rodada da G&G abriu a escrita para todo mundo: o composer aparece
  // sempre, e o que muda por papel é o destino do comunicado.
  it('mostra o composer para a lenda, avisando que vai para aprovação', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue(feedPage(false))
    wrap(<MuralCorporativoFeed />)
    await screen.findByText('Comunicado da empresa toda')
    expect(screen.getByPlaceholderText('Enviar para aprovação')).toBeInTheDocument()
  })

  it('quem publica direto não vê o aviso de aprovação', async () => {
    mockUseAuth.mockReturnValue(user('ADMIN'))
    vi.spyOn(api, 'apiFetch').mockResolvedValue(feedPage(true))
    wrap(<MuralCorporativoFeed />)
    await waitFor(() => expect(screen.getByPlaceholderText('Publicar')).toBeInTheDocument())
  })

})
