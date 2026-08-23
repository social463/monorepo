import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Mock } from 'vitest'
import { PdiPage } from './PdiPage'
import { getPdiDashboard } from '../../lib/pdi-api'

vi.mock('../../lib/pdi-api', () => ({
  createPdiAction: vi.fn(),
  createPdiPlan: vi.fn(),
  deletePdiPlan: vi.fn(),
  getPdiDashboard: vi.fn(),
  getPdiShowcase: vi.fn(),
  listEligiblePdiLeaders: vi.fn(),
  listPdiPlans: vi.fn(),
  updatePdiPlan: vi.fn(),
  updatePdiVisibility: vi.fn(),
  listPendingPdiReviews: vi.fn(),
  reviewPdiAction: vi.fn(),
  deletePdiAction: vi.fn(),
  listPdiActionHistory: vi.fn(),
  updatePdiAction: vi.fn(),
  completePdiAction: vi.fn(),
  getPdiEvidenceConfig: vi.fn(),
  uploadPdiEvidence: vi.fn(),
}))

const mockDashboard = getPdiDashboard as unknown as Mock

function renderPainel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={['/pdi?aba=painel']}>
      <QueryClientProvider client={qc}>
        <PdiPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('Painel do PDI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDashboard.mockResolvedValue({
      dashboard: {
        plans: 2,
        actions: 8,
        doneActions: 4,
        awaitingReview: 1,
        overdue: 0,
        progressPct: 55,
        byType: [
          { type: 'COURSE', total: 4, done: 3 },
          { type: 'BOOK', total: 1, done: 0 },
        ],
        competencies: [],
      },
      cycles: [{ cyclePeriod: '2026-Q1', plans: 1, actions: 4, doneActions: 2, progressPct: 50 }],
    })
  })

  it('mostra as métricas do ciclo com o contexto de cada número', async () => {
    renderPainel()

    expect(await screen.findByText('Ações no total')).toBeInTheDocument()
    expect(screen.getByText('em 2 planos')).toBeInTheDocument()
    expect(screen.getByText('na mão do líder')).toBeInTheDocument()
    expect(screen.getByText('tudo dentro do prazo')).toBeInTheDocument()
  })

  it('quebra o progresso por tipo de ação', async () => {
    renderPainel()

    expect(await screen.findByText('Curso')).toBeInTheDocument()
    expect(screen.getByText('3 de 4 concluídas')).toBeInTheDocument()
    expect(screen.getByText('0 de 1 concluída')).toBeInTheDocument()
  })

  it('lista os ciclos com o progresso geral', async () => {
    renderPainel()

    expect(await screen.findByText('Progresso geral')).toBeInTheDocument()
    expect(screen.getByText('55%')).toBeInTheDocument()
    expect(screen.getByText('2026-Q1')).toBeInTheDocument()
    expect(screen.getByText('2/4 ações')).toBeInTheDocument()
  })
})
