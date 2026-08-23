import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { BirthdaysCard } from './BirthdaysCard'
import { apiFetch } from '../lib/api'

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

function birthday(
  id: string,
  name: string,
  daysUntil: number,
  observedDate: string,
  position: string | null = 'Consultor',
  sectorName?: string,
) {
  return {
    user: { id, name, position, sectorName, avatarStyle: null, avatarSeed: null, avatarOptions: null, photoUrl: null },
    day: Number(observedDate.slice(8, 10)),
    month: Number(observedDate.slice(5, 7)),
    daysUntil,
    observedDate,
  }
}

/** Resposta de /celebrations com só os aniversários (upcoming) preenchidos. */
function response(upcoming: unknown[], month: unknown[] = []) {
  return {
    referenceDay: '2026-07-30',
    birthdays: { month, upcoming },
    workAnniversaries: { month: [], upcoming: [] },
  }
}

describe('BirthdaysCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mostra o próximo aniversariante com setor, destaque "Hoje" e link pro calendário', async () => {
    mockApiFetch.mockResolvedValue(
      response([birthday('u1', 'Heitor Albanez', 0, '2026-07-30', 'Consultor', 'Operações')]),
    )

    wrap(<BirthdaysCard />)

    expect(await screen.findByText('Heitor Albanez')).toBeInTheDocument()
    expect(screen.getByText('Operações')).toBeInTheDocument()
    expect(screen.getByText('Hoje')).toBeInTheDocument()
    // No chip "Hoje" a data absoluta some: seria a mesma informação duas vezes.
    expect(screen.queryByText(/30\/07\/2026/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver todos os aniversários/i })).toHaveAttribute(
      'href',
      '/aniversariantes',
    )
  })

  it('leva pro perfil da pessoa ao clicar em "Deixe um feedback"', async () => {
    mockApiFetch.mockResolvedValue(response([birthday('u1', 'Heitor Albanez', 0, '2026-07-30')]))

    wrap(<BirthdaysCard />)

    expect(await screen.findByText('Heitor Albanez')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /deixe um feedback/i })).toHaveAttribute('href', '/perfil/u1')
  })

  it('mostra "Amanhã" e "Em N dias" para datas futuras', async () => {
    mockApiFetch.mockResolvedValue(
      response([
        birthday('u1', 'Amanhã Pessoa', 1, '2026-07-31'),
        birthday('u2', 'Daqui A Pouco', 5, '2026-08-04'),
      ]),
    )

    wrap(<BirthdaysCard />)

    expect(await screen.findByText(/^Amanhã · /)).toBeInTheDocument()
    expect(screen.getByText(/^Em 5 dias · /)).toBeInTheDocument()
  })

  // A lista é da empresa toda: o setor é o que diferencia colegas de outros times.
  // O cargo não aparece aqui (só no perfil) — a lista fica menos poluída.
  it('mostra só o setor como subtítulo, sem o cargo', async () => {
    mockApiFetch.mockResolvedValue(
      response([
        birthday('u1', 'Heitor Albanez', 0, '2026-07-30', 'Consultor', 'Operações'),
        birthday('u2', 'Ana Prado', 0, '2026-07-30', null, 'Gente e Gestão'),
      ]),
    )

    wrap(<BirthdaysCard />)

    expect(await screen.findByText('Operações')).toBeInTheDocument()
    expect(screen.getByText('Gente e Gestão')).toBeInTheDocument()
    expect(screen.queryByText('Consultor')).toBeNull()
    expect(screen.queryByText(/consultor · operações/i)).toBeNull()
  })

  it('mostra todo mundo das próximas datas, sem cortar por pessoa', async () => {
    mockApiFetch.mockResolvedValue(
      response([
        birthday('u1', 'Ana', 0, '2026-07-30'),
        birthday('u2', 'Bruno', 0, '2026-07-30'),
        birthday('u3', 'Carla', 0, '2026-07-30'),
        birthday('u4', 'Duda', 0, '2026-07-30'),
      ]),
    )

    wrap(<BirthdaysCard />)

    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Bruno')).toBeInTheDocument()
    expect(screen.getByText('Carla')).toBeInTheDocument()
    expect(screen.getByText('Duda')).toBeInTheDocument()
  })

  it('mostra estado vazio quando não há próximo aniversariante, mantendo o link', async () => {
    mockApiFetch.mockResolvedValue(response([], [birthday('u1', 'Ana', 0, '2026-07-12')]))

    wrap(<BirthdaysCard />)

    expect(await screen.findByText(/nenhum aniversário chegando por aqui/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver todos os aniversários/i })).toBeInTheDocument()
  })

  it('não renderiza nada quando a chamada falha', async () => {
    mockApiFetch.mockRejectedValue(new Error('boom'))

    wrap(<BirthdaysCard />)

    await vi.waitFor(() => {
      expect(screen.queryByTestId('birthdays-card')).toBeNull()
    })
    expect(screen.queryByText(/próximos aniversariantes/i)).toBeNull()
  })
})
