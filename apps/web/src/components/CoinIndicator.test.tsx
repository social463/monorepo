import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CoinIndicator } from './CoinIndicator'
import * as api from '../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function mockApi() {
  return vi.spyOn(api, 'apiFetch').mockImplementation((path: string) => {
    if (path === '/me/coins') return Promise.resolve({ balance: 120 } as never)
    if (path === '/coins/rules') {
      return Promise.resolve({
        rules: [{ event: 'MOOD_ANSWERED', amount: 10, capWindow: 'NONE', capAmount: null }],
      } as never)
    }
    if (path.startsWith('/me/coins/transactions')) {
      return Promise.resolve({
        entries: [
          {
            id: 't1',
            kind: 'EARN',
            event: 'MOOD_ANSWERED',
            amount: 10,
            reason: null,
            actor: null,
            day: '2026-07-30',
            createdAt: '2026-07-30T12:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 30,
        balance: 120,
      } as never)
    }
    return Promise.reject(new Error(`unexpected ${path}`))
  })
}

describe('CoinIndicator', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('mostra o saldo', async () => {
    mockApi()
    wrap(<CoinIndicator />)
    expect(await screen.findByText('120')).toBeInTheDocument()
  })

  it('não renderiza nada quando a query falha', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockRejectedValue(new Error('boom'))
    const { container } = wrap(<CoinIndicator />)
    await waitFor(() => expect(spy).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('abre o painel no clique, com os últimos lançamentos e os links, e fecha no Escape', async () => {
    mockApi()
    wrap(<CoinIndicator />)

    await userEvent.click(await screen.findByRole('button', { name: 'EMR Coins' }))
    const panel = await screen.findByRole('dialog', { name: 'EMR Coins' })
    expect(panel).toBeInTheDocument()
    // O último lançamento aparece; a lista de regras não, ela mora no manual.
    expect(await screen.findByText('Registrar o humor do dia')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /como ganhar emr coins/i })).toHaveAttribute(
      'href',
      '/manual-game',
    )
    expect(screen.getByRole('link', { name: /ver extrato completo/i })).toHaveAttribute(
      'href',
      '/loja?tab=extrato',
    )

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('não busca as regras de coins para montar o painel', async () => {
    const spy = mockApi()
    wrap(<CoinIndicator />)

    await userEvent.click(await screen.findByRole('button', { name: 'EMR Coins' }))
    await screen.findByRole('dialog', { name: 'EMR Coins' })
    expect(spy).not.toHaveBeenCalledWith('/coins/rules')
  })
})
