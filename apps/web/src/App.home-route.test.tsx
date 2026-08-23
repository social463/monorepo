import { render, screen } from '@testing-library/react'
import { vi, type Mock } from 'vitest'
import type { ReactNode } from 'react'
import { App } from './App'
import { apiFetch } from './lib/api'

// O Feed Corporativo não depende de feature do setor para quem é do time (ver
// `canSeeCorporateMural`), mas `sectorFeatures` fica aqui como no app real —
// este teste existe para pegar redirecionamento indevido, não gating.
const legendUser = {
  id: 'u1',
  name: 'Ana Souza',
  role: 'LEGEND',
  position: 'Dev',
  photoUrl: null,
  sectorFeatures: ['mural-corporativo'],
}

vi.mock('./auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: legendUser,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}))

vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

describe('App — rota / para não-admin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/periods/current') return Promise.resolve({ period: null })
      if (path === '/periods/next') return Promise.resolve({ period: null })
      if (path === '/mural') return Promise.resolve({ items: [] })
      if (path === '/users') return Promise.resolve({ users: [] })
      // Fallback para /corporate-posts e demais endpoints do feed
      return Promise.resolve({ items: [], nextCursor: null, canPublish: false, votes: [], periods: [], badges: [], users: [] })
    })
    window.history.pushState({}, '', '/')
  })

  it('renderiza a HomePage (Feed Corporativo) e não redireciona para o perfil', async () => {
    render(<App />)
    expect(
      await screen.findByRole('heading', { name: /feed corporativo/i }),
    ).toBeInTheDocument()
  })
})
