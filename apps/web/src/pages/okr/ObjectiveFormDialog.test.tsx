import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { OkrCycleDTO, OkrObjectiveDTO } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { ObjectiveFormDialog } from './ObjectiveFormDialog'
import { KeyResultFormDialog } from './KeyResultFormDialog'
import { createOkrKeyResult, createOkrObjective, updateOkrObjective } from '../../lib/okr-api'

vi.mock('../../lib/okr-api', () => ({
  createOkrObjective: vi.fn(),
  updateOkrObjective: vi.fn(),
  createOkrKeyResult: vi.fn(),
  updateOkrKeyResult: vi.fn(),
}))

// O seletor de pessoas tem busca e rede próprias; aqui interessa o que o
// formulário manda, então ele vira um campo simples de id.
vi.mock('../mural-feedbacks/TargetPicker', () => ({
  TargetPicker: ({ ariaLabel, onChange }: { ariaLabel: string; onChange: (u: unknown) => void }) => (
    <input
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value ? { id: e.target.value, name: e.target.value } : null)}
    />
  ),
}))

const mockCreate = createOkrObjective as unknown as Mock
const mockUpdate = updateOkrObjective as unknown as Mock
const mockCreateKr = createOkrKeyResult as unknown as Mock

const cycle = { id: 'c1', name: 'Ciclo', status: 'OPEN', finishDate: '2027-12-31' } as OkrCycleDTO

const objective = {
  id: 'o1',
  cycleId: 'c1',
  parentId: null,
  code: 'PRD1',
  name: 'Reduzir churn',
  description: null,
  scope: 'TEAM',
  visibility: 'EVERYONE',
  finishDate: '2027-12-31',
  weight: 0.4,
  confidenceLevel: null,
  assignments: [{ person: { id: 'u9', name: 'Dona', email: 'd@x.com', photoUrl: null }, role: 'OWNER' }],
  keyResults: [],
} as unknown as OkrObjectiveDTO

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreate.mockResolvedValue({ objective })
  mockUpdate.mockResolvedValue({ objective })
  mockCreateKr.mockResolvedValue({ objective })
})

describe('ObjectiveFormDialog', () => {
  it('cria a meta com escopo, papéis e peso em fração', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    wrap(<ObjectiveFormDialog cycle={cycle} objective={null} onClose={() => {}} onSaved={onSaved} />)

    await user.type(screen.getByLabelText('Nome da meta'), 'Aumentar conversão')
    await user.type(screen.getByLabelText(/Peso no pai/), '40')
    await user.type(screen.getByLabelText('Dono da meta'), 'u9')
    await user.type(screen.getByLabelText('Responsável pela meta'), 'u7')
    await user.click(screen.getByRole('button', { name: 'Criar meta' }))

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        cycleId: 'c1',
        name: 'Aumentar conversão',
        parentId: null,
        weight: 0.4,
        assignments: [
          { personId: 'u9', role: 'OWNER' },
          { personId: 'u7', role: 'ASSIGNED_TO' },
        ],
      }),
    )
    expect(onSaved).toHaveBeenCalled()
  })

  it('submeta nasce ligada à meta pai', async () => {
    const user = userEvent.setup()
    wrap(<ObjectiveFormDialog cycle={cycle} objective={null} parent={objective} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByText('Desdobra: Reduzir churn')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Nome da meta'), 'Churn do squad')
    await user.click(screen.getByRole('button', { name: 'Criar meta' }))
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'o1' }))
  })

  it('nome vazio e peso fora da faixa são barrados antes da API', async () => {
    const user = userEvent.setup()
    wrap(<ObjectiveFormDialog cycle={cycle} objective={null} onClose={() => {}} onSaved={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Criar meta' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome da meta.')

    await user.type(screen.getByLabelText('Nome da meta'), 'Meta')
    await user.type(screen.getByLabelText(/Peso no pai/), '140')
    await user.click(screen.getByRole('button', { name: 'Criar meta' }))
    expect(screen.getByRole('alert')).toHaveTextContent('O peso vai de 0 a 100.')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('editar abre preenchido e mantém a meta pai', async () => {
    const user = userEvent.setup()
    wrap(<ObjectiveFormDialog cycle={cycle} objective={objective} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByLabelText('Nome da meta')).toHaveValue('Reduzir churn')
    expect(screen.getByLabelText(/Peso no pai/)).toHaveValue('40')
    await user.click(screen.getByRole('button', { name: 'Salvar meta' }))
    expect(mockUpdate).toHaveBeenCalledWith('o1', expect.objectContaining({ name: 'Reduzir churn', parentId: null }))
  })

  it('erro da API aparece no diálogo', async () => {
    mockCreate.mockRejectedValue(new ApiError(422, 'A soma dos pesos passa de 100%.'))
    const user = userEvent.setup()
    wrap(<ObjectiveFormDialog cycle={cycle} objective={null} onClose={() => {}} onSaved={() => {}} />)
    await user.type(screen.getByLabelText('Nome da meta'), 'Meta')
    await user.click(screen.getByRole('button', { name: 'Criar meta' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A soma dos pesos passa de 100%.')
  })
})

describe('KeyResultFormDialog', () => {
  it('cria o key result com base, meta e direção', async () => {
    const user = userEvent.setup()
    wrap(<KeyResultFormDialog objective={objective} keyResult={null} onClose={() => {}} onSaved={() => {}} />)
    const form = screen.getByRole('form', { name: 'Novo key result de Reduzir churn' })
    // O nome já vem do objetivo: no tenant, meta e KR têm o mesmo nome.
    expect(within(form).getByLabelText('Nome')).toHaveValue('Reduzir churn')
    await user.type(within(form).getByLabelText('Meta'), '95')
    await user.click(within(form).getByRole('button', { name: 'Criar key result' }))

    expect(mockCreateKr).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ name: 'Reduzir churn', baseline: 0, target: 95, direction: 'HIGHER_IS_BETTER', metricType: 'PERCENTAGE' }),
    )
  })

  it('sem meta informada, não chama a API', async () => {
    const user = userEvent.setup()
    wrap(<KeyResultFormDialog objective={objective} keyResult={null} onClose={() => {}} onSaved={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Criar key result' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe a meta.')
    expect(mockCreateKr).not.toHaveBeenCalled()
  })
})
