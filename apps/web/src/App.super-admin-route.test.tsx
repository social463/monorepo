import { render, screen } from '@testing-library/react'
import { vi, type Mock } from 'vitest'
import type { ReactNode } from 'react'
import { App } from './App'
import { apiFetch } from './lib/api'

const superAdminUser = {
  id: 'sa1',
  name: 'Super Admin',
  role: 'SUPER_ADMIN',
  position: null,
  photoUrl: null,
}

vi.mock('./auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: superAdminUser,
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

describe('App — rota / para SUPER_ADMIN', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/super-admin/companies') return Promise.resolve({ companies: [] })
      return Promise.resolve({ items: [], nextCursor: null, votes: [], periods: [], badges: [], users: [] })
    })
    window.history.pushState({}, '', '/')
  })

  it('redireciona para /super-admin', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Empresas' })).toBeInTheDocument()
  })
})
