import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Mock } from 'vitest'
import { PdiPage } from './PdiPage'
import { getPdiShowcase, listPdiPlans, updatePdiVisibility } from '../../lib/pdi-api'

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Lucca' }, loading: false }),
}))

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

const mockShowcase = getPdiShowcase as unknown as Mock
const mockPlans = listPdiPlans as unknown as Mock
const mockVisibility = updatePdiVisibility as unknown as Mock

function renderVitrine() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={['/pdi?aba=vitrine']}>
      <QueryClientProvider client={qc}>
        <PdiPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('Vitrine do PDI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVisibility.mockResolvedValue({ visibility: 'ALL' })
    mockPlans.mockResolvedValue({ plans: [], visibility: 'TEAM', settings: { leaderApprovalRequired: true } })
    mockShowcase.mockResolvedValue({
      showcase: {
        user: { id: 'u1', name: 'Lucca', photoUrl: null, position: null },
        visibility: 'TEAM',
        visible: true,
        competencies: ['Liderança'],
        actions: [
          {
            id: 'a1',
            description: 'Curso de liderança',
            type: 'COURSE',
            competency: 'Liderança',
            completedAt: '2026-07-10T12:00:00.000Z',
          },
        ],
      },
    })
  })

  it('lista as conquistas com tipo, competência e data', async () => {
    renderVitrine()

    expect(await screen.findByText('Curso de liderança')).toBeInTheDocument()
    expect(screen.getByText('1 ação concluída')).toBeInTheDocument()
    expect(screen.getByText('Concluída em 10/07/2026')).toBeInTheDocument()
  })

  it('marca o alcance atual e troca ao escolher outro', async () => {
    const user = userEvent.setup()
    renderVitrine()

    const atual = await screen.findByRole('button', { name: /Meu setor/ })
    expect(atual).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: /Toda a empresa/ }))
    await waitFor(() => expect(mockVisibility).toHaveBeenCalledWith('ALL'))
  })

  it('mostra o vazio quando não há ação concluída', async () => {
    mockShowcase.mockResolvedValue({
      showcase: {
        user: { id: 'u1', name: 'Lucca', photoUrl: null, position: null },
        visibility: 'TEAM',
        visible: true,
        competencies: [],
        actions: [],
      },
    })
    renderVitrine()

    expect(await screen.findByText('Nada na vitrine ainda')).toBeInTheDocument()
  })
})
