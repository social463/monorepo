import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import type { OneOnOneMeetingDetailDTO, OneOnOneMeetingSummaryDTO, OneOnOnePersonDTO } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { OneOnOneDetailPage } from './OneOnOneDetailPage'

/** Pessoa do 1:1 sem personagem nem foto — o `<Avatar>` cai nas iniciais. */
function pessoa(id: string, name: string, position: string | null = null): OneOnOnePersonDTO {
  return { id, name, photoUrl: null, position, avatarStyle: null, avatarSeed: null, avatarOptions: null }
}

vi.mock('../../lib/one-on-one-api', () => ({
  getOneOnOne: vi.fn(),
  listOneOnOnes: vi.fn(),
  listOneOnOneTopicTemplates: vi.fn(),
  addOneOnOneTopic: vi.fn(),
  updateOneOnOneTopic: vi.fn(),
  deleteOneOnOneTopic: vi.fn(),
  saveOneOnOneNote: vi.fn(),
  createOneOnOneAction: vi.fn(),
  updateOneOnOneAction: vi.fn(),
  promoteOneOnOneAction: vi.fn(),
  cancelOneOnOne: vi.fn(),
  rescheduleOneOnOne: vi.fn(),
}))
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Ana' } }) }))
// O tempo real tem teste próprio (`useOneOnOneSocket.test.tsx`); aqui ele só
// abriria um WebSocket de verdade e deixaria timers de reconexão para trás.
vi.mock('../../lib/useOneOnOneSocket', () => ({ useOneOnOneSocket: () => {} }))

const api = await import('../../lib/one-on-one-api')

function detail(over: Partial<OneOnOneMeetingDetailDTO> = {}): OneOnOneMeetingDetailDTO {
  return {
    id: 'm1',
    seriesId: 's1',
    startsAt: '2026-08-10T13:00:00.000Z',
    endsAt: '2026-08-10T13:30:00.000Z',
    status: 'SCHEDULED',
    recurrence: 'NONE',
    counterpart: pessoa('u2', 'Bruno', 'Dev'),
    openActionCount: 1,
    topicCount: 3,
    inviteeResponse: 'ACCEPTED',
    viewerIsInvitee: false,
    proposedStartsAt: null,
    declineNote: null,
    topics: [{ id: 't1', text: 'Carreira', origin: 'CUSTOM', discussed: false, createdById: 'u1', sortOrder: 0 }],
    openActions: [
      {
        id: 'a1',
        description: 'Levantar escopo',
        owner: pessoa('u1', 'Ana'),
        dueDate: null,
        status: 'OPEN',
        completedAt: null,
        completedById: null,
        createdInMeetingId: 'm0',
        pdiActionId: null,
        createdAt: '2026-08-01T10:00:00.000Z',
      },
    ],
    closedActions: [],
    note: 'minha nota',
    pdi: null,
    ...over,
  }
}

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/1-1/m1']}>
        <Routes>
          <Route path="/1-1/:id" element={<OneOnOneDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// Simula uma navegação de um encontro para outro SEM desmontar
// OneOnOneDetailPage — o Route mantém o mesmo elemento quando só o parâmetro
// `:id` muda, então o componente é reaproveitado (a Task 12 vai ligar links
// assim, ex.: "próximo 1:1").
function renderComNavegacaoEntreEncontros(client: QueryClient) {
  function Harness() {
    const navigate = useNavigate()
    return (
      <>
        <button type="button" onClick={() => navigate('/1-1/m2')}>
          Ir para o encontro m2
        </button>
        <Routes>
          <Route path="/1-1/:id" element={<OneOnOneDetailPage />} />
        </Routes>
      </>
    )
  }
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/1-1/m1']}>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function resumo(over: Partial<OneOnOneMeetingSummaryDTO> = {}): OneOnOneMeetingSummaryDTO {
  return {
    id: 'm0',
    seriesId: 's1',
    startsAt: '2026-07-27T13:00:00.000Z',
    endsAt: '2026-07-27T13:30:00.000Z',
    status: 'DONE',
    recurrence: 'NONE',
    counterpart: pessoa('u2', 'Bruno', 'Dev'),
    openActionCount: 0,
    topicCount: 3,
    inviteeResponse: 'ACCEPTED',
    viewerIsInvitee: false,
    proposedStartsAt: null,
    declineNote: null,
    ...over,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listOneOnOneTopicTemplates).mockResolvedValue({
    templates: [{ id: 'tt1', theme: 'Carreira', text: 'Onde você quer chegar?', active: true, sortOrder: 0 }],
  })
  vi.mocked(api.listOneOnOnes).mockResolvedValue({ meetings: [] })
})

