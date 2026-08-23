import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { CampaignPostDTO } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { CampaignsSection } from './CampaignsSection'

const previewCampaign = vi.fn()
const confirmCampaign = vi.fn()
const listCampaignPosts = vi.fn()
const publishCampaignPost = vi.fn()

vi.mock('../../lib/campaign-api', () => ({
  previewCampaign: (body: unknown) => previewCampaign(body),
  confirmCampaign: (body: unknown) => confirmCampaign(body),
  listCampaignPosts: (from: string, to: string) => listCampaignPosts(from, to),
  createCampaignPost: vi.fn(),
  updateCampaignPost: vi.fn(),
  publishCampaignPost: (id: string) => publishCampaignPost(id),
  cancelCampaignPost: vi.fn(),
}))

// O seletor de responsável do CampaignCalendar chama /users?scope=company via
// apiFetch direto — não passa pelo campaign-api.ts. Sem esse mock a aba
// Calendário quebra tentando resolver essa chamada de verdade.
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return {
    ...actual,
    apiFetch: vi.fn().mockResolvedValue({ users: [] }),
  }
})

const post = (over: Partial<CampaignPostDTO> = {}): CampaignPostDTO => ({
  id: 'cp1',
  campaignId: 'c1',
  campaignTheme: 'Semana da segurança',
  title: 'Abertura',
  body: 'Começa a semana da segurança.',
  visualHint: null,
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

beforeEach(() => {
  vi.clearAllMocks()
  listCampaignPosts.mockResolvedValue({ posts: [post()] })
})

describe('CampaignsSection', () => {
  it('abre no calendário e mostra os itens do mês', async () => {
    renderSection()
    expect(await screen.findByText('Abertura')).toBeInTheDocument()
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
})
