import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { OkrCycleDTO, OkrKeyResultDTO, OkrObjectiveDTO } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { OkrObjectivePage } from './OkrObjectivePage'
import { deleteOkrObjective, getOkrObjective, listOkrCheckIns, listOkrCycles, listOkrObjectives } from '../../lib/okr-api'

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Isabel Queiroz', role: 'LEGEND', sectorFeatures: [] } }),
}))

vi.mock('../../lib/okr-api', () => ({
  listOkrCycles: vi.fn(),
  listOkrObjectives: vi.fn(),
  getOkrObjective: vi.fn(),
  listOkrCheckIns: vi.fn(),
  createOkrCheckIn: vi.fn(),
  createOkrObjective: vi.fn(),
  updateOkrObjective: vi.fn(),
  deleteOkrObjective: vi.fn(),
  createOkrKeyResult: vi.fn(),
  updateOkrKeyResult: vi.fn(),
}))

const mockCycles = listOkrCycles as unknown as Mock
const mockObjectives = listOkrObjectives as unknown as Mock
const mockObjective = getOkrObjective as unknown as Mock
const mockCheckIns = listOkrCheckIns as unknown as Mock

const person = { id: 'u1', name: 'Isabel Queiroz', email: 'isabel@x.com', photoUrl: null }

const cycle: OkrCycleDTO = {
  id: 'c1',
  name: 'Ciclo EMR - 2027',
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
}

function keyResult(overrides: Partial<OkrKeyResultDTO> = {}): OkrKeyResultDTO {
  return {
    id: 'kr1',
    objectiveId: 'o1',
    code: 'PRD0038',
    name: '% de Bugs Desenvolvedor',
    description: null,
    metricType: 'PERCENTAGE',
    unit: null,
    baseline: 0,
    target: 5,
    direction: 'LOWER_IS_BETTER',
    weight: null,
    status: 'ACTIVE',
    finishDate: null,
    calculated: false,
    dependencies: [],
    assignments: [{ person, role: 'ASSIGNED_TO' }],
    permissions: { updateKeyResult: false, updateKeyResultStatus: false, createCheckIn: true },
    currentValue: 16.7,
    accumulatedValue: null,
    progressLinear: 334,
    attainment: 0.2994,
    overshoot: 0,
    goalMet: false,
    color: '#eb5656',
    ...overrides,
  }
}

function objective(overrides: Partial<OkrObjectiveDTO> = {}): OkrObjectiveDTO {
  return {
    id: 'o1',
    cycleId: 'c1',
    parentId: 'p1',
    code: 'PRD0038',
    name: '% de Bugs Desenvolvedor',
    description: '(Bugs gerados pelo Dev / Tarefas entregues pelo Dev) × 100',
    scope: 'INDIVIDUAL',
    status: 'ACTIVE',
    visibility: 'EVERYONE',
    finishDate: '2027-12-31',
    weight: null,
    aggregation: 'KR_ONLY',
    confidenceLevel: 'ATTENTION_REQUIRED',
    path: ['p1', 'o1'],
    manualProgress: null,
    assignments: [{ person, role: 'OWNER' }],
    permissions: { updateObjective: false, deleteObjective: false, createKeyResult: false },
    keyResults: [keyResult()],
    currentValue: 16.7,
    accumulatedValue: null,
    progressLinear: 334,
    attainment: 0.2994,
    overshoot: 0,
    goalMet: false,
    color: '#eb5656',
    ...overrides,
  }
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/metas/objetivo/o1']}>
        <Routes>
          <Route path="/metas/objetivo/:id" element={<OkrObjectivePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCycles.mockResolvedValue({ cycles: [cycle] })
  mockObjective.mockImplementation(async (id: string) =>
    id === 'o1'
      ? { objective: objective() }
      : { objective: objective({ id: 'p1', parentId: null, name: '% de tasks no prazo', code: 'PRD0052', keyResults: [] }) },
  )
  mockObjectives.mockResolvedValue({ objectives: [] })
  mockCheckIns.mockResolvedValue({
    checkIns: [
      {
        id: 'ci1',
        keyResultId: 'kr1',
        value: 16.7,
        numerator: null,
        denominator: null,
        comment: 'Bugs causados: 1',
        author: person,
        effectiveAt: '2026-09-14',
        source: 'IMPULSEUP_IMPORT',
        sourceRef: null,
        createdAt: '2026-09-14T12:00:00.000Z',
        permissions: { updateCheckIn: false, deleteCheckIn: false },
      },
    ],
  })
})