describe('OneOnOneDetailPage', () => {
  it('mostra pauta, ação pendente herdada e a nota privada de quem abriu', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())

    renderDetail()

    expect(await screen.findByText('Carreira')).toBeInTheDocument()
    expect(screen.getByText('Levantar escopo')).toBeInTheDocument()
    expect(screen.getByDisplayValue('minha nota')).toBeInTheDocument()
    expect(screen.getByText(/só você vê/i)).toBeInTheDocument()
  })

  /**
   * Aberto direto pela URL (`location.key === 'default'`, que é o caso do
   * MemoryRouter com uma entrada só), voltar não pode jogar para fora do app:
   * o fallback leva para a lista.
   */
  it('tem a seta de voltar, com a lista como fallback', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/1-1/m1']}>
          <Routes>
            <Route path="/1-1" element={<p>lista de 1:1</p>} />
            <Route path="/1-1/:id" element={<OneOnOneDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByText('Carreira')
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))

    expect(screen.getByText('lista de 1:1')).toBeInTheDocument()
  })

  it('oferece os tópicos sugeridos do catálogo da empresa', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())

    renderDetail()

    expect(await screen.findByRole('button', { name: 'Onde você quer chegar?' })).toBeInTheDocument()
  })

  it('conclui uma ação pendente', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())
    vi.mocked(api.updateOneOnOneAction).mockResolvedValue({
      action: { ...detail().openActions[0], status: 'DONE' },
    })

    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: /concluir/i }))

    expect(api.updateOneOnOneAction).toHaveBeenCalledWith('a1', { status: 'DONE' })
  })

  it('edita a descrição e o responsável de uma ação já combinada', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())
    vi.mocked(api.updateOneOnOneAction).mockResolvedValue({
      action: { ...detail().openActions[0], description: 'Levantar escopo com o time', owner: pessoa('u2', 'Bruno') },
    })

    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: 'Editar "Levantar escopo"' }))

    const campo = screen.getByRole('textbox', { name: 'Editar "Levantar escopo"' })
    await userEvent.clear(campo)
    await userEvent.type(campo, 'Levantar escopo com o time')
    await userEvent.selectOptions(screen.getByLabelText('Responsável por "Levantar escopo"'), 'u2')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    // Descrição e responsável num PATCH só: a linha nunca fica meio salva.
    expect(api.updateOneOnOneAction).toHaveBeenCalledWith('a1', {
      description: 'Levantar escopo com o time',
      ownerId: 'u2',
    })
  })

  it('cancelar a edição não manda nada e devolve a linha ao normal', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())

    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: 'Editar "Levantar escopo"' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Editar "Levantar escopo"' }), ' e mais')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(api.updateOneOnOneAction).not.toHaveBeenCalled()
    expect(screen.getByText('Levantar escopo')).toBeInTheDocument()
  })

  it('salvar sem mudar nada fecha a edição sem chamar a API', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())

    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: 'Editar "Levantar escopo"' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(api.updateOneOnOneAction).not.toHaveBeenCalled()
    expect(screen.getByText('Levantar escopo')).toBeInTheDocument()
  })

  it('abrir a edição de uma ação do colega mantém o colega como responsável', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(
      detail({ openActions: [{ ...detail().openActions[0], owner: pessoa('u2', 'Bruno') }] }),
    )
    vi.mocked(api.updateOneOnOneAction).mockResolvedValue({ action: detail().openActions[0] })

    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: 'Editar "Levantar escopo"' }))

    // O seletor nasce no dono ATUAL: só abrir a edição não pode passar o
    // combinado do Bruno para quem abriu.
    expect(screen.getByLabelText('Responsável por "Levantar escopo"')).toHaveValue('u2')
  })

  it('não mostra a seção de PDI quando o par não é líder↔liderado', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail({ pdi: null }))

    renderDetail()
    await screen.findByText('Carreira')

    expect(screen.queryByText(/plano de desenvolvimento/i)).not.toBeInTheDocument()
  })

  it('mostra "Adicionar ao PDI" só quando canPromote é true', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(
      detail({
        pdi: {
          planId: 'p1',
          planTitle: 'Ciclo 2026',
          owner: pessoa('u1', 'Ana'),
          actions: [],
          canPromote: true,
        },
      }),
    )

    renderDetail()

    expect(await screen.findByText('Ciclo 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /adicionar ao pdi/i })).toBeInTheDocument()
  })

  it('esconde "Adicionar ao PDI" para quem não é dono do plano', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(
      detail({
        pdi: {
          planId: 'p1',
          planTitle: 'Ciclo 2026',
          owner: pessoa('u2', 'Bruno'),
          actions: [],
          canPromote: false,
        },
      }),
    )

    renderDetail()
    await screen.findByText('Ciclo 2026')

    expect(screen.queryByRole('button', { name: /adicionar ao pdi/i })).not.toBeInTheDocument()
  })

  it('esconde "Adicionar ao PDI" para ação já promovida', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(
      detail({
        openActions: [{ ...detail().openActions[0], pdiActionId: 'pdi-a1' }],
        pdi: {
          planId: 'p1',
          planTitle: 'Ciclo 2026',
          owner: pessoa('u1', 'Ana'),
          actions: [],
          canPromote: true,
        },
      }),
    )

    renderDetail()
    await screen.findByText('Levantar escopo')

    expect(screen.queryByRole('button', { name: /adicionar ao pdi/i })).not.toBeInTheDocument()
  })

  it('salva a nota ao perder o foco da textarea', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail({ note: 'nota inicial' }))
    vi.mocked(api.saveOneOnOneNote).mockResolvedValue({ note: 'nota digitada' })

    renderDetail()

    const textarea = await screen.findByDisplayValue('nota inicial')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'nota digitada')
    await userEvent.tab()

    expect(api.saveOneOnOneNote).toHaveBeenCalledWith('m1', 'nota digitada')
  })

  it('não perde o rascunho não salvo da nota quando um refetch traz a nota antiga do servidor', async () => {
    vi.mocked(api.getOneOnOne)
      .mockResolvedValueOnce(detail({ note: 'nota inicial' }))
      .mockResolvedValueOnce(detail({ note: 'nota antiga diferente' }))
    vi.mocked(api.updateOneOnOneAction).mockResolvedValue({
      action: { ...detail().openActions[0], status: 'DONE' },
    })

    renderDetail()

    const textarea = await screen.findByDisplayValue('nota inicial')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'rascunho não salvo')

    await userEvent.click(screen.getByRole('button', { name: /concluir/i }))

    await waitFor(() => expect(api.getOneOnOne).toHaveBeenCalledTimes(2))
    expect(screen.getByDisplayValue('rascunho não salvo')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('nota antiga diferente')).not.toBeInTheDocument()
  })

  it('adota o valor devolvido pela API depois de salvar a nota', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail({ note: 'nota inicial' }))
    vi.mocked(api.saveOneOnOneNote).mockResolvedValue({ note: 'nota normalizada pelo servidor' })

    renderDetail()

    const textarea = await screen.findByDisplayValue('nota inicial')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'nota digitada')
    await userEvent.tab()

    expect(await screen.findByDisplayValue('nota normalizada pelo servidor')).toBeInTheDocument()
  })

  it('mostra mensagem de erro quando promover ao PDI falha', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(
      detail({
        pdi: {
          planId: 'p1',
          planTitle: 'Ciclo 2026',
          owner: pessoa('u1', 'Ana'),
          actions: [],
          canPromote: true,
        },
      }),
    )
    vi.mocked(api.promoteOneOnOneAction).mockRejectedValue(new ApiError(409, 'Ação já promovida ao PDI.'))

    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: /adicionar ao pdi/i }))

    expect(await screen.findByText('Ação já promovida ao PDI.')).toBeInTheDocument()
  })

  it('troca de encontro sem desmontar não mistura o rascunho da nota entre encontros', async () => {
    // As duas queries já ficam em cache — o cenário mais perigoso do achado:
    // nenhum "Carregando…" no meio, `data` nunca passa por undefined.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['one-on-one', 'm1'], detail({ id: 'm1', note: 'nota A' }))
    client.setQueryData(['one-on-one', 'm2'], detail({ id: 'm2', note: 'nota B' }))
    vi.mocked(api.getOneOnOne).mockImplementation((id: string) =>
      Promise.resolve(id === 'm1' ? detail({ id: 'm1', note: 'nota A' }) : detail({ id: 'm2', note: 'nota B' })),
    )

    renderComNavegacaoEntreEncontros(client)

    const textareaA = await screen.findByDisplayValue('nota A')
    await userEvent.clear(textareaA)
    await userEvent.type(textareaA, 'rascunho A não salvo')

    await userEvent.click(screen.getByRole('button', { name: /ir para o encontro m2/i }))

    // (i) a nota exibida passa a ser a do encontro B, não o rascunho de A.
    expect(await screen.findByDisplayValue('nota B')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('rascunho A não salvo')).not.toBeInTheDocument()

    // (ii) um blur depois da troca não grava o texto de A no encontro B. (O
    // clique no botão de navegação já dispara um blur em textareaA antes de
    // navegar — salvar o rascunho de A sob o id de A é o comportamento
    // correto e esperado, só não pode vazar para o id de B.)
    const textareaB = screen.getByLabelText('Minhas observações')
    await userEvent.click(textareaB)
    await userEvent.tab()

    expect(api.saveOneOnOneNote).not.toHaveBeenCalledWith('m2', 'rascunho A não salvo')
  })

  it('não deixa uma resposta atrasada de salvar a nota de um encontro contaminar o outro após navegar', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['one-on-one', 'm1'], detail({ id: 'm1', note: 'nota A' }))
    client.setQueryData(['one-on-one', 'm2'], detail({ id: 'm2', note: 'nota B inicial' }))
    vi.mocked(api.getOneOnOne).mockImplementation((id: string) =>
      Promise.resolve(id === 'm1' ? detail({ id: 'm1', note: 'nota A' }) : detail({ id: 'm2', note: 'nota B inicial' })),
    )

    // Deferred manual: a resposta de salvar a nota de A só resolve quando a
    // gente decidir, para controlar a corrida com a navegação.
    let resolverSalvarA: (value: { note: string | null }) => void = () => {}
    const salvarADeferred = new Promise<{ note: string | null }>((resolve) => {
      resolverSalvarA = resolve
    })
    vi.mocked(api.saveOneOnOneNote).mockImplementation((meetingId: string, body: string) =>
      meetingId === 'm1' ? salvarADeferred : Promise.resolve({ note: body }),
    )

    renderComNavegacaoEntreEncontros(client)

    const textareaA = await screen.findByDisplayValue('nota A')
    await userEvent.clear(textareaA)
    await userEvent.type(textareaA, 'rascunho A editado')

    // O clique dispara o blur de A (salva com id_A, mas fica pendente) e só
    // depois navega — a resposta de A atravessa a troca de encontro.
    await userEvent.click(screen.getByRole('button', { name: /ir para o encontro m2/i }))
    await waitFor(() => expect(api.saveOneOnOneNote).toHaveBeenCalledWith('m1', 'rascunho A editado'))

    expect(await screen.findByDisplayValue('nota B inicial')).toBeInTheDocument()

    // Só agora a resposta atrasada de A chega — já estamos em B.
    resolverSalvarA({ note: 'rascunho A editado' })

    // Com o rascunho de B LIMPO, um valor novo e legítimo do servidor para B
    // ainda precisa ser adotado normalmente — invariante (c) sobrevivendo à
    // resposta atrasada de A. (Este caso sozinho NÃO prova a não-contaminação:
    // com o rascunho limpo, adotar o valor do servidor é o resultado dos dois
    // lados. A prova está no teste do rascunho SUJO em B, logo abaixo.)
    client.setQueryData(['one-on-one', 'm2'], detail({ id: 'm2', note: 'nota B atualizada pelo servidor' }))

    expect(await screen.findByDisplayValue('nota B atualizada pelo servidor')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('rascunho A editado')).not.toBeInTheDocument()
  })

  it('resposta atrasada de um encontro abandonado não descarta o rascunho sujo do encontro exibido', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['one-on-one', 'm1'], detail({ id: 'm1', note: 'nota A' }))
    client.setQueryData(['one-on-one', 'm2'], detail({ id: 'm2', note: 'nota B inicial' }))
    vi.mocked(api.getOneOnOne).mockImplementation((id: string) =>
      Promise.resolve(id === 'm1' ? detail({ id: 'm1', note: 'nota A' }) : detail({ id: 'm2', note: 'nota B inicial' })),
    )

    let resolverSalvarA: (value: { note: string | null }) => void = () => {}
    const salvarADeferred = new Promise<{ note: string | null }>((resolve) => {
      resolverSalvarA = resolve
    })
    vi.mocked(api.saveOneOnOneNote).mockImplementation((meetingId: string, body: string) =>
      meetingId === 'm1' ? salvarADeferred : Promise.resolve({ note: body }),
    )

    renderComNavegacaoEntreEncontros(client)

    // 1) edita a nota de A e navega para B — o save de A fica pendente.
    const textareaA = await screen.findByDisplayValue('nota A')
    await userEvent.clear(textareaA)
    await userEvent.type(textareaA, 'rascunho A editado')
    await userEvent.click(screen.getByRole('button', { name: /ir para o encontro m2/i }))
    await waitFor(() => expect(api.saveOneOnOneNote).toHaveBeenCalledWith('m1', 'rascunho A editado'))
    expect(await screen.findByDisplayValue('nota B inicial')).toBeInTheDocument()

    // 2) já em B, a pessoa digita: o rascunho de B fica SUJO (é isso que o
    // teste da rodada anterior não tinha, e por isso ele passava por acidente).
    const textareaB = screen.getByLabelText('Minhas observações')
    await userEvent.clear(textareaB)
    await userEvent.type(textareaB, 'rascunho B em andamento')

    // 3) só então a resposta atrasada de A chega — ela não pode reescrever o
    // registro de "qual encontro/valor o rascunho da tela acompanha".
    resolverSalvarA({ note: 'rascunho A editado' })

    // 4) e uma atualização legítima do servidor para B chega depois (o tópico
    // novo prova que a atualização foi de fato renderizada).
    client.setQueryData(
      ['one-on-one', 'm2'],
      detail({
        id: 'm2',
        note: 'nota B do servidor',
        topics: [
          { id: 't2', text: 'Tópico novo de B', origin: 'CUSTOM', discussed: false, createdById: 'u1', sortOrder: 0 },
        ],
      }),
    )
    expect(await screen.findByText('Tópico novo de B')).toBeInTheDocument()

    // O rascunho sujo de B sobrevive: nem a resposta de A nem o refetch o apagam.
    expect(screen.getByDisplayValue('rascunho B em andamento')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('nota B do servidor')).not.toBeInTheDocument()
  })

  it('erro de um save de encontro abandonado não aparece na tela do encontro exibido', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['one-on-one', 'm1'], detail({ id: 'm1', note: 'nota A' }))
    client.setQueryData(['one-on-one', 'm2'], detail({ id: 'm2', note: 'nota B' }))
    vi.mocked(api.getOneOnOne).mockImplementation((id: string) =>
      Promise.resolve(id === 'm1' ? detail({ id: 'm1', note: 'nota A' }) : detail({ id: 'm2', note: 'nota B' })),
    )

    let rejeitarSalvarA: (erro: unknown) => void = () => {}
    const salvarADeferred = new Promise<{ note: string | null }>((_resolve, reject) => {
      rejeitarSalvarA = reject
    })
    vi.mocked(api.saveOneOnOneNote).mockImplementation((meetingId: string) =>
      meetingId === 'm1' ? salvarADeferred : Promise.reject(new ApiError(500, 'Falha ao salvar a nota de B.')),
    )

    renderComNavegacaoEntreEncontros(client)

    const textareaA = await screen.findByDisplayValue('nota A')
    await userEvent.clear(textareaA)
    await userEvent.type(textareaA, 'rascunho A editado')
    await userEvent.click(screen.getByRole('button', { name: /ir para o encontro m2/i }))
    await waitFor(() => expect(api.saveOneOnOneNote).toHaveBeenCalledWith('m1', 'rascunho A editado'))
    expect(await screen.findByDisplayValue('nota B')).toBeInTheDocument()

    // O save de A falha DEPOIS da navegação: a mensagem é sobre um encontro
    // que não está mais na tela e não pode aparecer aqui.
    rejeitarSalvarA(new ApiError(500, 'Falha ao salvar a nota de A.'))
    client.setQueryData(
      ['one-on-one', 'm2'],
      detail({
        id: 'm2',
        note: 'nota B',
        topics: [
          { id: 't2', text: 'Tópico novo de B', origin: 'CUSTOM', discussed: false, createdById: 'u1', sortOrder: 0 },
        ],
      }),
    )
    expect(await screen.findByText('Tópico novo de B')).toBeInTheDocument()
    expect(screen.queryByText('Falha ao salvar a nota de A.')).not.toBeInTheDocument()

    // Controle positivo: o erro do PRÓPRIO encontro exibido continua aparecendo
    // — a ausência acima é o guard funcionando, não a seção de erro sumida.
    const textareaB = screen.getByLabelText('Minhas observações')
    await userEvent.clear(textareaB)
    await userEvent.type(textareaB, 'nota B editada')
    await userEvent.tab()

    expect(await screen.findByText('Falha ao salvar a nota de B.')).toBeInTheDocument()
    expect(screen.queryByText('Falha ao salvar a nota de A.')).not.toBeInTheDocument()
  })

  it('limpa o erro de uma seção do encontro anterior ao trocar de encontro', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['one-on-one', 'm1'], detail({ id: 'm1' }))
    client.setQueryData(['one-on-one', 'm2'], detail({ id: 'm2', note: 'nota B' }))
    vi.mocked(api.getOneOnOne).mockImplementation((id: string) =>
      Promise.resolve(id === 'm1' ? detail({ id: 'm1' }) : detail({ id: 'm2', note: 'nota B' })),
    )
    vi.mocked(api.updateOneOnOneAction).mockRejectedValue(new ApiError(400, 'Não deu para concluir a ação de A.'))

    renderComNavegacaoEntreEncontros(client)

    await userEvent.click(await screen.findByRole('button', { name: /concluir/i }))
    expect(await screen.findByText('Não deu para concluir a ação de A.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /ir para o encontro m2/i }))
    await screen.findByDisplayValue('nota B')

    expect(screen.queryByText('Não deu para concluir a ação de A.')).not.toBeInTheDocument()
  })

  it('combina uma ação para você por padrão', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())
    renderDetail()

    await userEvent.type(await screen.findByLabelText('Combinar uma ação'), 'Levantar métricas')
    await userEvent.click(screen.getByRole('button', { name: 'Combinar' }))

    expect(api.createOneOnOneAction).toHaveBeenCalledWith('m1', {
      description: 'Levantar métricas',
      ownerId: 'u1',
      dueDate: null,
    })
  })

  it('deixa combinar uma ação para o outro — antes ia sempre pra quem escreveu', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())
    renderDetail()

    await userEvent.type(await screen.findByLabelText('Combinar uma ação'), 'Revisar o plano')
    await userEvent.selectOptions(screen.getByLabelText('Responsável pelo combinado'), 'u2')
    await userEvent.click(screen.getByRole('button', { name: 'Combinar' }))

    expect(api.createOneOnOneAction).toHaveBeenCalledWith('m1', {
      description: 'Revisar o plano',
      ownerId: 'u2',
      dueDate: null,
    })
  })

  it('só oferece os dois da série como responsável', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())
    renderDetail()

    const seletor = await screen.findByLabelText('Responsável pelo combinado')
    expect(within(seletor).getAllByRole('option').map((o) => o.textContent)).toEqual(['Você', 'Bruno'])
  })

  it('mantém o responsável escolhido entre um combinado e o seguinte', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())
    renderDetail()

    await userEvent.type(await screen.findByLabelText('Combinar uma ação'), 'Primeira')
    await userEvent.selectOptions(screen.getByLabelText('Responsável pelo combinado'), 'u2')
    await userEvent.click(screen.getByRole('button', { name: 'Combinar' }))

    // O texto some, a escolha fica: combinar duas coisas para a mesma pessoa
    // é o caso comum.
    expect(screen.getByLabelText('Combinar uma ação')).toHaveValue('')
    expect(screen.getByLabelText('Responsável pelo combinado')).toHaveValue('u2')
  })

  it('limpa o texto de nova ação/tópico não enviado ao trocar de encontro', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['one-on-one', 'm1'], detail({ id: 'm1' }))
    client.setQueryData(['one-on-one', 'm2'], detail({ id: 'm2', note: 'nota B' }))
    vi.mocked(api.getOneOnOne).mockImplementation((id: string) =>
      Promise.resolve(id === 'm1' ? detail({ id: 'm1' }) : detail({ id: 'm2', note: 'nota B' })),
    )

    renderComNavegacaoEntreEncontros(client)

    const campoNovaAcao = await screen.findByLabelText('Combinar uma ação')
    await userEvent.type(campoNovaAcao, 'ação de A não enviada')
    const campoNovoTopico = screen.getByLabelText('Adicionar tópico')
    await userEvent.type(campoNovoTopico, 'tópico de A não enviado')

    await userEvent.click(screen.getByRole('button', { name: /ir para o encontro m2/i }))
    await screen.findByDisplayValue('nota B')

    expect(screen.getByLabelText('Combinar uma ação')).toHaveValue('')
    expect(screen.getByLabelText('Adicionar tópico')).toHaveValue('')
  })
})

