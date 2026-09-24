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
    fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: 'changeme123' } })
    fireEvent.click(screen.getByRole('button', { name: /entrar/i }))
    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith('ana@empresa.com', 'changeme123', false),
    )
  })

  it('toggles password visibility', () => {
    renderLogin()
    const passwordInput = screen.getByLabelText(/^senha$/i)
    expect(passwordInput).toHaveAttribute('type', 'password')

    fireEvent.click(screen.getByRole('button', { name: /mostrar senha/i }))
    expect(passwordInput).toHaveAttribute('type', 'text')

    fireEvent.click(screen.getByRole('button', { name: /ocultar senha/i }))
    expect(passwordInput).toHaveAttribute('type', 'password')
  })

  // Documento 4, seção 2: a tela deixou de vender "feedback entre pares" e
  // passou a apresentar o portal. A copy é oficial da G&G — o teste trava o
  // texto para que um ajuste de layout não a reescreva sem querer.
  it('apresenta o portal, e não a ferramenta de feedback', () => {
    renderLogin()
    expect(screen.getByText('Portal EMR')).toBeInTheDocument()
    expect(screen.getByText('Conecte-se com a nossa cultura, engaje e evolua.')).toBeInTheDocument()
    expect(screen.getByText('Sua central de informações e cultura na EMR.')).toBeInTheDocument()
    expect(screen.getByText('Fique por dentro de todas as novidades')).toBeInTheDocument()
    expect(screen.getByText('Envie reconhecimentos e seja reconhecido')).toBeInTheDocument()
    expect(screen.getByText('Acumule EMR Coins, Pontos e Selos')).toBeInTheDocument()
    expect(screen.getByText('E muito mais!')).toBeInTheDocument()
    expect(screen.queryByText(/quem constrói merece virar lenda/i)).not.toBeInTheDocument()
  })

  it('shows an error message when login fails', async () => {
    loginMock.mockRejectedValue(new ApiError(401, 'Credenciais inválidas'))
    renderLogin()
    fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: 'x@y.com' } })
    fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: /entrar/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/credenciais inválidas/i)
  })
})
