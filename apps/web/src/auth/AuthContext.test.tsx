import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import { ProtectedRoute } from './ProtectedRoute'
import { apiFetch, setAccessToken } from '../lib/api'

vi.mock('../lib/analytics', () => ({ identifyAnalytics: vi.fn() }))

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
  } as Response
}

const USUARIO = { id: 'u1', name: 'Ana', role: 'MANAGER', adminAccess: true }

function Painel() {
  const { user } = useAuth()
  return <p>Painel de {user?.name}</p>
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>Tela de login</p>} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <Painel />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

/** Sessão viva: o bootstrap restaura pelo cookie e `/auth/me` devolve a pessoa. */
function sessaoViva() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/auth/refresh'
          ? jsonResponse({ accessToken: 'valido' })
          : jsonResponse({ user: USUARIO }),
      ),
    ),
  )
}

describe('AuthProvider — sessão expirada', () => {
  beforeEach(() => setAccessToken(null))
  afterEach(() => vi.unstubAllGlobals())

  /**
   * O bug do print: a sessão morria em pleno uso, o token sumia da memória e
   * mais nada acontecia. A tela continuava de pé com os dados já carregados, e
   * cada ação devolvia "Não autorizado" inline — sem caminho de volta.
   */
  it('leva ao login quando o refresh é recusado em pleno uso', async () => {
    sessaoViva()
    renderApp()
    expect(await screen.findByText('Painel de Ana')).toBeInTheDocument()

    // Cookie derrubado (papel trocado, reuso detectado, expiração): tudo 401.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({}, { ok: false, status: 401 }))))
    await act(async () => {
      await apiFetch('/admin/users', { method: 'POST', body: '{}' }).catch(() => {})
    })

    await waitFor(() => expect(screen.getByText('Tela de login')).toBeInTheDocument())
  })

  it('blip de rede no refresh NÃO derruba a tela', async () => {
    sessaoViva()
    renderApp()
    expect(await screen.findByText('Painel de Ana')).toBeInTheDocument()

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === '/api/auth/refresh'
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(jsonResponse({}, { ok: false, status: 401 })),
      ),
    )
    await act(async () => {
      await apiFetch('/profile').catch(() => {})
    })

    expect(screen.getByText('Painel de Ana')).toBeInTheDocument()
  })
})
