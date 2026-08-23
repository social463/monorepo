import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { VotePage } from './VotePage'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path === '/users') {
      return Promise.resolve({
        users: [
          {
            id: 'u2',
            name: 'Bruno Lima',
            email: 'bruno@empresa.com',
            role: 'LEGEND',
            position: null,
            squad: null,
            photoUrl: null,
            active: true,
            joinedAt: '2026-01-01T00:00:00.000Z',
            sectorId: 'sector-dev-produto',
          },
        ],
      })
    }
    if (path === '/categories') {
      return Promise.resolve({
        categories: [
          { id: 'c1', name: 'Colaboração', slug: 'colaboracao', description: null, isSpecial: false },
          { id: 'c2', name: 'Inovação', slug: 'inovacao', description: null, isSpecial: false },
          { id: 'c3', name: 'Liderança', slug: 'lideranca', description: null, isSpecial: false },
          { id: 'c4', name: 'Qualidade', slug: 'qualidade', description: null, isSpecial: false },
        ],
      })
    }
    if (path === '/periods/current') {
      return Promise.resolve({
        period: { id: 'p1', sectorId: 'sector-dev-produto', monthRef: '2026-06', startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-30T23:59:59.000Z', status: 'OPEN' },
      })
    }
    if (path === '/votes/me') {
      return Promise.resolve({ votes: [] })
    }
    if (path === '/votes' && options?.method === 'POST') {
      return Promise.resolve({ vote: { id: 'v1' } })
    }
    return Promise.reject(new Error(`unexpected ${path}`))
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VotePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('VotePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('loads colleagues and categories into the form', async () => {
    renderPage()
    expect(await screen.findByRole('radio', { name: /Bruno Lima/ })).toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: /Colaboração/ })).toBeInTheDocument()
  })

  it('bloqueia o envio quando o feedback é curto demais', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: /Bruno Lima/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Colaboração/ }))
    fireEvent.change(screen.getByLabelText(/seu feedback/i), { target: { value: 'curto' } })
    fireEvent.click(screen.getByRole('button', { name: /confirmar voto/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/pelo menos 10 caracteres/i)
    expect(mockApiFetch).not.toHaveBeenCalledWith('/votes', expect.anything())
  })

  it('shows a closed state and hides the form when there is no open period', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/periods/current') return Promise.resolve({ period: null })
      if (path === '/periods/next') return Promise.resolve({ period: null })
      if (path === '/users') return Promise.resolve({ users: [] })
      if (path === '/categories') return Promise.resolve({ categories: [] })
      if (path === '/votes/me') return Promise.resolve({ votes: [] })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderPage()

    expect(await screen.findByText(/votação fechada/i)).toBeInTheDocument()
    expect(screen.getByText(/nenhum período de votação está aberto/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirmar voto/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/seu feedback/i)).not.toBeInTheDocument()
  })

  it('shows the next scheduled period when closed and one is upcoming', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/periods/current') return Promise.resolve({ period: null })
      if (path === '/periods/next') {
        return Promise.resolve({
          period: { id: 'pn', monthRef: '2026-08', startsAt: '2026-08-03T00:00:00.000Z', endsAt: '2026-08-10T23:59:59.000Z', status: 'OPEN', state: 'SCHEDULED', editable: true },
        })
      }
      if (path === '/users') return Promise.resolve({ users: [] })
      if (path === '/categories') return Promise.resolve({ categories: [] })
      if (path === '/votes/me') return Promise.resolve({ votes: [] })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderPage()

    expect(await screen.findByText(/votação fechada/i)).toBeInTheDocument()
    expect(await screen.findByText(/próxima votação \(2026-08\)/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirmar voto/i })).not.toBeInTheDocument()
  })

  it('hides the form and shows an already-voted notice when the user already voted this period', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/users') return Promise.resolve({ users: [] })
      if (path === '/categories') return Promise.resolve({ categories: [] })
      if (path === '/periods/current') {
        return Promise.resolve({
          period: { id: 'p1', monthRef: '2026-06', startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-30T23:59:59.000Z', status: 'OPEN' },
        })
      }
      if (path === '/votes/me') {
        return Promise.resolve({
          votes: [
            {
              id: 'v1',
              voter: { id: 'u1', name: 'Ana' },
              voted: { id: 'u2', name: 'Bruno Lima' },
              categories: [{ id: 'c1', name: 'Colaboração', slug: 'colaboracao' }],
              justification: 'Ajudou muito no incidente de produção.',
              createdAt: '2026-06-05T00:00:00.000Z',
              periodId: 'p1',
              monthRef: '2026-06',
            },
          ],
        })
      }
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderPage()

    expect(await screen.findByText(/você já votou neste período/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirmar voto/i })).not.toBeInTheDocument()
  })

  it('esconde lideranças (LEAD) da lista de candidatos', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/users') {
        return Promise.resolve({
          users: [
            { id: 'u2', name: 'Bruno Lima', email: 'bruno@empresa.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
            { id: 'u3', name: 'Lider Reis', email: 'lider@empresa.com', role: 'LEAD', position: 'Head de Engenharia', squad: 'Liderança', photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
          ],
        })
      }
      if (path === '/categories') return Promise.resolve({ categories: [{ id: 'c1', name: 'Colaboração', slug: 'colaboracao', description: null, isSpecial: false }] })
      if (path === '/periods/current') return Promise.resolve({ period: { id: 'p1', monthRef: '2026-06', startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-30T23:59:59.000Z', status: 'OPEN' } })
      if (path === '/votes/me') return Promise.resolve({ votes: [] })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderPage()

    expect(await screen.findByRole('radio', { name: /Bruno Lima/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Lider Reis/ })).not.toBeInTheDocument()
  })

  it('submits a valid vote with a single category and shows a success message', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: /Bruno Lima/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Colaboração/ }))
    fireEvent.change(screen.getByLabelText(/seu feedback/i), {
      target: { value: 'Ajudou muito no incidente de produção.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /confirmar voto/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/votes', expect.objectContaining({ method: 'POST' })),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/voto registrado/i)
  })

  it('submits a vote with two categories and sends categoryIds array in the body', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: /Bruno Lima/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Colaboração/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Inovação/ }))
    fireEvent.change(screen.getByLabelText(/seu feedback/i), {
      target: { value: 'Colaborou muito e trouxe soluções inovadoras.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /confirmar voto/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/votes',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"categoryIds"'),
        }),
      ),
    )
    const call = mockApiFetch.mock.calls.find(
      (args) => args[0] === '/votes' && (args[1] as RequestInit)?.method === 'POST',
    )
    expect(call).toBeDefined()
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body.categoryIds).toHaveLength(2)
    expect(body.categoryIds).toContain('c1')
    expect(body.categoryIds).toContain('c2')
    expect(await screen.findByRole('status')).toHaveTextContent(/voto registrado/i)
  })

  it('disables unchosen categories once MAX_VOTE_CATEGORIES are selected', async () => {
    // Setup 4 categories so we can hit the cap of 3
    renderPage()
    // Wait for categories to load (4 categories defined in setupFetch)
    await screen.findByRole('checkbox', { name: /Colaboração/ })
    fireEvent.click(screen.getByRole('checkbox', { name: /Colaboração/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Inovação/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Liderança/ }))
    // Now at limit of 3 — Qualidade should be disabled
    const qualidadeCheckbox = screen.getByRole('checkbox', { name: /Qualidade/ })
    expect(qualidadeCheckbox).toBeDisabled()
    // Selected ones should still be enabled (can deselect)
    expect(screen.getByRole('checkbox', { name: /Colaboração/ })).not.toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /Inovação/ })).not.toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /Liderança/ })).not.toBeDisabled()
  })

  it('blocks submit when no category is selected', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: /Bruno Lima/ }))
    fireEvent.change(screen.getByLabelText(/seu feedback/i), {
      target: { value: 'Ajudou muito no incidente de produção.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /confirmar voto/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/ao menos uma categoria/i)
    expect(mockApiFetch).not.toHaveBeenCalledWith('/votes', expect.anything())
  })

  it('não lista como candidato alguém de outro setor', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/users') {
        return Promise.resolve({
          users: [
            { id: 'u2', name: 'Bruno Lima', email: 'bruno@empresa.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', sectorId: 'sector-dev-produto' },
            { id: 'u3', name: 'De Outro Setor', email: 'outro@empresa.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', sectorId: 'sector-b' },
          ],
        })
      }
      if (path === '/categories') return Promise.resolve({ categories: [] })
      if (path === '/periods/current') {
        return Promise.resolve({
          period: { id: 'p1', sectorId: 'sector-dev-produto', monthRef: '2026-06', startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-30T23:59:59.000Z', status: 'OPEN' },
        })
      }
      if (path === '/votes/me') return Promise.resolve({ votes: [] })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderPage()
    expect(await screen.findByRole('radio', { name: /Bruno Lima/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /De Outro Setor/ })).not.toBeInTheDocument()
  })
})
