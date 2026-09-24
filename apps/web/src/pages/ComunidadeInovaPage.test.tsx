import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InovaProjectDTO } from '@legends/shared'
import { ComunidadeInovaPage } from './ComunidadeInovaPage'
import * as inovaApi from '../lib/inova-api'
import * as authModule from '../auth/AuthContext'

vi.mock('../lib/inova-api')
vi.mock('../auth/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/AuthContext')>()),
  useAuth: vi.fn(),
}))

const projetoBase: InovaProjectDTO = {
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
}

function renderPage() {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ComunidadeInovaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ComunidadeInovaPage', () => {
  // Os filtros vivem na sessionStorage, que o jsdom compartilha entre os testes
  // do arquivo — sem limpar, o recorte de um teste esconde o projeto do outro.
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('mostra os projetos agrupados por fase', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [{ ...projetoBase }],
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())
    // Cabeçalho da coluna + a pílula de fase do card.
    expect(screen.getByRole('heading', { name: 'Ideia do Projeto' })).toBeInTheDocument()
    expect(screen.getAllByText('Ideia do Projeto')).toHaveLength(2)
  })

  it('o card inteiro abre o projeto e o texto aparece sem marcação Markdown', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { id: 'outra', role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [{ ...projetoBase, description: 'Automatiza o **relatório**', results: '- Menos retrabalho' }],
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/comunidade-inova/projetos']}>
          <Routes>
            <Route path="/comunidade-inova/projetos" element={<ComunidadeInovaPage />} />
            <Route path="/comunidade-inova/projetos/:id" element={<p>detalhe</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Automatiza o relatório')).toBeInTheDocument()
    expect(screen.getByText('✓ Menos retrabalho')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /aprenda a editar seus projetos aqui/i })).toHaveAttribute(
      'href',
      '/comunidade-inova/como-usar',
    )
    // Quem não é dono não vê o atalho de edição.
    expect(screen.queryByRole('link', { name: /editar projeto a/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Automatiza o relatório'))
    expect(await screen.findByText('detalhe')).toBeInTheDocument()
  })

  it('mostra "Novo projeto" para qualquer colaborador', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({ projects: [] })

    renderPage()

    await waitFor(() => expect(screen.getByText('Ideia do Projeto')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /novo projeto/i })).toBeInTheDocument()
  })

  it('mostra o painel "Evolução das Áreas" com pontos somados por setor', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', sector: 'Ensino', phase: 'IDEA' }, // 1 ponto
        { ...projetoBase, id: '2', sector: 'Ensino', phase: 'COMPLETED' }, // 6 pontos
        { ...projetoBase, id: '3', sector: 'CX', phase: 'EXPLORING_SOLUTION' }, // 2 pontos
      ],
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Evolução das Áreas')).toBeInTheDocument())
    expect(screen.getByText('Ensino')).toBeInTheDocument()
    expect(screen.getByText('7 pts')).toBeInTheDocument() // 1+6
  })

  it('filtro "Só prioridade" esconde projetos sem priority', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', title: 'Prioritário', priority: true },
        { ...projetoBase, id: '2', title: 'Normal', priority: false },
      ],
    })

    renderPage()
    await waitFor(() => expect(screen.getByText('Prioritário')).toBeInTheDocument())
    expect(screen.getByText('Normal')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /só prioridade/i }))
    expect(screen.getByText('Prioritário')).toBeInTheDocument()
    expect(screen.queryByText('Normal')).not.toBeInTheDocument()
  })

  it('não mostra o botão de prioridade para quem não é admin/subadmin', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({ projects: [{ ...projetoBase }] })

    renderPage()
    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /marcar como prioridade|remover prioridade/i })).not.toBeInTheDocument()
  })

  it('mostra o botão de prioridade e reporta erro quando o toggle falha', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'ADMIN' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({ projects: [{ ...projetoBase }] })
    vi.mocked(inovaApi.updateInovaProject).mockRejectedValue(new Error('403'))

    renderPage()
    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())

    const botao = screen.getByRole('button', { name: /marcar como prioridade/i })
    await userEvent.click(botao)

    await waitFor(() =>
      expect(screen.getByText('Não foi possível atualizar a prioridade.')).toBeInTheDocument(),
    )
  })
  it('recorta por setor pelo painel de Filtros', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', title: 'Do Ensino', sector: 'Ensino' },
        { ...projetoBase, id: '2', title: 'Do CX', sector: 'CX' },
      ],
    })

    renderPage()
    await waitFor(() => expect(screen.getByText('Do Ensino')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /^filtros$/i }))
    await userEvent.selectOptions(screen.getByLabelText('Setor'), 'CX')

    expect(screen.getByText('Do CX')).toBeInTheDocument()
    expect(screen.queryByText('Do Ensino')).not.toBeInTheDocument()
    expect(sessionStorage.getItem('comunidade-inova:setor')).toBe('CX')
  })

  it('recorta por responsável, fase e desafio da liderança', async () => {
    const ana = { id: 'u-ana', name: 'Ana', email: 'ana@x.com', role: 'LEGEND' } as InovaProjectDTO['responsible1']
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', title: 'Da Ana', responsible2: ana, phase: 'TESTING_SOLUTION', leadershipChallenge: true },
        { ...projetoBase, id: '2', title: 'De ninguém', phase: 'IDEA' },
      ],
    })

    renderPage()
    await waitFor(() => expect(screen.getByText('Da Ana')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^filtros$/i }))

    // Responsável casa com responsible2, não só com o primeiro da dupla.
    await userEvent.selectOptions(screen.getByLabelText('Responsável'), 'u-ana')
    expect(screen.queryByText('De ninguém')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Fase'), 'IDEA')
    expect(screen.queryByText('Da Ana')).not.toBeInTheDocument()
    expect(screen.getByText('Nenhum projeto neste filtro.')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Fase'), 'TESTING_SOLUTION')
    await userEvent.selectOptions(screen.getByLabelText('Desafio Alta Liderança'), 'nao')
    expect(screen.queryByText('Da Ana')).not.toBeInTheDocument()
  })

  it('"Limpar filtros" devolve a lista inteira', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', title: 'Do Ensino', sector: 'Ensino' },
        { ...projetoBase, id: '2', title: 'Do CX', sector: 'CX' },
      ],
    })

    renderPage()
    await waitFor(() => expect(screen.getByText('Do Ensino')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^filtros$/i }))
    await userEvent.selectOptions(screen.getByLabelText('Setor'), 'CX')
    expect(screen.queryByText('Do Ensino')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /limpar filtros/i }))

    expect(screen.getByText('Do Ensino')).toBeInTheDocument()
    expect(screen.getByText('Do CX')).toBeInTheDocument()
    expect(sessionStorage.getItem('comunidade-inova:setor')).toBe('all')
  })
})
