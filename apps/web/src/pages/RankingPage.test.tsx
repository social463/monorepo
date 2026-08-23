import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { RankingPage } from './RankingPage'
import { apiFetch } from '../lib/api'

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

function user(id: string, name: string, sectorName = 'Desenvolvimento de Produto') {
  return {
    id,
    name,
    email: null,
    role: 'LEGEND',
    area: null,
    position: null,
    squad: null,
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    active: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    leftAt: null,
    sectorId: 's1',
    sectorName,
    companyId: 'company-emr',
    companyName: null,
    enabledFeatures: [],
    sectorFeatures: [],
    adminAccess: false,
  }
}

function pointsEntry(id: string, name: string, position: number, points: number, online = false) {
  return {
    position,
    points,
    online,
    level: { name: 'Prata', color: '#5F6B7A', next: 'Ouro', min: 500, nextMin: 1500, remaining: 100, progress: 40 },
    user: user(id, name),
  }
}

const POINTS_RESPONSE = {
  entries: [
    pointsEntry('u1', 'Ana Primeira', 1, 900, true),
    pointsEntry('u2', 'Bruno Segundo', 2, 700),
    pointsEntry('u3', 'Carla Terceira', 3, 500),
    pointsEntry('u4', 'Diego Quarto', 4, 100),
  ],
  total: 4,
  me: { position: 4, points: 100 },
}

const STREAK_RESPONSE = {
  entries: [
    { position: 1, currentStreak: 7, bestStreak: 9, online: true, user: user('u1', 'Ana Primeira') },
    { position: 2, currentStreak: 0, bestStreak: 3, online: false, user: user('u2', 'Bruno Segundo') },
  ],
  total: 2,
  me: { position: 2, currentStreak: 0 },
}

function wrap(initialPath = '/ranking') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <RankingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RankingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: { id: 'u4', name: 'Diego Quarto' } })
    mockApiFetch.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/ranking/streaks') ? STREAK_RESPONSE : POINTS_RESPONSE),
    )
  })

  it('abre no ranking geral com pódio, tabela e a posição de quem está olhando', async () => {
    wrap()
    expect(await screen.findAllByText('Ana Primeira')).not.toHaveLength(0)

    // Pódio: os três primeiros aparecem também fora da tabela.
    expect(screen.getAllByText('900 pts')).toHaveLength(1)
    expect(screen.getByText(/Sua posição/)).toBeInTheDocument()
    expect(screen.getByText('4º')).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getByText('Diego Quarto')).toBeInTheDocument()
    expect(within(table).getByText('(você)')).toBeInTheDocument()
  })

  it('mostra o status de presença de cada participante', async () => {
    wrap()
    await screen.findAllByText('Ana Primeira')
    expect(screen.getAllByLabelText('On-line na plataforma').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('Inativo').length).toBeGreaterThan(0)
  })

  it('filtra a tabela pelo nome', async () => {
    wrap()
    await screen.findAllByText('Ana Primeira')

    await userEvent.type(screen.getByRole('searchbox'), 'bruno')

    const table = screen.getByRole('table')
    expect(within(table).getByText('Bruno Segundo')).toBeInTheDocument()
    expect(within(table).queryByText('Diego Quarto')).not.toBeInTheDocument()
  })

  it('pagina no cliente sem refazer a busca no servidor', async () => {
    wrap()
    await screen.findAllByText('Ana Primeira')
    mockApiFetch.mockClear()

    await userEvent.selectOptions(screen.getByRole('combobox'), '10')
    expect(screen.getByText('1–4 de 4')).toBeInTheDocument()
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('troca para a aba de consistência e busca o outro ranking', async () => {
    wrap()
    await screen.findAllByText('Ana Primeira')

    await userEvent.click(screen.getByRole('tab', { name: 'Consistência' }))

    expect(await screen.findByText(/Dias/)).toBeInTheDocument()
    expect(mockApiFetch).toHaveBeenCalledWith('/ranking/streaks')
    const table = screen.getByRole('table')
    expect(within(table).getByText('9')).toBeInTheDocument() // maior sequência
  })

  it('abre direto na aba pedida pela URL', async () => {
    wrap('/ranking?aba=consistencia')
    expect(await screen.findByText(/Dias/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Consistência' })).toHaveAttribute('aria-selected', 'true')
  })

  it('avisa quando o ranking não carrega, em vez de mostrar tabela vazia', async () => {
    mockApiFetch.mockRejectedValue(new Error('falhou'))
    wrap()
    expect(await screen.findByText(/Não foi possível carregar o ranking/)).toBeInTheDocument()
  })
})