/**
 * Duas lacunas de tela que o spec pede e o DTO já alimentava: o rastro da ação
 * fechada ("no PDI", com link) e a explicação no lugar do botão que some.
 */
describe('OneOnOneDetailPage — rastro das ações fechadas e ausência de plano', () => {
  const fechada = {
    id: 'a9',
    description: 'Ler o livro combinado',
    owner: pessoa('u1', 'Ana'),
    dueDate: null,
    status: 'DONE' as const,
    completedAt: '2026-08-11T10:00:00.000Z',
    completedById: 'u1',
    createdInMeetingId: 'm1',
    pdiActionId: null,
    createdAt: '2026-08-01T10:00:00.000Z',
  }

  it('mostra a ação concluída e a promovida, cada uma com o seu rótulo', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(
      detail({
        closedActions: [
          fechada,
          { ...fechada, id: 'a10', description: 'Virou ação do plano', status: 'PROMOTED', pdiActionId: 'pdi-1' },
        ],
      }),
    )

    renderDetail()

    expect(await screen.findByText('Ler o livro combinado')).toBeInTheDocument()
    expect(screen.getByText('Virou ação do plano')).toBeInTheDocument()
    expect(screen.getByText(/concluída/i)).toBeInTheDocument()
    // A promovida leva ao PDI — é lá que a cobrança passa a acontecer.
    expect(screen.getByRole('link', { name: /no pdi/i })).toHaveAttribute('href', '/pdi')
  })

  it('sem plano de PDI ligado ao par, explica em vez de só sumir com o botão', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail({ pdi: null }))

    renderDetail()
    await screen.findByText('Levantar escopo')

    expect(screen.getByText(/plano de PDI ativo com Bruno/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /meu pdi/i })).toHaveAttribute('href', '/pdi')
    expect(screen.queryByRole('button', { name: /adicionar ao pdi/i })).not.toBeInTheDocument()
  })

  it('quando o plano é do outro, diz de quem ele é em vez de convidar a criar um', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(
      detail({
        pdi: {
          planId: 'p1',
          planTitle: 'Ciclo 2026',
          owner: pessoa('u2', 'Bruno'),
          actions: [],
          canPromote: false,
        },
      }),
    )

    renderDetail()
    await screen.findByText('Levantar escopo')

    expect(screen.getByText(/só o Bruno adiciona ações ao PDI dele/i)).toBeInTheDocument()
    expect(screen.queryByText(/você ainda não tem um plano/i)).not.toBeInTheDocument()
  })
})

