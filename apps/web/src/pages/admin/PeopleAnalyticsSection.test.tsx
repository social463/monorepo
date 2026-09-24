import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type {
  AccessHeatmapDTO,
  CommunicationOverviewDTO,
  EngagementOverviewDTO,
  InovaAnalyticsDTO,
  MoodOverviewDTO,
  PeopleOverviewDTO,
} from '@legends/shared'
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
    from: '2026-05-27',
    to: '2026-06-25',
    days: 30,
    sectorId: null,
    activePeople: 12,
    uniqueUsersInRange: 9,
    accessesInRange: 11,
    adoptionRate: 75,
    accessSeries: [
      { day: '2026-06-23', accesses: 4, uniqueUsers: 3 },
      { day: '2026-06-24', accesses: 7, uniqueUsers: 5 },
      { day: '2026-06-25', accesses: 0, uniqueUsers: 0 },
    ],
    engagementSeries: [
      { day: '2026-06-23', feedbacks: 2, reactions: 3, comments: 1 },
      { day: '2026-06-24', feedbacks: 1, reactions: 0, comments: 0 },
      { day: '2026-06-25', feedbacks: 0, reactions: 0, comments: 0 },
    ],
    feedbacksCount: 14,
    feedbackReactionsCount: 21,
    postsPublished: 4,
    feedbacksByCategory: [{ key: 'c1', label: 'Colaboração', count: 6 }],
    feedbacksByTag: [{ key: 'proatividade', label: 'Proatividade', count: 2 }],
    byRole: [
      { key: 'LEGEND', label: 'Lenda', count: 9 },
      { key: 'LEAD', label: 'Líder', count: 3 },
    ],
    bySquad: [{ key: 'Alpha', label: 'Alpha', count: 7 }],
    ...patch,
  }
}

