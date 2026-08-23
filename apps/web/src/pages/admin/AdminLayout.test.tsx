import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './AdminLayout'

describe('AdminLayout', () => {
  // O layout do console virou só a caixa de conteúdo: a navegação mora na
  // segunda linha do header (ver `AppLayout` + `admin-nav-items`), como no
  // resto do app. Antes daqui saía uma sidebar fixa própria.
  it('renderiza a rota filha via Outlet, na mesma caixa de conteúdo do app', () => {
    render(
      <MemoryRouter initialEntries={['/admin/setores']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="setores" element={<p>Conteúdo de setores</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    const conteudo = screen.getByText('Conteúdo de setores')
    expect(conteudo).toBeInTheDocument()
    // Sem navegação própria: nenhuma sidebar concorrendo com a barra do topo.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(conteudo.parentElement).toHaveClass('max-w-page')
  })
})
