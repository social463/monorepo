import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { ReactNode } from 'react'
import { defaultCharacterFromSeed } from '@legends/shared'
import { App } from './App'
import { saveOfficeGuestSession } from './lib/officeGuestSession'

vi.mock('./auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: null,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}))

vi.mock('./office/session/OfficeSessionContext', () => ({
  OfficeSessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./office/pip/OfficePipWindow', () => ({
  OfficePipWindow: () => null,
}))

vi.mock('./pages/OfficePage', () => ({
  OfficePage: () => <div>Escritório convidado</div>,
}))

function saveValidGuestSession() {
  saveOfficeGuestSession({
    token: 'guest-token',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    guest: {
      id: 'guest:1',
      name: 'Visitante',
      presetId: 'guest-preset-1',
      avatarSeed: 'guest-orion',
      avatarOptions: defaultCharacterFromSeed('guest-orion'),
    },
  })
}

describe('App — convidado', () => {
  beforeEach(() => {
    sessionStorage.clear()
    window.history.pushState({}, '', '/')
  })

  it('bloqueia rotas fora do fluxo de convidado quando o acesso temporário está válido', async () => {
    saveValidGuestSession()
    window.history.pushState({}, '', '/login')

    render(<App />)

    expect(await screen.findByText('Escritório convidado')).toBeInTheDocument()
  })

  it('permite voltar ao escritório pela tela de agradecimento enquanto o convite estiver válido', () => {
    saveValidGuestSession()
    window.history.pushState({}, '', '/convidado/obrigado')

    render(<App />)

    expect(screen.getByRole('heading', { name: 'Obrigado pela visita' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voltar ao escritório' })).toBeInTheDocument()
  })

  it('não mostra ação de retorno quando o acesso temporário expirou', () => {
    sessionStorage.setItem(
      'office:guest-session',
      JSON.stringify({
        token: 'guest-token',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        guest: { id: 'guest:1', name: 'Visitante', presetId: 'guest-preset-1' },
      }),
    )
    window.history.pushState({}, '', '/convidado/obrigado')

    render(<App />)

    expect(screen.getByText('O acesso temporário expirou.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Voltar ao escritório' })).not.toBeInTheDocument()
  })
})
