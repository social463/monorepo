import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi, type Mock } from 'vitest'
import { CompanyDashboardPage } from './CompanyDashboardPage'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

const DASHBOARD = {
  company: { id: 'c1', name: 'EMR', slug: 'emr', active: true, createdAt: '2026-01-15T00:00:00.000Z' },
  totalUsers: 5,
  sectorBreakdown: [
    { sectorId: 's1', sectorName: 'Geral', userCount: 3 },
    { sectorId: 's2', sectorName: 'Vazio', userCount: 0 },
  ],
}

const ADMINS = [
  { id: 'u1', name: 'Ana', email: 'ana@emr.com', active: true, createdAt: '2026-01-15T00:00:00.000Z' },
  { id: 'u2', name: 'Bruno', email: 'bruno@emr.com', active: false, createdAt: '2026-02-01T00:00:00.000Z' },
]

function setupFetch(admins = ADMINS) {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/super-admin/companies/c1/dashboard' && !method) return Promise.resolve(DASHBOARD)
    if (path === '/super-admin/companies/c1/admins' && !method) return Promise.resolve({ admins })
    if (path === '/super-admin/companies/c1/admins' && method === 'POST') {
      return Promise.resolve({ admin: { id: 'u3', name: 'Carla', email: 'carla@emr.com', active: true, createdAt: '2026-03-01T00:00:00.000Z' } })
    }
    if (path.startsWith('/super-admin/companies/c1/admins/') && method === 'PATCH') {
      return Promise.resolve({ admin: { ...admins[0], name: 'Ana Maria' } })
    }
    if (path.startsWith('/super-admin/companies/c1/admins/') && method === 'DELETE') return Promise.resolve(undefined)
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderPage(path = '/super-admin/companies/c1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/super-admin/companies/:id" element={<CompanyDashboardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CompanyDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('mostra as métricas da empresa', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'EMR' })).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Geral')).toBeInTheDocument()
    expect(screen.getByText('Vazio')).toBeInTheDocument()
    expect(mockApiFetch).toHaveBeenCalledWith('/super-admin/companies/c1/dashboard')
  })

  it('resume a empresa em três cards, incluindo os administradores ativos', async () => {
    renderPage()

    expect(await screen.findByText('Usuários ativos')).toBeInTheDocument()
    expect(screen.getByText('Setores')).toBeInTheDocument()
    // Dos dois admins do mock, só a Ana está ativa.
    const card = (await screen.findByText('Administradores ativos')).closest('div')!
    expect(card).toHaveTextContent('1')
  })

  it('leva de volta para a lista pelo breadcrumb', async () => {
    renderPage()

    const voltar = await screen.findByRole('link', { name: 'Empresas' })
    expect(voltar).toHaveAttribute('href', '/super-admin')
  })

  it('mostra mensagem de empresa não encontrada em 404', async () => {
    const { ApiError } = await import('../lib/api')
    mockApiFetch.mockRejectedValue(new ApiError(404, 'Empresa não encontrada.'))
    renderPage()

    expect(await screen.findByText(/não encontrada/)).toBeInTheDocument()
  })

  it('lista os administradores, inclusive os inativos', async () => {
    renderPage()

    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('ana@emr.com')).toBeInTheDocument()
    expect(screen.getByText('Bruno')).toBeInTheDocument()
    // Inativo não oferece Editar/Remover — só o caminho de volta.
    expect(screen.getByRole('button', { name: 'Reativar' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(1)
  })

  it('mostra o vazio quando a empresa não tem admin', async () => {
    setupFetch([])
    renderPage()

    expect(await screen.findByText('Nenhum administrador cadastrado.')).toBeInTheDocument()
  })

  it('cria um administrador novo via POST', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '+ Novo admin' }))
    fireEvent.change(screen.getByLabelText('Nome do novo admin'), { target: { value: 'Carla' } })
    fireEvent.change(screen.getByLabelText('E-mail do novo admin'), { target: { value: 'carla@emr.com' } })
    fireEvent.change(screen.getByLabelText('Senha do novo admin'), { target: { value: 'changeme123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar administrador' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/super-admin/companies/c1/admins',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Carla', email: 'carla@emr.com', password: 'changeme123' }),
        }),
      ),
    )
  })

  it('cobra os campos obrigatórios antes de chamar a API', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '+ Novo admin' }))
    fireEvent.click(screen.getByRole('button', { name: 'Criar administrador' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/obrigat[óo]rios/)
    expect(mockApiFetch).not.toHaveBeenCalledWith(
      '/super-admin/companies/c1/admins',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('edita só o que mudou no administrador', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Nome do admin'), { target: { value: 'Ana Maria' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/super-admin/companies/c1/admins/u1',
        // E-mail intocado fica fora do corpo; `password` vazio nunca vira troca de senha.
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Ana Maria' }) }),
      ),
    )
  })

  it('manda a senha nova quando o campo é preenchido', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Nova senha do admin'), { target: { value: 'novasenha123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/super-admin/companies/c1/admins/u1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ password: 'novasenha123' }) }),
      ),
    )
  })

  it('recusa senha curta sem chamar a API', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Nova senha do admin'), { target: { value: 'curta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/8 caracteres/)
    expect(mockApiFetch).not.toHaveBeenCalledWith(
      '/super-admin/companies/c1/admins/u1',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('remove um administrador via DELETE e reativa via PATCH', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }))
    // Remoção pede confirmação: o primeiro clique só arma o gesto.
    expect(mockApiFetch).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'DELETE' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/super-admin/companies/c1/admins/u1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reativar' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/super-admin/companies/c1/admins/u2',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ active: true }) }),
      ),
    )
  })

  it('mostra o erro do servidor quando a remoção é barrada', async () => {
    const { ApiError } = await import('../lib/api')
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/super-admin/companies/c1/dashboard' && !method) return Promise.resolve(DASHBOARD)
      if (path === '/super-admin/companies/c1/admins' && !method) return Promise.resolve({ admins: [ADMINS[0]] })
      if (method === 'DELETE') {
        return Promise.reject(new ApiError(409, 'A empresa precisa de pelo menos um administrador ativo.'))
      }
      return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
    })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/pelo menos um administrador ativo/)
  })
})
