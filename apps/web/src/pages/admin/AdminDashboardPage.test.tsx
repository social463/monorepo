import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { AdminDashboardPage } from './AdminDashboardPage'
import * as api from '../../lib/api'

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AdminDashboardPage', () => {
  it('mostra um card por setor com estado do período e alerta de destaque pendente', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      sectors: [
        {
          sectorId: 's1',
          sectorName: 'Desenvolvimento de Produto',
          activeUserCount: 10,
          period: { id: 'p1', monthRef: '2027-05', state: 'ACTIVE', startsAt: '2027-05-01T00:00:00.000Z', endsAt: '2027-05-31T23:59:59.000Z', votesCast: 3 },
          pendingHighlight: false,
        },
        {
          sectorId: 's2',
          sectorName: 'Comercial',
          activeUserCount: 4,
          period: null,
          pendingHighlight: true,
        },
      ],
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Desenvolvimento de Produto')).toBeInTheDocument())
    expect(screen.getByText('Comercial')).toBeInTheDocument()
    expect(screen.getByText(/3 votos/i)).toBeInTheDocument()
    expect(screen.getByText(/destaque pendente/i)).toBeInTheDocument()
    expect(screen.getByText('Ativo')).toBeInTheDocument()
    expect(screen.getByText(/sem período agendado ou ativo/i)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /ver períodos/i })).toHaveLength(2)
  })

  it('mostra badge "Agendado" para período SCHEDULED sem a linha de progresso de votos', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      sectors: [
        {
          sectorId: 's1',
          sectorName: 'Design',
          activeUserCount: 5,
          period: { id: 'p1', monthRef: '2027-06', state: 'SCHEDULED', startsAt: '2027-06-01T00:00:00.000Z', endsAt: '2027-06-30T23:59:59.000Z', votesCast: 0 },
          pendingHighlight: false,
        },
      ],
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Design')).toBeInTheDocument())
    expect(screen.getByText('Agendado')).toBeInTheDocument()
    expect(screen.queryByText(/votos de/i)).not.toBeInTheDocument()
  })

  it('mostra badge "Encerrado" para período ENDED sem a linha de progresso de votos', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      sectors: [
        {
          sectorId: 's1',
          sectorName: 'Operações',
          activeUserCount: 8,
          period: { id: 'p1', monthRef: '2027-04', state: 'ENDED', startsAt: '2027-04-01T00:00:00.000Z', endsAt: '2027-04-30T23:59:59.000Z', votesCast: 7 },
          pendingHighlight: false,
        },
      ],
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Operações')).toBeInTheDocument())
    expect(screen.getByText('Encerrado')).toBeInTheDocument()
    expect(screen.queryByText(/votos de/i)).not.toBeInTheDocument()
  })

  it('mostra estado de erro quando a requisição falha', async () => {
    vi.spyOn(api, 'apiFetch').mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(screen.getByText(/erro ao carregar o dashboard/i)).toBeInTheDocument())
  })

  it('mostra estado vazio quando não há setores', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ sectors: [] })
    renderPage()
    await waitFor(() => expect(screen.getByText(/nenhum setor cadastrado/i)).toBeInTheDocument())
  })
})
