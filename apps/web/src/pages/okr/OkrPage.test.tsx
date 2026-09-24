import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { OkrCycleDTO, OkrKeyResultDTO, OkrObjectiveDTO } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { OkrPage } from './OkrPage'
import { parseDecimal } from './okr-format'
import {
  createOkrCheckIn,
  getOkrPersonResults,
  listOkrCheckIns,
  listOkrCycles,
  listOkrObjectives,
} from '../../lib/okr-api'

vi.mock('../../lib/okr-api', () => ({
  listOkrCycles: vi.fn(),
  listOkrObjectives: vi.fn(),
  getOkrPersonResults: vi.fn(),
  listOkrCheckIns: vi.fn(),
  createOkrCheckIn: vi.fn(),
  createOkrObjective: vi.fn(),
  updateOkrObjective: vi.fn(),
  deleteOkrObjective: vi.fn(),
  createOkrKeyResult: vi.fn(),
  updateOkrKeyResult: vi.fn(),
}))

const authUser = { id: 'u1', name: 'Fulana', role: 'LEGEND', adminAccess: false, sectorFeatures: [] as string[] }
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: authUser }),
}))

const mockCycles = listOkrCycles as unknown as Mock
const mockObjectives = listOkrObjectives as unknown as Mock
const mockPerson = getOkrPersonResults as unknown as Mock
const mockCheckIns = listOkrCheckIns as unknown as Mock
const mockCreate = createOkrCheckIn as unknown as Mock

function wrap(ui: ReactNode, entry = '/metas') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function cycle(overrides: Partial<OkrCycleDTO> = {}): OkrCycleDTO {
  return {
    id: 'c1',
    name: 'Ciclo 2027',
    description: null,
    status: 'OPEN',
    startDate: '2027-01-01',
    finishDate: '2027-12-31',
    forceCommentOnCheckIn: false,
    updateWindowStart: null,
    updateWindowFinish: null,
    progressRanges: [],
    decimals: { percentage: 2, numeric: 2, currency: 2 },
    externalSource: null,
    externalId: null,
    ...overrides,
  }
}

const person = { id: 'u1', name: 'Fulana', email: 'fulana@x.com', photoUrl: null }

function keyResult(overrides: Partial<OkrKeyResultDTO> = {}): OkrKeyResultDTO {
  return {
    id: 'kr1',
    objectiveId: 'o1',
    code: null,
    name: 'Churn mensal',
    description: null,
    metricType: 'PERCENTAGE',
    unit: null,
    baseline: 0,
    target: 10,
    direction: 'LOWER_IS_BETTER',
    weight: null,
    status: 'ACTIVE',
    finishDate: null,
    calculated: false,
    dependencies: [],
    assignments: [{ person, role: 'ASSIGNED_TO' }],
    permissions: { updateKeyResult: false, updateKeyResultStatus: false, createCheckIn: true },
    currentValue: 15.03,
    accumulatedValue: null,
    progressLinear: 150.3,
    attainment: 0.665,
    overshoot: 0,
    goalMet: false,
    color: '#f59e0b',
    ...overrides,
  }
}

function objective(overrides: Partial<OkrObjectiveDTO> = {}): OkrObjectiveDTO {
  return {
    id: 'o1',
    cycleId: 'c1',
    parentId: null,
    code: null,
    name: 'Reduzir churn',
    description: null,
    scope: 'TEAM',
    status: 'ACTIVE',
    visibility: 'EVERYONE',
    finishDate: null,
    weight: null,
    aggregation: 'KR_ONLY',
    confidenceLevel: null,
    path: ['o1'],
    manualProgress: null,
    assignments: [{ person, role: 'OWNER' }],
    permissions: { updateObjective: false, deleteObjective: false, createKeyResult: false },
    keyResults: [keyResult()],
    currentValue: 15.03,
    accumulatedValue: null,
    progressLinear: 150.3,
    attainment: 0.665,
    overshoot: 0,
    goalMet: false,
    color: '#f59e0b',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(authUser, { role: 'LEGEND', adminAccess: false, sectorFeatures: [] })
  mockCycles.mockResolvedValue({ cycles: [cycle()] })
  mockPerson.mockResolvedValue({ results: { person, cycleId: 'c1', objectives: [objective()] } })
  mockObjectives.mockResolvedValue({ objectives: [] })
  mockCheckIns.mockResolvedValue({ checkIns: [] })
  mockCreate.mockResolvedValue({ checkIn: {} })
})

