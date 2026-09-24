import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicUser } from '@legends/shared'
import { InovaProjectFormPage } from './InovaProjectFormPage'
import * as inovaApi from '../../lib/inova-api'
import * as api from '../../lib/api'

vi.mock('../../lib/inova-api')

const mockUseAuth = vi.fn()
vi.mock('../../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

const fulano: PublicUser = {
  id: 'u1',
  name: 'Fulano de Tal',
  email: null,
  role: 'LEGEND',
  area: null,
  position: null,
  positionCategory: null,
  squad: null,
  photoUrl: null,
  avatarStyle: null,
  avatarSeed: null,
  avatarOptions: null,
  active: true,
  joinedAt: '2026-01-01T00:00:00.000Z',
  leftAt: null,
  sectorId: 's1',
  companyId: 'company-emr',
  companyName: null,
  enabledFeatures: [],
  sectorFeatures: [],
  adminAccess: false,
}

/** Quem está logada e cadastrando o projeto — é ela quem some da lista de feedback. */
const logada: PublicUser = { ...fulano, id: 'u-logada', name: 'Karla Souza' }

describe('InovaProjectFormPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // já viu o modal de onboarding em cadastro anterior: o teste cobre o fluxo
    // de redirecionamento normal, não o modal único de primeiro cadastro (Tasks 9/10).
    localStorage.setItem('inova_onboarding_seen', 'true')
    mockUseAuth.mockReturnValue({ user: logada })
    // A lista de responsáveis é a da empresa inteira (?scope=all), e não a de
    // destinatários de feedback: quem cadastra precisa se achar na busca.
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path === '/users/company?scope=all') return { users: [logada, fulano] } as never
      throw new Error(`unexpected apiFetch: ${path}`)
    })
  })

  it('cria um projeto novo preenchendo todos os campos obrigatórios', async () => {
    vi.mocked(inovaApi.createInovaProject).mockResolvedValue({ project: { id: 'novo-id' } as never })
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/comunidade-inova/novo']}>
          <Routes>
            <Route path="/comunidade-inova/novo" element={<InovaProjectFormPage />} />
            <Route path="/comunidade-inova/projetos/:id" element={<p>detalhe</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await userEvent.click(screen.getByLabelText(/li e entendi os critérios/i))
    await userEvent.type(screen.getByLabelText(/título do projeto/i), 'Meu projeto')
    // Setor e categoria são lista fechada, como no INOVA original.
    await userEvent.selectOptions(screen.getByLabelText(/^categoria/i), 'Automação de processos')
    await userEvent.selectOptions(screen.getByLabelText(/^setor/i), 'Ensino')
    await userEvent.click(screen.getByRole('button', { name: /trocar destinatário/i }))
    await userEvent.click(screen.getByLabelText(/^responsável pelo projeto/i))
    await userEvent.click(await screen.findByText('Fulano de Tal'))
    await userEvent.type(screen.getByLabelText(/^descrição do projeto/i), 'Descrição do projeto')
    await userEvent.type(screen.getByLabelText(/qual problema/i), 'Resolve X')
    await userEvent.type(screen.getByLabelText(/qual o prazo/i), '3 meses')
    await userEvent.type(screen.getByLabelText(/quais ferramentas/i), 'ChatGPT')
    await userEvent.type(screen.getByLabelText(/quais custos/i), 'Nenhum')
    await userEvent.click(screen.getByRole('button', { name: /salvar|lançar projeto/i }))

    await waitFor(() => expect(inovaApi.createInovaProject).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('detalhe')).toBeInTheDocument())
  })

  it('já traz quem está cadastrando como responsável, e ela aparece na busca', async () => {
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/comunidade-inova/novo']}>
          <Routes>
            <Route path="/comunidade-inova/novo" element={<InovaProjectFormPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Karla Souza')).toBeInTheDocument()

    // Trocando o campo, ela continua achável pela busca — era isso que a lista de
    // destinatários de feedback escondia de quem cadastra o próprio projeto.
    await userEvent.click(screen.getByRole('button', { name: /trocar destinatário/i }))
    await userEvent.type(screen.getByLabelText(/^responsável pelo projeto/i), 'kar')
    expect(await screen.findByText('Karla Souza')).toBeInTheDocument()
  })

  it('não permite submeter sem aceitar os critérios de elegibilidade', async () => {
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/comunidade-inova/novo']}>
          <Routes>
            <Route path="/comunidade-inova/novo" element={<InovaProjectFormPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await userEvent.type(screen.getByLabelText(/título do projeto/i), 'Meu projeto')

    expect(screen.getByRole('button', { name: /salvar|lançar projeto/i })).toBeDisabled()
    expect(inovaApi.createInovaProject).not.toHaveBeenCalled()
  })

  it('na edição mostra as etapas Impacto e Fase, salva o impacto e deixa voltar de fase', async () => {
    const dono = { ...logada }
    vi.mocked(inovaApi.getInovaProjectDetail).mockResolvedValue({
      project: {
        id: 'p1',
        title: 'Projeto',
        category: 'Outro',
        sector: 'Ensino',
        description: 'Descrição',
        problemDescription: 'Problema',
        results: null,
        hoursSaved: null,
        costReduction: null,
        otherMetrics: null,
        projectCosts: 'Nenhum',
        toolsUsed: 'ChatGPT',
        deadline: null,
        estimatedDeadline: '3 meses',
        priority: false,
        leadershipChallenge: false,
        sectorRepresentative: null,
        responsible1: dono,
        responsible2: null,
        phase: 'TESTING_SOLUTION',
        archived: false,
        createdById: dono.id,
        createdByName: dono.name,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      phaseHistory: [],
      diaryEntries: [],
      tasks: [],
      activity: [],
    })
    vi.mocked(inovaApi.updateInovaProject).mockResolvedValue({ project: { id: 'p1' } as never })
    vi.mocked(inovaApi.changeInovaProjectPhase).mockResolvedValue({ project: { id: 'p1' } as never })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/comunidade-inova/projetos/p1/editar']}>
          <Routes>
            <Route path="/comunidade-inova/projetos/:id/editar" element={<InovaProjectFormPage />} />
            <Route path="/comunidade-inova/projetos/:id" element={<p>detalhe</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText(/título do projeto/i)).toHaveValue('Projeto'))

    await userEvent.click(screen.getByRole('button', { name: /2\. impacto/i }))
    await userEvent.type(screen.getByLabelText(/horas economizadas/i), '40')
    await userEvent.type(screen.getByLabelText(/redução de custo/i), '5.000,50')
    await userEvent.type(screen.getByLabelText(/resultados obtidos/i), 'Menos retrabalho')

    await userEvent.click(screen.getByRole('button', { name: /próximo: fase/i }))
    expect(screen.getByRole('radio', { name: /testando a solução/i })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: /explorando a solução/i }))

    await userEvent.click(screen.getByRole('button', { name: /salvar alterações/i }))

    await waitFor(() =>
      expect(inovaApi.updateInovaProject).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ hoursSaved: 40, costReduction: 5000.5, results: 'Menos retrabalho' }),
      ),
    )
    expect(inovaApi.changeInovaProjectPhase).toHaveBeenCalledWith('p1', { phase: 'EXPLORING_SOLUTION' })
    await waitFor(() => expect(screen.getByText('detalhe')).toBeInTheDocument())
  })

  it('abre direto na etapa Impacto pelo link "Registrar impacto"', async () => {
    vi.mocked(inovaApi.getInovaProjectDetail).mockReturnValue(new Promise(() => {}))
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/comunidade-inova/projetos/p1/editar?etapa=impacto']}>
          <Routes>
            <Route path="/comunidade-inova/projetos/:id/editar" element={<InovaProjectFormPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByLabelText(/horas economizadas/i)).toBeInTheDocument()
  })
})
