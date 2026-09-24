import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { TrainingOverviewResponse } from '@legends/shared'
import { TrainingAnalyticsTab } from './TrainingAnalyticsTab'
import { apiFetch } from '../../lib/api'

/**
 * Documento 4, seção 9.5: a trilha de Desenvolvimento & IA — três cards, dois
 * blocos e o filtro de cargo, que é desta aba.
 */

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

function resposta(over: Partial<TrainingOverviewResponse['training']> = {}): TrainingOverviewResponse {
  return {
    training: {
      from: '2026-07-22',
      to: '2026-08-20',
      days: 30,
      sectorId: null,
      position: null,
      coursesPublished: 12,
      completions: 21,
      completionsPerCollaborator: 1.4,
      mandatoryCompletedPct: 70,
      mandatoryEnrollments: 40,
      completionsBySector: [
        { sectorId: 's1', sectorName: 'Comercial', completions: 13 },
        { sectorId: 's2', sectorName: 'Produto', completions: 8 },
      ],
      topCourses: [
        { courseId: 'c1', title: 'Onboarding EMR', mandatory: true, completions: 9 },
        { courseId: 'c2', title: 'Liderança na prática', mandatory: false, completions: 4 },
      ],
      ...over,
    },
    positions: ['Designer', 'SRE'],
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TrainingAnalyticsTab window={{ range: '30d' }} sectorId="" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApiFetch.mockResolvedValue(resposta())
})

describe('TrainingAnalyticsTab', () => {
  it('mostra os três cards de KPI', async () => {
    renderTab()

    expect(await screen.findByText('Treinamentos cadastrados')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Média de conclusões por colaborador')).toBeInTheDocument()
    expect(screen.getByText('1,4')).toBeInTheDocument()
    expect(screen.getByText('Obrigatórios finalizados')).toBeInTheDocument()
    expect(screen.getByText('70%')).toBeInTheDocument()
    // O denominador precisa aparecer: "70%" sem "de 40" não dá para interpretar.
    expect(screen.getByText(/de 40 inscrições em curso obrigatório/)).toBeInTheDocument()
  })

  it('desenha a distribuição por setor e a tabela de cursos', async () => {
    renderTab()

    expect(await screen.findByText('Conclusões por setor')).toBeInTheDocument()
    expect(screen.getByText('Comercial')).toBeInTheDocument()

    const tabela = screen.getByRole('table')
    expect(within(tabela).getByText('Onboarding EMR')).toBeInTheDocument()
    // Obrigatório aparece como "Sim"; o opcional fica com um traço.
    expect(within(tabela).getByText('Sim')).toBeInTheDocument()
    expect(within(tabela).getByText('—')).toBeInTheDocument()
  })

  it('o filtro de cargo entra na query', async () => {
    renderTab()

    await screen.findByText('Treinamentos cadastrados')
    await userEvent.click(screen.getByRole('combobox', { name: 'Cargo' }))
    await userEvent.click(await screen.findByRole('option', { name: 'SRE' }))

    expect(
      mockApiFetch.mock.calls.some(([url]) => String(url).includes('position=SRE')),
    ).toBe(true)
  })

  it('sem cargo cadastrado na empresa, o seletor não aparece', async () => {
    mockApiFetch.mockResolvedValue({ ...resposta(), positions: [] })
    renderTab()

    await screen.findByText('Treinamentos cadastrados')
    expect(screen.queryByRole('combobox', { name: 'Cargo' })).not.toBeInTheDocument()
  })

  it('período sem conclusão mostra estado vazio, não tabela em branco', async () => {
    mockApiFetch.mockResolvedValue(
      resposta({ completions: 0, completionsBySector: [], topCourses: [] }),
    )
    renderTab()

    expect(await screen.findAllByText('Nenhuma conclusão no período.')).toHaveLength(2)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