describe('OkrObjectivePage', () => {
  it('mostra a meta com dados à esquerda e progresso de atingimento à direita', async () => {
    wrap()
    expect(await screen.findByRole('heading', { level: 1, name: '% de Bugs Desenvolvedor' })).toBeInTheDocument()
    expect(screen.getByText('ID: PRD0038')).toBeInTheDocument()
    expect(screen.getByText('Porcentagem · Menor é melhor')).toBeInTheDocument()
    expect(screen.getByText(/Bugs gerados pelo Dev/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ciclo EMR - 2027/ })).toHaveAttribute('href', '/metas?aba=ciclo&ciclo=c1')
    expect(screen.getByText('Valor atual: 16,7%')).toBeInTheDocument()
    expect(screen.getByText('Teto: 5%')).toBeInTheDocument()
    // A ImpulseUp mostra 334%; aqui é atingimento de um teto estourado.
    expect(screen.getByRole('progressbar', { name: 'Resultado de % de Bugs Desenvolvedor' })).toHaveAttribute('aria-valuenow', '30')
    expect(screen.queryByText('334%')).not.toBeInTheDocument()
  })

  it('meta pai e submetas ficam recolhidas, com contador, e levam à página delas', async () => {
    mockObjectives.mockResolvedValue({
      objectives: [objective({ id: 's1', parentId: 'o1', name: 'Bugs do squad', keyResults: [] })],
    })
    const user = userEvent.setup()
    wrap()
    const parent = await screen.findByRole('button', { name: /Meta pai/ })
    expect(parent).toHaveAttribute('aria-expanded', 'false')
    expect(parent).toHaveTextContent('1')
    await user.click(parent)
    expect(await screen.findByRole('link', { name: '% de tasks no prazo' })).toHaveAttribute('href', '/metas/objetivo/p1')

    const children = screen.getByRole('button', { name: /Submetas/ })
    expect(children).toHaveTextContent('1')
    await user.click(children)
    expect(screen.getByRole('link', { name: 'Bugs do squad' })).toHaveAttribute('href', '/metas/objetivo/s1')
    expect(mockObjectives).toHaveBeenCalledWith('c1', { parentId: 'o1' })
  })

  it('aba Atualizações mostra a série de check-ins', async () => {
    const user = userEvent.setup()
    wrap()
    await user.click(await screen.findByRole('tab', { name: 'Atualizações' }))
    expect(await screen.findByText('Bugs causados: 1')).toBeInTheDocument()
    expect(screen.getByText(/14\/09\/2026 · Isabel Queiroz · ImpulseUp/)).toBeInTheDocument()
  })

  it('"Atualizar progresso" abre o diálogo com a confiança atual marcada', async () => {
    const user = userEvent.setup()
    wrap()
    await user.click(await screen.findByRole('button', { name: 'Atualizar progresso' }))
    const dialog = screen.getByRole('dialog', { name: 'Atualizar progresso da meta' })
    expect(within(dialog).getByRole('radio', { name: 'Requer atenção' })).toBeChecked()
  })

  it('sem permissão de check-in, não oferece atualizar', async () => {
    mockObjective.mockResolvedValue({
      objective: objective({
        parentId: null,
        keyResults: [keyResult({ permissions: { updateKeyResult: false, updateKeyResultStatus: false, createCheckIn: false } })],
      }),
    })
    wrap()
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Atualizar progresso' })).not.toBeInTheDocument()
  })

  it('meta que não existe (ou que a pessoa não vê) diz isso', async () => {
    mockObjective.mockRejectedValue(new ApiError(404, 'Objetivo não encontrado.'))
    wrap()
    expect(await screen.findByText('Meta não encontrada.')).toBeInTheDocument()
  })

  it('ações de edição obedecem as permissões da meta', async () => {
    wrap()
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    // Sem permissão (o padrão do fixture), nenhuma ação de escrita aparece.
    for (const nome of ['Editar', 'Key result', 'Submeta', 'Excluir']) {
      expect(screen.queryByRole('button', { name: nome })).not.toBeInTheDocument()
    }
  })

  it('dono da meta edita, desdobra, adiciona key result e exclui', async () => {
    mockObjective.mockResolvedValue({
      objective: objective({
        parentId: null,
        permissions: { updateObjective: true, deleteObjective: true, createKeyResult: true },
      }),
    })
    const user = userEvent.setup()
    wrap()
    await user.click(await screen.findByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('form', { name: 'Editar % de Bugs Desenvolvedor' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Submeta' }))
    expect(screen.getByRole('form', { name: 'Nova meta' })).toBeInTheDocument()
    expect(screen.getByText('Desdobra: % de Bugs Desenvolvedor')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Key result' }))
    expect(screen.getByRole('form', { name: /Novo key result/ })).toBeInTheDocument()
  })

  it('excluir pede confirmação e só then chama a API', async () => {
    mockObjective.mockResolvedValue({
      objective: objective({ parentId: null, permissions: { updateObjective: true, deleteObjective: true, createKeyResult: false } }),
    })
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    wrap()
    await user.click(await screen.findByRole('button', { name: 'Excluir' }))
    expect(confirm).toHaveBeenCalled()
    expect(deleteOkrObjective).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(deleteOkrObjective).toHaveBeenCalledWith('o1')
    confirm.mockRestore()
  })
})