describe('OneOnOneDetailPage — histórico do par', () => {
  it('lista só os encontros ANTERIORES com a mesma pessoa', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())
    vi.mocked(api.listOneOnOnes).mockResolvedValue({
      meetings: [
        resumo({ id: 'm0', startsAt: '2026-07-27T13:00:00.000Z' }),
        // o próprio encontro aberto não é "histórico" dele mesmo…
        resumo({ id: 'm1', startsAt: '2026-08-10T13:00:00.000Z', status: 'SCHEDULED' }),
        // …e 1:1 com OUTRA pessoa não entra neste painel.
        resumo({
          id: 'mx',
          startsAt: '2026-07-20T13:00:00.000Z',
          counterpart: pessoa('u3', 'Carla'),
        }),
      ],
    })

    renderDetail()

    const links = await screen.findAllByRole('link', { name: /ver detalhes/i })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/1-1/m0')
  })

  it('sem encontro anterior, explica em vez de mostrar uma linha do tempo vazia', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())

    renderDetail()

    expect(await screen.findByText(/nenhum encontro anterior com Bruno/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /ver detalhes/i })).not.toBeInTheDocument()
  })
})

describe('OneOnOneDetailPage — salvar a nota pelo botão', () => {
  it('só habilita o botão com rascunho sujo e salva uma única vez', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail({ note: 'nota inicial' }))
    vi.mocked(api.saveOneOnOneNote).mockResolvedValue({ note: 'nota editada' })

    renderDetail()

    const textarea = await screen.findByDisplayValue('nota inicial')
    expect(screen.getByRole('button', { name: /notas salvas/i })).toBeDisabled()

    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'nota editada')

    // O clique não pode disparar TAMBÉM o save do blur — seria a mesma nota
    // salva duas vezes (daí o preventDefault no mousedown do botão).
    await userEvent.click(screen.getByRole('button', { name: /salvar notas/i }))

    expect(api.saveOneOnOneNote).toHaveBeenCalledTimes(1)
    expect(api.saveOneOnOneNote).toHaveBeenCalledWith('m1', 'nota editada')
    expect(await screen.findByRole('button', { name: /notas salvas/i })).toBeDisabled()
  })
})

