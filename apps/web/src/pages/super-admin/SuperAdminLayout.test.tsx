import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import { SuperAdminLayout } from './SuperAdminLayout'

const logout = vi.fn()

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Super Admin', role: 'SUPER_ADMIN' },
    loading: false,
    login: vi.fn(),
    logout,
    setUser: vi.fn(),
  }),
}))

function renderLayout(path = '/super-admin') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<SuperAdminLayout />}>
          <Route path="/super-admin" element={<p>conteúdo da página</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('SuperAdminLayout', () => {
  beforeEach(() => vi.clearAllMocks())

  it('envolve a página com a navegação do console', () => {
    renderLayout()

    expect(screen.getByText('conteúdo da página')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Navegação do super admin' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Empresas' })).toHaveAttribute('href', '/super-admin')
  })

  it('identifica quem está logado como super admin', () => {
    renderLayout()

    expect(screen.getByText('Super Admin')).toBeInTheDocument()
    expect(screen.getByText('Super admin')).toBeInTheDocument()
  })

  it('desloga pelo botão da sidebar', () => {
    renderLayout()

    // Dois caminhos de saída: o da sidebar (desktop) e o do header (mobile,
    // onde a sidebar não aparece). Ambos devem chamar o mesmo logout.
    const botoes = screen.getAllByRole('button', { name: 'Sair' })
    expect(botoes).toHaveLength(2)
    botoes.forEach((botao) => fireEvent.click(botao))
    expect(logout).toHaveBeenCalledTimes(2)
  })
})
