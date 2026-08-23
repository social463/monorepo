import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { AdoptionOverviewDTO } from '@legends/shared'
import { AdoptionPage } from './AdoptionPage'

const overview: AdoptionOverviewDTO = {
  windowDays: 30,
  since: '2026-07-12T00:00:00.000Z',
  companies: [
    {
      companyId: 'c1',
      companyName: 'Empresa Ativa',
      active: true,
      activeUsers: 8,
      totalUsers: 10,
      totalEvents: 120,
      lastEventAt: '2026-08-11T10:00:00.000Z',
      sectors: [{ sectorId: 's1', sectorName: 'Engenharia', activeUsers: 5, totalEvents: 90 }],
      topEvents: [{ name: 'vote_cast', count: 60 }],
    },
    {
      companyId: 'c2',
      companyName: 'Empresa Parada',
      active: true,
      activeUsers: 0,
      totalUsers: 4,
      totalEvents: 0,
      lastEventAt: null,
      sectors: [],
      topEvents: [],
    },
  ],
}

vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: vi.fn(async () => overview),
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdoptionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AdoptionPage', () => {
  it('resume adoção e destaca quem não está usando', async () => {
    renderPage()

    expect(await screen.findByText('Empresa Ativa')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByText('Sem uso')).toBeInTheDocument()
    expect(
      screen.getByText('1 empresa ativa não registrou nenhum uso nesta janela.'),
    ).toBeInTheDocument()
    // Alcance: ativos sobre o total, para não premiar só a empresa maior.
    expect(screen.getByText('8/10 pessoas · 80%')).toBeInTheDocument()
  })

  it('abre o detalhe com setor e eventos, com rótulo em português', async () => {
    renderPage()
    const user = userEvent.setup()

    const botoes = await screen.findAllByRole('button', { name: 'Detalhar' })
    await user.click(botoes[0]!)

    await waitFor(() => expect(screen.getByText('Engenharia')).toBeInTheDocument())
    expect(screen.getByText('Voto')).toBeInTheDocument()
    expect(screen.queryByText('vote_cast')).not.toBeInTheDocument()
  })

  it('não deixa detalhar empresa sem uso', async () => {
    renderPage()

    const botoes = await screen.findAllByRole('button', { name: 'Detalhar' })
    expect(botoes[1]).toBeDisabled()
  })
})
