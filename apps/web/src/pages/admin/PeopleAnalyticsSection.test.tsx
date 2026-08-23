import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { EngagementOverviewDTO, PeopleOverviewDTO } from '@legends/shared'
import { PeopleAnalyticsSection } from './PeopleAnalyticsSection'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, apiFetch: vi.fn() }
})

const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockAuth.role } }),
}))

const mockApiFetch = apiFetch as unknown as Mock

function overviewFixture(patch: Partial<PeopleOverviewDTO> = {}): PeopleOverviewDTO {
  return {
    range: '30d',
    sectorId: null,
    activePeople: 12,
    uniqueUsers7d: 5,
    uniqueUsers30d: 9,
    adoptionRate: 75,
    accessSeries: [
      { day: '2026-06-23', accesses: 4, uniqueUsers: 3 },
      { day: '2026-06-24', accesses: 7, uniqueUsers: 5 },
      { day: '2026-06-25', accesses: 0, uniqueUsers: 0 },
    ],
    votingAdoption: { periodId: 'p1', monthRef: '2026-06', eligible: 10, voted: 6, rate: 60 },
    feedbacksCount: 14,
    feedbackReactionsCount: 21,
    byRole: [
      { key: 'LEGEND', label: 'Lenda', count: 9 },
      { key: 'LEAD', label: 'Líder', count: 3 },
    ],
    bySquad: [{ key: 'Alpha', label: 'Alpha', count: 7 }],
    accessHeatmap: [
      { weekday: 1, hour: 9, accesses: 4 },
      { weekday: 3, hour: 14, accesses: 9 },
    ],
    ...patch,
  }
}

function engagementFixture(patch: Partial<EngagementOverviewDTO> = {}): EngagementOverviewDTO {
  return {
    range: '30d',
    sectorId: null,
    mood: {
      entries: 30,
      participants: 8,
      average: 4.2,
      distribution: [
        { key: 'HARD', label: 'Estressado(a)', count: 1 },
        { key: 'LOW', label: 'Desanimado(a)', count: 2 },
        { key: 'NEUTRAL', label: 'Neutro', count: 5 },
        { key: 'GOOD', label: 'Bem', count: 12 },
        { key: 'GREAT', label: 'Ótimo', count: 10 },
      ],
      trend: [
        { day: '2026-06-23', average: 4.5, entries: 2 },
        { day: '2026-06-24', average: null, entries: 0 },
        { day: '2026-06-25', average: 3.8, entries: 5 },
      ],
    },
    muralReach: {
      postCount: 2,
      uniqueViewers: 11,
      posts: [
        {
          postId: 'post-1',
          authorName: 'Ana',
          excerpt: 'Novo benefício de saúde',
          createdAt: '2026-06-20T15:00:00.000Z',
          comments: 3,
          reactions: 8,
          engagedUsers: 9,
        },
      ],
    },
    topScreens: [
      { path: '/mural', label: 'Mural da empresa', accesses: 40, uniqueUsers: 10 },
      { path: '/perfil/:id', label: 'Perfil de colega', accesses: 12, uniqueUsers: 6 },
    ],
    ...patch,
  }
}

function setupFetch(options: { overview?: PeopleOverviewDTO; engagement?: EngagementOverviewDTO } = {}) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/admin/people/overview')) {
      return Promise.resolve({ overview: options.overview ?? overviewFixture() })
    }
    if (path.startsWith('/admin/people/engagement')) {
      return Promise.resolve({ engagement: options.engagement ?? engagementFixture() })
    }
    if (path.startsWith('/admin/sectors')) {
      return Promise.resolve({ sectors: [{ id: 'sector-gente', name: 'Gente e Gestão', slug: 'gente', active: true }] })
    }
    if (path.startsWith('/admin/users')) return Promise.resolve({ users: [] })
    return Promise.resolve({})
  })
}

