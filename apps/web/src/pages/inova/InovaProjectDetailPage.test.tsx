import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { InovaProjectDetailPage } from './InovaProjectDetailPage'
import * as inovaApi from '../../lib/inova-api'
import * as authModule from '../../auth/AuthContext'

vi.mock('../../lib/inova-api')
vi.mock('../../auth/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/AuthContext')>()),
  useAuth: vi.fn(),
}))

describe('InovaProjectDetailPage', () => {
  it('mostra o diário de bordo e as tarefas do projeto', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.getInovaProjectDetail).mockResolvedValue({
      project: {
        id: '1',
        title: 'Projeto A',
        category: 'IA',
        sector: 'Ensino',
        description: 'desc',
        problemDescription: null,
        results: null,
        hoursSaved: null,
        costReduction: null,
        otherMetrics: null,
        projectCosts: null,
        toolsUsed: null,
        deadline: null,
        estimatedDeadline: null,
        priority: false,
        leadershipChallenge: false,
        sectorRepresentative: null,
        responsible1: null,
        responsible2: null,
        phase: 'IDEA',
        archived: false,
        createdById: 'u1',
        createdByName: 'Fulano',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      phaseHistory: [{ id: 'ph1', projectId: '1', phase: 'IDEA', note: null, occurredAt: '2026-01-01T00:00:00.000Z' }],
      diaryEntries: [
        {
          id: 'd1',
          projectId: '1',
          title: 'Entrada 1',
          description: null,
          learnings: null,
          tools: null,
          entryType: 'MANUAL',
          occurredAt: '2026-01-02T00:00:00.000Z',
          imageUrls: [],
          videoLinks: [],
          externalLinks: [],
          createdById: 'u1',
          createdByName: 'Fulano',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      tasks: [
        {
          id: 't1',
          projectId: '1',
          title: 'Tarefa 1',
          description: null,
          responsible: null,
          dueDate: null,
          status: 'PENDING',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      activity: [
        {
          id: 'a1',
          projectId: '1',
          action: 'CREATE',
          entity: 'PROJECT',
          summary: 'Projeto criado',
          actorId: 'u1',
          actorName: 'Fulano',
          details: null,
          createdAt: '2026-01-01T12:00:00.000Z',
        },
      ],
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/comunidade-inova/1']}>
          <Routes>
            <Route path="/comunidade-inova/:id" element={<InovaProjectDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())
    expect(screen.getByText('Entrada 1')).toBeInTheDocument()
    expect(screen.getByText('Tarefa 1')).toBeInTheDocument()
    expect(screen.getByText(/Projeto criado/)).toBeInTheDocument()
    // Histórico de alterações: quem fez e quando, com hora.
    expect(screen.getByText('1 registro')).toBeInTheDocument()
    expect(screen.getAllByText('Fulano').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/01\/01\/2026/).length).toBeGreaterThan(0)
  })
})

describe('InovaProjectDetailPage — quem pode excluir', () => {
  const projeto = {
    id: '1',
    title: 'Projeto A',
    category: 'IA',
    sector: 'Ensino',
    description: 'desc',
    problemDescription: null,
    results: null,
    hoursSaved: null,
    costReduction: null,
    otherMetrics: null,
    projectCosts: null,
    toolsUsed: null,
    deadline: null,
    estimatedDeadline: null,
    priority: false,
    leadershipChallenge: false,
    sectorRepresentative: null,
    responsible1: null,
    responsible2: null,
    phase: 'IDEA' as const,
    archived: false,
    createdById: 'dono',
    createdByName: 'Dono',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  const entrada = {
    id: 'd1',
    projectId: '1',
    title: 'Entrada 1',
    description: null,
    learnings: null,
    tools: null,
    entryType: 'MANUAL' as const,
    occurredAt: '2026-01-02T00:00:00.000Z',
    imageUrls: [],
    videoLinks: [],
    externalLinks: [],
    createdById: 'autor',
    createdByName: 'Autor',
    createdAt: '2026-01-02T00:00:00.000Z',
  }

  const tarefa = {
    id: 't1',
    projectId: '1',
    title: 'Tarefa 1',
    description: null,
    responsible: null,
    dueDate: null,
    status: 'PENDING' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  function renderComo(user: { id: string; role: string }) {
    vi.mocked(authModule.useAuth).mockReturnValue({ user } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.getInovaProjectDetail).mockResolvedValue({
      project: projeto,
      phaseHistory: [],
      diaryEntries: [entrada],
      tasks: [tarefa],
      activity: [],
    })
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/comunidade-inova/1']}>
          <Routes>
            <Route path="/comunidade-inova/:id" element={<InovaProjectDetailPage />} />
            <Route path="/comunidade-inova/projetos" element={<p>lista</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('esconde as ações do projeto de quem não é dono nem administra', async () => {
    renderComo({ id: 'estranho', role: 'LEGEND' })
    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /excluir projeto/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /editar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /excluir tarefa/i })).not.toBeInTheDocument()
    // …mas a entrada do diário que ela mesma não escreveu também não.
    expect(screen.queryByRole('button', { name: /excluir entrada/i })).not.toBeInTheDocument()
  })

  it('quem escreveu a entrada pode apagá-la mesmo sem ser dono do projeto', async () => {
    renderComo({ id: 'autor', role: 'LEGEND' })
    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /excluir entrada/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /excluir projeto/i })).not.toBeInTheDocument()
  })

  it('o dono exclui o projeto depois de confirmar', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(inovaApi.deleteInovaProject).mockResolvedValue(undefined)
    renderComo({ id: 'dono', role: 'LEGEND' })
    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /excluir projeto/i }))

    expect(confirmar).toHaveBeenCalled()
    await waitFor(() => expect(inovaApi.deleteInovaProject).toHaveBeenCalledWith('1'))
    confirmar.mockRestore()
  })

  it('desistir da confirmação não chama a API', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(inovaApi.deleteInovaProjectTask).mockResolvedValue(undefined)
    renderComo({ id: 'dono', role: 'LEGEND' })
    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /excluir tarefa/i }))

    expect(inovaApi.deleteInovaProjectTask).not.toHaveBeenCalled()
    confirmar.mockRestore()
  })

  it('o dono volta o projeto de fase clicando na jornada', async () => {
    vi.mocked(inovaApi.changeInovaProjectPhase).mockResolvedValue({ project: projeto })
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { id: 'dono', role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.getInovaProjectDetail).mockResolvedValue({
      project: { ...projeto, phase: 'TESTING_SOLUTION' },
      phaseHistory: [],
      diaryEntries: [],
      tasks: [],
      activity: [],
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/comunidade-inova/1']}>
          <Routes>
            <Route path="/comunidade-inova/:id" element={<InovaProjectDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: /mover para a fase testando a solução/i })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /mover para a fase ideia do projeto/i }))

    await waitFor(() => expect(inovaApi.changeInovaProjectPhase).toHaveBeenCalledWith('1', { phase: 'IDEA' }))
  })

  it('quem não é dono vê a jornada, mas não muda a fase', async () => {
    renderComo({ id: 'estranho', role: 'LEGEND' })
    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /mover para a fase/i })).not.toBeInTheDocument()
  })
})

