import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { AdministratorsSection } from './AdministratorsSection'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

const baseUser = {
  email: 'admin@empresa.com',
  area: null,
  position: null,
  squad: null,
  photoUrl: null,
  avatarStyle: null,
  avatarSeed: null,
  avatarOptions: null,
  joinedAt: '2024-01-01T00:00:00.000Z',
  leftAt: null,
  enabledFeatures: [],
  sectorFeatures: [],
  teamsWebhookUrl: null,
}

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/admin/administrators' && !method) {
      return Promise.resolve({
        users: [
          { ...baseUser, id: 'a1', name: 'Ana Admin', email: 'ana@empresa.com', role: 'ADMIN', active: true, sectorId: 'sector-1' },
          { ...baseUser, id: 's1', name: 'Sara Subadmin', email: 'sara@empresa.com', role: 'SUBADMIN', active: true, sectorId: 'sector-1' },
        ],
      })
    }
    if (path === '/admin/sectors' && !method) {
      return Promise.resolve({ sectors: [{ id: 'sector-1', name: 'Plataforma', slug: 'plataforma', active: true, enabledFeatures: [], roles: [] }] })
    }
    if (path === '/admin/users/s1' && method === 'PATCH') {
      return Promise.resolve({ user: { ...baseUser, id: 's1', name: 'Sara Subadmin', role: 'ADMIN', active: true, sectorId: 'sector-1' } })
    }
    if (path === '/admin/users' && method === 'POST') {
      return Promise.resolve({ user: { ...baseUser, id: 's2', name: 'Bruno Subadmin', email: 'bruno@empresa.com', role: 'SUBADMIN', active: true, sectorId: 'sector-1' } })
    }
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AdministratorsSection />
    </QueryClientProvider>,
  )
}

describe('AdministratorsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('lista as contas Admin e Subadmin com papel e setor', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Plataforma \(2\)/ }))
    expect(screen.getByText('Ana Admin')).toBeInTheDocument()
    expect(screen.getByText(/Admin · Global/)).toBeInTheDocument()
    expect(screen.getByText('Sara Subadmin')).toBeInTheDocument()
    expect(screen.getByText(/Subadmin · Plataforma/)).toBeInTheDocument()
  })

  it('edita papel/setor/ativo de uma conta e envia PATCH /admin/users/:id', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Plataforma \(2\)/ }))
    await screen.findByText('Sara Subadmin')
    const row = screen.getByText('Sara Subadmin').closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Editar' }))

    fireEvent.click(within(row).getByLabelText('Papel de Sara Subadmin'))
    fireEvent.click(screen.getByRole('option', { name: 'Admin' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/users/s1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'Sara Subadmin', email: 'sara@empresa.com', role: 'ADMIN', sectorId: 'sector-1', active: true }),
        }),
      ),
    )
  })

  it('cria uma conta Subadmin em POST /admin/users', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: '+ Adicionar admin' }))
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Bruno Subadmin' } })
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'bruno@empresa.com' } })
    fireEvent.click(screen.getByLabelText('Setor'))
    fireEvent.click(await screen.findByRole('option', { name: 'Plataforma' }))
    fireEvent.change(screen.getByLabelText('Senha provisória'), { target: { value: 'changeme123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/users',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'Bruno Subadmin',
            email: 'bruno@empresa.com',
            password: 'changeme123',
            role: 'SUBADMIN',
            sectorId: 'sector-1',
          }),
        }),
      ),
    )
  })

  it('invalida a lista de administradores após salvar (refetch)', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Plataforma \(2\)/ }))
    await screen.findByText('Sara Subadmin')
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/admin/administrators' && !method) {
        return Promise.resolve({ users: [{ ...baseUser, id: 'a1', name: 'Ana Admin', role: 'ADMIN', active: true, sectorId: 'sector-1' }] })
      }
      if (path === '/admin/sectors' && !method) {
        return Promise.resolve({ sectors: [{ id: 'sector-1', name: 'Plataforma', slug: 'plataforma', active: true, enabledFeatures: [], roles: [] }] })
      }
      if (path === '/admin/users/s1' && method === 'PATCH') {
        return Promise.resolve({ user: { ...baseUser, id: 's1', name: 'Sara Subadmin', role: 'ADMIN', active: true, sectorId: 'sector-1' } })
      }
      return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
    })

    const row = screen.getByText('Sara Subadmin').closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Editar' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByText('Sara Subadmin')).not.toBeInTheDocument())
  })
})

// Acesso administrativo delegado — colaboradores que administram sem deixar de
// ser do time. Spec: docs/superpowers/specs/2026-08-15-acesso-admin-delegado-design.md
describe('AdministratorsSection — acesso delegado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/admin/administrators' && !method) {
        return Promise.resolve({
          users: [
            { ...baseUser, id: 'a1', name: 'Ana Admin', email: 'ana@empresa.com', role: 'ADMIN', active: true, sectorId: 'sector-1', adminAccess: false },
            { ...baseUser, id: 'd1', name: 'Diego Lenda', email: 'diego@empresa.com', role: 'LEGEND', active: true, sectorId: 'sector-1', adminAccess: true },
          ],
        })
      }
      if (path === '/admin/sectors' && !method) {
        return Promise.resolve({ sectors: [{ id: 'sector-1', name: 'Plataforma', slug: 'plataforma', active: true, enabledFeatures: [], roles: [] }] })
      }
      if (path === '/admin/users/d1' && method === 'PATCH') {
        return Promise.resolve({ user: { ...baseUser, id: 'd1', name: 'Diego Lenda', role: 'LEGEND', active: true, sectorId: 'sector-1', adminAccess: false } })
      }
      return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
    })
  })

  // Contas de gestão e delegados vêm na mesma resposta, mas são públicos
  // diferentes: um se edita aqui, o outro é colaborador e só se revoga.
  it('separa os delegados das contas de gestão', async () => {
    renderSection()
    expect(await screen.findByText(/acesso administrativo delegado/i)).toBeInTheDocument()

    const linhaDelegado = screen.getByText('Diego Lenda').closest('li')!
    expect(within(linhaDelegado).getByRole('button', { name: /revogar acesso/i })).toBeInTheDocument()
    expect(within(linhaDelegado).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()

    // A conta de gestão fica no acordeão do setor, e sozinha lá: o delegado
    // não entra na contagem dele.
    fireEvent.click(screen.getByRole('button', { name: /Plataforma \(1\)/ }))
    const linhaConta = screen.getByText('Ana Admin').closest('li')!
    expect(within(linhaConta).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
  })

  it('revogar manda adminAccess: false', async () => {
    renderSection()
    const linha = (await screen.findByText('Diego Lenda')).closest('li')!
    fireEvent.click(within(linha).getByRole('button', { name: /revogar acesso/i }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/users/d1', expect.objectContaining({ method: 'PATCH' })),
    )
    const call = mockApiFetch.mock.calls.find((c) => c[0] === '/admin/users/d1' && c[1]?.method === 'PATCH')!
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ adminAccess: false })
  })
})
