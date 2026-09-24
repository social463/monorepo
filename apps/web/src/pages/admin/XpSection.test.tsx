import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { XpSection } from './XpSection'
import { apiFetch } from '../../lib/api'

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

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/admin/xp/rules' && !method) return Promise.resolve({ rules: [RULE] })
    if (path === '/admin/xp/rules' && method === 'POST') return Promise.resolve({ rule: RULE })
    if (path.startsWith('/admin/xp/rules/') && method === 'PATCH') return Promise.resolve({ rule: RULE })
    return Promise.resolve({})
  })
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <XpSection />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('XpSection — regras de pontos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('edita valor e teto de uma regra existente (Documento 3, seção 5)', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))

    const amount = screen.getByLabelText('Pontos por ação')
    await userEvent.clear(amount)
    await userEvent.type(amount, '30')
    await userEvent.click(screen.getByRole('combobox', { name: 'Janela do teto' }))
    await userEvent.click(await screen.findByRole('option', { name: /dia/i }))
    await userEvent.type(screen.getByLabelText('Teto da janela'), '90')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/xp/rules/r1', {
        method: 'PATCH',
        body: JSON.stringify({ amount: 30, capWindow: 'DAY', capAmount: 90 }),
      }),
    )
  })

  it('teto some do payload quando a janela volta a ser "sem teto"', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))

    // `capAmount` com `capWindow: NONE` seria um limite que nunca é contado —
    // a API recusa, então a tela nem manda.
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/xp/rules/r1', {
        method: 'PATCH',
        body: JSON.stringify({ amount: 50, capWindow: 'NONE', capAmount: null }),
      }),
    )
  })

  it('criar continua funcionando, e só a criação escolhe o evento', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: /adicionar regra/i }))

    expect(screen.getByRole('combobox', { name: /evento/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('combobox', { name: /evento/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'Publicar um feedback' }))
    const amount = screen.getByLabelText('Pontos por ação')
    await userEvent.clear(amount)
    await userEvent.type(amount, '15')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/xp/rules', {
        method: 'POST',
        body: JSON.stringify({ event: 'FEEDBACK_PUBLISHED', amount: 15, capWindow: 'NONE', capAmount: null }),
      }),
    )
  })
})
