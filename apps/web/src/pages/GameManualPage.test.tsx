import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { GameManualPage } from './GameManualPage'
import { apiFetch } from '../lib/api'

const mockUseAuth = vi.fn()
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
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

/** Usuário com (ou sem) a feature de coins — é ela que abre a coluna de coins. */
function signIn(features: string[]) {
  mockUseAuth.mockReturnValue({
    user: { role: 'LEGEND', enabledFeatures: features, sectorFeatures: features },
  })
}

const BALANCE = {
  points: 1200,
  level: { name: 'Prata', color: '#5F6B7A', next: 'Ouro', min: 500, nextMin: 1500, remaining: 300, progress: 70 },
}

function respondWith(over: { xp?: unknown[]; coins?: unknown[]; balance?: unknown } = {}) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/xp/rules') {
      return Promise.resolve({
        rules: over.xp ?? [{ event: 'MOOD_ANSWERED', amount: 15, capWindow: 'DAY', capAmount: 15 }],
      })
    }
    if (path === '/coins/rules') {
      return Promise.resolve({
        rules: over.coins ?? [{ event: 'MOOD_ANSWERED', amount: 3, capWindow: 'NONE', capAmount: null }],
      })
    }
    return Promise.resolve(over.balance ?? BALANCE)
  })
}

describe('GameManualPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signIn(['coins'])
    respondWith()
  })

  it('explica a sequência ativa: dia útil, segunda chance e quando zera', async () => {
    wrap(<GameManualPage />)

    expect(await screen.findByRole('heading', { name: /sequência ativa \(streak\)/i })).toBeInTheDocument()
    expect(screen.getByText(/Finais de semana/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Segunda Chance' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Atenção!' })).toBeInTheDocument()
    expect(screen.getByText(/passar sem registro, o foguinho apaga/)).toBeInTheDocument()
  })

  it('marca as três seções do texto oficial', async () => {
    wrap(<GameManualPage />)

    expect(await screen.findByText('Seção 1')).toBeInTheDocument()
    expect(screen.getByText('Seção 2')).toBeInTheDocument()
    expect(screen.getByText('Seção 3')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /níveis & conquistas/i })).toBeInTheDocument()
  })

  it('mostra um card por ação, com o que ela rende nas duas moedas e o teto', async () => {
    wrap(<GameManualPage />)

    const card = (await screen.findByRole('heading', { name: 'Registrar o humor do dia' })).closest('div')!
    expect(within(card).getByText('+15')).toBeInTheDocument()
    expect(within(card).getByText('Até 15 por dia')).toBeInTheDocument()
    expect(within(card).getByText('+3')).toBeInTheDocument()
    expect(within(card).getByText('Sem limite')).toBeInTheDocument()
  })

  it('sem a feature de coins, o card mostra só os pontos', async () => {
    signIn([])
    wrap(<GameManualPage />)

    const card = (await screen.findByRole('heading', { name: 'Registrar o humor do dia' })).closest('div')!
    expect(within(card).getByText('+15')).toBeInTheDocument()
    expect(within(card).queryByText('EMR Coins')).not.toBeInTheDocument()
    // A regra de coins nem é buscada quando a empresa não tem a feature.
    expect(mockApiFetch).not.toHaveBeenCalledWith('/coins/rules')
  })

  it('mostra a faixa de cada nível e a barra de progresso para o próximo', async () => {
    wrap(<GameManualPage />)

    const bar = await screen.findByRole('progressbar', { name: /progresso para o próximo nível/i })

    expect(screen.getByText('Bronze')).toBeInTheDocument()
    expect(screen.getByText(/0 – 499/)).toBeInTheDocument()
    expect(screen.getByText(/7.500\+/)).toBeInTheDocument()
    expect(screen.getByText('Você está aqui')).toBeInTheDocument()
    expect(bar).toHaveAttribute('aria-valuenow', '70')
    expect(screen.getByText(/Faltam 300 pontos para o próximo nível/)).toBeInTheDocument()
  })

  it('mostra o nível Platina, incluído pelo Desenvolvimento de Produto', async () => {
    wrap(<GameManualPage />)

    expect(await screen.findByText('Platina')).toBeInTheDocument()
    expect(screen.getByText(/3.500 – 7.499/)).toBeInTheDocument()
  })

  it('sem nenhum ponto não afirma nível nenhum', async () => {
    respondWith({
      balance: {
        points: 0,
        level: { name: 'Bronze', color: '#8C5A2B', next: 'Prata', min: 0, nextMin: 500, remaining: 500, progress: 0 },
      },
    })
    wrap(<GameManualPage />)

    expect(await screen.findByText(/a partir do primeiro ponto ganho/i)).toBeInTheDocument()
    expect(screen.queryByText('Você está aqui')).not.toBeInTheDocument()
  })
})