/** O `Select` do projeto é um combobox próprio (botão + listbox), não um <select>. */
async function pickOption(comboboxName: string, optionName: string) {
  await userEvent.click(screen.getByRole('combobox', { name: comboboxName }))
  await userEvent.click(await screen.findByRole('option', { name: optionName }))
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PeopleAnalyticsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PeopleAnalyticsSection', () => {
  beforeEach(() => {
    mockAuth.role = 'ADMIN'
    mockApiFetch.mockReset()
  })

  it('mostra os KPIs de adoção e a adesão da votação na aba de visão geral', async () => {
    setupFetch()
    renderSection()

    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())
    const kpi = (label: string) => within(screen.getByRole('group', { name: label }))
    expect(kpi('Pessoas ativas').getByText('12')).toBeInTheDocument()
    expect(kpi('Únicos em 7 dias').getByText('5')).toBeInTheDocument()
    expect(kpi('Únicos em 30 dias').getByText('9')).toBeInTheDocument()
    expect(kpi('Feedbacks').getByText('14')).toBeInTheDocument()
    expect(screen.getByText('Período 2026-06')).toBeInTheDocument()
    expect(screen.getByText(/6 de 10 pessoas elegíveis já votaram/i)).toBeInTheDocument()
    expect(screen.getByText('Lenda')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('troca de aba para clima e engajamento e mostra alcance do Mural e telas', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('tab', { name: /clima & engajamento/i }))

    await waitFor(() => expect(screen.getByText('4.2/5')).toBeInTheDocument())
    expect(screen.getByText('11')).toBeInTheDocument() // visitantes do Mural
    expect(screen.getByText('Novo benefício de saúde')).toBeInTheDocument()
    const linha = screen.getByText('Novo benefício de saúde').closest('tr')!
    expect(within(linha).getByText('3')).toBeInTheDocument() // comentários
    expect(within(linha).getByText('8')).toBeInTheDocument() // reações
    expect(screen.getByText('Mural da empresa')).toBeInTheDocument()
    expect(screen.getByText('Perfil de colega')).toBeInTheDocument()
  })

  it('trocar o filtro de período refaz a busca com o novo range', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    await pickOption('Período de análise', 'Últimos 7 dias')

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('range=7d')),
    )
  })

  it('trocar o filtro de setor refaz a busca com o setor escolhido', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    await pickOption('Setor', 'Gente e Gestão')

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('sectorId=sector-gente')),
    )
  })

  it('não oferece filtro de setor para SUBADMIN (a API usa o setor do token)', async () => {
    mockAuth.role = 'SUBADMIN'
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    expect(screen.queryByRole('combobox', { name: 'Setor' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Período de análise' })).toBeInTheDocument()
  })

  it('mostra estado vazio em português, sem NaN, quando não há dados', async () => {
    setupFetch({
      overview: overviewFixture({
        activePeople: 0,
        uniqueUsers7d: 0,
        uniqueUsers30d: 0,
        adoptionRate: 0,
        accessSeries: [
          { day: '2026-06-24', accesses: 0, uniqueUsers: 0 },
          { day: '2026-06-25', accesses: 0, uniqueUsers: 0 },
        ],
        votingAdoption: null,
        feedbacksCount: 0,
        feedbackReactionsCount: 0,
        byRole: [],
        bySquad: [],
      }),
    })
    renderSection()

    await waitFor(() => expect(screen.getByText('0%')).toBeInTheDocument())
    expect(screen.getByText('Nenhum acesso registrado no período.')).toBeInTheDocument()
    expect(screen.getByText(/nenhum período de votação ativo ou agendado/i)).toBeInTheDocument()
    expect(screen.getAllByText('Nenhuma pessoa ativa no recorte.')).toHaveLength(2)
    expect(document.body.textContent).not.toContain('NaN')
  })

  it('estado vazio do clima não quebra com média null', async () => {
    setupFetch({
      engagement: engagementFixture({
        mood: {
          entries: 0,
          participants: 0,
          average: null,
          distribution: [
            { key: 'HARD', label: 'Estressado(a)', count: 0 },
            { key: 'LOW', label: 'Desanimado(a)', count: 0 },
            { key: 'NEUTRAL', label: 'Neutro', count: 0 },
            { key: 'GOOD', label: 'Bem', count: 0 },
            { key: 'GREAT', label: 'Ótimo', count: 0 },
          ],
          trend: [
            { day: '2026-06-24', average: null, entries: 0 },
            { day: '2026-06-25', average: null, entries: 0 },
          ],
        },
        muralReach: { postCount: 0, uniqueViewers: 0, posts: [] },
        topScreens: [],
      }),
    })
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('tab', { name: /clima & engajamento/i }))

    await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument())
    // Tendência e distribuição mostram o mesmo vazio — daí o getAllByText.
    expect(screen.getAllByText('Ninguém registrou o humor no período.')).toHaveLength(2)
    expect(screen.getByText('Nenhum comunicado publicado no período.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('NaN')
  })

  it('desenha o mapa de calor com a grade 7x24 e o pico rotulado', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    // 7 dias da semana como cabeçalho de linha.
    expect(screen.getByRole('rowheader', { name: 'Seg' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Dom' })).toBeInTheDocument()
    // A célula de maior valor vira o pico da legenda.
    expect(screen.getByText(/pico: 9/)).toBeInTheDocument()
    expect(screen.getByTitle('Qua 14h — 9 acesso(s)')).toBeInTheDocument()
    expect(screen.getByTitle('Seg 09h — 4 acesso(s)')).toBeInTheDocument()
    // Hora sem acesso continua na grade, zerada.
    expect(screen.getByTitle('Ter 03h — 0 acesso(s)')).toBeInTheDocument()
  })

  it('mapa de calor sem acesso nenhum mostra estado vazio', async () => {
    setupFetch({ overview: overviewFixture({ accessHeatmap: [] }) })
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())
    expect(screen.getAllByText('Nenhum acesso registrado no período.').length).toBeGreaterThan(0)
  })

  it('tendência do clima informa a média e não desenha o dia sem registro', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: /clima & engajamento/i }))

    const grafico = await screen.findByRole('img', { name: /tendência do clima/i })
    // 2 dias com média (23 e 25) separados por um sem registro (24) => 2 traços.
    expect(grafico.querySelectorAll('polyline')).toHaveLength(2)
    expect(screen.getByText(/média 4\.2\/5/)).toBeInTheDocument()
  })

  it('tendência do clima sem nenhum registro mostra estado vazio', async () => {
    setupFetch({
      engagement: engagementFixture({
        mood: {
          entries: 0,
          participants: 0,
          average: null,
          distribution: [{ key: 'HARD', label: 'Estressado(a)', count: 0 }],
          trend: [{ day: '2026-06-25', average: null, entries: 0 }],
        },
      }),
    })
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: /clima & engajamento/i }))

    await waitFor(() =>
      expect(screen.getAllByText('Ninguém registrou o humor no período.').length).toBeGreaterThan(0),
    )
  })

  it('mostra erro em português quando a API falha', async () => {
    mockApiFetch.mockRejectedValue(new Error('boom'))
    renderSection()
    await waitFor(() => expect(screen.getByText(/erro ao carregar a visão geral/i)).toBeInTheDocument())
  })
})
