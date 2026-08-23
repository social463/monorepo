import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MOOD_REASON_LABELS, type MoodOverviewDTO } from '@legends/shared'
import { MoodOverviewSection } from './MoodOverviewSection'
import * as api from '../../lib/api'

const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockAuth.role } }),
}))

function makeOverview(overrides: Partial<MoodOverviewDTO> = {}): MoodOverviewDTO {
  return {
    days: 30,
    sectorId: null,
    weekAverage: 3.75,
    participationToday: { responded: 12, total: 20, percent: 60 },
    totalEntries: 48,
    trend: [
      { day: '2026-07-29', average: 4, count: 8, suppressed: false },
      { day: '2026-07-30', average: null, count: 0, suppressed: true },
      { day: '2026-07-31', average: 3.5, count: 12, suppressed: false },
    ],
    todayDistribution: [
      { mood: 'HARD', count: 1, percent: 8 },
      { mood: 'LOW', count: 2, percent: 17 },
      { mood: 'NEUTRAL', count: 3, percent: 25 },
      { mood: 'GOOD', count: 4, percent: 33 },
      { mood: 'GREAT', count: 2, percent: 17 },
    ],
    reasons: [
      { reason: 'WORKLOAD', count: 5, percent: 50 },
      { reason: null, count: 5, percent: 50 },
    ],
    comments: [
      { id: 'c1', day: '2026-07-31', daysAgo: 0, mood: 'LOW', reason: 'WORKLOAD', note: 'Semana muito corrida' },
      { id: 'c2', day: '2026-07-29', daysAgo: 2, mood: 'HARD', reason: null, note: 'Sem contexto pra entregar' },
    ],
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MoodOverviewSection />
    </QueryClientProvider>,
  )
}

function mockApi(overview: MoodOverviewDTO) {
  return vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
    if (path.startsWith('/admin/sectors')) {
      return { sectors: [{ id: 's1', name: 'Gente e Gestão' }] } as never
    }
    return { overview } as never
  })
}

describe('MoodOverviewSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockAuth.role = 'ADMIN'
  })

  it('mostra os indicadores, a distribuição do dia e o ranking de motivos', async () => {
    mockApi(makeOverview())
    renderPage()

    expect(await screen.findByText('3.75')).toBeInTheDocument()
    expect(screen.getByText('🙂 Bem')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('12 de 20 pessoas registraram')).toBeInTheDocument()
    expect(screen.getByText('48')).toBeInTheDocument()

    expect(screen.getByText('33% · 4')).toBeInTheDocument()

    const ranking = screen.getByRole('heading', { name: 'Motivos declarados' }).closest('section')!
    expect(within(ranking).getByText(MOOD_REASON_LABELS.WORKLOAD)).toBeInTheDocument()
    // Motivo ausente entra como "Não informado", não some do ranking.
    expect(within(ranking).getByText('Não informado')).toBeInTheDocument()
  })

  it('lista os comentários sem autor, com humor, motivo e há quanto tempo', async () => {
    mockApi(makeOverview())
    renderPage()

    expect(await screen.findByText('Semana muito corrida')).toBeInTheDocument()
    expect(screen.getByText('hoje')).toBeInTheDocument()
    expect(screen.getByText('Sem contexto pra entregar')).toBeInTheDocument()
    expect(screen.getByText('há 2 dias')).toBeInTheDocument()
  })

  it('avisa "poucas respostas" quando o recorte fica abaixo do piso de anonimato', async () => {
    mockApi(
      makeOverview({
        weekAverage: null,
        participationToday: null,
        totalEntries: 0,
        todayDistribution: [],
        reasons: [],
        comments: [],
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getAllByText(/Poucas respostas para exibir/).length).toBeGreaterThan(0))
    expect(screen.getAllByText('—').length).toBe(2)
  })

  it('o ADMIN filtra por setor; o SUBADMIN não vê o filtro', async () => {
    mockApi(makeOverview())
    const { unmount } = renderPage()
    expect(await screen.findByRole('combobox', { name: /Filtrar por setor/i })).toBeInTheDocument()
    unmount()

    mockAuth.role = 'SUBADMIN'
    mockApi(makeOverview())
    renderPage()
    await screen.findByText('3.75')
    expect(screen.queryByRole('combobox', { name: /Filtrar por setor/i })).not.toBeInTheDocument()
  })

  it('consulta a API com a janela escolhida', async () => {
    const spy = mockApi(makeOverview())
    renderPage()
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/admin/mood/overview?days=30'))
  })

  it('a tendência quebra a linha nos dias suprimidos em vez de ligar os pontos', async () => {
    mockApi(makeOverview())
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0))
    // Dois trechos: 29/07 e 31/07 estão separados pelo dia suprimido de 30/07.
    expect(container.querySelectorAll('polyline')).toHaveLength(2)
  })
})
