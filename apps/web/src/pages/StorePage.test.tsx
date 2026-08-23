import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { PublicUser } from '@legends/shared'
import { StorePage } from './StorePage'
import * as api from '../lib/api'

vi.mock('../lib/use-coins', async () => {
  const actual = await vi.importActual<typeof import('../lib/use-coins')>('../lib/use-coins')
  return { ...actual, useCoinBalance: () => ({ data: { balance: 150 }, isLoading: false }) }
})

let currentUser: Partial<PublicUser> = { id: 'u1', role: 'LEGEND', sectorFeatures: [] }
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, loading: false, login: vi.fn(), logout: vi.fn() }),
}))

/** Vitrine sem nenhum produto publicado — o estado de hoje. */
function mockEmptyStore() {
  vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
    if (path.startsWith('/store/products')) return { products: [] } as never
    if (path.startsWith('/store/orders')) return { orders: [], total: 0, page: 1, pageSize: 20 } as never
    if (path.startsWith('/me/coins/transactions')) {
      return { entries: [], total: 0, page: 1, pageSize: 30, balance: 150 } as never
    }
    throw new Error(`rota inesperada: ${path}`)
  })
}

const PRODUCTS = {
  products: [
    { id: 'p1', title: 'Fone', description: null, category: 'Equipamento', priceInCoins: 100,
      stock: 3, imageUrl: null, isDigital: false, isActive: true,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
    { id: 'p2', title: 'Day off', description: null, category: 'Experiência', priceInCoins: 500,
      stock: 1, imageUrl: null, isDigital: true, isActive: true,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
  ],
}

function renderPage(path = '/loja') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <StorePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  currentUser = { id: 'u1', role: 'LEGEND', sectorFeatures: [] }
  vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
    if (path.startsWith('/store/products')) return PRODUCTS as never
    if (path.startsWith('/store/orders')) return { orders: [], total: 0, page: 1, pageSize: 20 } as never
    throw new Error(`rota inesperada: ${path}`)
  })
})

describe('StorePage', () => {
  it('mostra o saldo em destaque e o aviso de que o XP não é debitado', async () => {
    renderPage()

    expect(await screen.findByText('Saldo atual')).toBeInTheDocument()
    expect(screen.getByText('150')).toBeInTheDocument()
    expect(
      screen.getByText(/XP do ranking permanece intacto/),
    ).toBeInTheDocument()
  })

  it('sem produto publicado, mostra a mensagem de expectativa com o saldo guardado', async () => {
    mockEmptyStore()
    renderPage()

    expect(await screen.findByText(/Preparando os melhores prêmios para você!/)).toBeInTheDocument()
    expect(screen.getByText(/Você já tem/)).toHaveTextContent('Você já tem 150 EMR Coins guardadas')
    expect(screen.getByRole('button', { name: /Vitrine em preparação/ })).toBeDisabled()
    // Colaborador não vê atalho de administração.
    expect(screen.queryByRole('link', { name: /painel administrativo/i })).toBeNull()
  })

  it('oferece o painel administrativo a quem administra Gente e Gestão', async () => {
    currentUser = { id: 'u2', role: 'ADMIN', sectorFeatures: [] }
    mockEmptyStore()
    renderPage()

    expect(await screen.findByRole('link', { name: /painel administrativo/i })).toHaveAttribute(
      'href',
      '/admin/loja',
    )
  })

  it('abre o extrato de coins pela URL', async () => {
    mockEmptyStore()
    renderPage('/loja?tab=extrato')

    expect(await screen.findByRole('heading', { name: 'Extrato' })).toBeInTheDocument()
    expect(await screen.findByText(/Nenhum lançamento ainda/)).toBeInTheDocument()
  })

  it('mostra os produtos da vitrine com preço em coins', async () => {
    renderPage()
    expect(await screen.findByText('Fone')).toBeInTheDocument()
    expect(screen.getByText('100 coins')).toBeInTheDocument()
  })

  it('desabilita o resgate quando o saldo não cobre o preço', async () => {
    renderPage()
    await screen.findByText('Day off')

    const botoes = screen.getAllByRole('button', { name: 'Resgatar' })
    expect(botoes[0]).toBeEnabled()   // Fone, 100 coins, saldo 150
    expect(botoes[1]).toBeDisabled()  // Day off, 500 coins
  })

  it('mostra a mensagem do backend quando o resgate falha', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.startsWith('/store/products')) return PRODUCTS as never
      if (path === '/store/orders' && options?.method === 'POST') {
        throw new Error('Saldo insuficiente para resgatar este produto.')
      }
      if (path.startsWith('/store/orders')) return { orders: [], total: 0, page: 1, pageSize: 20 } as never
      throw new Error(`rota inesperada: ${path}`)
    })

    renderPage()
    await screen.findByText('Fone')
    await userEvent.click(screen.getAllByRole('button', { name: 'Resgatar' })[0])
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar resgate' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Saldo insuficiente para resgatar este produto.',
      )
    })
  })
})
