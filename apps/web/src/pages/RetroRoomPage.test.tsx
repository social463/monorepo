// apps/web/src/pages/RetroRoomPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RetroRoomPage } from './RetroRoomPage'
import type { PublicUser, RetroRoomDTO } from '@legends/shared'
import * as api from '../lib/retro-api'
import { ApiError } from '../lib/api'

const timer = {
  mode: 'elapsed',
  status: 'idle',
  durationSeconds: null,
  startedAt: null,
  accumulatedSeconds: 0,
  updatedAt: '',
  updatedBy: null,
  serverNow: '',
} satisfies RetroRoomDTO['timer']

const room: RetroRoomDTO = {
  id: 'r1', title: 'Retro 1', sprint: 1, squads: [{ id: 'sq1', name: 'Squad A' }], status: 'OPEN', anonymous: false, votesPerParticipant: 3,
  createdAt: '', concludedAt: null, creator: { id: 'l1', name: 'Lia' }, participantCount: 2, myRole: 'FACILITATOR',
  participants: [], myRemainingVotes: 3, timer,
  cards: [{ id: 'c1', text: 'Deploy tranquilo', x: 40, y: 50, color: 'yellow', author: { id: 'd1', name: 'Dan', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null }, mine: true, voteCount: 0, myVotes: 0, reactions: [], createdAt: '', updatedAt: '', editedBy: null, editedAt: null }],
}

const pub = (id: string, name: string): PublicUser => ({
  id, name, email: `${id}@x`, role: 'LEGEND', area: null, position: null, positionCategory: null, squad: null,
  photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '', leftAt: null, enabledFeatures: [], sectorId: 'sector-dev-produto', companyId: 'company-emr', companyName: null, sectorFeatures: [], adminAccess: false,
})
const roomWithParticipants: RetroRoomDTO = {
  ...room,
  participants: [
    { user: pub('l1', 'Lia'), isCreator: true },
    { user: pub('d1', 'Dan'), isCreator: false },
  ],
}

vi.mock('../lib/retro-api', () => ({
  getRetroRoom: vi.fn(),
  createRetroCard: vi.fn().mockResolvedValue({ card: { id: 'c2', text: 'Novo ponto', x: 0, y: 0, color: 'green', author: null, mine: true, voteCount: 0, myVotes: 0, reactions: [], createdAt: '', updatedAt: '', editedBy: null, editedAt: null } }),
  updateRetroCard: vi.fn(), updateRetroCardPosition: vi.fn(), deleteRetroCard: vi.fn().mockResolvedValue({}),
  addRetroVote: vi.fn().mockResolvedValue({ voteCount: 1, myRemainingVotes: 2 }), removeRetroVote: vi.fn(), toggleRetroReaction: vi.fn(),
  updateRetroTimer: vi.fn().mockResolvedValue({
    timer: {
      mode: 'elapsed',
      status: 'running',
      durationSeconds: null,
      startedAt: '2026-08-04T10:00:00.000Z',
      accumulatedSeconds: 0,
      updatedAt: '2026-08-04T10:00:00.000Z',
      updatedBy: { id: 'l1', name: 'Lia' },
      serverNow: '2026-08-04T10:00:00.000Z',
    },
    room: {},
  }),
  advanceRetroPhase: vi.fn().mockResolvedValue({ room: { id: 'r1', title: 'Retro 1', status: 'CONCLUDED', anonymous: false, votesPerParticipant: 3, createdAt: '', concludedAt: '', creator: { id: 'l1', name: 'Lia' }, participantCount: 2, myRole: 'FACILITATOR', participants: [], myRemainingVotes: 3, cards: [] } }),
  toggleRetroAnonymous: vi.fn().mockResolvedValue({ room: { id: 'r1', title: 'Retro 1', status: 'OPEN', anonymous: true, votesPerParticipant: 3, createdAt: '', concludedAt: null, creator: { id: 'l1', name: 'Lia' }, participantCount: 2, myRole: 'FACILITATOR', participants: [], myRemainingVotes: 3, cards: [] } }),
  setRetroParticipants: vi.fn().mockResolvedValue({ room: { id: 'r1', title: 'Retro 1', status: 'OPEN', anonymous: false, votesPerParticipant: 3, createdAt: '', concludedAt: null, creator: { id: 'l1', name: 'Lia' }, participantCount: 1, myRole: 'FACILITATOR', participants: [], myRemainingVotes: 3, cards: [] } }),
  listInvitableUsers: vi.fn().mockResolvedValue({ users: [
    { id: 'b1', name: 'Bia', email: 'b@x', role: 'LEGEND', position: null, positionCategory: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '' },
    { id: 'd1', name: 'Dan', email: 'd@x', role: 'LEGEND', position: null, positionCategory: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '' },
  ] }),
  getRetroCarryover: vi.fn().mockResolvedValue({ toValidate: [], overdue: [] }),
  setRetroCarryover: vi.fn().mockResolvedValue({ item: {} }),
  getRetroEdits: vi.fn().mockResolvedValue({ edits: [] }),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'l1', role: 'LEAD', name: 'Lia' } }) }))
