import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InovaProjectDTO, PublicUser } from '@legends/shared'
import { InovaAdminPanelPage } from './InovaAdminPanelPage'
import * as inovaApi from '../../lib/inova-api'

vi.mock('../../lib/inova-api')

const fulano: PublicUser = {
  id: 'u1',
  name: 'Fulano',
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

const projetoBase: InovaProjectDTO = {
  id: '1',
  title: 'Projeto A',
  category: 'Automação de processos',
  sector: 'Ensino',
  description: 'desc',
  problemDescription: null,
  results: null,
  hoursSaved: 10,
  costReduction: 500,
  otherMetrics: null,
  projectCosts: null,
  toolsUsed: null,
  deadline: null,
  estimatedDeadline: null,
  priority: false,
  leadershipChallenge: false,
  sectorRepresentative: null,
  responsible1: fulano,
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
        <InovaAdminPanelPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('InovaAdminPanelPage', () => {
  it('soma as métricas dos projetos não arquivados e ignora arquivado', async () => {
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', costReduction: 500, hoursSaved: 10 },
        { ...projetoBase, id: '2', costReduction: 300, hoursSaved: 5, sector: 'CX' },
        { ...projetoBase, id: '3', archived: true, costReduction: 9999, hoursSaved: 999 },
      ],
    })
    vi.mocked(inovaApi.listSectors).mockResolvedValue({ sectors: [{ id: 's1', name: 'Ensino' }, { id: 's2', name: 'CX' }] })

    renderPage()

    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Economia Estimada' })).getByText('R$ 800')).toBeInTheDocument())
    expect(within(screen.getByRole('group', { name: 'Horas Economizadas/mês' })).getByText('15h')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Projetos Ativos' })).getByText('2')).toBeInTheDocument()
  })

  it('filtro por setor recalcula as métricas', async () => {
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', sector: 'Ensino', costReduction: 500 },
        { ...projetoBase, id: '2', sector: 'CX', costReduction: 300 },
      ],
    })
    vi.mocked(inovaApi.listSectors).mockResolvedValue({ sectors: [{ id: 's1', name: 'Ensino' }, { id: 's2', name: 'CX' }] })

    renderPage()
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Economia Estimada' })).getByText('R$ 800')).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByLabelText('Setor'), 'Ensino')

    expect(within(screen.getByRole('group', { name: 'Economia Estimada' })).getByText('R$ 500')).toBeInTheDocument()
  })

  it('mostra insight de setor sem projeto', async () => {
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({ projects: [{ ...projetoBase, sector: 'Ensino' }] })
    vi.mocked(inovaApi.listSectors).mockResolvedValue({ sectors: [{ id: 's1', name: 'Ensino' }, { id: 's2', name: 'CX' }] })

    renderPage()

    await waitFor(() => expect(screen.getByText(/CX/)).toBeInTheDocument())
    expect(screen.getByText(/Sem projetos ativos/)).toBeInTheDocument()
  })

  // O projeto importado do INOVA original grava "Gente & Gestão"; o cadastro
  // de setores escreve "Gente e Gestão". Comparando o texto cru, o painel dava
  // G&G como setor sem projeto mesmo com projeto dele no quadro.
  it('conta o projeto de "Gente & Gestão" para o setor cadastrado como "Gente e Gestão"', async () => {
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', sector: 'Ensino' },
        { ...projetoBase, id: '2', sector: 'Gente & Gestão' },
      ],
    })
    vi.mocked(inovaApi.listSectors).mockResolvedValue({
      sectors: [
        { id: 's1', name: 'Ensino' },
        { id: 's2', name: 'Gente e Gestão' },
        { id: 's3', name: 'CX' },
      ],
    })

    renderPage()

    const areas = await screen.findByRole('group', { name: 'Áreas Participando' })
    await waitFor(() => expect(within(areas).getByText('2/3')).toBeInTheDocument())
    expect(within(areas).getByText('Sem projetos ativos: CX')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Gente e Gestão' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Gente & Gestão' })).not.toBeInTheDocument()
  })

  it('mostra o ROI e o gráfico de projetos por fase', async () => {
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', costReduction: 1000, projectCosts: 'R$ 500' },
        { ...projetoBase, id: '2', phase: 'COMPLETED', costReduction: 0 },
      ],
    })
    vi.mocked(inovaApi.listSectors).mockResolvedValue({ sectors: [{ id: 's1', name: 'Ensino' }] })

    renderPage()

    await waitFor(() => expect(screen.getByText('2.0x')).toBeInTheDocument())
    const porFase = screen.getByRole('heading', { name: 'Projetos por Fase' }).closest('section')!
    expect(within(porFase).getByText('Ideia do Projeto')).toBeInTheDocument()
    expect(within(porFase).getByText('Concluído')).toBeInTheDocument()
  })

  it('período conta projeto criado antes que mudou de fase ou ganhou diário no período', async () => {
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        // Criado em 2025, avançou em 2026: entra no recorte de 2026.
        {
          ...projetoBase,
          id: '1',
          costReduction: 100,
          createdAt: '2025-05-01T12:00:00.000Z',
          phaseHistory: [
            { phase: 'IDEA', occurredAt: '2025-05-01T12:00:00.000Z' },
            { phase: 'TESTING_SOLUTION', occurredAt: '2026-03-10T12:00:00.000Z' },
          ],
          diaryDates: [],
        },
        // Criado em 2025, só registrou diário em 2026: entra também.
        { ...projetoBase, id: '2', costReduction: 20, createdAt: '2025-06-01T12:00:00.000Z', phaseHistory: [], diaryDates: ['2026-02-01T12:00:00.000Z'] },
        // Nada em 2026: fica fora.
        { ...projetoBase, id: '3', costReduction: 3, createdAt: '2025-07-01T12:00:00.000Z', phaseHistory: [], diaryDates: [] },
      ],
    })
    vi.mocked(inovaApi.listSectors).mockResolvedValue({ sectors: [{ id: 's1', name: 'Ensino' }] })

    renderPage()
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Economia Estimada' })).getByText('R$ 123')).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByDisplayValue('Todo o período'), 'year')
    await userEvent.selectOptions(screen.getByDisplayValue(String(new Date().getFullYear())), '2026')

    expect(within(screen.getByRole('group', { name: 'Economia Estimada' })).getByText('R$ 120')).toBeInTheDocument()
  })

  it('"Limpar" zera setor e período do filtro global', async () => {
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', sector: 'Ensino', costReduction: 500 },
        { ...projetoBase, id: '2', sector: 'CX', costReduction: 300 },
      ],
    })
    vi.mocked(inovaApi.listSectors).mockResolvedValue({ sectors: [{ id: 's1', name: 'Ensino' }, { id: 's2', name: 'CX' }] })

    renderPage()
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Economia Estimada' })).getByText('R$ 800')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Limpar' })).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Setor'), 'Ensino')
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }))

    expect(within(screen.getByRole('group', { name: 'Economia Estimada' })).getByText('R$ 800')).toBeInTheDocument()
    expect(screen.getByLabelText('Setor')).toHaveValue('all')
  })

  it('pipeline agrupa as fases em três colunas, com cards que abrem o projeto', async () => {
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: 'a', title: 'Ideia solta', phase: 'IDEA' },
        { ...projetoBase, id: 'b', title: 'Explorando algo', phase: 'EXPLORING_SOLUTION' },
        { ...projetoBase, id: 'c', title: 'Testando algo', phase: 'TESTING_SOLUTION' },
        { ...projetoBase, id: 'd', title: 'Na rotina', phase: 'ROUTINE_USE' },
        { ...projetoBase, id: 'e', title: 'Já concluído', phase: 'COMPLETED' },
      ],
    })
    vi.mocked(inovaApi.listSectors).mockResolvedValue({ sectors: [{ id: 's1', name: 'Ensino' }] })

    renderPage()

    const naoIniciaram = await screen.findByRole('region', { name: 'Projetos que ainda não iniciaram' })
    const andamento = screen.getByRole('region', { name: 'Projetos em andamento' })
    const execucao = screen.getByRole('region', { name: 'Projetos em execução' })
    await waitFor(() => expect(within(naoIniciaram).getByRole('link', { name: /Ideia solta/ })).toHaveAttribute('href', '/comunidade-inova/projetos/a'))
    expect(within(andamento).getAllByRole('link')).toHaveLength(2)
    expect(within(execucao).getByRole('link', { name: /Na rotina/ })).toBeInTheDocument()
    // Concluído não é pipeline — fica fora das três colunas.
    expect(screen.queryByRole('link', { name: /Já concluído/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Filtros' }))
    await userEvent.selectOptions(screen.getByLabelText('Fase do pipeline'), 'TESTING_SOLUTION')
    expect(within(andamento).getAllByRole('link')).toHaveLength(1)
    expect(within(naoIniciaram).queryAllByRole('link')).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(within(andamento).getAllByRole('link')).toHaveLength(2)
  })

  it('gráfico de evolução traça avanços de fase, sem contar a fase inicial da criação', async () => {
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        {
          ...projetoBase,
          id: '1',
          createdAt: '2026-01-10T12:00:00.000Z',
          phaseHistory: [
            { phase: 'IDEA', occurredAt: '2026-01-10T12:00:00.000Z' },
            { phase: 'EXPLORING_SOLUTION', occurredAt: '2026-02-10T12:00:00.000Z' },
            { phase: 'TESTING_SOLUTION', occurredAt: '2026-02-20T12:00:00.000Z' },
          ],
        },
      ],
    })
    vi.mocked(inovaApi.listSectors).mockResolvedValue({ sectors: [{ id: 's1', name: 'Ensino' }] })

    renderPage()

    expect(await screen.findByRole('img', { name: /1 novo projeto e 2 avanços de fase/ })).toBeInTheDocument()
  })

  it('manda ao chat só os projetos do recorte quando há filtro', async () => {
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', sector: 'Ensino' },
        { ...projetoBase, id: '2', sector: 'CX' },
      ],
    })
    vi.mocked(inovaApi.listSectors).mockResolvedValue({ sectors: [{ id: 's1', name: 'Ensino' }, { id: 's2', name: 'CX' }] })
    vi.mocked(inovaApi.listInovaAdminChatConversations).mockResolvedValue({ conversations: [] })
    vi.mocked(inovaApi.askInovaAdminChat).mockReturnValue(new Promise(() => {}))

    renderPage()
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Economia Estimada' })).getByText('R$ 1.000')).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByLabelText('Setor'), 'CX')
    expect(screen.getByText(/Analisando o recorte do painel: CX/)).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText(/Ex\.:/), 'como estamos?{Enter}')

    expect(inovaApi.askInovaAdminChat).toHaveBeenCalledWith({ message: 'como estamos?', projectIds: ['2'] })
  })

  it('"Tipos de Projetos" abre a lista de projetos da categoria', async () => {
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', title: 'Robô de conciliação', category: 'Automação de processos', sector: 'CX' },
        { ...projetoBase, id: '2', title: 'Painel de churn', category: 'Análise de dados' },
      ],
    })
    vi.mocked(inovaApi.listSectors).mockResolvedValue({ sectors: [{ id: 's1', name: 'Ensino' }, { id: 's2', name: 'CX' }] })

    renderPage()

    const tipos = (await screen.findByRole('heading', { name: 'Tipos de Projetos em Andamento' })).closest('section')!
    await userEvent.click(await within(tipos).findByRole('button', { name: /Automação de processos/ }))
    expect(within(tipos).getByText(/Robô de conciliação/)).toBeInTheDocument()
    expect(within(tipos).getByText(/· CX/)).toBeInTheDocument()
  })

  // Achado 1: "R$ 5.000" era interpretado como decimal (parseFloat('5.000') === 5)
  // porque um único grupo de 3 dígitos após o ponto, sem vírgula, é sempre
  // milhar em pt-BR ("5.000" = cinco mil), nunca decimal. O parser soma TODOS
  // os tokens numéricos do texto livre — daí testar também vírgula decimal
  // ("1.200,50") e um valor sem "R$" no meio de texto ("$70 para transcrição")
  // continuando corretos.
  it('soma "Custos do projeto" tratando ponto de milhar, vírgula decimal e texto livre corretamente', async () => {
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        { ...projetoBase, id: '1', costReduction: 0, projectCosts: 'R$ 5.000' },
        { ...projetoBase, id: '2', costReduction: 0, projectCosts: 'R$ 1.200,50' },
        { ...projetoBase, id: '3', costReduction: 0, projectCosts: '$70 para transcrição' },
      ],
    })
    vi.mocked(inovaApi.listSectors).mockResolvedValue({ sectors: [{ id: 's1', name: 'Ensino' }] })

    renderPage()

    // 5000 + 1200,5 + 70 = 6270,5 — se "R$ 5.000" fosse lido como decimal
    // (bug original), o total ficaria em torno de "R$ 71,5".
    await waitFor(() =>
      expect(within(screen.getByRole('group', { name: 'Investimento total' })).getByText('R$ 6.270,5')).toBeInTheDocument(),
    )
  })

  // Achado 2: o rótulo do mês no gráfico de linha do tempo vinha de
  // `new Date('YYYY-MM-01').toLocaleDateString(...)`. Uma data-only ISO string
  // é interpretada como UTC meia-noite; renderizada num fuso atrás de UTC
  // (ex.: America/Sao_Paulo, UTC-3) ela volta para o dia anterior — e, no dia
  // 1º do mês, isso troca o MÊS inteiro ("jan/26" virava "dez/25"). Fixar o
  // fuso do teste para um horário atrás de UTC é o que de fato provaria a
  // independência de fuso: com literais de string ("jan/26") o teste antigo
  // passava mesmo com o bug, porque nunca exercitava o `Date` de verdade.
  describe('rótulo do mês no gráfico (independente do fuso horário do executor do teste)', () => {
    const originalTZ = process.env.TZ

    beforeEach(() => {
      process.env.TZ = 'America/Sao_Paulo'
    })

    afterEach(() => {
      process.env.TZ = originalTZ
    })

    it('rotula pelo mês do texto "YYYY-MM", não pelo Date convertido para o fuso local', async () => {
      vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
        projects: [{ ...projetoBase, id: '1', createdAt: '2026-01-01T00:00:00.000Z' }],
      })
      vi.mocked(inovaApi.listSectors).mockResolvedValue({ sectors: [{ id: 's1', name: 'Ensino' }] })

      renderPage()

      await waitFor(() => expect(screen.getByText('jan/26')).toBeInTheDocument())
      expect(screen.queryByText('dez/25')).not.toBeInTheDocument()
    })
  })
})
