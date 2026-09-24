import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { CampaignPostDTO, ScheduledFeedPostDTO } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { CampaignsSection } from './CampaignsSection'

const previewCampaign = vi.fn()
const confirmCampaign = vi.fn()
const listCampaignPosts = vi.fn()
const publishCampaignPost = vi.fn()
const listScheduledFeedPosts = vi.fn()
const deleteCampaignPost = vi.fn()
const getCampaignCalendarContext = vi.fn()

vi.mock('../../lib/campaign-api', () => ({
  previewCampaign: (body: unknown) => previewCampaign(body),
  confirmCampaign: (body: unknown) => confirmCampaign(body),
  listCampaignPosts: (from: string, to: string) => listCampaignPosts(from, to),
  listScheduledFeedPosts: (from: string, to: string) => listScheduledFeedPosts(from, to),
  createCampaignPost: vi.fn(),
  updateCampaignPost: vi.fn(),
  publishCampaignPost: (id: string) => publishCampaignPost(id),
  cancelCampaignPost: vi.fn(),
  deleteCampaignPost: (id: string) => deleteCampaignPost(id),
  getCampaignCalendarContext: (from: string, to: string) => getCampaignCalendarContext(from, to),
}))

// O seletor de responsável do CampaignCalendar chama /users?scope=company via
// apiFetch direto — não passa pelo campaign-api.ts. A aba Publicar e o painel
// do modelo padrão também batem em apiFetch, então o mock responde por rota.
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return {
    ...actual,
    apiFetch: vi.fn((path: string) => {
      if (path.startsWith('/admin/campaign-prompt-template')) {
        return Promise.resolve({ template: 'Modelo oficial.', isDefault: true })
      }
      if (path.startsWith('/corporate-post-tags')) return Promise.resolve({ tags: [] })
      if (path.startsWith('/sectors')) return Promise.resolve({ sectors: [] })
      return Promise.resolve({ users: [] })
    }),
  }
})

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'G&G', role: 'ADMIN', adminAccess: true } }),
}))

const post = (over: Partial<CampaignPostDTO> = {}): CampaignPostDTO => ({
  id: 'cp1',
  campaignId: 'c1',
  campaignTheme: 'Semana da segurança',
  title: 'Abertura',
  body: 'Começa a semana da segurança.',
  visualHint: null,
  image: null,
  scheduledFor: '2026-09-01T12:00:00.000Z',
  channel: 'MURAL',
  audience: 'ALL',
  status: 'SCHEDULED',
  responsibleId: null,
  responsibleName: null,
  publishedPostId: null,
  publishedAt: null,
  createdAt: '2026-08-01T12:00:00.000Z',
  ...over,
})

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // MemoryRouter: o 503 da aba Gerar mostra um <Link to="/admin/ia">
  // (CampaignGenerator), que precisa de contexto de rota — a tela real sempre
  // roda dentro de uma <Route> do App.tsx.
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CampaignsSection />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const agendadoNoFeed = (over: Partial<ScheduledFeedPostDTO> = {}): ScheduledFeedPostDTO => ({
  id: 'fp1',
  title: 'Aviso do time',
  content: 'Texto do comunicado do feed.',
  authorId: 'u9',
  authorName: 'Marina',
  publishAt: '2026-09-01T16:30:00.000Z',
  createdAt: '2026-08-30T12:00:00.000Z',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  listCampaignPosts.mockResolvedValue({ posts: [post()] })
  listScheduledFeedPosts.mockResolvedValue({ posts: [] })
  getCampaignCalendarContext.mockResolvedValue({ occurrences: [], birthdays: [], workAnniversaries: [] })
})

