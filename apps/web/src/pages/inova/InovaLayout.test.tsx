import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { InovaLayout } from './InovaLayout'
import * as authModule from '../../auth/AuthContext'
import * as devSettingsModule from '../../lib/use-development-settings'

vi.mock('../../auth/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/AuthContext')>()),
  useAuth: vi.fn(),
}))

vi.mock('../../lib/use-development-settings')

function renderLayout(role: string) {
  vi.mocked(authModule.useAuth).mockReturnValue({ user: { role, adminAccess: false } } as ReturnType<typeof authModule.useAuth>)
  vi.mocked(devSettingsModule.useDevelopmentSettings).mockReturnValue({
    isPending: false,
    data: { settings: { inovaModuleEnabled: true } },
  } as ReturnType<typeof devSettingsModule.useDevelopmentSettings>)
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/comunidade-inova']}>
        <Routes>
          <Route path="/comunidade-inova" element={<InovaLayout />}>
            <Route index element={<p>início</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('InovaLayout', () => {
  it('mostra as abas Início/Projetos/Recursos/Como usar para qualquer usuário', () => {
    renderLayout('LEGEND')
    expect(screen.getByRole('link', { name: /início/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /projetos/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /recursos/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^guia$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /como usar/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /responsabilidades/i })).toBeInTheDocument()
  })

  // Cadastrar projeto é de qualquer colaborador desde
  // specs/2026-09-15-inova-projeto-de-todos-design.md.
  it('mostra "Criar projeto" para qualquer colaborador', () => {
    renderLayout('LEGEND')
    expect(screen.getByRole('link', { name: /criar projeto/i })).toBeInTheDocument()
  })

  it('mostra "Criar projeto" para admin', () => {
    renderLayout('ADMIN')
    expect(screen.getByRole('link', { name: /criar projeto/i })).toBeInTheDocument()
  })

  it('o Painel continua só para quem administra', () => {
    renderLayout('LEGEND')
    expect(screen.queryByRole('link', { name: /painel/i })).not.toBeInTheDocument()
  })

  it('redireciona para / quando o módulo está desabilitado', () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND', adminAccess: false } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(devSettingsModule.useDevelopmentSettings).mockReturnValue({
      isPending: false,
      data: { settings: { inovaModuleEnabled: false } },
    } as ReturnType<typeof devSettingsModule.useDevelopmentSettings>)
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/comunidade-inova']}>
          <Routes>
            <Route path="/" element={<p>home</p>} />
            <Route path="/comunidade-inova" element={<InovaLayout />}>
              <Route index element={<p>início</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('home')).toBeInTheDocument()
  })
})