describe('OneOnOneDetailPage — remarcar, cancelar e editar a pauta', () => {
  // Os campos de remarcar falam o relógio de parede de quem olha, então a
  // asserção do horário depende do fuso. Fixado no fuso do produto (pt-BR), e
  // não no da máquina: senão o teste diz uma coisa aqui e outra num CI em UTC.
  const fusoOriginal = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'America/Sao_Paulo'
  })
  afterAll(() => {
    process.env.TZ = fusoOriginal
  })

  it('remarca pelo menu do cabeçalho, com os campos já preenchidos', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())
    vi.mocked(api.rescheduleOneOnOne).mockResolvedValue({ meetings: [] })

    renderDetail()
    await screen.findByText(/1:1 com Bruno/i)

    await userEvent.click(screen.getByRole('button', { name: /ações do 1:1 com bruno/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /remarcar/i }))

    // Os campos abrem no horário atual do encontro — remarcar não é recomeçar.
    const data = screen.getByLabelText('Data') as HTMLInputElement
    const hora = screen.getByLabelText('Horário') as HTMLInputElement
    expect(data.value).toBe('2026-08-10')
    expect(hora.value).toBe('10:00')

    await userEvent.clear(hora)
    await userEvent.type(hora, '15:30')
    await userEvent.click(screen.getByRole('button', { name: /^remarcar$/i }))

    await waitFor(() =>
      expect(api.rescheduleOneOnOne).toHaveBeenCalledWith(
        'm1',
        { date: '2026-08-10', startTime: '15:30', durationMinutes: 30 },
        'this',
      ),
    )
  })

  it('cancelar leva de volta para a lista, porque a tela do encontro deixa de existir', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())
    vi.mocked(api.cancelOneOnOne).mockResolvedValue(undefined)

    renderDetail()
    await screen.findByText(/1:1 com Bruno/i)

    await userEvent.click(screen.getByRole('button', { name: /ações do 1:1 com bruno/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /cancelar 1:1/i }))
    await userEvent.click(screen.getByRole('button', { name: /^cancelar 1:1$/i }))

    await waitFor(() => expect(api.cancelOneOnOne).toHaveBeenCalledWith('m1', 'this'))
    // Sem rota para /1-1 no harness, a saída da tela do encontro é o que se vê.
    await waitFor(() => expect(screen.queryByText(/1:1 com Bruno/i)).not.toBeInTheDocument())
  })

  it('encontro já realizado não oferece o menu de ações', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail({ status: 'DONE' }))

    renderDetail()
    await screen.findByText(/1:1 com Bruno/i)

    expect(screen.queryByRole('button', { name: /ações do 1:1/i })).not.toBeInTheDocument()
  })

  it('edita o texto de um tópico da pauta no lugar', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())
    vi.mocked(api.updateOneOnOneTopic).mockResolvedValue({
      topic: { id: 't1', text: 'Carreira e metas', origin: 'CUSTOM', discussed: false, createdById: 'u1', sortOrder: 0 },
    })

    renderDetail()
    await screen.findByText('Carreira')

    await userEvent.click(screen.getByRole('button', { name: /editar "carreira"/i }))
    const campo = screen.getByRole('textbox', { name: /editar "carreira"/i })
    await userEvent.clear(campo)
    await userEvent.type(campo, 'Carreira e metas')
    await userEvent.click(screen.getByRole('button', { name: /salvar tópico/i }))

    await waitFor(() =>
      expect(api.updateOneOnOneTopic).toHaveBeenCalledWith('t1', { text: 'Carreira e metas' }),
    )
  })

  it('Esc fecha a edição do tópico sem salvar', async () => {
    vi.mocked(api.getOneOnOne).mockResolvedValue(detail())

    renderDetail()
    await screen.findByText('Carreira')

    await userEvent.click(screen.getByRole('button', { name: /editar "carreira"/i }))
    await userEvent.type(screen.getByRole('textbox', { name: /editar "carreira"/i }), 'x{Escape}')

    expect(screen.queryByRole('textbox', { name: /editar "carreira"/i })).not.toBeInTheDocument()
    expect(api.updateOneOnOneTopic).not.toHaveBeenCalled()
  })
})
