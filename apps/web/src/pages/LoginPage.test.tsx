import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { LoginPage } from './LoginPage'
import { ApiError } from '../lib/api'

const loginMock = vi.fn()

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ login: loginMock, user: null, loading: false, logout: vi.fn() }),
}))

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('submits the typed credentials', async () => {
    loginMock.mockResolvedValue(undefined)
    renderLogin()
    fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: 'ana@empresa.com' } })
    fireEvent.change(screen.getByLabelText(/^senha$/i, { selector: 'input' }), { target: { value: 'changeme123' } })
    fireEvent.click(screen.getByRole('button', { name: /entrar/i }))
    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith('ana@empresa.com', 'changeme123', false),
    )
  })

  it('toggles password visibility', () => {
    renderLogin()
    const passwordInput = screen.getByLabelText(/^senha$/i, { selector: 'input' })
    expect(passwordInput).toHaveAttribute('type', 'password')

    fireEvent.click(screen.getByRole('button', { name: /mostrar senha/i }))
    expect(passwordInput).toHaveAttribute('type', 'text')

    fireEvent.click(screen.getByRole('button', { name: /ocultar senha/i }))
    expect(passwordInput).toHaveAttribute('type', 'password')
  })

  it('shows an error message when login fails', async () => {
    loginMock.mockRejectedValue(new ApiError(401, 'Credenciais inválidas'))
    renderLogin()
    fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: 'x@y.com' } })
    fireEvent.change(screen.getByLabelText(/^senha$/i, { selector: 'input' }), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: /entrar/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/credenciais inválidas/i)
  })
})
