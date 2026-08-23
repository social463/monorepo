import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { SquadsSection } from './SquadsSection'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockAuth.role } }),
}))

const mockApiFetch = apiFetch as unknown as Mock

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/admin/squads' && !method) {
      return Promise.resolve({
        squads: [
          {
            id: 'sq1',
            name: 'B2B',
            slug: 'b2b',
            active: true,
            leaderId: null,
            leader: null,
            sectorId: 'sector-1',
            members: [{ id: 'u1', name: 'Arthur Pedro' }],
          },
        ],
      })
    }
    if (path === '/admin/users' && !method) {
      return Promise.resolve({
        users: [
          { id: 'u1', name: 'Arthur Pedro' },
          { id: 'u2', name: 'Emerson Marques' },
          { id: 'u3', name: 'Erika Kelner' },
        ],
      })
    }
    if (path === '/admin/sectors' && !method) {
      return Promise.resolve({ sectors: [{ id: 'sector-1', name: 'Plataforma', slug: 'plataforma', active: true, enabledFeatures: [], roles: [] }] })
    }
    if (path === '/admin/squads' && method === 'POST') {
      return Promise.resolve({ squad: { id: 'sq2', name: 'Nova Squad', slug: 'nova-squad', active: true, leaderId: null, leader: null, sectorId: 'sector-1', members: [] } })
    }
    if (path === '/admin/squads/sq1' && method === 'PATCH') {
      return Promise.resolve({ squad: { id: 'sq1', name: 'B2B', slug: 'b2b', active: true, leaderId: 'u2', leader: { id: 'u2', name: 'Emerson Marques' }, sectorId: 'sector-1', members: [{ id: 'u1', name: 'Arthur Pedro' }] } })
    }
    if (path === '/admin/squads/sq1/members' && method === 'POST') {
      return Promise.resolve({ squad: { id: 'sq1', name: 'B2B', slug: 'b2b', active: true, leaderId: null, leader: null, sectorId: 'sector-1', members: [{ id: 'u1', name: 'Arthur Pedro' }, { id: 'u2', name: 'Emerson Marques' }] } })
    }
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SquadsSection />
    </QueryClientProvider>,
  )
}

async function expandPlataformaGroup() {
  fireEvent.click(await screen.findByRole('button', { name: /plataforma \(1\)/i }))
}

describe('SquadsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('agrupa as squads por setor, num acordeão recolhido por padrão', async () => {
    renderSection()
    const toggle = await screen.findByRole('button', { name: /plataforma \(1\)/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('B2B')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('B2B')).toBeInTheDocument()
  })

  it('mostra o combobox de líder com busca, sem líder por padrão', async () => {
    renderSection()
    await expandPlataformaGroup()
    const leaderCombo = await screen.findByRole('combobox', { name: /líder da b2b/i })
    expect(leaderCombo).toHaveTextContent('Sem líder')
  })

  it('define o líder selecionando na lista do combobox', async () => {
    renderSection()
    await expandPlataformaGroup()
    const leaderCombo = await screen.findByRole('combobox', { name: /líder da b2b/i })
    fireEvent.click(leaderCombo)
    fireEvent.click(screen.getByRole('option', { name: 'Emerson Marques' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/squads/sq1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ leaderId: 'u2' }) }),
      ),
    )
  })

  it('filtra as opções de líder ao digitar o nome', async () => {
    renderSection()
    await expandPlataformaGroup()
    const leaderCombo = await screen.findByRole('combobox', { name: /líder da b2b/i })
    fireEvent.click(leaderCombo)
    fireEvent.change(screen.getByLabelText(/buscar em líder da b2b/i), { target: { value: 'erika' } })
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: 'Erika Kelner' })).toBeInTheDocument()
  })

  it('adiciona um integrante pelo combobox de adicionar integrante (só mostra quem ainda não está na squad)', async () => {
    renderSection()
    await expandPlataformaGroup()
    const addCombo = await screen.findByRole('combobox', { name: /adicionar integrante à b2b/i })
    fireEvent.click(addCombo)
    // Arthur Pedro já é integrante — não deve aparecer como opção.
    expect(screen.queryByRole('option', { name: 'Arthur Pedro' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Emerson Marques' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/squads/sq1/members',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ userId: 'u2' }) }),
      ),
    )
  })

  it('muda o setor de uma squad existente', async () => {
    renderSection()
    await expandPlataformaGroup()
    const sectorSelect = await screen.findByLabelText(/setor da b2b/i)
    fireEvent.click(sectorSelect)
    fireEvent.click(screen.getByRole('option', { name: 'Plataforma' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/squads/sq1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ sectorId: 'sector-1' }) }),
      ),
    )
  })

  it('cria squad com o setor selecionado no formulário', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /\+ adicionar squad/i }))
    fireEvent.change(screen.getByLabelText(/^nova squad$/i), { target: { value: 'Nova Squad' } })
    fireEvent.click(screen.getByLabelText(/setor da nova squad/i))
    fireEvent.click(await screen.findByRole('option', { name: 'Plataforma' }))
    fireEvent.click(screen.getByRole('button', { name: /^adicionar$/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/squads',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Nova Squad', sectorId: 'sector-1' }) }),
      ),
    )
  })
})

describe('SquadsSection — Subadmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
    mockAuth.role = 'SUBADMIN'
  })

  it('esconde o seletor de setor (criação e por squad) quando logado como Subadmin', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /\+ adicionar squad/i }))
    expect(screen.queryByLabelText(/setor da nova squad/i)).not.toBeInTheDocument()
    await expandPlataformaGroup()
    expect(screen.queryByLabelText(/setor da b2b/i)).not.toBeInTheDocument()
  })
})
