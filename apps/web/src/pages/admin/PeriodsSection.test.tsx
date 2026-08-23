import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { PeriodsSection } from './PeriodsSection'
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
    if (path === '/admin/sectors' && !method) {
      return Promise.resolve({ sectors: [] })
    }
    if (path === '/admin/periods' && !method) {
      return Promise.resolve({
        periods: [{ id: 'p1', monthRef: '2026-06', startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-30T23:59:59.000Z', status: 'OPEN', state: 'ACTIVE', editable: true }],
      })
    }
    if (path === '/admin/periods' && method === 'POST') {
      return Promise.resolve({ period: { id: 'p2', monthRef: '2026-08', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-31T23:59:59.000Z', status: 'OPEN', state: 'SCHEDULED', editable: true } })
    }
    if (path.startsWith('/admin/periods/') && method === 'PATCH') {
      return Promise.resolve({ period: { id: 'p1', monthRef: '2026-06', startsAt: '2026-06-05T00:00:00.000Z', endsAt: '2026-06-20T23:59:59.000Z', status: 'OPEN', state: 'ACTIVE', editable: true } })
    }
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PeriodsSection />
    </QueryClientProvider>,
  )
}

describe('PeriodsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('schedules a future period from month + date/time range', async () => {
    renderSection()
    await screen.findByText('2026-06')
    fireEvent.click(screen.getByRole('button', { name: '+ Agendar período' }))
    fireEvent.change(screen.getByLabelText(/mês do destaque/i), { target: { value: '2026-08' } })
    fireEvent.change(screen.getByLabelText(/início da votação/i), { target: { value: '2026-08-01T09:30' } })
    fireEvent.change(screen.getByLabelText(/fim da votação/i), { target: { value: '2026-08-10T18:45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agendar período' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/periods',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    const body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/periods' && c[1]?.method === 'POST')![1] as RequestInit).body as string)
    expect(body.monthRef).toBe('2026-08')
    expect(body.startsAt).toBe('2026-08-01T09:30')
    expect(body.endsAt).toBe('2026-08-10T18:45')
  })

  it('groups periods into em andamento, agendados and encerrados', async () => {
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/admin/sectors' && !method) return Promise.resolve({ sectors: [] })
      if (path === '/admin/periods' && !method) {
        return Promise.resolve({
          periods: [
            { id: 'a', monthRef: '2026-06', startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-30T23:59:59.000Z', status: 'OPEN', state: 'ACTIVE', editable: true },
            { id: 's', monthRef: '2026-08', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-31T23:59:59.000Z', status: 'OPEN', state: 'SCHEDULED', editable: true },
            { id: 'e', monthRef: '2026-01', startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-01-31T23:59:59.000Z', status: 'CLOSED', state: 'ENDED', editable: false },
          ],
        })
      }
      return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
    })
    renderSection()
    expect(await screen.findByText(/em andamento/i)).toBeInTheDocument()
    expect(screen.getByText(/agendados/i)).toBeInTheDocument()
    expect(screen.getByText(/encerrados/i)).toBeInTheDocument()
    // O agendado tem botão Cancelar; o ativo tem Fechar; o encerrado, nenhum.
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fechar/i })).toBeInTheDocument()
    // Apenas os períodos editáveis (mês atual/futuro) têm botão Editar: ativo + agendado = 2.
    expect(screen.getAllByRole('button', { name: /editar período/i })).toHaveLength(2)
  })

  it('edits the window of an editable period (PATCH)', async () => {
    renderSection()
    await screen.findByText('2026-06')
    fireEvent.click(await screen.findByRole('button', { name: /editar período 2026-06/i }))
    fireEvent.change(screen.getByLabelText(/início do período 2026-06/i), { target: { value: '2026-06-05T08:15' } })
    fireEvent.change(screen.getByLabelText(/fim do período 2026-06/i), { target: { value: '2026-06-20T17:30' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/periods/p1', expect.objectContaining({ method: 'PATCH' })),
    )
    const body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/periods/p1' && c[1]?.method === 'PATCH')![1] as RequestInit).body as string)
    expect(body.startsAt).toBe('2026-06-05T08:15')
    expect(body.endsAt).toBe('2026-06-20T17:30')
  })

  it('gera imagem de um destaque em rascunho antes de publicar', async () => {
    let imageUrl: string | null = null
    let status = 'DRAFT'
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/admin/sectors' && !method) return Promise.resolve({ sectors: [] })
      if (path === '/admin/periods' && !method) {
        return Promise.resolve({
          periods: [{ id: 'ended-1', monthRef: '2026-05', startsAt: '2026-05-01T00:00:00.000Z', endsAt: '2026-05-31T23:59:59.000Z', status: 'CLOSED', state: 'ENDED', editable: false }],
        })
      }
      if (path === '/admin/periods/ended-1/highlight' && !method) {
        return Promise.resolve({
          highlight: { periodId: 'ended-1', monthRef: '2026-05', status, winner: null, winnerVotes: 3, text: 'Texto revisado', imageUrl },
        })
      }
      if (path === '/admin/periods/ended-1/highlight/image' && method === 'POST') {
        imageUrl = '/api/highlights/2026-05.png'
        return Promise.resolve({
          highlight: { periodId: 'ended-1', monthRef: '2026-05', status, winner: null, winnerVotes: 3, text: 'Texto revisado', imageUrl },
        })
      }
      if (path === '/admin/periods/ended-1/highlight/publish' && method === 'POST') {
        status = 'PUBLISHED'
        return Promise.resolve({
          highlight: { periodId: 'ended-1', monthRef: '2026-05', status, winner: null, winnerVotes: 3, text: 'Texto revisado', imageUrl },
        })
      }
      return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
    })

    renderSection()
    expect(await screen.findByDisplayValue('Texto revisado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Gerar imagem' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/periods/ended-1/highlight/image', expect.objectContaining({ method: 'POST' })),
    )
    expect(await screen.findByRole('link', { name: 'Baixar imagem' })).toHaveAttribute('href', '/api/highlights/2026-05.png')
    expect(screen.getByRole('img', { name: 'Imagem do destaque de 2026-05' })).toHaveAttribute('src', '/api/highlights/2026-05.png')
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/periods/ended-1/highlight/publish', expect.objectContaining({ method: 'POST' })),
    )
  })
})

describe('PeriodsSection — Subadmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
    mockAuth.role = 'SUBADMIN'
  })

  it('esconde o seletor de setor na criação e no filtro quando logado como Subadmin', async () => {
    renderSection()
    await screen.findByText('2026-06')
    fireEvent.click(screen.getByRole('button', { name: '+ Agendar período' }))
    expect(screen.queryByLabelText(/setor do período/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/filtrar períodos por setor/i)).not.toBeInTheDocument()
  })
})