describe('CampaignsSection', () => {
  it('abre no calendário e mostra os itens do mês', async () => {
    renderSection()
    expect(await screen.findByText('Abertura')).toBeInTheDocument()
  })

  // A grade numerava 1..31 em sete colunas, então o dia 1 caía sempre na
  // primeira coluna: "quinta" aqui e "quinta" no calendário de todo mundo eram
  // colunas diferentes.
  it('alinha os dias ao dia real da semana, como o calendário de todos', async () => {
    renderSection()

    await screen.findByText('Abertura')
    for (const rotulo of ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']) {
      expect(screen.getByText(rotulo)).toBeInTheDocument()
    }
  })

  it('desenha a campanha como faixa contínua por trás dos comunicados', async () => {
    listCampaignPosts.mockResolvedValue({
      posts: [post()],
      campaigns: [
        {
          id: 'c1',
          theme: 'Setembro Amarelo',
          startsAt: '2026-09-01T12:00:00.000Z',
          endsAt: '2026-09-10T12:00:00.000Z',
        },
      ],
    })
    renderSection()

    // 01 → 10 de setembro atravessa duas semanas da grade, então a faixa vira
    // dois trechos — e não dez chips soltos, um por dia.
    const trechos = await screen.findAllByTitle('Campanha Setembro Amarelo')
    expect(trechos).toHaveLength(2)
  })

  it('mês sem campanha não desenha faixa nenhuma', async () => {
    renderSection()

    await screen.findByText('Abertura')
    expect(screen.queryByTitle(/^Campanha /)).not.toBeInTheDocument()
  })

  it('mostra a arte do item e o que a data significa no canal que publica sozinho', async () => {
    listCampaignPosts.mockResolvedValue({
      posts: [post({ image: { url: 'https://cdn.exemplo.com/arte.png', width: 1200, height: 630 } })],
    })
    renderSection()

    fireEvent.click(await screen.findByText('Abertura'))

    expect(await screen.findByAltText('Arte do comunicado')).toHaveAttribute(
      'src',
      'https://cdn.exemplo.com/arte.png',
    )
    // A tela precisa dizer o que a data faz: era exatamente o que faltava para
    // quem agendava e não achava o comunicado em lugar nenhum.
    expect(screen.getByText(/sai sozinho no mural/i)).toBeInTheDocument()
  })

  it('avisa que canal de entrega manual não dispara nada', async () => {
    listCampaignPosts.mockResolvedValue({ posts: [post({ channel: 'TEAMS' })] })
    renderSection()

    fireEvent.click(await screen.findByText('Abertura'))

    expect(screen.getByText(/entrega manual/i)).toBeInTheDocument()
    expect(screen.queryByText(/sai sozinho no mural/i)).not.toBeInTheDocument()
  })

  it('mostra na mesma grade o que foi agendado direto no Feed', async () => {
    // O valor da grade unificada é ver que já havia comunicado marcado para o
    // mesmo dia — antes, agendado do Feed não aparecia para a G&G em lugar nenhum.
    listScheduledFeedPosts.mockResolvedValue({ posts: [agendadoNoFeed()] })
    renderSection()

    expect(await screen.findByText('Abertura')).toBeInTheDocument()
    expect(screen.getByText('Aviso do time')).toBeInTheDocument()
    expect(screen.getByText(/Feed · Marina/)).toBeInTheDocument()
  })

  it('abre o agendado do Feed em leitura, sem salvar nem publicar', async () => {
    listScheduledFeedPosts.mockResolvedValue({ posts: [agendadoNoFeed()] })
    renderSection()

    fireEvent.click(await screen.findByText('Aviso do time'))

    expect(screen.getByText('Texto do comunicado do feed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /excluir comunicado/i })).toBeInTheDocument()
    // Reagendar e editar não existem nem para o autor de um agendado do Feed.
    expect(screen.queryByRole('button', { name: /^salvar$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /publicar agora/i })).not.toBeInTheDocument()
  })

  it('falha só na consulta do Feed não derruba o calendário editorial', async () => {
    listScheduledFeedPosts.mockRejectedValue(new ApiError(500, 'quebrou'))
    renderSection()

    expect(await screen.findByText('Abertura')).toBeInTheDocument()
    expect(await screen.findByText(/só os itens do calendário/i)).toBeInTheDocument()
  })

  it('exclui um item cancelado, com confirmação antes', async () => {
    // O cancelado fica riscado na grade e não sai de lá — daí a exclusão.
    listCampaignPosts.mockResolvedValue({ posts: [post({ status: 'CANCELLED' })] })
    deleteCampaignPost.mockResolvedValue(undefined)
    renderSection()

    fireEvent.click(await screen.findByText('Abertura'))
    // Cancelar não aparece no que já está cancelado: ao lado do Excluir,
    // parecia a mesma coisa.
    expect(screen.queryByRole('button', { name: /cancelar comunicado/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))

    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent(/irreversível/i)
    expect(deleteCampaignPost).not.toHaveBeenCalled()

    fireEvent.click(within(dialogo).getByRole('button', { name: /^excluir$/i }))
    await waitFor(() => expect(deleteCampaignPost).toHaveBeenCalledWith('cp1'))
  })

  it('voltar no diálogo não exclui nada', async () => {
    listCampaignPosts.mockResolvedValue({ posts: [post()] })
    renderSection()

    fireEvent.click(await screen.findByText('Abertura'))
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /voltar/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteCampaignPost).not.toHaveBeenCalled()
  })

  it('gera N cartões no preview sem gravar nada', async () => {
    previewCampaign.mockResolvedValue({
      drafts: [
        { title: 'A', body: 'Corpo A', visualHint: null, scheduledFor: '2026-09-01T12:00:00.000Z' },
        { title: 'B', body: 'Corpo B', visualHint: null, scheduledFor: '2026-09-03T12:00:00.000Z' },
      ],
    })
    const user = userEvent.setup()
    renderSection()

    await user.click(screen.getByRole('tab', { name: /gerar/i }))
    await user.type(screen.getByLabelText(/tema/i), 'Semana da segurança')
    await user.type(screen.getByLabelText(/data inicial/i), '2026-09-01')
    await user.type(screen.getByLabelText(/data final/i), '2026-09-10')
    await user.clear(screen.getByLabelText(/quantidade/i))
    await user.type(screen.getByLabelText(/quantidade/i), '2')
    await user.click(screen.getByRole('button', { name: /gerar comunicados/i }))

    expect(await screen.findByDisplayValue('Corpo A')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Corpo B')).toBeInTheDocument()
    expect(confirmCampaign).not.toHaveBeenCalled()
    expect(screen.getByText(/nada foi gravado ainda/i)).toBeInTheDocument()
  })

  it('preserva a edição do rascunho ao confirmar', async () => {
    previewCampaign.mockResolvedValue({
      drafts: [{ title: 'A', body: 'Corpo A', visualHint: null, scheduledFor: '2026-09-01T12:00:00.000Z' }],
    })
    confirmCampaign.mockResolvedValue({ posts: [post()] })
    const user = userEvent.setup()
    renderSection()

    await user.click(screen.getByRole('tab', { name: /gerar/i }))
    await user.type(screen.getByLabelText(/tema/i), 'Tema')
    await user.type(screen.getByLabelText(/data inicial/i), '2026-09-01')
    await user.type(screen.getByLabelText(/data final/i), '2026-09-10')
    await user.click(screen.getByRole('button', { name: /gerar comunicados/i }))

    const corpo = await screen.findByDisplayValue('Corpo A')
    await user.clear(corpo)
    await user.type(corpo, 'Corpo EDITADO')
    // O texto do botão é dinâmico ('Confirmar e agendar' / 'Agendando…' durante
    // a mutation) — buscamos antes do clique, com a referência já em mãos.
    await user.click(screen.getByRole('button', { name: /confirmar e agendar/i }))

    await waitFor(() => expect(confirmCampaign).toHaveBeenCalled())
    expect(confirmCampaign.mock.calls[0][0].posts[0].body).toBe('Corpo EDITADO')
  })

  it('limpar a data de um cartão do preview não derruba a tela nem os outros cartões', async () => {
    // Regressão do ACHADO 1: limpar um datetime-local (selecionar tudo +
    // Backspace) dispara `change` com value === ''. `new Date('').toISOString()`
    // lançava RangeError dentro do handler, antes de `atualizar` rodar — o
    // React propagava pro error boundary mais próximo e o usuário perdia TODOS
    // os rascunhos não confirmados (o preview não grava nada no servidor).
    previewCampaign.mockResolvedValue({
      drafts: [
        { title: 'A', body: 'Corpo A', visualHint: null, scheduledFor: '2026-09-01T12:00:00.000Z' },
        { title: 'B', body: 'Corpo B', visualHint: null, scheduledFor: '2026-09-03T12:00:00.000Z' },
      ],
    })
    const user = userEvent.setup()
    renderSection()

    await user.click(screen.getByRole('tab', { name: /gerar/i }))
    await user.type(screen.getByLabelText(/tema/i), 'Tema')
    await user.type(screen.getByLabelText(/data inicial/i), '2026-09-01')
    await user.type(screen.getByLabelText(/data final/i), '2026-09-10')
    await user.click(screen.getByRole('button', { name: /gerar comunicados/i }))

    await screen.findByDisplayValue('Corpo A')
    const dataDoCartaoA = screen.getByLabelText('Data do comunicado 1')

    // Simula exatamente o `change` que o navegador dispara ao limpar o campo —
    // é o gatilho real do bug, não uma sequência de teclas que o jsdom pode
    // não reproduzir fielmente para datetime-local.
    fireEvent.change(dataDoCartaoA, { target: { value: '' } })

    // A tela não derrubou: os dois cartões (com os corpos originais)
    // continuam visíveis, nada foi perdido.
    expect(screen.getByDisplayValue('Corpo A')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Corpo B')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirmar e agendar/i })).toBeInTheDocument()
  })

  it('confirmar leva o calendário para o mês do primeiro item agendado', async () => {
    // Regressão do ACHADO 7: uma campanha agendada para um mês futuro,
    // confirmada hoje, não pode cair numa grade do mês atual vazia e sem
    // nenhuma evidência de que algo foi salvo.
    previewCampaign.mockResolvedValue({
      drafts: [{ title: 'A', body: 'Corpo A', visualHint: null, scheduledFor: '2026-12-05T12:00:00.000Z' }],
    })
    confirmCampaign.mockResolvedValue({
      posts: [post({ id: 'cp-dez', scheduledFor: '2026-12-05T12:00:00.000Z' })],
    })
    const user = userEvent.setup()
    renderSection()

    await user.click(screen.getByRole('tab', { name: /gerar/i }))
    await user.type(screen.getByLabelText(/tema/i), 'Tema')
    await user.type(screen.getByLabelText(/data inicial/i), '2026-12-01')
    await user.type(screen.getByLabelText(/data final/i), '2026-12-10')
    await user.click(screen.getByRole('button', { name: /gerar comunicados/i }))
    await screen.findByDisplayValue('Corpo A')
    await user.click(screen.getByRole('button', { name: /confirmar e agendar/i }))

    await waitFor(() => expect(confirmCampaign).toHaveBeenCalled())

    // Volta pra aba Calendário sozinho, no mês certo (dezembro/2026, não o mês
    // corrente em que o teste roda) — e com uma confirmação visível de quantos
    // itens foram agendados.
    expect(await screen.findByRole('heading', { name: /dezembro de 2026/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/1 comunicado agendado/i)
  })

  it('avisa que a campanha publica para toda a empresa quando o alvo é liderança', async () => {
    previewCampaign.mockResolvedValue({
      drafts: [{ title: 'A', body: 'Corpo A', visualHint: null, scheduledFor: '2026-09-01T12:00:00.000Z' }],
    })
    const user = userEvent.setup()
    renderSection()

    await user.click(screen.getByRole('tab', { name: /gerar/i }))
    await user.selectOptions(screen.getByLabelText(/público/i), 'LEADERSHIP')
    await user.type(screen.getByLabelText(/tema/i), 'Tema')
    await user.type(screen.getByLabelText(/data inicial/i), '2026-09-01')
    await user.type(screen.getByLabelText(/data final/i), '2026-09-10')
    await user.click(screen.getByRole('button', { name: /gerar comunicados/i }))

    expect(await screen.findByText(/publica para toda a empresa/i)).toBeInTheDocument()
  })

  it('mostra o 503 na aba Gerar sem derrubar o calendário', async () => {
    previewCampaign.mockRejectedValue(new ApiError(503, 'Agente de IA não configurado.'))
    const user = userEvent.setup()
    renderSection()

    await user.click(screen.getByRole('tab', { name: /gerar/i }))
    await user.type(screen.getByLabelText(/tema/i), 'Tema')
    await user.type(screen.getByLabelText(/data inicial/i), '2026-09-01')
    await user.type(screen.getByLabelText(/data final/i), '2026-09-10')
    await user.click(screen.getByRole('button', { name: /gerar comunicados/i }))

    expect(await screen.findByText(/não configurado/i)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /calendário/i }))
    expect(await screen.findByText('Abertura')).toBeInTheDocument()
  })

  it('mostra eventos do calendário organizacional e aniversários/tempo de casa junto com a campanha', async () => {
    getCampaignCalendarContext.mockResolvedValue({
      occurrences: [
        {
          eventId: 'ev1',
          iso: '2026-09-01',
          endIso: '2026-09-01',
          title: 'Feriado municipal',
          description: '',
          startTime: null,
          endTime: null,
          typeSlug: 'feriado',
          typeName: 'Feriado',
          typeIcon: 'event',
          color: '#6366f1',
          audienceTags: [],
          isInternalComm: false,
          createdById: 'u1',
          createdByName: 'G&G',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      birthdays: [{ user: { id: 'ana', name: 'Ana' }, day: 1, month: 9 }],
      workAnniversaries: [{ user: { id: 'bruno', name: 'Bruno' }, day: 1, month: 9, years: 3 }],
    })
    renderSection()

    expect(await screen.findByText('Abertura')).toBeInTheDocument()
    expect(screen.getByText('Feriado municipal')).toBeInTheDocument()
    expect(screen.getByText(/Ana/)).toBeInTheDocument()
    expect(screen.getByText(/Bruno.*3 anos de casa/)).toBeInTheDocument()
  })

  it('evento do contexto não vira item de campanha, mas abre o mesmo modal de detalhes/edição do calendário principal ao ser clicado', async () => {
    getCampaignCalendarContext.mockResolvedValue({
      occurrences: [
        {
          eventId: 'ev1',
          iso: '2026-09-01',
          endIso: '2026-09-01',
          title: 'Feriado municipal',
          description: '',
          startTime: null,
          endTime: null,
          typeSlug: 'feriado',
          typeName: 'Feriado',
          typeIcon: 'event',
          color: '#6366f1',
          audienceTags: [],
          isInternalComm: false,
          createdById: 'u1',
          createdByName: 'G&G',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      birthdays: [],
      workAnniversaries: [],
    })
    renderSection()

    const item = await screen.findByText('Feriado municipal')
    const button = item.closest('button')
    expect(button).not.toBeNull()

    await userEvent.click(button!)
    expect(await screen.findByRole('dialog', { name: 'Feriado municipal' })).toBeInTheDocument()
  })

  it('o toggle "Mostrar eventos e aniversários" nasce ligado e esconde a camada quando desligado', async () => {
    getCampaignCalendarContext.mockResolvedValue({
      occurrences: [
        {
          eventId: 'ev1',
          iso: '2026-09-01',
          endIso: '2026-09-01',
          title: 'Feriado municipal',
          description: '',
          startTime: null,
          endTime: null,
          typeSlug: 'feriado',
          typeName: 'Feriado',
          typeIcon: 'event',
          color: '#6366f1',
          audienceTags: [],
          isInternalComm: false,
          createdById: 'u1',
          createdByName: 'G&G',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      birthdays: [],
      workAnniversaries: [],
    })
    const user = userEvent.setup()
    renderSection()

    const toggle = await screen.findByRole('checkbox', { name: /mostrar eventos e aniversários/i })
    expect(toggle).toBeChecked()
    expect(await screen.findByText('Feriado municipal')).toBeInTheDocument()

    await user.click(toggle)

    expect(screen.queryByText('Feriado municipal')).not.toBeInTheDocument()
  })
})

/**
 * Documento 4, seção 13.1: a G&G precisa controlar todos os comunicados da
 * empresa pelo gerenciamento de campanhas, sem sair para o Feed.
 */
describe('CampaignsSection — aba Publicar', () => {
  it('renderiza o composer do Feed, com o agendamento que ele já traz', async () => {
    renderSection()

    await userEvent.click(screen.getByRole('tab', { name: 'Publicar' }))

    // O composer é o do Feed — não uma cópia. Estes dois controles são dele:
    // o destino do comunicado e o agendamento que entrou no Lote A.
    expect(await screen.findByLabelText('Destino do comunicado')).toBeInTheDocument()
    expect(screen.getByText('Agendar publicação')).toBeInTheDocument()
  })

  it('as três abas convivem e a de calendário continua sendo a padrão', async () => {
    renderSection()

    expect(screen.getByRole('tab', { name: 'Calendário' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Gerar' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Publicar' })).toBeInTheDocument()
  })
})

/** Documento 4, seção 13.4. */
describe('CampaignsSection — modelo padrão', () => {
  it('o painel do modelo fica junto do gerador', async () => {
    renderSection()

    await userEvent.click(screen.getByRole('tab', { name: 'Gerar' }))

    expect(await screen.findByRole('heading', { name: 'Modelo padrão de comunicado' })).toBeInTheDocument()
    expect(screen.getByText('Usando o modelo oficial')).toBeInTheDocument()
  })

  it('o toggle do modelo nasce ligado no gerador', async () => {
    renderSection()

    await userEvent.click(screen.getByRole('tab', { name: 'Gerar' }))

    expect(
      await screen.findByRole('checkbox', { name: /Aplicar o modelo padrão/ }),
    ).toBeChecked()
  })
})
