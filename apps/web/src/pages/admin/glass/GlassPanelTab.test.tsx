import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlassOverviewDTO } from '@legends/shared'

vi.mock('../../../lib/glass-api', () => ({
  getGlassOverview: vi.fn(),
  listGlassReviews: vi.fn(),
}))

import { GlassPanelTab } from './GlassPanelTab'
import { getGlassOverview, listGlassReviews } from '../../../lib/glass-api'

const overviewMock = vi.mocked(getGlassOverview)
const reviewsMock = vi.mocked(listGlassReviews)

beforeEach(() => {
  vi.clearAllMocks()
  reviewsMock.mockResolvedValue({ reviews: [], total: 0 })
})

const CRITICA = {
  id: 'r1',
  reviewDate: '2026-02-10',
  rating: 1,
  role: 'Analista',
  level: null,
  sector: 'Suporte',
  tenure: 'DE_1_A_3_ANOS',
  status: 'ATIVO',
  recommends: false,
  leadershipApproval: false,
  title: null,
  positives: null,
  negatives: 'Jornada puxada',
  advice: null,
  sentiment: 'NEGATIVO',
  themesPositive: [],
  themesNegative: ['SOBRECARGA'],
  alerts: ['NOTA_BAIXA_ATIVO'],
  aiSummary: 'Nota baixa de quem está na casa.',
  createdAt: '2026-02-11T00:00:00.000Z',
} as const

const OVERVIEW: GlassOverviewDTO = {
  totalReviews: 3,
  averageRating: 3.7,
  recommendRate: 0.67,
  leadershipApprovalRate: 0.33,
  sentimentCounts: { POSITIVO: 1, NEUTRO: 1, NEGATIVO: 1 },
  trend: [
    { month: '2026-01', averageRating: 4.5, count: 2 },
    { month: '2026-02', averageRating: 2, count: 1 },
  ],
  bySector: [{ key: 'Suporte', count: 2, averageRating: 2.5 }],
  byRole: [{ key: 'Analista', count: 2, averageRating: 2.5 }],
  byTenure: [{ key: 'DE_1_A_3_ANOS', count: 2, averageRating: 2.5 }],
  byStatus: [{ key: 'ATIVO', count: 3, averageRating: 3.7 }],
  topThemesPositive: [{ theme: 'AMBIENTE_EQUIPE', count: 2 }],
  topThemesNegative: [{ theme: 'SOBRECARGA', count: 3 }],
  alerts: [{ key: 'SETOR_CRITICO', scope: 'Suporte', count: 3 }],
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GlassPanelTab />
    </QueryClientProvider>,
  )
}

describe('GlassPanelTab', () => {
  it('mostra os números do acumulado', async () => {
    overviewMock.mockResolvedValue({ overview: OVERVIEW })

    renderPanel()

    await waitFor(() => expect(screen.getByText('3,7')).toBeInTheDocument())
    // "Nota média" também é cabeçalho da tabela de tendência — getAllByText,
    // senão o teste quebra por ambiguidade em vez de por regressão.
    expect(screen.getAllByText('Nota média').length).toBeGreaterThan(0)
    expect(screen.getByText('67%')).toBeInTheDocument()
  })

  it('mostra os recortes com rótulo em português', async () => {
    overviewMock.mockResolvedValue({ overview: OVERVIEW })

    renderPanel()

    await waitFor(() => expect(screen.getByText('De 1 a 3 anos')).toBeInTheDocument())
    expect(screen.getByText('Suporte')).toBeInTheDocument()
    expect(screen.getByText('Funcionário atual')).toBeInTheDocument()
  })

  it('mostra o alerta agregado com o setor e o porquê', async () => {
    overviewMock.mockResolvedValue({ overview: OVERVIEW })

    renderPanel()

    await waitFor(() =>
      expect(screen.getByText(/Setor com repetição de nota baixa/)).toBeInTheDocument(),
    )
    // "Suporte" aparece no recorte por setor e no alerta — getAllByText, senão
    // o teste quebra por ambiguidade em vez de por regressão.
    expect(screen.getAllByText(/Suporte/).length).toBeGreaterThan(0)
  })

  it('conta as avaliações com alerta pelo total, não pela página devolvida', async () => {
    overviewMock.mockResolvedValue({ overview: OVERVIEW })
    // O servidor corta a lista em `limit`; o cabeçalho tem de dizer quantas
    // alertam de verdade, senão um painel de risco mente para menos.
    reviewsMock.mockResolvedValue({ reviews: [CRITICA] as never, total: 80 })

    renderPanel()

    await waitFor(() => expect(screen.getByText(/Avaliações com alerta \(80\)/)).toBeInTheDocument())
  })

  it('avisa quando não conseguiu carregar as avaliações com alerta', async () => {
    overviewMock.mockResolvedValue({ overview: OVERVIEW })
    // Requisição que falha lendo como "está tudo bem" é o pior desfecho de um
    // painel de alertas.
    reviewsMock.mockRejectedValue(new Error('falhou'))

    renderPanel()

    await waitFor(() =>
      expect(screen.getByText(/não consegui carregar as avaliações com alerta/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/nenhuma avaliação com alerta/i)).not.toBeInTheDocument()
  })

  it('mostra "não classificado" quando a avaliação não tem sentimento', async () => {
    overviewMock.mockResolvedValue({ overview: OVERVIEW })
    reviewsMock.mockResolvedValue({ reviews: [{ ...CRITICA, sentiment: null }] as never, total: 1 })

    renderPanel()

    await waitFor(() => expect(screen.getByText(/Não classificado/)).toBeInTheDocument())
  })

  it('explica a tela vazia em vez de mostrar zeros soltos', async () => {
    overviewMock.mockResolvedValue({
      overview: { ...OVERVIEW, totalReviews: 0, averageRating: null, trend: [], bySector: [], alerts: [] },
    })

    renderPanel()

    await waitFor(() => expect(screen.getByText(/nenhuma avaliação/i)).toBeInTheDocument())
  })
})