describe('InovaProjectDetailPage — kanban e diário', () => {
  const base = {
    id: '1',
    title: 'Projeto A',
    category: 'IA',
    sector: 'Ensino',
    description: 'desc',
    problemDescription: null,
    results: null,
    hoursSaved: null,
    costReduction: null,
    otherMetrics: null,
    projectCosts: null,
    toolsUsed: null,
    deadline: null,
    estimatedDeadline: null,
    priority: false,
    leadershipChallenge: false,
    sectorRepresentative: null,
    responsible1: null,
    responsible2: null,
    phase: 'IDEA' as const,
    archived: false,
    createdById: 'dono',
    createdByName: 'Dono',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  const entrada = (id: string, title: string, entryType: 'MANUAL' | 'AUTOMATIC') => ({
    id,
    projectId: '1',
    title,
    description: null,
    learnings: null,
    tools: null,
    entryType,
    occurredAt: '2026-01-02T00:00:00.000Z',
    imageUrls: [],
    videoLinks: [],
    externalLinks: [],
    createdById: 'autor',
    createdByName: 'Autor',
    createdAt: '2026-01-02T00:00:00.000Z',
  })

  function renderPage() {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { id: 'colega', role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.getInovaProjectDetail).mockResolvedValue({
      project: base,
      phaseHistory: [],
      diaryEntries: [entrada('d1', 'Testei o protótipo', 'MANUAL'), entrada('d2', 'Tarefa criada: Pesquisar', 'AUTOMATIC')],
      tasks: [
        {
          id: 't1',
          projectId: '1',
          title: 'Pesquisar',
          description: null,
          responsible: 'Ana',
          dueDate: '2026-10-01',
          status: 'PENDING',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      activity: [],
    })
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/comunidade-inova/1']}>
          <Routes>
            <Route path="/comunidade-inova/:id" element={<InovaProjectDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('filtra o diário entre entradas manuais e automáticas', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Testei o protótipo')).toBeInTheDocument())
    expect(screen.getByText('Tarefa criada: Pesquisar')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Automáticos' }))
    expect(screen.queryByText('Testei o protótipo')).not.toBeInTheDocument()
    expect(screen.getByText('Tarefa criada: Pesquisar')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Manuais' }))
    expect(screen.getByText('Testei o protótipo')).toBeInTheDocument()
    expect(screen.queryByText('Tarefa criada: Pesquisar')).not.toBeInTheDocument()
  })

  it('cria a tarefa na coluna do "+" e edita a existente', async () => {
    vi.mocked(inovaApi.createInovaProjectTask).mockResolvedValue({ task: {} as never })
    vi.mocked(inovaApi.updateInovaProjectTask).mockResolvedValue({ task: {} as never })
    vi.mocked(inovaApi.updateInovaProjectTaskStatus).mockResolvedValue({ task: {} as never })
    renderPage()
    await waitFor(() => expect(screen.getByText('01/10/2026')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Nova tarefa em Em andamento' }))
    await userEvent.type(screen.getByLabelText('Título da tarefa'), 'Montar protótipo')
    await userEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }))
    await waitFor(() =>
      expect(inovaApi.createInovaProjectTask).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ title: 'Montar protótipo', status: 'IN_PROGRESS' }),
      ),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Editar tarefa Pesquisar' }))
    await userEvent.clear(screen.getByLabelText('Responsável pela tarefa'))
    await userEvent.type(screen.getByLabelText('Responsável pela tarefa'), 'Bia')
    await userEvent.selectOptions(screen.getByLabelText('Status da tarefa'), 'DONE')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(inovaApi.updateInovaProjectTask).toHaveBeenCalledWith('t1', expect.objectContaining({ responsible: 'Bia' })),
    )
    expect(inovaApi.updateInovaProjectTaskStatus).toHaveBeenCalledWith('t1', 'DONE')
  })
})


describe('InovaProjectDetailPage — curadoria, texto rico e histórico', () => {
  const projeto = {
    id: '1',
    title: 'Projeto A',
    category: 'IA',
    sector: 'Ensino',
    description: 'Automatiza o **relatório semanal**',
    problemDescription: null,
    results: null,
    hoursSaved: null,
    costReduction: null,
    otherMetrics: null,
    projectCosts: null,
    toolsUsed: null,
    deadline: null,
    estimatedDeadline: null,
    priority: false,
    leadershipChallenge: false,
    sectorRepresentative: null,
    responsible1: null,
    responsible2: null,
    phase: 'IDEA' as const,
    archived: false,
    createdById: 'dono',
    createdByName: 'Dono',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  function renderComo(user: { id: string; role: string }) {
    vi.mocked(authModule.useAuth).mockReturnValue({ user } as ReturnType<typeof authModule.useAuth>)
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/comunidade-inova/1']}>
          <Routes>
            <Route path="/comunidade-inova/:id" element={<InovaProjectDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('quem administra arquiva o projeto; o dono comum não vê o botão', async () => {
    vi.mocked(inovaApi.getInovaProjectDetail).mockResolvedValue({ project: projeto, phaseHistory: [], diaryEntries: [], tasks: [], activity: [] })
    vi.mocked(inovaApi.updateInovaProject).mockResolvedValue({ project: { ...projeto, archived: true } })

    const { unmount } = renderComo({ id: 'dono', role: 'LEGEND' })
    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /arquivar projeto/i })).not.toBeInTheDocument()
    unmount()

    renderComo({ id: 'admin', role: 'ADMIN' })
    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /arquivar projeto/i }))
    await waitFor(() => expect(inovaApi.updateInovaProject).toHaveBeenCalledWith('1', { archived: true }))
    expect(await screen.findByText(/não conta mais no ranking/i)).toBeInTheDocument()
  })

  it('renderiza a descrição em Markdown e embute vídeo do Loom no diário', async () => {
    vi.mocked(inovaApi.getInovaProjectDetail).mockResolvedValue({
      project: projeto,
      phaseHistory: [],
      diaryEntries: [
        {
          id: 'd1',
          projectId: '1',
          title: 'Demo',
          description: null,
          learnings: null,
          tools: null,
          entryType: 'MANUAL',
          occurredAt: '2026-01-02T00:00:00.000Z',
          imageUrls: [],
          videoLinks: ['https://www.loom.com/share/abc123def'],
          externalLinks: [],
          createdById: 'autor',
          createdByName: 'Autor',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      tasks: [],
      activity: [],
    })
    renderComo({ id: 'estranho', role: 'LEGEND' })
    expect(await screen.findByText('relatório semanal')).toHaveProperty('tagName', 'STRONG')
    expect(screen.getByTitle('Vídeo do diário de bordo')).toHaveAttribute('src', 'https://www.loom.com/embed/abc123def')
  })

  it('mostra as 8 alterações mais recentes e o resto atrás de "Ver todos"', async () => {
    const activity = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`,
      projectId: '1',
      action: 'TASK_CREATED',
      entity: 'InovaProjectTask',
      summary: `Alteração ${i + 1}`,
      actorId: 'u1',
      actorName: 'Fulano',
      details: null,
      createdAt: '2026-01-01T12:00:00.000Z',
    }))
    vi.mocked(inovaApi.getInovaProjectDetail).mockResolvedValue({ project: projeto, phaseHistory: [], diaryEntries: [], tasks: [], activity })
    renderComo({ id: 'estranho', role: 'LEGEND' })

    expect(await screen.findByText('10 registros')).toBeInTheDocument()
    expect(screen.getByText('Alteração 8')).toBeInTheDocument()
    expect(screen.queryByText('Alteração 9')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ver todos (10)' }))
    expect(screen.getByText('Alteração 10')).toBeInTheDocument()
  })
})
