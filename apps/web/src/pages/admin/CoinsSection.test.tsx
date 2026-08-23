import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { CoinsSection } from './CoinsSection'
import { apiFetch, ApiError } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

const RULE = {
  id: 'r1',
  event: 'VOTE_CAST',
  amount: 50,
  capWindow: 'NONE',
  capAmount: null,
  active: true,
  createdAt: '2026-07-30T10:00:00.000Z',
  updatedAt: '2026-07-30T10:00:00.000Z',
}

function setupFetch(overrides: Record<string, unknown> = {}) {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/admin/coins/rules' && !method) return Promise.resolve({ rules: [RULE] })
    if (path === '/admin/coins/rules' && method === 'POST') return Promise.resolve({ rule: RULE })
    if (path === '/admin/users' && !method) {
      return Promise.resolve({ users: [{ id: 'u1', name: 'Ana', email: 'ana@x.com' }] })
    }
    if (path === '/admin/sectors' && !method) return Promise.resolve({ sectors: [] })
    if (path === '/admin/users/u1/coins' && !method) return Promise.resolve({ balance: 30, user: { id: 'u1', name: 'Ana' } })
    if (path.startsWith('/admin/users/u1/coins/transactions')) {
      return Promise.resolve({ entries: [], total: 0, page: 1, pageSize: 30, balance: 30 })
    }
    if (path.startsWith('/admin/users/u1/coins/adjustments')) {
      if (overrides.adjustmentError) return Promise.reject(overrides.adjustmentError)
      return Promise.resolve({ transaction: {}, balance: 40 })
    }
    if (path.startsWith('/admin/coins/report')) {
      return Promise.resolve({
        rows: [
          { event: 'VOTE_CAST', ruleId: 'r1', amount: 50, totalAmount: 150, transactionCount: 3, userCount: 2 },
        ],
        manual: { creditedAmount: 10, debitedAmount: -5, transactionCount: 2 },
        totalAmount: 155,
        from: null,
        to: null,
        sectorId: null,
      })
    }
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CoinsSection />
    </QueryClientProvider>,
  )
}

describe('CoinsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('lista as regras existentes e o relatório', async () => {
    renderSection()
    expect(await screen.findByText('Votar no período')).toBeInTheDocument()
    expect(screen.getByText(/\+50 · Sem teto · ativa/)).toBeInTheDocument()
    expect(await screen.findByText(/3 lançamentos · 2 pessoas/)).toBeInTheDocument()
    expect(screen.getByText(/total distribuído: 155/)).toBeInTheDocument()
  })

  it('cria regra mandando evento, valor e teto', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: /adicionar regra/i }))

    await userEvent.click(screen.getByRole('combobox', { name: /evento/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'Publicar um feedback' }))

    const amount = screen.getByLabelText('Coins por ação')
    await userEvent.clear(amount)
    await userEvent.type(amount, '20')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/coins/rules', {
        method: 'POST',
        body: JSON.stringify({ event: 'FEEDBACK_PUBLISHED', amount: 20, capWindow: 'NONE', capAmount: null }),
      }),
    )
  })

  it('esconde do seletor os eventos que já têm regra', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: /adicionar regra/i }))
    await userEvent.click(screen.getByRole('combobox', { name: /evento/i }))

    expect(await screen.findByRole('option', { name: 'Publicar um feedback' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Votar no período' })).toBeNull()
  })

  it('mostra o saldo do colaborador escolhido e a mensagem de saldo insuficiente', async () => {
    setupFetch({ adjustmentError: new ApiError(409, 'Saldo insuficiente: o colaborador tem 30 EMR Coins disponíveis.') })
    renderSection()

    await userEvent.click(await screen.findByRole('combobox', { name: /colaborador/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'Ana' }))

    expect(await screen.findByText(/🪙 30/)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Valor do ajuste'), '-40')
    await userEvent.type(screen.getByLabelText('Justificativa'), 'estorno')
    await userEvent.click(screen.getByRole('button', { name: /lançar ajuste/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Saldo insuficiente')
  })
})
