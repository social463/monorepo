import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import type { PdiActionDTO, PdiReviewQueueItemDTO } from '@legends/shared'
import { LeaderValidationPanel } from './LeaderValidationPanel'
import { listPendingPdiReviews } from '../../lib/pdi-api'

vi.mock('../../lib/pdi-api', () => ({
  listPendingPdiReviews: vi.fn(),
  reviewPdiAction: vi.fn(),
}))

const mockQueue = listPendingPdiReviews as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

function action(id: string, description: string): PdiActionDTO {
  return {
    id,
    planId: 'plan-1',
    description,
    type: 'COURSE',
    priority: 'MEDIUM',
    status: 'AWAITING_REVIEW',
    dueDate: null,
    progressPct: 100,
    competency: null,
    notes: null,
    checklist: [],
    reflection: null,
    practicalApplication: null,
    submittedForReviewAt: '2026-07-01T00:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    reviewComment: null,
    completedAt: null,
    evidences: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

function item(
  overrides: { actionId: string; description: string; planId: string; planTitle: string; owner: string },
): PdiReviewQueueItemDTO {
  return {
    action: { ...action(overrides.actionId, overrides.description), planId: overrides.planId },
    plan: { id: overrides.planId, title: overrides.planTitle, cyclePeriod: '2026-Q1', progressPct: 60 },
    owner: { id: `user-${overrides.owner}`, name: overrides.owner, photoUrl: null, position: 'Dev' },
  }
}

const ALEX_1 = item({
  actionId: 'a1',
  description: 'Certificação AWS',
  planId: 'plan-alex',
  planTitle: 'Ciclo de Q3',
  owner: 'Alex Mercer',
})
const ALEX_2 = item({
  actionId: 'a2',
  description: 'Sprint de dívida técnica',
  planId: 'plan-alex',
  planTitle: 'Ciclo de Q3',
  owner: 'Alex Mercer',
})
const SARAH = item({
  actionId: 'b1',
  description: 'Arquitetura de eventos',
  planId: 'plan-sarah',
  planTitle: 'Objetivos de Q3',
  owner: 'Sarah Connor',
})

describe('LeaderValidationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueue.mockResolvedValue({ items: [ALEX_1, ALEX_2, SARAH] })
  })

  it('agrupa a fila por pessoa e abre a primeira da lista', async () => {
    wrap(<LeaderValidationPanel />)

    expect(await screen.findByText('Pendentes (2)')).toBeInTheDocument()
    expect(screen.getByText('2 ações aguardando')).toBeInTheDocument()
    expect(screen.getByText('1 ação aguardando')).toBeInTheDocument()

    // A direita começa no primeiro grupo: as duas ações do Alex, não a da Sarah.
    expect(screen.getByText('Certificação AWS')).toBeInTheDocument()
    expect(screen.getByText('Sprint de dívida técnica')).toBeInTheDocument()
    expect(screen.queryByText('Arquitetura de eventos')).not.toBeInTheDocument()
  })

  it('troca as ações da direita ao escolher outra pessoa', async () => {
    const user = userEvent.setup()
    wrap(<LeaderValidationPanel />)

    await user.click(await screen.findByText('Sarah Connor'))

    expect(screen.getByText('Arquitetura de eventos')).toBeInTheDocument()
    expect(screen.queryByText('Certificação AWS')).not.toBeInTheDocument()
  })

  it('mostra o vazio quando não há nada aguardando', async () => {
    mockQueue.mockResolvedValue({ items: [] })
    wrap(<LeaderValidationPanel />)

    expect(await screen.findByText('Nada aguardando validação')).toBeInTheDocument()
  })
})
