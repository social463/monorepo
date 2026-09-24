import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { MyStatsCard } from './MyStatsCard'
import { apiFetch } from '../lib/api'

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Ana Silva', role: 'LEGEND', joinedAt: '2023-06-01T00:00:00.000Z' },
  }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function badge(slug: string, name: string, current: number, target: number, kind = 'IMPACT'): unknown {
  return {
    id: slug, slug, name, description: 'd', kind, iconKey: 'k',
    threshold: target, categorySlug: null, badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null, requirement: 'r',
    progress: { current, target },
  }
}

describe('MyStatsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mostra contagem de selos, anos de casa e top-3 por progresso', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/badges')
        return Promise.resolve({
          badges: [
            badge('a', 'Quase lá', 4, 5),    // 80%
            badge('b', 'No meio', 5, 10),     // 50%
            badge('c', 'Começando', 1, 10),   // 10%
            badge('d', 'Bem baixo', 1, 100),  // 1% — fica de fora do top-3
            badge('earned', 'Conquistado', 5, 5),
          ],
        })
      if (path === '/users/u1/badges')
        return Promise.resolve({ badges: [{ badge: { slug: 'earned' } }, { badge: { slug: 'x2' } }] })
      throw new Error(`unexpected ${path}`)
    })

    wrap(<MyStatsCard />)

    // 2 selos conquistados.
    expect(await screen.findByText('2')).toBeInTheDocument()
    // joinedAt 2023-06 → em 2026-06 = 3 anos.
    expect(screen.getByText(/3 anos de casa/i)).toBeInTheDocument()
    // Top-3 por progresso; o de 1% e o conquistado ficam de fora.
    expect(await screen.findByText('Quase lá')).toBeInTheDocument()
    expect(screen.getByText('No meio')).toBeInTheDocument()
    expect(screen.getByText('Começando')).toBeInTheDocument()
    expect(screen.queryByText('Bem baixo')).toBeNull()
    expect(screen.queryByText('Conquistado')).toBeNull()
    // Link para a galeria.
    expect(screen.getByRole('link', { name: /ver galeria completa/i })).toHaveAttribute('href', '/selos')
  })

  it('mostra só o próximo marco de tempo de casa, não a escada inteira', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/badges')
        return Promise.resolve({
          badges: [
            badge('t4', '4 anos de casa', 3, 4, 'TENURE'),
            badge('t5', '5 anos de casa', 3, 5, 'TENURE'),
            badge('t6', '6 anos de casa', 3, 6, 'TENURE'),
            badge('imp', 'Incansável', 5, 10, 'IMPACT'),
          ],
        })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [] })
      throw new Error(`unexpected ${path}`)
    })

    wrap(<MyStatsCard />)

    // Só o marco mais próximo (4 anos) aparece; 5 e 6 ficam de fora na Home.
    expect(await screen.findByText('4 anos de casa')).toBeInTheDocument()
    expect(screen.queryByText('5 anos de casa')).toBeNull()
    expect(screen.queryByText('6 anos de casa')).toBeNull()
    // Selos de outros tipos seguem normalmente.
    expect(screen.getByText('Incansável')).toBeInTheDocument()
  })

  it('esconde "Próximos selos" quando não há selos em progresso', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/badges') return Promise.resolve({ badges: [badge('earned', 'Conquistado', 5, 5)] })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [{ badge: { slug: 'earned' } }] })
      throw new Error(`unexpected ${path}`)
    })
    wrap(<MyStatsCard />)
    expect(await screen.findByText('1')).toBeInTheDocument()
    expect(screen.queryByText(/próximos selos/i)).toBeNull()
  })
})
