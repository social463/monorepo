import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import type { PublicUser } from '@legends/shared'
import { EngagementPage } from './EngagementPage'
import { apiFetch } from '../lib/api'

let currentUser: Partial<PublicUser> = {}

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, loading: false, login: vi.fn(), logout: vi.fn() }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

function renderPage(initialPath = '/engajamento') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <EngagementPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EngagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentUser = { id: 'u1', name: 'Ana', role: 'LEGEND', enabledFeatures: [], sectorFeatures: ['selos'] }
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/badges') return Promise.resolve({ badges: [] })
      if (path.startsWith('/users/')) return Promise.resolve({ badges: [] })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
  })

  it('mostra a galeria de emblemas', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Engajamento' })).toBeInTheDocument()
    expect(mockApiFetch).toHaveBeenCalledWith('/badges')
  })

  // A aba de EMR Coins foi removida: as regras moram no Manual do Game e o
  // extrato, na Lojinha. Sem barra de abas, `?tab=coins` não ressuscita nada.
  it('não tem mais aba de coins, nem com ?tab=coins na URL', async () => {
    renderPage('/engajamento?tab=coins')

    await screen.findByRole('heading', { name: 'Engajamento' })
    expect(screen.queryByRole('tab')).toBeNull()
    expect(mockApiFetch).not.toHaveBeenCalledWith('/me/coins')
    expect(mockApiFetch).not.toHaveBeenCalledWith('/coins/rules')
  })
})
