import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ThirdPartyInvitePage } from './ThirdPartyInvitePage'
import { AuthProvider } from '../auth/AuthContext'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/third-party-invites/') && url.endsWith('/accept')) {
        return new Response(
          JSON.stringify({ accessToken: 'tok', user: { id: 'u1', name: 'Fulano', role: 'THIRD_PARTY', enabledFeatures: ['escritorio'] } }),
          { status: 201 },
        )
      }
      if (url.includes('/third-party-invites/')) {
        return new Response(
          JSON.stringify({ createdByName: 'Admin', expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 404 })
    }),
  )
})

function renderPage() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/terceirizado/convite/abc123']}>
        <Routes>
          <Route path="/terceirizado/convite/:token" element={<ThirdPartyInvitePage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('ThirdPartyInvitePage', () => {
  it('carrega o convite e envia nome/e-mail/senha para criar a conta', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Admin/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Fulano' } })
    fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: 'fulano@x.com' } })
    fireEvent.change(screen.getByLabelText(/senha/i), { target: { value: 'senha1234' } })
    fireEvent.click(screen.getByRole('button', { name: /criar conta/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/accept'), expect.anything()))
  })
})
