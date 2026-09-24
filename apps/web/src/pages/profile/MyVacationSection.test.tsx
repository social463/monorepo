import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { EMR_VACATION_POLICY, type MyVacationPlanningResponse } from '@legends/shared'
import { MyVacationSection } from './MyVacationSection'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

function fixture(patch: Partial<MyVacationPlanningResponse> = {}): MyVacationPlanningResponse {
  return {
    campaign: {
      id: 'c1',
      year: 2027,
      opensAt: '2026-08-01',
      deadline: '2027-06-30',
      manuallyLocked: false,
      locked: false,
      policy: EMR_VACATION_POLICY,
      noticeTemplate: '',
    },
    items: [
      {
        entitlement: {
          id: 'ent-1',
          employmentType: 'CLT',
          acquisitionStart: '2026-04-08',
          acquisitionEnd: '2027-04-07',
          dueDate: '2028-03-07',
          balanceDays: 30,
          note: null,
          daysToDueDate: 560,
        },
        plan: null,
        request: null,
      },
    ],
    ...patch,
  }
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MyVacationSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockApiFetch.mockResolvedValue(fixture())
})

describe('Minhas férias', () => {
  it('mostra o saldo e até quando as férias precisam terminar', async () => {
    renderSection()

    expect(await screen.findByText('Minhas férias')).toBeInTheDocument()
    expect(screen.getByText(/30 dias/)).toBeInTheDocument()
    expect(screen.getByText('07/03/2028')).toBeInTheDocument()
  })

  it('diz, com todas as letras, que é pedido e não reserva', async () => {
    renderSection()

    // Prometer o contrário criaria expectativa que o produto não honra.
    expect(
      await screen.findByText('É um pedido, não uma reserva — a decisão é da sua liderança.'),
    ).toBeInTheDocument()
  })

  it('envia o pedido com data e dias', async () => {
    renderSection()
    await screen.findByText('Minhas férias')

    await userEvent.type(screen.getByLabelText(/Quando você gostaria de começar/), '2027-07-05')
    await userEvent.type(screen.getByLabelText(/Quantos dias/), '20')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/me/vacation-planning/request',
        expect.objectContaining({ method: 'PUT' }),
      ),
    )
  })

  it('plano ainda não validado aparece como rascunho, não como decidido', async () => {
    mockApiFetch.mockResolvedValue(
      fixture({
        items: [
          {
            ...fixture().items[0]!,
            plan: {
              periods: [{ startDate: '2027-05-03', endDate: '2027-06-01', days: 30, soldDays: 0 }],
              status: 'CONFIRMED',
              validatedAt: null,
            },
          },
        ],
      }),
    )
    renderSection()

    // Mostrar como certo faria a pessoa se organizar em cima de algo provisório.
    expect(await screen.findByText(/só\s+valem depois que o time de Gente e Gestão conferir/)).toBeInTheDocument()
    expect(screen.queryByText('Suas férias estão programadas')).not.toBeInTheDocument()
  })

  it('validado é decidido, e aí o formulário some', async () => {
    mockApiFetch.mockResolvedValue(
      fixture({
        items: [
          {
            ...fixture().items[0]!,
            plan: {
              periods: [{ startDate: '2027-05-03', endDate: '2027-06-01', days: 30, soldDays: 0 }],
              status: 'VALIDATED',
              validatedAt: '2026-09-01T12:00:00.000Z',
            },
          },
        ],
      }),
    )
    renderSection()

    expect(await screen.findByText('Suas férias estão programadas')).toBeInTheDocument()
    expect(screen.getByText(/03\/05\/2027 a 01\/06\/2027/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pedido/ })).not.toBeInTheDocument()
  })

  it('sem campanha aberta a seção não ocupa espaço no perfil', async () => {
    mockApiFetch.mockResolvedValue({ campaign: null, items: [] })
    const { container } = renderSection()

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
