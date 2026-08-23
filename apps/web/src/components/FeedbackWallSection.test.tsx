import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { FeedbackWallSection } from './FeedbackWallSection'
import * as api from '../lib/api'

const mockUseAuth = vi.fn()
vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

function person(id: string, name: string) {
  return {
    id,
    name,
    email: null,
    role: 'LEGEND',
    area: null,
    position: null,
    squad: null,
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    active: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    leftAt: null,
    sectorId: 's1',
    companyId: 'company-emr',
    companyName: null,
    enabledFeatures: [],
    sectorFeatures: [],
  }
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('FeedbackWallSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUseAuth.mockReturnValue({ user: person('u1', 'Ana') })
  })

  it('mostra os feedbacks compartilhados com autor, destinatário e link "Ver todas"', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      feedbacks: [
        {
          id: 'f1',
          author: person('u2', 'Maria Yasmin'),
          target: person('u3', 'Mariana Rabelo'),
          targets: [person('u3', 'Mariana Rabelo')],
          message: 'Mari, sua disposição em compartilhar suas ideias é essencial para o time.',
          category: 'POSITIVO',
          categories: [],
          customCategory: null,
          createdAt: '2026-07-01T00:00:00.000Z',
          sharedAt: '2026-07-02T00:00:00.000Z',
          reactions: [],
          commentCount: 0,
        },
      ],
      hasMore: true,
    })

    wrap(<FeedbackWallSection />)

    expect(await screen.findByText(/Mari, sua disposição/i)).toBeInTheDocument()
    expect(screen.getByText('Maria Yasmin')).toBeInTheDocument()
    expect(screen.getByText('Mariana Rabelo')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /mural de feedbacks/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver todas/i })).toHaveAttribute('href', '/mural-feedbacks')
  })

  it('o card leva ao feedback no perfil de quem recebeu', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      feedbacks: [
        {
          id: 'f1',
          author: person('u2', 'Maria'),
          target: person('u3', 'Mariana'),
          targets: [person('u3', 'Mariana')],
          message: 'Obrigada pelo apoio de sempre nesta entrega.',
          category: 'ELOGIO',
          categories: [],
          customCategory: null,
          createdAt: '2026-07-01T00:00:00.000Z',
          sharedAt: '2026-07-02T00:00:00.000Z',
          reactions: [],
          commentCount: 0,
        },
      ],
      hasMore: false,
    })

    wrap(<FeedbackWallSection />)

    const message = await screen.findByText(/Obrigada pelo apoio/i)
    expect(message.closest('a')).toHaveAttribute('href', '/perfil/u3?feedback=f1')
  })

  it('mostra o estado vazio quando ninguém compartilhou ainda', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ feedbacks: [], hasMore: false })
    wrap(<FeedbackWallSection />)
    expect(await screen.findByTestId('feedback-wall-empty')).toBeInTheDocument()
  })

  it('pede só a prévia à API, não a lista inteira', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ feedbacks: [], hasMore: false })
    wrap(<FeedbackWallSection />)
    await screen.findByTestId('feedback-wall-empty')
    expect(spy).toHaveBeenCalledWith('/feedbacks/mural?offset=0&limit=2')
  })
})
