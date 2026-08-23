import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { HomeProfileCard } from './HomeProfileCard'
import { ApiError, apiFetch } from '../lib/api'

const mockUseAuth = vi.fn()
vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    name: 'Ana Souza',
    role: 'LEGEND',
    position: 'Product Designer',
    squad: null,
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    active: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    enabledFeatures: [],
    sectorFeatures: ['coins', 'selos'],
    ...overrides,
  }
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const LEVEL = { name: 'Prata', color: '#5F6B7A', next: 'Ouro', min: 500, nextMin: 1500, remaining: 300, progress: 70 }

describe('HomeProfileCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: user(), loading: false })
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/me/xp') return Promise.resolve({ points: 1200, level: LEVEL })
      if (path === '/me/coins') return Promise.resolve({ balance: 340 })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [] })
      return Promise.resolve({})
    })
  })

  it('mostra nome, cargo, nível e progresso', async () => {
    wrap(<HomeProfileCard />)
    expect(screen.getByText('Ana Souza')).toBeInTheDocument()
    expect(screen.getByText('Product Designer')).toBeInTheDocument()
    expect(await screen.findByText('Prata')).toBeInTheDocument()
    expect(await screen.findByText(/faltam 300 pontos para ouro/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70')
  })

  // Um "Bronze 0%" permanente não é progressão: é um lembrete de que a pessoa
  // não fez nada, ocupando o bloco mais alto do card.
  it('não mostra nível para quem ainda não pontuou', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/me/xp')
        return Promise.resolve({
          points: 0,
          level: { name: 'Bronze', color: '#8C5A2B', next: 'Prata', min: 0, nextMin: 500, remaining: 500, progress: 0 },
        })
      if (path === '/me/coins') return Promise.resolve({ balance: 0 })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [] })
      return Promise.resolve({})
    })
    wrap(<HomeProfileCard />)

    // `waitFor`, e não uma âncora: enquanto a carteira carrega, a seção mostra
    // o esqueleto (que não afirma nível nenhum) — o que precisa sumir é o
    // bloco depois que o total chega.
    await waitFor(() => expect(screen.queryByText('Nível')).not.toBeInTheDocument())
    expect(screen.queryByText('Bronze')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    // O resto do card continua de pé.
    expect(screen.getByText('Ana Souza')).toBeInTheDocument()
    expect(screen.getByText('Pontos')).toBeInTheDocument()
  })

  it('volta a mostrar o nível no primeiro ponto ganho', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/me/xp')
        return Promise.resolve({
          points: 1,
          level: { name: 'Bronze', color: '#8C5A2B', next: 'Prata', min: 0, nextMin: 500, remaining: 499, progress: 0 },
        })
      if (path === '/me/coins') return Promise.resolve({ balance: 0 })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [] })
      return Promise.resolve({})
    })
    wrap(<HomeProfileCard />)
    expect(await screen.findByText('Bronze')).toBeInTheDocument()
  })

  // A cor é do metal, não da marca: um tenant verde não deixa o Prata verde.
  it('pinta o bloco do nível com a cor que vem do nível', async () => {
    wrap(<HomeProfileCard />)
    const nome = await screen.findByText('Prata')
    expect(nome.closest('div[style]')).toHaveStyle({ backgroundColor: '#5F6B7A' })
  })

  it('mostra a carteira com as duas moedas', async () => {
    wrap(<HomeProfileCard />)
    expect(await screen.findByText('1.200')).toBeInTheDocument()
    expect(await screen.findByText('340')).toBeInTheDocument()
  })

  // Sem a feature não há Lojinha nem saldo: um "0" permanente pareceria bug.
  it('esconde os coins de quem não tem a feature', async () => {
    mockUseAuth.mockReturnValue({ user: user({ sectorFeatures: ['selos'] }), loading: false })
    wrap(<HomeProfileCard />)
    expect(await screen.findByText('1.200')).toBeInTheDocument()
    expect(screen.queryByText('EMR Coins')).not.toBeInTheDocument()
    expect(mockApiFetch).not.toHaveBeenCalledWith('/me/coins')
  })

  /**
   * A feature viaja no JWT: quem estava logado quando o admin desligou coins
   * segue com ela no token por até 15 minutos. A API recusa o saldo e o
   * ladrilho ficava na tela com um travessão — "EMR COINS —".
   */
  it('some com os coins quando a API recusa o saldo, em vez de mostrar travessão', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/me/xp') return Promise.resolve({ points: 1200, level: LEVEL })
      if (path === '/me/coins') return Promise.reject(new ApiError(403, 'Recurso indisponível.'))
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [] })
      return Promise.reject(new Error(`unexpected ${path}`))
    })

    wrap(<HomeProfileCard />)

    expect(await screen.findByText('1.200')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('EMR Coins')).not.toBeInTheDocument())
  })

  it('mostra só os 4 primeiros emblemas, com link para ver todos', async () => {
    const badges = Array.from({ length: 7 }, (_, index) => ({
      id: `ub${index}`,
      badge: { slug: `s${index}`, name: `Selo ${index}`, iconKey: 'star', kind: 'IMPACT' },
      awardedAt: '2026-08-01T00:00:00.000Z',
      source: 'AUTOMATIC',
      awardedBy: null,
      featured: false,
    }))
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/me/xp') return Promise.resolve({ points: 1200, level: LEVEL })
      if (path === '/me/coins') return Promise.resolve({ balance: 340 })
      if (path === '/users/u1/badges') return Promise.resolve({ badges })
      return Promise.resolve({})
    })

    wrap(<HomeProfileCard />)
    const verTodos = await screen.findByRole('link', { name: /ver todos \(7\)/i })
    expect(verTodos).toHaveAttribute('href', '/engajamento')
    const preview = await screen.findByTestId('home-badge-preview')
    expect(within(preview).getAllByRole('listitem')).toHaveLength(4)
  })

  it('sem emblema nenhum explica em vez de mostrar lista vazia', async () => {
    wrap(<HomeProfileCard />)
    expect(await screen.findByText(/nenhum emblema ainda/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /ver todos/i })).not.toBeInTheDocument()
  })
})
