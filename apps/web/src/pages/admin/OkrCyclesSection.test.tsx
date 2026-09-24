import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { OKR_DEFAULT_DECIMALS, OKR_DEFAULT_PROGRESS_RANGES, type OkrCycleDTO } from '@legends/shared'
import { OkrCyclesSection } from './OkrCyclesSection'
import * as okrApi from '../../lib/okr-api'

vi.mock('../../lib/okr-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/okr-api')>()
  return {
    ...actual,
    listOkrCycles: vi.fn(),
    createOkrCycle: vi.fn(),
    updateOkrCycle: vi.fn(),
  }
})

const mockList = okrApi.listOkrCycles as unknown as Mock
const mockCreate = okrApi.createOkrCycle as unknown as Mock
const mockUpdate = okrApi.updateOkrCycle as unknown as Mock

function buildCycle(overrides: Partial<OkrCycleDTO> = {}): OkrCycleDTO {
  return {
    id: 'cycle-1',
    name: '2026 · 1º semestre',
    description: null,
    status: 'OPEN',
    startDate: '2026-01-01',
    finishDate: '2026-06-30',
    forceCommentOnCheckIn: true,
    updateWindowStart: null,
    updateWindowFinish: null,
    progressRanges: OKR_DEFAULT_PROGRESS_RANGES.map((range) => ({ ...range })),
    decimals: { ...OKR_DEFAULT_DECIMALS },
    externalSource: null,
    externalId: null,
    ...overrides,
  }
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OkrCyclesSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockList.mockResolvedValue({ cycles: [buildCycle()] })
  mockCreate.mockResolvedValue({ cycle: buildCycle({ id: 'cycle-2' }) })
  mockUpdate.mockResolvedValue({ cycle: buildCycle() })
})

describe('OkrCyclesSection', () => {
  it('lista os ciclos com período, situação e exigência de comentário', async () => {
    renderSection()
    expect(await screen.findByText('2026 · 1º semestre')).toBeInTheDocument()
    expect(screen.getByText('01/01/2026 – 30/06/2026')).toBeInTheDocument()
    expect(screen.getByText('Aberto')).toBeInTheDocument()
    expect(screen.getByText('Exige comentário no check-in')).toBeInTheDocument()
    expect(screen.getByText(/Janela de atualização: o ciclo inteiro/)).toBeInTheDocument()
  })

  it('cria um ciclo com o payload completo', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Novo ciclo' }))

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: '2027 · anual' } })
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Ciclo anual' } })
    fireEvent.change(screen.getByLabelText('Início'), { target: { value: '2027-01-01' } })
    fireEvent.change(screen.getByLabelText('Fim'), { target: { value: '2027-12-31' } })
    fireEvent.click(screen.getByLabelText('Exigir comentário no check-in'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      name: '2027 · anual',
      description: 'Ciclo anual',
      status: 'DRAFT',
      startDate: '2027-01-01',
      finishDate: '2027-12-31',
      forceCommentOnCheckIn: true,
      updateWindowStart: null,
      updateWindowFinish: null,
      progressRanges: OKR_DEFAULT_PROGRESS_RANGES.map((range) => ({ ...range })),
      decimals: { ...OKR_DEFAULT_DECIMALS },
    })
  })

  it('barra o semáforo com buraco antes de chamar a API', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Novo ciclo' }))

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ciclo torto' } })
    fireEvent.change(screen.getByLabelText('Início'), { target: { value: '2027-01-01' } })
    fireEvent.change(screen.getByLabelText('Fim'), { target: { value: '2027-12-31' } })
    // Abre um buraco entre a 1ª e a 2ª faixa: 0–20 e depois 30–60.
    fireEvent.change(screen.getByLabelText('Máximo da faixa 1'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/contínuas/i)
    expect(mockCreate).not.toHaveBeenCalled()

    // Restaurar o padrão conserta e o envio passa.
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar padrão' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
  })

  it('ao editar, manda só o que mudou', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: '2026 · 1º sem (revisado)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith('cycle-1', { name: '2026 · 1º sem (revisado)' })
  })

  it('fecha o diálogo no Escape', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Novo ciclo' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
