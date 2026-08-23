import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { BirthdaysPage } from './BirthdaysPage'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function wrap(ui: ReactNode, path = '/aniversariantes') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const TODAY = new Date(2026, 7, 12) // 12/08/2026
const REFERENCE_DAY = '2026-08-12'

function user(id: string, name: string, sectorName = 'Operações') {
  return {
    id,
    name,
    sectorName,
    position: 'Consultor',
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
  }
}

function entry(id: string, name: string, day: number, extra: Record<string, unknown> = {}) {
  return { user: user(id, name), day, month: 8, ...extra }
}

function response(over: {
  birthdayMonth?: unknown[]
  birthdayToday?: unknown[]
  tenureMonth?: unknown[]
  tenureToday?: unknown[]
}) {
  return {
    referenceDay: REFERENCE_DAY,
    birthdays: {
      month: over.birthdayMonth ?? [],
      upcoming: (over.birthdayToday ?? []).map((e) => ({
        ...(e as object),
        daysUntil: 0,
        observedDate: REFERENCE_DAY,
      })),
    },
    workAnniversaries: {
      month: over.tenureMonth ?? [],
      upcoming: (over.tenureToday ?? []).map((e) => ({
        ...(e as object),
        daysUntil: 0,
        observedDate: REFERENCE_DAY,
      })),
    },
  }
}

describe('BirthdaysPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('destaca quem faz aniversário hoje e lista o mês com data e status', async () => {
    mockApiFetch.mockResolvedValue(
      response({
        birthdayToday: [entry('u1', 'Ana Prado', 12)],
        birthdayMonth: [entry('u2', 'Bruno Lima', 3), entry('u1', 'Ana Prado', 12), entry('u3', 'Caio Reis', 25)],
      }),
    )

    wrap(<BirthdaysPage today={TODAY} />)

    expect(await screen.findByText('Hoje é aniversário de Ana!')).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getByText('25/08')).toBeInTheDocument()
    // Passado, hoje e futuro dentro do mesmo mês.
    expect(within(table).getByText('Realizado')).toBeInTheDocument()
    expect(within(table).getByText('Hoje')).toBeInTheDocument()
    expect(within(table).getByText('A comemorar')).toBeInTheDocument()
    expect(within(table).getAllByText('Operações')).toHaveLength(3)
  })

  it('avisa quando não há aniversariante hoje', async () => {
    mockApiFetch.mockResolvedValue(response({ birthdayMonth: [entry('u2', 'Bruno Lima', 3)] }))

    wrap(<BirthdaysPage today={TODAY} />)

    expect(await screen.findByText('Nenhum aniversariante hoje')).toBeInTheDocument()
  })

  it('a aba Tempo de casa mostra o mesmo formato com os anos de casa', async () => {
    mockApiFetch.mockResolvedValue(
      response({
        birthdayMonth: [entry('u2', 'Bruno Lima', 3)],
        tenureToday: [entry('u4', 'Dani Souza', 12, { years: 3 })],
        tenureMonth: [entry('u4', 'Dani Souza', 12, { years: 3 })],
      }),
    )

    wrap(<BirthdaysPage today={TODAY} />)
    await screen.findByText('Bruno Lima')

    await userEvent.click(screen.getByRole('tab', { name: /tempo de casa/i }))

    expect(await screen.findByText('3 anos de casa hoje')).toBeInTheDocument()
    expect(screen.queryByText('Bruno Lima')).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText(/· 3 anos/)).toBeInTheDocument()
  })

  it('abre direto em Tempo de casa quando a URL pede a aba', async () => {
    mockApiFetch.mockResolvedValue(
      response({
        birthdayMonth: [entry('u2', 'Bruno Lima', 3)],
        tenureMonth: [entry('u4', 'Dani Souza', 12, { years: 3 })],
      }),
    )

    wrap(<BirthdaysPage today={TODAY} />, '/aniversariantes?aba=tempo-de-casa')

    expect(await screen.findByText('Dani Souza')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /tempo de casa/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('Bruno Lima')).not.toBeInTheDocument()
  })

  it('filtra a listagem por nome', async () => {
    mockApiFetch.mockResolvedValue(
      response({ birthdayMonth: [entry('u2', 'Bruno Lima', 3), entry('u3', 'Caio Reis', 25)] }),
    )

    wrap(<BirthdaysPage today={TODAY} />)
    await screen.findByText('Bruno Lima')

    await userEvent.type(screen.getByRole('searchbox', { name: /pesquisar por nome/i }), 'caio')

    expect(screen.queryByText('Bruno Lima')).not.toBeInTheDocument()
    expect(screen.getByText('Caio Reis')).toBeInTheDocument()
  })

  it('navega entre meses e volta para o mês atual', async () => {
    mockApiFetch.mockResolvedValue(response({ birthdayMonth: [entry('u2', 'Bruno Lima', 3)] }))

    wrap(<BirthdaysPage today={TODAY} />)
    await screen.findByText('Bruno Lima')
    expect(mockApiFetch).toHaveBeenCalledWith('/celebrations?month=2026-08')
    expect(screen.queryByRole('button', { name: 'Mês atual' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Próximo mês' }))

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/celebrations?month=2026-09'))
    expect(screen.getAllByText('setembro de 2026').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: 'Mês atual' }))

    await waitFor(() => expect(screen.getAllByText('agosto de 2026').length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: 'Mês atual' })).not.toBeInTheDocument()
  })
})
