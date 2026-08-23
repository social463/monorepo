import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { ReactNode } from 'react'
import { App } from './App'

vi.mock('./auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: {
      id: 'u1',
      name: 'Terceirizado',
      email: 't@x.com',
      role: 'THIRD_PARTY',
      area: null,
      position: null,
      squad: null,
      photoUrl: null,
      avatarStyle: null,
      avatarSeed: null,
      avatarOptions: null,
      active: true,
      joinedAt: new Date().toISOString(),
      leftAt: null,
      enabledFeatures: ['escritorio'],
    },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}))

// `useOfficeSession` entra aqui porque a AppLayout chama `exitOffice()` no
// logout — sem o export, o mock derruba o render inteiro da AppLayout.
vi.mock('./office/session/OfficeSessionContext', () => ({
  OfficeSessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useOfficeSession: () => ({ exitOffice: vi.fn() }),
}))

vi.mock('./office/pip/OfficePipWindow', () => ({
  OfficePipWindow: () => null,
}))

vi.mock('./pages/VotePage', () => ({
  VotePage: () => <div>Página de votação</div>,
}))

describe('FeatureGate', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/')
  })

  it('redireciona terceirizado sem a feature "votar" para a Home', async () => {
    window.history.pushState({}, '', '/votar')

    render(<App />)

    await waitFor(() => expect(screen.queryByText('Página de votação')).not.toBeInTheDocument())
    expect(window.location.pathname).toBe('/')
  })
})
