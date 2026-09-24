import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { WorkAnniversariesCard } from './WorkAnniversariesCard'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

// O card consulta quem está logado para decidir se mostra o botão de parabéns
// (a mesma regra do `FeedbackComposer`): sem ADMIN e sem si mesmo.
const mockAuth = vi.hoisted(() => ({ user: { id: 'viewer', role: 'LEGEND' } as { id: string; role: string } | null }))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: mockAuth.user }) }))

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function anniversary(id: string, name: string, years: number, daysUntil: number, observedDate: string) {
  return {
    user: { id, name, position: 'PM', avatarStyle: null, avatarSeed: null, avatarOptions: null, photoUrl: null },
    day: Number(observedDate.slice(8, 10)),
    month: Number(observedDate.slice(5, 7)),
    years,
    daysUntil,
    observedDate,
  }
}

/** Resposta de /celebrations com só os aniversários de casa (upcoming) preenchidos. */
function response(upcoming: unknown[], month: unknown[] = []) {
  return {
    referenceDay: '2026-07-30',
    birthdays: { month: [], upcoming: [] },
    workAnniversaries: { month, upcoming },
  }
}

describe('WorkAnniversariesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mostra os próximos aniversários de casa, com o plural correto e destaque "Hoje"', async () => {
    mockApiFetch.mockResolvedValue(
      response([
        anniversary('u1', 'Diego Barreto', 3, 0, '2026-07-30'),
        anniversary('u2', 'Ana Lima', 1, 0, '2026-07-30'),
      ]),
    )

    wrap(<WorkAnniversariesCard />)

    expect(await screen.findByText('Diego Barreto')).toBeInTheDocument()
    expect(screen.getByText('3 anos de casa')).toBeInTheDocument()
    expect(screen.getByText('Ana Lima')).toBeInTheDocument()
    expect(screen.getByText('1 ano de casa')).toBeInTheDocument()
    expect(screen.getAllByText('Hoje')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /ver todos os aniversários/i })).toHaveAttribute(
      'href',
      '/aniversariantes?aba=tempo-de-casa',
    )
  })

  // Igual ao card de aniversário: só o botão de festa, apontando para o mural.
  it('leva ao mural de aniversário do perfil ao clicar no botão de festa', async () => {
    mockApiFetch.mockResolvedValue(response([anniversary('u1', 'Diego Barreto', 3, 0, '2026-07-30')]))

    wrap(<WorkAnniversariesCard />)

    expect(await screen.findByText('Diego Barreto')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /dê os parabéns a Diego Barreto/i })).toHaveAttribute(
      'href',
      '/perfil/u1?parabens=1',
    )
    expect(screen.queryByRole('link', { name: /deixe um feedback/i })).not.toBeInTheDocument()
  })

  it('mostra todo mundo das próximas datas, sem cortar por pessoa', async () => {
    mockApiFetch.mockResolvedValue(
      response([
        anniversary('u1', 'Ana', 2, 0, '2026-07-30'),
        anniversary('u2', 'Bruno', 2, 0, '2026-07-30'),
        anniversary('u3', 'Carla', 2, 0, '2026-07-30'),
      ]),
    )

    wrap(<WorkAnniversariesCard />)

    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Bruno')).toBeInTheDocument()
    expect(screen.getByText('Carla')).toBeInTheDocument()
  })

  it('mostra data futura com rótulo "Em N dias" e a data absoluta', async () => {
    mockApiFetch.mockResolvedValue(response([anniversary('u1', 'Futura', 4, 12, '2026-08-11')]))

    wrap(<WorkAnniversariesCard />)

    expect(await screen.findByText('Em 12 dias · 11/08/2026')).toBeInTheDocument()
  })

  it('mostra estado vazio quando não há próximo aniversário de casa, mantendo o link', async () => {
    mockApiFetch.mockResolvedValue(response([], [anniversary('u1', 'Ana', 2, 0, '2026-07-12')]))

    wrap(<WorkAnniversariesCard />)

    expect(await screen.findByText(/nenhum aniversário de casa chegando por aqui/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver todos os aniversários/i })).toBeInTheDocument()
  })

  it('não renderiza nada quando a chamada falha', async () => {
    mockApiFetch.mockRejectedValue(new Error('boom'))

    wrap(<WorkAnniversariesCard />)

    await vi.waitFor(() => {
      expect(screen.queryByTestId('work-anniversaries-card')).toBeNull()
    })
    expect(screen.queryByText(/próximos aniversários de empresa/i)).toBeNull()
  })
})
