import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import {
  EMR_VACATION_POLICY,
  type VacationPlanDTO,
  type VacationPlanningResponse,
} from '@legends/shared'
import { VacationPlanningTab } from './VacationPlanningTab'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, apiFetch: vi.fn() }
})

// O painel de lançamento avulso tem consultas próprias; aqui só interessa que
// ele apareça, não o que ele mostra.
vi.mock('../profile/TeamVacationsPanel', () => ({
  TeamVacationsPanel: () => <div data-testid="painel-avulso" />,
}))

const mockApiFetch = apiFetch as unknown as Mock

function planFixture(patch: Partial<VacationPlanDTO> = {}): VacationPlanDTO {
  return {
    id: 'plan-1',
    user: { id: 'u1', name: 'Ana Souza', email: 'ana@x.com', role: 'LEGEND' } as VacationPlanDTO['user'],
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
    periods: [],
    sellDays: false,
    note: null,
    status: 'DRAFT',
    changeRequested: false,
    confirmedBy: null,
    confirmedAt: null,
    validatedBy: null,
    validatedAt: null,
    unlockedUntil: null,
    request: null,
    replacing: [],
    ...patch,
  }
}

function responseFixture(patch: Partial<VacationPlanningResponse> = {}): VacationPlanningResponse {
  return {
    campaign: {
      id: 'c1',
      year: 2027,
      opensAt: '2026-08-01',
      deadline: '2027-06-30',
      manuallyLocked: false,
      locked: false,
      policy: EMR_VACATION_POLICY,
      noticeTemplate: 'Olá, {nome}!',
    },
    plans: [planFixture()],
    holidays: [],
    monthOverlaps: [],
    ...patch,
  }
}

/** O `Select` do projeto é um combobox próprio: abre e escolhe por clique. */
async function escolher(comboboxName: string, optionName: string) {
  await userEvent.click(screen.getByRole('combobox', { name: comboboxName }))
  await userEvent.click(await screen.findByRole('option', { name: optionName }))
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VacationPlanningTab />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockApiFetch.mockResolvedValue(responseFixture())
})

describe('aba de Férias da Liderança', () => {
  it('mostra a campanha, o prazo e o progresso', async () => {
    renderTab()

    expect(await screen.findByText('Programação de Férias 2027')).toBeInTheDocument()
    expect(screen.getByText(/Prazo: 30\/06\/2027/)).toBeInTheDocument()
    expect(screen.getByText('0 de 1 prontos')).toBeInTheDocument()
  })

  it('sem campanha aberta, a aba é o painel de lançamento avulso', async () => {
    mockApiFetch.mockResolvedValue({ campaign: null, plans: [], holidays: [], monthOverlaps: [] })
    renderTab()

    // Não fica vazia: é o que o líder usa o ano inteiro.
    expect(await screen.findByTestId('painel-avulso')).toBeInTheDocument()
    expect(screen.queryByText(/Programação de Férias/)).not.toBeInTheDocument()
  })

  it('o cartão mostra o limite de gozo em destaque', async () => {
    renderTab()

    expect(await screen.findByText('07/03/2028')).toBeInTheDocument()
    expect(screen.getByText('Limite para as férias')).toBeInTheDocument()
  })

  it('quem não tem saldo não vira pendência', async () => {
    mockApiFetch.mockResolvedValue(
      responseFixture({
        plans: [planFixture({ entitlement: { ...planFixture().entitlement, balanceDays: 0 } })],
      }),
    )
    renderTab()

    expect(
      await screen.findByText('Este período aquisitivo não tem saldo a programar.'),
    ).toBeInTheDocument()
    // Sem saldo não há combinação a escolher.
    expect(screen.queryByLabelText('Combinação de férias')).not.toBeInTheDocument()
  })

  it('coincidência no mês é informativo, e diz que não é impedimento', async () => {
    mockApiFetch.mockResolvedValue(
      responseFixture({ monthOverlaps: [{ month: '2027-07', userIds: ['u1'] }] }),
    )
    renderTab()

    expect(await screen.findByText('Mais de uma pessoa fora no mesmo mês')).toBeInTheDocument()
    expect(screen.getByText(/Não é impedimento/)).toBeInTheDocument()
    expect(screen.getByText(/julho de 2027/)).toBeInTheDocument()
  })

  it('avisa que a validação vai substituir o que foi lançado à mão', async () => {
    mockApiFetch.mockResolvedValue(
      responseFixture({
        plans: [
          planFixture({
            replacing: [{ startDate: '2027-05-10', endDate: '2027-05-20', note: 'Combinado antes' }],
          }),
        ],
      }),
    )
    renderTab()

    // Aparece AQUI, e não na validação: quem lançou tinha um motivo.
    expect(await screen.findByText(/já tem férias lançadas à mão/)).toBeInTheDocument()
    expect(screen.getByText(/Combinado antes/)).toBeInTheDocument()
  })

  it('escolher a combinação preenche os dias sozinha', async () => {
    renderTab()
    await screen.findByRole('combobox', { name: 'Combinação de férias' })

    await escolher('Combinação de férias', '15 e 15')

    // Dois períodos de 15 dias, sem o gestor digitar número nenhum — ele só
    // informa o primeiro dia de cada um.
    await waitFor(() => expect(screen.getAllByText('15')).toHaveLength(2))
  })

  it('campanha encerrada trava o formulário e explica a quem recorrer', async () => {
    mockApiFetch.mockResolvedValue(
      responseFixture({ campaign: { ...responseFixture().campaign!, locked: true } }),
    )
    renderTab()

    expect(await screen.findByText(/O prazo para preenchimento terminou/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Combinação de férias' })).toBeDisabled()
  })

  it('o botão de confirmar não manda ninguém escrever e-mail', async () => {
    renderTab()

    expect(await screen.findByRole('button', { name: 'Confirmar programação' })).toBeInTheDocument()
    expect(screen.getByText(/você não\s+precisa mandar e-mail para ninguém/)).toBeInTheDocument()
  })
})

describe('linha do tempo do time', () => {
  it('desenha uma barra por período programado, com os dias', async () => {
    mockApiFetch.mockResolvedValue(
      responseFixture({
        plans: [
          planFixture({
            periods: [{ startDate: '2027-05-03', endDate: '2027-06-01', days: 30, soldDays: 0 }],
          }),
        ],
      }),
    )
    renderTab()

    expect(await screen.findByText('Quando o time sai')).toBeInTheDocument()
    expect(screen.getByTitle('03/05/2027 a 01/06/2027 · 30 dias')).toBeInTheDocument()
  })

  it('marca os feriados da empresa na régua', async () => {
    mockApiFetch.mockResolvedValue(
      responseFixture({
        holidays: [{ date: '2027-05-13', name: 'Feriado de teste' }],
        plans: [
          planFixture({
            periods: [{ startDate: '2027-05-03', endDate: '2027-06-01', days: 30, soldDays: 0 }],
          }),
        ],
      }),
    )
    renderTab()

    // Sem isso a data é recusada por uma mensagem e o gestor adivinha a próxima.
    expect(await screen.findByTitle('Feriado de teste — 13/05/2027')).toBeInTheDocument()
  })

  it('some quando ninguém programou nada — régua vazia não informa', async () => {
    renderTab()

    await screen.findByText('Programação de Férias 2027')
    expect(screen.queryByText('Quando o time sai')).not.toBeInTheDocument()
  })
})