function engagementFixture(patch: Partial<EngagementOverviewDTO> = {}): EngagementOverviewDTO {
  return {
    range: '30d',
    from: '2026-05-27',
    to: '2026-06-25',
    days: 30,
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

/** O mapa de calor, agora endpoint próprio (seção 4.2). */
function heatmapFixture(): AccessHeatmapDTO {
  return {
    from: '2026-05-27',
    to: '2026-06-25',
    days: 30,
    sectorId: null,
    cells: [
      { weekday: 1, hour: 9, accesses: 4 },
      { weekday: 3, hour: 14, accesses: 9 },
    ],
    avgSessionMinutes: 12.5,
    sessions: 42,
  }
}

/** O painel de Comunicação Interna, que a aba Engajamento monta (seção 4.8). */
function communicationFixture(): CommunicationOverviewDTO {
  return {
    from: '2026-05-27',
    to: '2026-06-25',
    days: 30,
    sectorId: null,
    tagId: null,
    averageReadPct: 42.5,
    totalEngagement: 11,
    postsPublished: 2,
    mostRead: {
      postId: 'post-1',
      excerpt: 'Novo benefício de saúde',
      createdAt: '2026-06-20T15:00:00.000Z',
      reads: 9,
      reactions: 8,
      comments: 3,
      readPct: 75,
    },
    pointsAwarded: 40,
    series: [{ day: '2026-06-25', reads: 4, interactions: 2 }],
    bySector: [{ sectorId: 's1', sectorName: 'Ensino', people: 4, readers: 3, reachPct: 75 }],
    reactions: [{ key: '💚', label: '💚', count: 5 }],
    topPosts: [
      {
        postId: 'post-1',
        excerpt: 'Novo benefício de saúde',
        createdAt: '2026-06-20T15:00:00.000Z',
        reads: 9,
        reactions: 8,
        comments: 3,
        readPct: 75,
      },
    ],
    bestSendTime: { weekday: 3, hour: 10, readPct: 62, posts: 4 },
    lowReachSectors: [{ sectorId: 's2', sectorName: 'Parado', daysSince: null }],
  }
}

/** O termômetro que a aba Clima monta — só o suficiente para ele renderizar. */
function moodOverviewFixture(): MoodOverviewDTO {
  return {
    days: 30,
    sectorId: null,
    weekAverage: 4.1,
    participationToday: { responded: 3, total: 10, percent: 30 },
    totalEntries: 12,
    trend: [{ day: '2026-06-25', average: 4.1, count: 3, suppressed: false }],
    todayDistribution: [],
    reasons: [],
    alertComments: [],
    comments: [],
  }
}

function inovaFixture(patch: Partial<InovaAnalyticsDTO> = {}): InovaAnalyticsDTO {
  return {
    range: '30d',
    from: '2026-05-27',
    to: '2026-06-25',
    days: 30,
    sectorId: null,
    totalAccesses: 0,
    uniqueUsers: 0,
    topPage: null,
    byPage: [],
    recentLogs: [],
    recentLogsTotal: 0,
    ...patch,
  }
}

function setupFetch(
  options: {
    overview?: PeopleOverviewDTO
    engagement?: EngagementOverviewDTO
    heatmap?: AccessHeatmapDTO
    communication?: CommunicationOverviewDTO
    inova?: InovaAnalyticsDTO
  } = {},
) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/admin/people/overview')) {
      return Promise.resolve({ overview: options.overview ?? overviewFixture() })
    }
    if (path.startsWith('/admin/people/engagement')) {
      return Promise.resolve({ engagement: options.engagement ?? engagementFixture() })
    }
    if (path.startsWith('/admin/people/inova')) {
      return Promise.resolve({ inova: options.inova ?? inovaFixture() })
    }
    if (path.startsWith('/admin/communication/overview')) {
      return Promise.resolve({ communication: options.communication ?? communicationFixture() })
    }
    if (path.startsWith('/corporate-post-tags')) return Promise.resolve({ tags: [] })
    if (path.startsWith('/admin/people/heatmap')) {
      return Promise.resolve({ heatmap: options.heatmap ?? heatmapFixture() })
    }
    if (path.startsWith('/admin/mood/overview')) {
      return Promise.resolve({ overview: moodOverviewFixture() })
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

// A aba padrão da tela agora é o Dashboard; os testes de Visão geral pedem
// a aba na URL, que é como `/admin` também chega aqui.
function renderSection(initialRoute = '/admin/pessoas?aba=overview') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
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

  it('mostra os KPIs de adoção na aba de visão geral, com legenda dinâmica', async () => {
    setupFetch()
    renderSection()

    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())
    const kpi = (label: string) => within(screen.getByRole('group', { name: label }))
    expect(kpi('Pessoas ativas').getByText('12')).toBeInTheDocument()
    // Os dois cards de janela FIXA (7 e 30 dias) viraram um do período e um de
    // acessos totais — era o card fixo que ignorava o filtro (seção 4.1).
    expect(kpi('Únicos no período').getByText('9')).toBeInTheDocument()
    expect(kpi('Acessos no período').getByText('11')).toBeInTheDocument()
    expect(kpi('Feedbacks').getByText('14')).toBeInTheDocument()
    // A legenda sai da janela devolvida pelo servidor, não de texto cravado.
    expect(screen.getAllByText('Nos últimos 30 dias').length).toBeGreaterThan(0)
    expect(screen.getByText('Lenda')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('analisa os feedbacks por competência e por tag (seção 4.3)', async () => {
    setupFetch()
    renderSection()

    await waitFor(() => expect(screen.getByText('Colaboração')).toBeInTheDocument())
    expect(screen.getByText('Proatividade')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Feedbacks por competência' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Feedbacks por tag' })).toBeInTheDocument()
  })

  it('período personalizado manda from/to na consulta', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    await pickOption('Período', 'Personalizado…')
    fireEvent.change(screen.getByLabelText('Período — data inicial'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText('Período — data final'), { target: { value: '2026-06-10' } })

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/people/overview?range=custom&from=2026-06-01&to=2026-06-10',
      ),
    )
  })

  it('a aba Dashboard traz KPIs e o gráfico de engajamento (seção 3)', async () => {
    setupFetch()
    renderSection('/admin/pessoas')

    // Sem `?aba=`, a tela abre no Dashboard — é para onde `/admin` manda.
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true')
    const kpi = (label: string) => within(screen.getByRole('group', { name: label }))
    await waitFor(() => expect(kpi('Usuários ativos').getByText('9')).toBeInTheDocument())
    expect(kpi('Publicações').getByText('4')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Engajamento dos usuários' })).toBeInTheDocument()
  })

  it('o mapa de calor tem filtro próprio e mostra o tempo médio derivado (seção 4.2)', async () => {
    setupFetch()
    renderSection()

    await waitFor(() => expect(screen.getByText('12.5 min')).toBeInTheDocument())
    expect(screen.getByText(/42 sessões · estimado pelo histórico de navegação, é um piso/)).toBeInTheDocument()
    // Filtro do bloco, separado do da tela.
    expect(screen.getByRole('combobox', { name: 'Período do mapa' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Setor do mapa de calor' })).toBeInTheDocument()
  })

  it('mexer no filtro do mapa não mexe no resto da tela', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('12.5 min')).toBeInTheDocument())

    await pickOption('Período do mapa', 'Últimos 7 dias')

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/people/heatmap?range=7d'),
    )
    // A visão geral continua no recorte do cabeçalho.
    expect(mockApiFetch).not.toHaveBeenCalledWith('/admin/people/overview?range=7d')
    expect(screen.getByText('Voltar ao filtro da tela')).toBeInTheDocument()
  })

  it('a aba de engajamento traz as telas mais acessadas, e não mais a comunicação', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('tab', { name: 'Engajamento' }))

    await waitFor(() => expect(screen.getByText('Mural da empresa')).toBeInTheDocument())
    expect(screen.getByText('Perfil de colega')).toBeInTheDocument()
    // A Comunicação Interna virou aba própria — não pode aparecer nas duas.
    expect(screen.queryByRole('heading', { name: 'Comunicação Interna' })).not.toBeInTheDocument()
    // O resumo de humor saiu daqui: ele agora é a aba Clima, inteira.
    expect(screen.queryByText('Humor médio')).not.toBeInTheDocument()
  })

  it('a Comunicação Interna é aba própria, com o painel da seção 4.8', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('tab', { name: 'Comunicação Interna' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Comunicação Interna' })).toBeInTheDocument())
    expect(screen.getAllByText('Novo benefício de saúde').length).toBeGreaterThan(0)
    expect(screen.getByText('42.5%')).toBeInTheDocument() // taxa média de leitura
    expect(screen.getByText('Qua, 10h')).toBeInTheDocument() // melhor horário
    expect(screen.getByText('nunca interagiu')).toBeInTheDocument() // alerta de alcance
    // Nada de "Telas mais acessadas" aqui: navegação é uso do produto, não comunicação.
    expect(screen.queryByText('Mural da empresa')).not.toBeInTheDocument()
  })

  it('o painel de comunicação segue o período do cabeçalho, sem filtro próprio', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('tab', { name: 'Comunicação Interna' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Comunicação Interna' })).toBeInTheDocument())

    // Como aba, ele obedece ao recorte da tela — igual ao Clima. Um segundo
    // seletor de período empilhado diria que existem dois recortes.
    expect(screen.queryByRole('combobox', { name: 'Período do painel' })).not.toBeInTheDocument()
    await pickOption('Período', 'Últimos 7 dias')
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/admin/communication/overview?range=7d')),
    )
  })

  it('trocar o filtro de período refaz a busca com o novo range', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    await pickOption('Período', 'Últimos 7 dias')

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/admin/people/overview?range=7d'))
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
    expect(screen.getByRole('combobox', { name: 'Período' })).toBeInTheDocument()
  })

  it('mostra estado vazio em português, sem NaN, quando não há dados', async () => {
    setupFetch({
      overview: overviewFixture({
        activePeople: 0,
        uniqueUsersInRange: 0,
        accessesInRange: 0,
        adoptionRate: 0,
        accessSeries: [
          { day: '2026-06-24', accesses: 0, uniqueUsers: 0 },
          { day: '2026-06-25', accesses: 0, uniqueUsers: 0 },
        ],
        feedbacksCount: 0,
        feedbackReactionsCount: 0,
        feedbacksByCategory: [],
        feedbacksByTag: [],
        byRole: [],
        bySquad: [],
      }),
    })
    renderSection()

    await waitFor(() => expect(screen.getByText('0%')).toBeInTheDocument())
    expect(screen.getByText('Nenhum acesso registrado no período.')).toBeInTheDocument()
    expect(screen.getAllByText('Nenhuma pessoa ativa no recorte.')).toHaveLength(2)
    expect(document.body.textContent).not.toContain('NaN')
  })

  it('estado vazio do engajamento não quebra nem escreve NaN', async () => {
    setupFetch({
      engagement: engagementFixture({ topScreens: [] }),
      communication: {
        ...communicationFixture(),
        postsPublished: 0,
        averageReadPct: 0,
        totalEngagement: 0,
        mostRead: null,
        series: [{ day: '2026-06-25', reads: 0, interactions: 0 }],
        bySector: [],
        reactions: [],
        topPosts: [],
        bestSendTime: null,
        lowReachSectors: [],
      },
    })
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('tab', { name: 'Engajamento' }))

    await waitFor(() =>
      expect(screen.getByText('Nenhum acesso registrado no período.')).toBeInTheDocument(),
    )
    expect(document.body.textContent).not.toContain('NaN')

    // O vazio da comunicação agora é de outra aba — as duas precisam aguentar.
    await userEvent.click(screen.getByRole('tab', { name: 'Comunicação Interna' }))

    await waitFor(() =>
      expect(screen.getByText('Nenhum comunicado publicado no período.')).toBeInTheDocument(),
    )
    // Sem base, o "melhor horário" cala em vez de apontar vencedor de ruído.
    expect(
      screen.getByText('Ainda não há comunicados suficientes num mesmo horário para recomendar.'),
    ).toBeInTheDocument()
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
    setupFetch({
      heatmap: { ...heatmapFixture(), cells: [], avgSessionMinutes: null, sessions: 0 },
    })
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())
    expect(screen.getAllByText('Nenhum acesso registrado no período.').length).toBeGreaterThan(0)
    // Sem sessão, o tempo médio é traço — não "0 min", que diria outra coisa.
    expect(screen.getByText('Sem acessos no recorte')).toBeInTheDocument()
  })

  it('a aba Clima monta o termômetro completo, no recorte do cabeçalho', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('tab', { name: 'Clima' }))

    // O painel que vivia em `/admin/clima`: participação de hoje e comentários.
    await waitFor(() => expect(screen.getByText('Distribuição de hoje')).toBeInTheDocument())
    expect(screen.getByText('Participação de hoje')).toBeInTheDocument()
    // O `days` sai do filtro de período da tela, não de um seletor próprio.
    expect(mockApiFetch).toHaveBeenCalledWith('/admin/mood/overview?days=30')
    expect(screen.queryByRole('combobox', { name: 'Janela do período' })).not.toBeInTheDocument()
  })

  // O atalho ficou apagado na aba Clima enquanto o termômetro exigia 7 dias.
  // Era justamente o recorte que a G&G queria ver, o piso caiu para 1 e agora
  // clicar nele tem de recortar o painel no dia corrente.
  it('a aba Clima aceita o atalho "Hoje" e recorta o termômetro nele', async () => {
    setupFetch()
    renderSection('/admin/pessoas?aba=clima')
    await waitFor(() => expect(screen.getByText('Distribuição de hoje')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('combobox', { name: 'Período' }))
    const hoje = await screen.findByRole('option', { name: 'Hoje' })
    expect(hoje).not.toHaveAttribute('aria-disabled')

    await userEvent.click(hoje)
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/admin/mood/overview?days=1')),
    )
  })

  it('nas outras abas o atalho "Hoje" continua disponível', async () => {
    setupFetch()
    renderSection()
    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('combobox', { name: 'Período' }))
    expect(await screen.findByRole('option', { name: 'Hoje' })).not.toHaveAttribute('aria-disabled')
  })

  it('abre direto na aba pedida pela URL — é para lá que /admin/clima redireciona', async () => {
    setupFetch()
    renderSection('/admin/pessoas?aba=clima')

    await waitFor(() => expect(screen.getByText('Distribuição de hoje')).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Clima' })).toHaveAttribute('aria-selected', 'true')
  })

  it('mostra erro em português quando a API falha', async () => {
    mockApiFetch.mockRejectedValue(new Error('boom'))
    renderSection()
    await waitFor(() => expect(screen.getByText(/erro ao carregar a visão geral/i)).toBeInTheDocument())
  })

  // A aba "Treinamentos" virou "Desenvolvimento", guarda-chuva de Treinamento
  // e Comunidade INOVA — cada trilha na sua sub-aba.
  it('a aba Desenvolvimento abre em Treinamento por padrão', async () => {
    setupFetch()
    renderSection('/admin/pessoas?aba=desenvolvimento')

    expect(screen.getByRole('tab', { name: 'Desenvolvimento' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Treinamento' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Comunidade INOVA' })).toHaveAttribute('aria-selected', 'false')
    await waitFor(() =>
      expect(screen.getByText('Erro ao carregar o painel de Treinamentos.')).toBeInTheDocument(),
    )
  })

  it('troca para a sub-aba Comunidade INOVA e mostra o analytics de acesso ao Guia', async () => {
    setupFetch({
      inova: inovaFixture({
        totalAccesses: 12,
        uniqueUsers: 4,
        topPage: { path: '/comunidade-inova/guia/prompts', label: 'Guia: Prompts', accesses: 7, uniqueUsers: 3 },
        byPage: [
          { path: '/comunidade-inova/guia/prompts', label: 'Guia: Prompts', accesses: 7, uniqueUsers: 3 },
          { path: '/comunidade-inova/guia', label: 'Guia: Início', accesses: 5, uniqueUsers: 4 },
        ],
        recentLogs: [
          { id: 'log-1', userName: 'Gina', userEmail: 'gina@x.com', path: '/comunidade-inova/guia/prompts', label: 'Guia: Prompts', createdAt: '2026-06-24T15:00:00.000Z' },
          { id: 'log-2', userName: 'Bruno', userEmail: 'bruno@x.com', path: '/comunidade-inova/guia', label: 'Guia: Início', createdAt: '2026-06-23T12:00:00.000Z' },
        ],
        recentLogsTotal: 2,
      }),
    })
    renderSection('/admin/pessoas?aba=desenvolvimento')
    await waitFor(() =>
      expect(screen.getByText('Erro ao carregar o painel de Treinamentos.')).toBeInTheDocument(),
    )

    await userEvent.click(screen.getByRole('tab', { name: 'Comunidade INOVA' }))

    expect(screen.getByRole('tab', { name: 'Comunidade INOVA' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Treinamento' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByText('Erro ao carregar o painel de Treinamentos.')).not.toBeInTheDocument()

    const kpi = (label: string) => within(screen.getByRole('group', { name: label }))
    await waitFor(() => expect(kpi('Total de acessos').getByText('12')).toBeInTheDocument())
    expect(kpi('Usuários únicos').getByText('4')).toBeInTheDocument()
    expect(kpi('Página mais acessada').getByText('Guia: Prompts')).toBeInTheDocument()
    expect(screen.getByText('Gina')).toBeInTheDocument()
    expect(screen.getByText('gina@x.com')).toBeInTheDocument()
    expect(screen.getByText('Bruno')).toBeInTheDocument()
  })

  it('filtra o log de acessos do Guia por nome ou e-mail', async () => {
    setupFetch({
      inova: inovaFixture({
        totalAccesses: 2,
        uniqueUsers: 2,
        recentLogs: [
          { id: 'log-1', userName: 'Gina', userEmail: 'gina@x.com', path: '/comunidade-inova/guia/prompts', label: 'Guia: Prompts', createdAt: '2026-06-24T15:00:00.000Z' },
          { id: 'log-2', userName: 'Bruno', userEmail: 'bruno@x.com', path: '/comunidade-inova/guia', label: 'Guia: Início', createdAt: '2026-06-23T12:00:00.000Z' },
        ],
        recentLogsTotal: 2,
      }),
    })
    renderSection('/admin/pessoas?aba=desenvolvimento&sub=inova')
    await waitFor(() => expect(screen.getByText('Gina')).toBeInTheDocument())
    expect(screen.getByText('Bruno')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Buscar por nome ou e-mail'), 'gina')

    expect(screen.getByText('Gina')).toBeInTheDocument()
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument()
  })

  it('avisa quando o log mostra só uma parte dos acessos do período', async () => {
    setupFetch({
      inova: inovaFixture({
        totalAccesses: 3,
        recentLogs: [
          { id: 'log-1', userName: 'Gina', userEmail: 'gina@x.com', path: '/comunidade-inova/guia', label: 'Guia: Início', createdAt: '2026-06-24T15:00:00.000Z' },
        ],
        recentLogsTotal: 3,
      }),
    })
    renderSection('/admin/pessoas?aba=desenvolvimento&sub=inova')

    await waitFor(() => expect(screen.getByText(/mostrando os 1 acessos mais recentes de 3/i)).toBeInTheDocument())
  })
})
