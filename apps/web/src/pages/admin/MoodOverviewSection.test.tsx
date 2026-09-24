import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MOOD_REASON_LABELS, type MoodOverviewDTO } from '@legends/shared'
import { MemoryRouter } from 'react-router-dom'
import type { AnalyticsWindowRequest } from '@legends/shared'
import { MoodOverviewSection } from './MoodOverviewSection'
import * as api from '../../lib/api'

const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockAuth.role } }),
}))

/** Autor mínimo de um comentário — só o que a lista renderiza. */
function pessoa(id: string, name: string) {
  return {
    id,
    name,
    sectorName: 'Ensino',
    position: null,
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
  } as never
}

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
    alertComments: [
      { id: 'c1', day: '2026-07-31', daysAgo: 0, mood: 'LOW', reason: 'WORKLOAD', note: 'Semana muito corrida', author: pessoa('u1', 'Ana Souza') },
      { id: 'c2', day: '2026-07-29', daysAgo: 2, mood: 'HARD', reason: null, note: 'Sem contexto pra entregar', author: pessoa('u2', 'Bruno Lima') },
    ],
    comments: [
      { id: 'c1', day: '2026-07-31', daysAgo: 0, mood: 'LOW', reason: 'WORKLOAD', note: 'Semana muito corrida', author: pessoa('u1', 'Ana Souza') },
      { id: 'c2', day: '2026-07-29', daysAgo: 2, mood: 'HARD', reason: null, note: 'Sem contexto pra entregar', author: pessoa('u2', 'Bruno Lima') },
      { id: 'c3', day: '2026-07-31', daysAgo: 0, mood: 'GREAT', reason: null, note: 'Semana ótima!', author: pessoa('u3', 'Carla Dias') },
    ],
    ...overrides,
  }
}

function renderPage(props: { window?: AnalyticsWindowRequest; sectorId?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {/* O comentário identificado leva ao perfil de quem escreveu — o painel
          precisa de Router desde a seção 4.6. */}
      <MemoryRouter>
        <MoodOverviewSection window={props.window ?? { range: '30d' }} sectorId={props.sectorId} />
      </MemoryRouter>
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

  // O atalho "Hoje" mandava `days=1` contra uma rota que exigia 7, então a tela
  // avisava em vez de consultar. A G&G pediu exatamente esse recorte, o piso
  // caiu para 1 e agora ele tem de ir para a API como qualquer outro.
  it('o atalho "Hoje" consulta a API em vez de avisar', async () => {
    const fetchSpy = mockApi(makeOverview())
    renderPage({ window: { range: 'hoje' } })

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/admin/mood/overview?days=1')),
    )
    expect(screen.queryByText(/não consegui ler esse recorte/i)).not.toBeInTheDocument()
  })

  it('período personalizado de três dias também consulta', async () => {
    const fetchSpy = mockApi(makeOverview())
    renderPage({ window: { range: 'custom', from: '2026-07-29', to: '2026-07-31' } })

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('from=2026-07-29&to=2026-07-31'),
      ),
    )
  })

  // Sobra da guarda: recorte que a tela não sabe medir dá 0 dias, e 0 é o único
  // valor que a rota ainda recusa.
  it('recorte que a tela não sabe medir avisa em vez de consultar', async () => {
    const fetchSpy = mockApi(makeOverview())
    renderPage({ window: { range: 'inexistente' as AnalyticsWindowRequest['range'] } })

    expect(await screen.findByText(/não consegui ler esse recorte/i)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/admin/mood/overview'))
  })

  it('mostra a mensagem que a API devolveu quando a consulta falha', async () => {
    vi.spyOn(api, 'apiFetch').mockRejectedValue(new api.ApiError(403, 'Acesso restrito ao seu setor.'))
    renderPage()

    expect(await screen.findByText('Acesso restrito ao seu setor.')).toBeInTheDocument()
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

  it('lista os comentários COM autor, humor, motivo e há quanto tempo', async () => {
    mockApi(makeOverview())
    renderPage()

    // O mesmo comentário negativo aparece nas DUAS caixas: "Causas de alerta"
    // é recorte de "Comentários", não uma lista exclusiva.
    expect(await screen.findAllByText('Semana muito corrida')).toHaveLength(2)
    expect(screen.getAllByText('hoje').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sem contexto pra entregar')).toHaveLength(2)
    // O autor vem junto — é a mudança da seção 4.6.
    expect(screen.getAllByText('Ana Souza').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bruno Lima').length).toBeGreaterThan(0)
  })

  it('a caixa de alerta traz só o negativo; a de comentários traz a escala inteira', async () => {
    mockApi(makeOverview())
    renderPage()

    const alerta = (await screen.findByRole('heading', { name: 'Causas de alerta' })).closest('section')!
    const todos = screen.getByRole('heading', { name: 'Comentários' }).closest('section')!

    expect(within(alerta).queryByText('Semana ótima!')).not.toBeInTheDocument()
    expect(within(todos).getByText('Semana ótima!')).toBeInTheDocument()
    expect(within(todos).getByText('Carla Dias')).toBeInTheDocument()
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

  it('é painel controlado: período e setor vêm de fora, sem seletor próprio', async () => {
    const spy = mockApi(makeOverview())
    renderPage({ window: { range: '90d' }, sectorId: 's1' })

    await waitFor(() => expect(spy).toHaveBeenCalledWith('/admin/mood/overview?days=90&sectorId=s1'))
    // Os dois seletores saíram na desduplicação — quem manda no recorte é a aba
    // Clima de People Analytics, que já tem os dois no cabeçalho.
    expect(screen.queryByRole('combobox', { name: /Janela do período/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /Filtrar por setor/i })).not.toBeInTheDocument()
  })

  it('consulta a API com a janela recebida, e sem setor consulta a empresa toda', async () => {
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
