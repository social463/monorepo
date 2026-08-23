import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { BirthdayConfetti } from './BirthdayConfetti'
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
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

function publicUser(id: string) {
  return {
    id,
    name: 'Aniversariante',
    position: null,
    sectorName: undefined,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    photoUrl: null,
  }
}

/** Resposta de /celebrations com uma única entrada em birthdays.upcoming. */
function response(userId: string, daysUntil: number) {
  return {
    referenceDay: '2026-07-15',
    birthdays: {
      month: [],
      upcoming: [{ user: publicUser(userId), day: 15, month: 7, daysUntil, observedDate: '2026-07-15' }],
    },
    workAnniversaries: { month: [], upcoming: [] },
  }
}

describe('BirthdayConfetti', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockUseAuth.mockReturnValue({ user: publicUser('u1') })
  })

  it('dispara quando hoje é o aniversário de nascimento do próprio usuário', async () => {
    mockApiFetch.mockResolvedValue(response('u1', 0))

    wrap(<BirthdayConfetti />)

    expect(await screen.findByTestId('birthday-confetti')).toBeInTheDocument()
    // Marca como já mostrado hoje, pra não repetir numa próxima navegação.
    expect(localStorage.getItem('legends:confetti-shown:u1:u1:2026-07-15')).toBe('1')
  })

  it('não dispara para aniversário de outra pessoa', async () => {
    mockApiFetch.mockResolvedValue(response('outro-usuario', 0))

    wrap(<BirthdayConfetti />)

    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    expect(screen.queryByTestId('birthday-confetti')).toBeNull()
  })

  it('não dispara se a data ainda não chegou (daysUntil > 0)', async () => {
    mockApiFetch.mockResolvedValue(response('u1', 1))

    wrap(<BirthdayConfetti />)

    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    expect(screen.queryByTestId('birthday-confetti')).toBeNull()
  })

  it('não dispara de novo no mesmo dia civil', async () => {
    localStorage.setItem('legends:confetti-shown:u1:u1:2026-07-15', '1')
    mockApiFetch.mockResolvedValue(response('u1', 0))

    wrap(<BirthdayConfetti />)

    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    expect(screen.queryByTestId('birthday-confetti')).toBeNull()
  })

  it('dispara para o aniversário de um colega quando targetUserId é o dele (ex.: ao abrir o perfil dele)', async () => {
    mockApiFetch.mockResolvedValue(response('colega-id', 0))

    wrap(<BirthdayConfetti targetUserId="colega-id" />)

    expect(await screen.findByTestId('birthday-confetti')).toBeInTheDocument()
    expect(localStorage.getItem('legends:confetti-shown:u1:colega-id:2026-07-15')).toBe('1')
  })

  it('com once=false (perfil), dispara mesmo já tendo comemorado antes no mesmo dia', async () => {
    localStorage.setItem('legends:confetti-shown:u1:colega-id:2026-07-15', '1')
    mockApiFetch.mockResolvedValue(response('colega-id', 0))

    wrap(<BirthdayConfetti targetUserId="colega-id" once={false} />)

    expect(await screen.findByTestId('birthday-confetti')).toBeInTheDocument()
    // Não persiste: não é "uma vez por dia", é a cada visita ao perfil.
    expect(localStorage.getItem('legends:confetti-shown:u1:colega-id:2026-07-15')).toBe('1')
  })

  it('não dispara sem usuário logado', async () => {
    mockUseAuth.mockReturnValue({ user: null })
    mockApiFetch.mockResolvedValue(response('u1', 0))

    wrap(<BirthdayConfetti />)

    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    expect(screen.queryByTestId('birthday-confetti')).toBeNull()
  })
})