describe('parseDecimal', () => {
  it('aceita vírgula, ponto e milhar brasileiro', () => {
    expect(parseDecimal('12,5')).toBe(12.5)
    expect(parseDecimal('12.5')).toBe(12.5)
    expect(parseDecimal('1.250,50')).toBe(1250.5)
  })

  it('vazio é nulo; texto é NaN', () => {
    expect(parseDecimal('  ')).toBeNull()
    expect(parseDecimal('abc')).toBeNaN()
  })
})

describe('OkrPage — Minhas metas', () => {
  it('meta "menor é melhor" mostra teto e atingimento, não o progresso linear estourado', async () => {
    const user = userEvent.setup()
    wrap(<OkrPage />)
    const name = await screen.findByRole('link', { name: 'Reduzir churn' })
    expect(name).toHaveAttribute('href', '/metas/objetivo/o1')
    const row = name.closest('tr')!
    expect(within(row).getByText(/teto de/)).toBeInTheDocument()
    expect(within(row).getByRole('progressbar', { name: 'Resultado de Reduzir churn' })).toHaveAttribute('aria-valuenow', '67')
    expect(screen.queryByText(/150/)).not.toBeInTheDocument()
    expect(mockPerson).toHaveBeenCalledWith('u1', 'c1')

    await user.click(within(row).getByRole('button', { name: 'Evolução de Reduzir churn' }))
    const dialog = screen.getByRole('dialog', { name: 'Churn mensal' })
    expect(within(dialog).getByText('Teto')).toBeInTheDocument()
    expect(within(dialog).getByText('Abaixo da meta')).toBeInTheDocument()
    expect(within(dialog).getByText('Nenhum check-in registrado ainda.')).toBeInTheDocument()
  })

  it('meta superada mostra quanto passou, com a barra parando em 100%', async () => {
    mockPerson.mockResolvedValue({
      results: {
        person,
        cycleId: 'c1',
        objectives: [
          objective({
            keyResults: [
              keyResult({ direction: 'HIGHER_IS_BETTER', attainment: 1, overshoot: 0.31, goalMet: true, color: '#64b2cb' }),
            ],
          }),
        ],
      },
    })
    wrap(<OkrPage />)
    const bar = await screen.findByRole('progressbar', { name: 'Resultado de Reduzir churn' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveTextContent('131%')
  })

  it('mostra os três escopos, na ordem, mesmo os vazios', async () => {
    mockPerson.mockResolvedValue({
      results: {
        person,
        cycleId: 'c1',
        objectives: [
          objective({ id: 'o1', name: 'Individual A', scope: 'INDIVIDUAL', keyResults: [] }),
          objective({ id: 'o2', name: 'Empresa A', scope: 'ORGANIZATION', keyResults: [] }),
        ],
      },
    })
    wrap(<OkrPage />)
    const groups = await screen.findAllByRole('heading', { level: 3 })
    expect(groups.map((g) => g.textContent)).toEqual([
      expect.stringContaining('Empresa'),
      expect.stringContaining('Time'),
      expect.stringContaining('Individual'),
    ])
    // Escopo sem meta nasce fechado, mas continua dizendo que está vazio.
    expect(screen.getByRole('button', { name: /Time/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('a exibição alterna entre acumulado e último check-in do ciclo', async () => {
    mockPerson.mockResolvedValue({
      results: {
        person,
        cycleId: 'c1',
        objectives: [
          objective({
            keyResults: [keyResult({ currentValue: 7.69, accumulatedValue: 5.93, attainment: 0.8431, target: 5 })],
          }),
        ],
      },
    })
    const user = userEvent.setup()
    wrap(<OkrPage />)
    const row = (await screen.findByRole('link', { name: 'Reduzir churn' })).closest('tr')!
    expect(within(row).getByText('5,93%')).toBeInTheDocument()
    expect(within(row).getByText('acumulado')).toBeInTheDocument()
    expect(within(row).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '84')

    await user.click(screen.getByRole('button', { name: 'por ciclo' }))
    const updated = screen.getByRole('link', { name: 'Reduzir churn' }).closest('tr')!
    expect(within(updated).getByText('7,69%')).toBeInTheDocument()
    expect(within(updated).queryByText('acumulado')).not.toBeInTheDocument()
    // Teto de 5% estourado: 5 ÷ 7,69 = 65%, recalculado com a regra do shared.
    expect(within(updated).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '65')
  })

  it('sem permissão de check-in, o botão não aparece', async () => {
    mockPerson.mockResolvedValue({
      results: {
        person,
        cycleId: 'c1',
        objectives: [
          objective({
            keyResults: [keyResult({ permissions: { updateKeyResult: false, updateKeyResultStatus: false, createCheckIn: false } })],
          }),
        ],
      },
    })
    wrap(<OkrPage />)
    expect(await screen.findByRole('link', { name: 'Reduzir churn' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Atualizar/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Evolução de Reduzir churn' })).toBeInTheDocument()
  })

  /** Abre "Atualizar" da linha e devolve o formulário do diálogo. */
  async function openUpdate(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Atualizar Churn mensal' }))
    return screen.getByRole('form', { name: 'Atualizar progresso de Churn mensal' })
  }
  const submit = (user: ReturnType<typeof userEvent.setup>, form: HTMLElement) =>
    user.click(within(form).getByRole('button', { name: 'Atualizar progresso' }))

  it('o controle deslizante vai da base ao valor atual e envia o valor escolhido', async () => {
    const user = userEvent.setup()
    wrap(<OkrPage />)
    const form = await openUpdate(user)
    const slider = within(form).getByRole('slider', { name: 'Churn mensal' })
    // Teto estourado: o trilho estica até o atual (15,03), senão nasceria fora dele.
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '15.03')
    expect(slider).toHaveValue('15.03')
    expect(within(form).getByText('Teto: 10%')).toBeInTheDocument()

    fireEvent.change(slider, { target: { value: '8.5' } })
    expect(within(form).getByText('8,5%')).toBeInTheDocument()
    await user.type(within(form).getByLabelText('Comentário'), 'Sprint 12')
    await submit(user, form)

    expect(mockCreate).toHaveBeenCalledWith('kr1', expect.objectContaining({ value: 8.5, comment: 'Sprint 12', sourceRef: null }))
    expect(mockCreate.mock.calls[0][1]).not.toHaveProperty('confidenceLevel')
    expect(await screen.findByRole('status')).toHaveTextContent('Progresso de Churn mensal atualizado.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"Informar valor" aceita vírgula decimal', async () => {
    const user = userEvent.setup()
    wrap(<OkrPage />)
    const form = await openUpdate(user)
    await user.click(within(form).getByRole('button', { name: 'Informar valor' }))
    await user.type(within(form).getByLabelText('Valor (%)'), '9,8')
    await submit(user, form)
    expect(mockCreate).toHaveBeenCalledWith('kr1', expect.objectContaining({ value: 9.8 }))
  })

  it('confiança só vai junto quando muda', async () => {
    mockPerson.mockResolvedValue({
      results: { person, cycleId: 'c1', objectives: [objective({ confidenceLevel: 'ON_TRACK' })] },
    })
    const user = userEvent.setup()
    wrap(<OkrPage />)
    const form = await openUpdate(user)
    expect(within(form).getByRole('radio', { name: 'No caminho' })).toBeChecked()
    await user.click(within(form).getByRole('radio', { name: 'Em risco' }))
    await submit(user, form)
    expect(mockCreate).toHaveBeenCalledWith('kr1', expect.objectContaining({ confidenceLevel: 'AT_RISK' }))
  })

  it('meta que é razão manda numerador e denominador, sem valor', async () => {
    const user = userEvent.setup()
    wrap(<OkrPage />)
    const form = await openUpdate(user)
    await user.click(within(form).getByRole('button', { name: 'Informar valor' }))
    await user.click(within(form).getByRole('button', { name: 'Informar numerador e denominador' }))
    await user.type(within(form).getByLabelText('Numerador'), '3')
    await user.type(within(form).getByLabelText('Denominador'), '45')
    await submit(user, form)

    const body = mockCreate.mock.calls[0][1]
    expect(body).toMatchObject({ numerator: 3, denominator: 45 })
    expect(body).not.toHaveProperty('value')
  })

  it('denominador zero é recusado antes de ir ao servidor', async () => {
    const user = userEvent.setup()
    wrap(<OkrPage />)
    const form = await openUpdate(user)
    await user.click(within(form).getByRole('button', { name: 'Informar valor' }))
    await user.click(within(form).getByRole('button', { name: 'Informar numerador e denominador' }))
    await user.type(within(form).getByLabelText('Numerador'), '3')
    await user.type(within(form).getByLabelText('Denominador'), '0')
    await submit(user, form)

    expect(screen.getByRole('alert')).toHaveTextContent('O denominador não pode ser zero.')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('ciclo que exige comentário não envia sem ele', async () => {
    mockCycles.mockResolvedValue({ cycles: [cycle({ forceCommentOnCheckIn: true })] })
    const user = userEvent.setup()
    wrap(<OkrPage />)
    const form = await openUpdate(user)
    await submit(user, form)

    expect(screen.getByRole('alert')).toHaveTextContent('Este ciclo exige um comentário no check-in.')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('erro do servidor aparece no diálogo, que continua aberto', async () => {
    mockCreate.mockRejectedValue(new ApiError(422, 'Fora da janela de atualização do ciclo.'))
    const user = userEvent.setup()
    wrap(<OkrPage />)
    const form = await openUpdate(user)
    await submit(user, form)

    expect(await screen.findByRole('alert')).toHaveTextContent('Fora da janela de atualização do ciclo.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('da evolução se chega à atualização', async () => {
    const user = userEvent.setup()
    wrap(<OkrPage />)
    await user.click(await screen.findByRole('button', { name: 'Evolução de Reduzir churn' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Churn mensal' })).getByRole('button', { name: 'Atualizar progresso' }))
    expect(screen.getByRole('form', { name: 'Atualizar progresso de Churn mensal' })).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('sem metas, aponta para a visão do ciclo', async () => {
    mockPerson.mockResolvedValue({ results: { person, cycleId: 'c1', objectives: [] } })
    wrap(<OkrPage />)
    expect(await screen.findByText(/Você não tem metas neste ciclo/)).toBeInTheDocument()
  })
})

describe('OkrPage — Metas do ciclo', () => {
  it('a busca ignora acento e caixa', async () => {
    mockObjectives.mockResolvedValue({
      objectives: [
        objective({ id: 'o1', name: 'Aumentar conversão', keyResults: [] }),
        objective({ id: 'o2', name: 'Reduzir churn', keyResults: [] }),
      ],
    })
    const user = userEvent.setup()
    wrap(<OkrPage />, '/metas?aba=ciclo')
    expect(await screen.findByText('Aumentar conversão')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Visão' })).toHaveTextContent('Metas do ciclo')
    expect(screen.getByText('2 objetivos')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Buscar'), 'CONVERSAO')
    expect(screen.getByText('1 objetivo')).toBeInTheDocument()
    expect(screen.queryByText('Reduzir churn')).not.toBeInTheDocument()
  })

  it('sem ciclo cadastrado, diz isso em vez de abas vazias', async () => {
    mockCycles.mockResolvedValue({ cycles: [] })
    wrap(<OkrPage />)
    expect(await screen.findByText('Nenhum ciclo de metas cadastrado ainda.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Visão' })).not.toBeInTheDocument()
  })
})

describe('OkrPage — criar meta', () => {
  it('"Nova meta" é da administração de metas, não do colaborador', async () => {
    wrap(<OkrPage />)
    expect(await screen.findByRole('link', { name: 'Reduzir churn' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Nova meta/ })).not.toBeInTheDocument()

    authUser.role = 'SUBADMIN'
    authUser.sectorFeatures = ['gente-gestao']
    wrap(<OkrPage />)
    expect(await screen.findAllByRole('button', { name: /Nova meta/ })).not.toHaveLength(0)
  })

  it('some no ciclo encerrado — lá ninguém escreve', async () => {
    authUser.role = 'ADMIN'
    mockCycles.mockResolvedValue({ cycles: [cycle({ status: 'CLOSED' })] })
    wrap(<OkrPage />)
    expect(await screen.findByRole('link', { name: 'Reduzir churn' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Nova meta/ })).not.toBeInTheDocument()
  })
})