vi.mock('../lib/useRetroSocket', () => ({
  useRetroSocket: () => ({ presentUserIds: ['l1'], cursors: [], floatingReactions: [], lockOf: () => null, sendCursor: vi.fn(), sendReaction: vi.fn(), grab: vi.fn(), move: vi.fn(), drop: vi.fn() }),
}))

const navigateSpy = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, useNavigate: () => navigateSpy }
})

function renderPage(r: RetroRoomDTO = room) {
  vi.mocked(api.getRetroRoom).mockResolvedValue({ room: r })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/retrospectivas/r1']}>
        <Routes><Route path="/retrospectivas/:id" element={<RetroRoomPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RetroRoomPage (canvas)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() })
  })

  it('renderiza título, regiões e o post-it existente', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 2, name: 'Retro 1' })).toBeInTheDocument()
    expect(screen.getByText('Deploy tranquilo')).toBeInTheDocument()
    expect(screen.getByText('O que foi bom')).toBeInTheDocument() // região de fundo
  })

  it('ferramenta inicial é cursor (flyouts fechados)', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    expect(screen.getByRole('button', { name: /cursor/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Reações')).not.toBeInTheDocument()
  })

  it('Reagir: escolher um emoji fecha o flyout e arma o carimbo no card', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: 'Reagir' }))
    // Após clicar no tool, o ReactionFlyout abre com o heading "Reações"
    const reactionFlyout = await screen.findByText('Reações')
    const flyoutContainer = reactionFlyout.closest('div[class*="shadow-lg"]') as HTMLElement
    fireEvent.click(within(flyoutContainer).getByRole('button', { name: /Reagir com 🔥/ }))
    // flyout fechou: o botão de escolher 🔥 do flyout some (mas o do FloatingReactionBar pode permanecer)
    expect(screen.queryByText('Reações')).not.toBeInTheDocument()
    // mas o carimbo segue armado: clicar num card aplica a reação
    fireEvent.pointerDown(screen.getByText('Deploy tranquilo'))
    await waitFor(() => expect(api.toggleRetroReaction).toHaveBeenCalledWith('r1', 'c1', '🔥'))
  })

  it('facilitador vê botão Concluir', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: /concluir/i })).toBeInTheDocument()
  })

  it('facilitador vê e inicia o cronômetro', async () => {
    renderPage()
    expect(await screen.findByLabelText('Cronômetro')).toHaveTextContent('00:00')
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }))
    await waitFor(() => expect(api.updateRetroTimer).toHaveBeenCalledWith('r1', { action: 'start', mode: 'elapsed', durationSeconds: null }))
  })

  it('cronômetro regressivo finalizado volta para configuração inicial', async () => {
    renderPage({
      ...room,
      timer: {
        mode: 'countdown',
        status: 'running',
        durationSeconds: 60,
        startedAt: '2020-01-01T00:00:00.000Z',
        // 60s depois do start, pelo relógio do servidor: a contagem zerou.
        serverNow: '2020-01-01T00:01:00.000Z',
        accumulatedSeconds: 0,
        updatedAt: '2020-01-01T00:00:00.000Z',
        updatedBy: null,
      },
    })
    expect(await screen.findByLabelText('Cronômetro')).toHaveTextContent('00:00')
    expect(screen.getByRole('button', { name: 'Iniciar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regressivo' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('mostra o erro quando o comando do cronômetro falha', async () => {
    vi.mocked(api.updateRetroTimer).mockRejectedValueOnce(new ApiError(409, 'Pause o cronômetro antes de configurar.'))
    renderPage()
    await screen.findByLabelText('Cronômetro')

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Pause o cronômetro antes de configurar.')
  })

  it('conta pelo relógio do servidor, não pelo da máquina do usuário', async () => {
    // `startedAt` é hora do servidor. Se o painel medisse o decorrido com o relógio
    // local, esta sala (que começou 30s atrás pro servidor) mostraria os anos de
    // diferença entre 2020 e hoje. `serverNow` é o que ancora a conta.
    renderPage({
      ...room,
      timer: {
        mode: 'countdown',
        status: 'running',
        durationSeconds: 600,
        startedAt: '2020-01-01T00:00:00.000Z',
        serverNow: '2020-01-01T00:00:30.000Z',
        accumulatedSeconds: 0,
        updatedAt: '2020-01-01T00:00:00.000Z',
        updatedBy: null,
      },
    })
    expect(await screen.findByLabelText('Cronômetro')).toHaveTextContent('09:30')
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument()
  })

  it('mostra o painel de instruções e os controles de zoom', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 2, name: 'Retro 1' })).toBeInTheDocument()
    expect(screen.getByText(/Escolha o tópico/i)).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
  })

  it('Sair navega para a lista de retrospectivas', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /sair/i }))
    expect(navigateSpy).toHaveBeenCalledWith('/retrospectivas')
  })

  it('clicar + muda o zoom exibido', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }))
    // 0.8 -> ~0.88 -> exibe 88%
    expect(screen.getByText('88%')).toBeInTheDocument()
  })

  it('Cursor: 1º clique seleciona, 2º clique edita o card', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    const card = screen.getByText('Deploy tranquilo').closest('[style]') as HTMLElement
    // 1º clique (pointerdown no card + pointerup sem mover) => seleciona
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)
    expect(document.querySelector('[data-selected]')).not.toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    // 2º clique => edita
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('arrastar o card de OUTRO autor move e persiste a posição', async () => {
    const others = {
      id: 'c2', text: 'Card do Dan', x: 200, y: 200, color: 'pink' as const,
      author: pub('d1', 'Dan'), mine: false, voteCount: 0, myVotes: 0, reactions: [], createdAt: '', updatedAt: '',
      editedBy: null, editedAt: null,
    }
    vi.mocked(api.updateRetroCardPosition).mockResolvedValue({ x: 80, y: 80 } as any)
    renderPage({ ...room, cards: [...room.cards, others] })
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    const card = screen.getByText('Card do Dan').closest('[style]') as HTMLElement
    // arrasto: pointerdown + move além do limiar (4px) + up
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 80, clientY: 80 })
    fireEvent.pointerUp(window, { clientX: 80, clientY: 80 })
    await waitFor(() => expect(api.updateRetroCardPosition).toHaveBeenCalled())
    expect(vi.mocked(api.updateRetroCardPosition).mock.calls[0][1]).toBe('c2')
  })

  it('clicar sobre uma região (quadrante) trata como fundo: desseleciona (área de pan)', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    const card = screen.getByText('Deploy tranquilo').closest('[style]') as HTMLElement
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)
    expect(document.querySelector('[data-selected]')).not.toBeNull()
    // clicar em cima do quadrante (não é card) desseleciona — antes não acontecia (não iniciava pan)
    fireEvent.pointerDown(screen.getByText('O que foi bom'))
    expect(document.querySelector('[data-selected]')).toBeNull()
  })

  it('Del exclui o card selecionado (e ignora durante a edição)', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    const card = screen.getByText('Deploy tranquilo').closest('[style]') as HTMLElement
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)
    fireEvent.keyDown(window, { key: 'Delete' })
    await waitFor(() => expect(api.deleteRetroCard).toHaveBeenCalledWith('r1', 'c1'))
  })

  it('Votar: ferramenta ativa + clique no card adiciona voto', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /votar/i }))
    const card = screen.getByText('Deploy tranquilo').closest('[style]') as HTMLElement
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)
    await waitFor(() => expect(api.addRetroVote).toHaveBeenCalledWith('r1', 'c1'))
  })

  it('Votar: escolher o modo fecha o flyout', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /votar/i }))
    expect(screen.getByText(/Votos restantes/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /remover voto/i }))
    expect(screen.queryByText(/Votos restantes/i)).toBeNull()
  })

  it('pad do quadrante: arrastar e soltar cria um card na cor correspondente', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    const pad = screen.getByRole('button', { name: /novo card em o que foi bom/i })
    fireEvent.pointerDown(pad, { clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 200, clientY: 220 })
    fireEvent.pointerUp(window, { clientX: 200, clientY: 220 })
    await waitFor(() => expect(api.createRetroCard).toHaveBeenCalled())
    expect(api.createRetroCard).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ color: 'green', x: expect.any(Number), y: expect.any(Number) }),
    )
  })

  it('pad do quadrante: clique sem arrastar não cria card', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    const pad = screen.getByRole('button', { name: /novo card em o que foi bom/i })
    fireEvent.pointerDown(pad, { clientX: 10, clientY: 10 })
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 })
    expect(api.createRetroCard).not.toHaveBeenCalled()
  })

  it('facilitador vê o switch de modo anônimo (off) e clicar chama a API', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    const sw = screen.getByRole('button', { name: /modo an[ôo]nimo/i })
    expect(sw).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(sw)
    await waitFor(() => expect(api.toggleRetroAnonymous).toHaveBeenCalledWith('r1', true))
  })

  it('mostra o chip "Anônimo" quando a sala está anônima', async () => {
    renderPage({ ...room, anonymous: true })
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    expect(screen.getByText('Anônimo')).toBeInTheDocument()
  })

  it('facilitador vê "Participantes (N)" e abre o painel', async () => {
    renderPage(roomWithParticipants)
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /participantes/i }))
    // o painel busca convidáveis (Dan já é participante => só Bia aparece para adicionar)
    expect(await screen.findByRole('button', { name: /Adicionar Bia/i })).toBeInTheDocument()
  })

  it('adicionar um participante chama a API com a lista incluindo o novo', async () => {
    renderPage(roomWithParticipants)
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /participantes/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Adicionar Bia/i }))
    await waitFor(() => expect(api.setRetroParticipants).toHaveBeenCalledWith('r1', ['l1', 'd1', 'b1']))
  })

  it('remover um participante chama a API sem o id', async () => {
    renderPage(roomWithParticipants)
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /participantes/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Remover Dan/i }))
    await waitFor(() => expect(api.setRetroParticipants).toHaveBeenCalledWith('r1', ['l1']))
  })

  it('sala concluída: LEAD edita a ação pelo card do quadrante Ações (commit vai para a origem) e vê o carimbo', async () => {
    // origem em "O que foi ruim" (centro ~1290,430); espelho no quadrante "Ações" (centro ~2450,450)
    const origin = {
      id: 'origin', text: 'Origem X', x: 1200, y: 340, color: 'pink' as const,
      author: pub('d1', 'Dan'), mine: false, voteCount: 0, myVotes: 0, reactions: [], createdAt: '', updatedAt: '',
      actionPlan: 'Plano A', actionResponsible: 'd1', actionDueDate: '2026-07-01', actionCardId: 'mirror',
      editedBy: { id: 'l1', name: 'Lia' }, editedAt: '2026-06-26T10:00:00.000Z',
    }
    const mirror = {
      id: 'mirror', text: 'Plano: Plano A\nResponsável: Dan\nPrazo: 01-07-2026\n\nOrigem: Origem X',
      x: 2360, y: 360, color: 'blue' as const, author: pub('d1', 'Dan'), mine: false, voteCount: 0, myVotes: 0,
      reactions: [], createdAt: '', updatedAt: '', editedBy: null, editedAt: null,
    }
    const concluded: RetroRoomDTO = { ...room, status: 'CONCLUDED', concludedAt: '2026-06-01', myRole: 'OBSERVER', cards: [origin, mirror] }
    vi.mocked(api.updateRetroCard).mockResolvedValue({ card: origin, actionCard: mirror } as any)
    renderPage(concluded)
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })

    // carimbo "editado por" aparece no espelho (lido da origem) e na própria origem
    expect(screen.getAllByText(/editado por Lia/i).length).toBe(2)

    // selecionar o card-espelho abre o formulário de ação
    const card = screen.getByText(/Origem: Origem X/).closest('[style]') as HTMLElement
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)
    const select = await screen.findByRole('combobox')

    // mudar o responsável → commit grava na ORIGEM, não no espelho
    fireEvent.change(select, { target: { value: 'd1' } })
    await waitFor(() =>
      expect(api.updateRetroCard).toHaveBeenCalledWith('r1', 'origin', expect.objectContaining({ actionResponsible: 'd1' })),
    )
  })

  it('renderiza card de carry-over (vencida) fixo no topo do quadrante Ações', async () => {
    vi.mocked(api.getRetroCarryover).mockResolvedValue({
      toValidate: [],
      overdue: [{ id: 'a1', plan: 'Ação vencida', note: null, dueDate: '2026-06-01', responsible: pub('d1', 'Dan'), sprint: 5, type: 'overdue', auditStatus: null }],
    })
    renderPage()
    const label = await screen.findByText('Ação vencida')
    expect(screen.getAllByText(/Vencida/i).length).toBeGreaterThan(0)
    // fixo no topo: região "Ações" y base = 280 + 80 = 360, primeira linha → top = 360px.
    const wrapper = label.closest('div.absolute') as HTMLElement
    expect(wrapper).not.toBeNull()
    expect(wrapper.style.top).toBe('360px')
  })

  it('sala concluída: editar o Plano e clicar fora salva o rascunho (commit ao desmarcar)', async () => {
    const origin = {
      id: 'origin', text: 'Origem X', x: 1200, y: 340, color: 'pink' as const,
      author: pub('d1', 'Dan'), mine: false, voteCount: 0, myVotes: 0, reactions: [], createdAt: '', updatedAt: '',
      actionPlan: 'Plano A', actionResponsible: 'd1', actionDueDate: '2026-07-01', actionCardId: 'mirror',
      editedBy: null, editedAt: null,
    }
    const mirror = {
      id: 'mirror', text: 'Plano: Plano A\nResponsável: Dan\nPrazo: 01-07-2026\n\nOrigem: Origem X',
      x: 2360, y: 360, color: 'blue' as const, author: pub('d1', 'Dan'), mine: false, voteCount: 0, myVotes: 0,
      reactions: [], createdAt: '', updatedAt: '', editedBy: null, editedAt: null,
    }
    const concluded: RetroRoomDTO = { ...room, status: 'CONCLUDED', concludedAt: '2026-06-01', myRole: 'OBSERVER', cards: [origin, mirror] }
    vi.mocked(api.updateRetroCard).mockResolvedValue({ card: origin, actionCard: mirror } as any)
    renderPage(concluded)
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })

    // seleciona o espelho e edita o campo Plano (que só salva no blur)
    fireEvent.pointerDown(screen.getByText(/Origem: Origem X/).closest('[style]') as HTMLElement, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)
    fireEvent.change(await screen.findByPlaceholderText('Plano'), { target: { value: 'Teste Teste' } })

    // clicar fora (região de fundo) desmarca — o rascunho deve ser salvo antes de desmontar o form
    fireEvent.pointerDown(screen.getByText('O que foi bom'))
    await waitFor(() =>
      expect(api.updateRetroCard).toHaveBeenCalledWith('r1', 'origin', expect.objectContaining({ actionPlan: 'Teste Teste' })),
    )
  })
})
