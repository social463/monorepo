import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { vi, type Mock } from 'vitest'
import { SuperAdminPage } from './SuperAdminPage'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, login: vi.fn(), logout: vi.fn(), setUser: vi.fn() }),
}))

const mockApiFetch = apiFetch as unknown as Mock

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/super-admin/companies' && !method) {
      return Promise.resolve({
        companies: [{ id: 'c1', name: 'EMR', slug: 'emr', active: true }],
      })
    }
    if (path === '/super-admin/companies' && method === 'POST') {
      return Promise.resolve({
        company: { id: 'c2', name: 'Empresa Nova', slug: 'empresa-nova', active: true },
        admin: { id: 'u2', name: 'Admin Nova', role: 'ADMIN' },
      })
    }
    if (path === '/super-admin/companies/c1' && method === 'PATCH') {
      return Promise.resolve({
        company: { id: 'c1', name: 'EMR Renomeada', slug: 'emr-renomeada', active: true },
      })
    }
    if (path === '/super-admin/companies/c1/dashboard' && !method) {
      return Promise.resolve({
        company: { id: 'c1', name: 'EMR', slug: 'emr', active: true, createdAt: '2026-01-15T00:00:00.000Z' },
        totalUsers: 7,
        sectorBreakdown: [{ sectorId: 's1', sectorName: 'Geral', userCount: 7 }],
      })
    }
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SuperAdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SuperAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('lista as empresas cadastradas com slug, status e números', async () => {
    renderPage()
    expect(await screen.findByText('EMR')).toBeInTheDocument()
    expect(screen.getByText('Ativa')).toBeInTheDocument()
    // Slug e contadores vivem na mesma linha de resumo.
    expect(await screen.findByText(/^emr ·/)).toHaveTextContent('7 usuários')
  })

  it('cria uma empresa nova em POST /super-admin/companies', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '+ Nova empresa' }))
    fireEvent.change(screen.getByLabelText('Nome da empresa'), { target: { value: 'Empresa Nova' } })
    fireEvent.change(screen.getByLabelText('Nome do admin'), { target: { value: 'Admin Nova' } })
    fireEvent.change(screen.getByLabelText('E-mail do admin'), { target: { value: 'admin@empresanova.com' } })
    fireEvent.change(screen.getByLabelText('Senha do admin'), { target: { value: 'changeme123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar empresa' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/super-admin/companies',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'Empresa Nova',
            admin: { name: 'Admin Nova', email: 'admin@empresanova.com', password: 'changeme123' },
          }),
        }),
      ),
    )
  })

  it('mostra erro de validação quando os campos obrigatórios estão vazios', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '+ Nova empresa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Criar empresa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/obrigat[óo]rios/)
    expect(mockApiFetch).not.toHaveBeenCalledWith('/super-admin/companies', expect.objectContaining({ method: 'POST' }))
  })

  it('edita o nome de uma empresa via PATCH', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Nome da empresa'), { target: { value: 'EMR Renomeada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/super-admin/companies/c1',
        // `active` saiu do formulário: ativar/desativar é só o botão da linha.
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'EMR Renomeada' }) }),
      ),
    )
  })

  it('mantém a empresa identificável (e o link) enquanto edita', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))

    // O cabeçalho da linha continua de pé — foi o que sumia antes.
    expect(screen.getByRole('link', { name: 'EMR' })).toHaveAttribute('href', '/super-admin/companies/c1')
    expect(screen.getByLabelText('Nome da empresa')).toHaveValue('EMR')
  })

  it('pede confirmação antes de desativar uma empresa', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Desativar' }))
    // Um clique só não desativa nada.
    expect(mockApiFetch).not.toHaveBeenCalledWith('/super-admin/companies/c1', expect.objectContaining({ method: 'PATCH' }))

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/super-admin/companies/c1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ active: false }) }),
      ),
    )
  })

  it('desiste de desativar ao cancelar a confirmação', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Desativar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByRole('button', { name: 'Desativar' })).toBeInTheDocument()
    expect(mockApiFetch).not.toHaveBeenCalledWith('/super-admin/companies/c1', expect.objectContaining({ method: 'PATCH' }))
  })

  it('linka o nome da empresa para a página de detalhe e mostra o total de usuários', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: 'EMR' })
    expect(link).toHaveAttribute('href', '/super-admin/companies/c1')
    expect(await screen.findByText(/7 usuários/)).toBeInTheDocument()
  })

  it('mostra "usuário" no singular quando a empresa tem exatamente 1 usuário', async () => {
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/super-admin/companies' && !method) {
        return Promise.resolve({
          companies: [{ id: 'c1', name: 'EMR', slug: 'emr', active: true }],
        })
      }
      if (path === '/super-admin/companies/c1/dashboard' && !method) {
        return Promise.resolve({
          company: { id: 'c1', name: 'EMR', slug: 'emr', active: true, createdAt: '2026-01-15T00:00:00.000Z' },
          totalUsers: 1,
          sectorBreakdown: [{ sectorId: 's1', sectorName: 'Geral', userCount: 1 }],
        })
      }
      return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
    })
    renderPage()
    expect(await screen.findByText(/1 usuário ·/)).toBeInTheDocument()
    expect(screen.queryByText(/1 usuários/)).not.toBeInTheDocument()
  })
})
