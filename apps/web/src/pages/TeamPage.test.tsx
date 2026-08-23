import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { OrganizationChartDTO, OrganizationNodeDTO } from '@legends/shared'
import { TeamPage } from './TeamPage'
import { apiFetch } from '../lib/api'

const mockUseAuth = vi.fn()
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
vi.mock('../components/Avatar', () => ({
  Avatar: ({ user }: { user: { name: string } }) => <span>{user.name.slice(0, 1)}</span>,
}))

const mockApiFetch = apiFetch as unknown as Mock

function node(
  id: string,
  name: string,
  position: string,
  sectorName: string,
  reports: OrganizationNodeDTO[] = [],
): OrganizationNodeDTO {
  return {
    id,
    name,
    position,
    sectorName,
    sectorId: `sector-${sectorName}`,
    role: 'LEGEND',
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    reports,
    reportsCount: reports.reduce((total, report) => total + report.reportsCount + 1, 0),
  }
}

const DIEGO = node('dev-2', 'Diego Dev', 'Desenvolvedor', 'Tecnologia')
const CARLA = node('lead-1', 'Carla Lead', 'Tech Lead', 'Tecnologia', [DIEGO])
const BRUNO = node('cto-1', 'Bruno CTO', 'CTO', 'Diretoria de Tecnologia', [CARLA])
const ERICA = node('des-1', 'Érica Designer', 'Product Designer', 'Produto')
const VANESSA = node('cmo-1', 'Vanessa CMO', 'CMO', 'Diretoria de Marketing', [ERICA])
const ANA = node('ceo-1', 'Ana CEO', 'CEO', 'Diretoria Executiva', [BRUNO, VANESSA])

const CHART: OrganizationChartDTO = {
  company: { id: 'company-1', name: 'Empresa Legends' },
  roots: [ANA],
  totalPeople: 6,
}

function wrap(ui: ReactNode = <TeamPage />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TeamPage — organograma', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: { id: 'dev-2', role: 'LEGEND', sectorId: 'sector-a' } })
    mockApiFetch.mockResolvedValue(CHART)
  })

  it('desenha a cadeia de comando inteira, aberta, com cargo e setor no card', async () => {
    wrap()

    expect(screen.getByRole('heading', { name: 'Organograma' })).toBeInTheDocument()
    expect(await screen.findByText(/Empresa Legends · 6 pessoas/)).toBeInTheDocument()
    expect(mockApiFetch).toHaveBeenCalledWith('/organization')

    for (const name of ['Ana CEO', 'Bruno CTO', 'Carla Lead', 'Diego Dev', 'Vanessa CMO', 'Érica Designer']) {
      expect(screen.getByRole('link', { name: new RegExp(name, 'i') })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: /Diego Dev/i })).toHaveAttribute('href', '/perfil/dev-2')
    expect(screen.getByText('Diretoria Executiva')).toBeInTheDocument()
    expect(screen.getAllByText('Tecnologia')).toHaveLength(2)

    // Líderes acima dos liderados na ordem do documento.
    const ana = screen.getByRole('link', { name: /Ana CEO/i })
    const diego = screen.getByRole('link', { name: /Diego Dev/i })
    expect(ana.compareDocumentPosition(diego) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('o card mede pelo conteúdo, para nome de setor comprido não sair cortado', async () => {
    wrap()
    // "Diretoria Executiva" não cabia nos 9rem fixos e saía com reticências. O
    // jsdom não faz layout, então o contrato aqui é a largura declarada: nada
    // de `w-[...]` fixo — `w-max` entre um piso e um teto. (Regressão real:
    // "Desenvolvimento de Produto" truncado no organograma da EMR.)
    const card = (await screen.findByText('Diretoria Executiva')).closest('a')?.parentElement
    expect(card?.className).toContain('w-max')
    expect(card?.className).toContain('min-w-[9rem]')
    expect(card?.className).toContain('max-w-[14rem]')
    expect(card?.className).not.toMatch(/(?:^|\s)w-\[\d/)
  })

  it('mostra o número de liderados diretos e recolhe a equipe pelo badge', async () => {
    wrap()
    await screen.findByRole('link', { name: /Ana CEO/i })

    const anaToggle = screen.getByRole('button', { name: 'Recolher equipe de Ana CEO' })
    expect(anaToggle).toHaveTextContent('2')
    // Folha não ganha botão.
    expect(screen.queryByRole('button', { name: /equipe de Diego Dev/ })).not.toBeInTheDocument()

    fireEvent.click(anaToggle)

    const expandir = screen.getByRole('button', { name: 'Expandir equipe de Ana CEO' })
    // Recolhido, o badge passa a mostrar a subárvore inteira, não só os diretos.
    expect(expandir).toHaveTextContent('+5')
    expect(screen.queryByText('Bruno CTO')).not.toBeInTheDocument()
    expect(screen.queryByText('Diego Dev')).not.toBeInTheDocument()

    fireEvent.click(expandir)
    expect(screen.getByRole('link', { name: /Bruno CTO/i })).toBeInTheDocument()
  })

  it('busca mantendo a linha de comando acima de quem casou', async () => {
    wrap()
    await screen.findByRole('link', { name: /Ana CEO/i })

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar no organograma' }), {
      target: { value: 'diego' },
    })

    // Diego aparece com Ana → Bruno → Carla acima; o ramo de Marketing sai.
    expect(screen.getByRole('link', { name: /Diego Dev/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Carla Lead/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ana CEO/i })).toBeInTheDocument()
    expect(screen.queryByText('Vanessa CMO')).not.toBeInTheDocument()
    expect(screen.queryByText('Érica Designer')).not.toBeInTheDocument()
    // Ana ficou com 1 liderado visível, não 2.
    expect(screen.getByRole('button', { name: 'Recolher equipe de Ana CEO' })).toHaveTextContent('1')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar no organograma' }), {
      target: { value: 'inexistente' },
    })
    expect(screen.getByRole('heading', { name: 'Nenhum resultado encontrado' })).toBeInTheDocument()
  })

  it('acha pessoa por setor e por cargo', async () => {
    wrap()
    await screen.findByRole('link', { name: /Ana CEO/i })
    const searchbox = screen.getByRole('searchbox', { name: 'Buscar no organograma' })

    fireEvent.change(searchbox, { target: { value: 'marketing' } })
    expect(screen.getByRole('link', { name: /Vanessa CMO/i })).toBeInTheDocument()
    expect(screen.queryByText('Bruno CTO')).not.toBeInTheDocument()

    fireEvent.change(searchbox, { target: { value: 'product designer' } })
    expect(screen.getByRole('link', { name: /Érica Designer/i })).toBeInTheDocument()
  })

  it('expande e recolhe todos os ramos', async () => {
    wrap()
    await screen.findByRole('link', { name: /Ana CEO/i })

    fireEvent.click(screen.getByRole('button', { name: 'Recolher tudo' }))
    expect(screen.getByRole('button', { name: 'Expandir equipe de Ana CEO' })).toBeInTheDocument()
    expect(screen.queryByText('Bruno CTO')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir tudo' }))
    expect(screen.getByRole('link', { name: /Diego Dev/i })).toBeInTheDocument()
  })

  it('avisa quando ninguém tem líder direto definido', async () => {
    mockApiFetch.mockResolvedValue({
      company: { id: 'company-1', name: 'Empresa Legends' },
      roots: [node('a', 'Pessoa A', 'Dev', 'Tecnologia'), node('b', 'Pessoa B', 'Dev', 'Tecnologia')],
      totalPeople: 2,
    } satisfies OrganizationChartDTO)
    mockUseAuth.mockReturnValue({ user: { id: 'a', role: 'ADMIN', sectorId: 'sector-a' } })
    wrap()

    expect(await screen.findByText(/Ninguém tem líder direto definido ainda/)).toBeInTheDocument()
    // O nome do menu importa: "Colaboradores" não existe no admin — o item é
    // "Lendas", em Organização.
    expect(screen.getByText(/Administração › Organização › Lendas/)).toBeInTheDocument()
  })

  it('limita o zoom desktop entre 60% e 140% e permite recentralizar', async () => {
    wrap()
    await screen.findByRole('link', { name: /Ana CEO/i })
    const increase = screen.getByRole('button', { name: 'Aumentar zoom' })
    for (let index = 0; index < 6; index += 1) fireEvent.click(increase)
    expect(screen.getByTestId('organization-canvas')).toHaveAttribute('data-zoom', '140')
    expect(increase).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Redefinir visualização' }))
    expect(screen.getByTestId('organization-canvas')).toHaveAttribute('data-zoom', '100')

    const decrease = screen.getByRole('button', { name: 'Diminuir zoom' })
    for (let index = 0; index < 6; index += 1) fireEvent.click(decrease)
    expect(screen.getByTestId('organization-canvas')).toHaveAttribute('data-zoom', '60')
    expect(decrease).toBeDisabled()
  })

  it('permite mover o canvas arrastando e aplicar zoom com a roda do mouse', async () => {
    wrap()
    await screen.findByRole('link', { name: /Ana CEO/i })
    const viewport = screen.getByTestId('organization-viewport')
    const canvas = screen.getByTestId('organization-canvas')

    fireEvent.pointerDown(viewport, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(viewport, { pointerId: 1, pointerType: 'mouse', clientX: 145, clientY: 130 })
    fireEvent.pointerUp(viewport, { pointerId: 1, pointerType: 'mouse', clientX: 145, clientY: 130 })

    expect(viewport).toHaveAttribute('data-pan-x', '45')
    expect(viewport).toHaveAttribute('data-pan-y', '30')

    fireEvent.wheel(viewport, { deltaY: -100, clientX: 200, clientY: 200 })
    expect(canvas).toHaveAttribute('data-zoom', '110')

    fireEvent.click(screen.getByRole('button', { name: 'Redefinir visualização' }))
    expect(viewport).toHaveAttribute('data-pan-x', '0')
    expect(viewport).toHaveAttribute('data-pan-y', '0')
    expect(canvas).toHaveAttribute('data-zoom', '100')
  })

  it('mostra erro e permite tentar novamente', async () => {
    mockApiFetch.mockRejectedValue(new Error('falha'))
    wrap()

    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao carregar o organograma.')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2))
  })

  it('esconde o CTA de reconhecimento para contas administrativas', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'admin-1', role: 'SUBADMIN', sectorId: 'sector-a' } })
    wrap()
    await screen.findByRole('link', { name: /Ana CEO/i })
    expect(screen.queryByRole('link', { name: 'Fazer reconhecimento' })).not.toBeInTheDocument()
  })
})

describe('TeamPage — organograma do meu time (entrada da Liderança)', () => {
  const MY_TEAM: OrganizationChartDTO = {
    company: { id: 'company-1', name: 'Empresa Legends' },
    roots: [node('lead-1', 'Lia Líder', 'Gerente', 'Tecnologia', [node('dev-2', 'Diego Dev', 'Desenvolvedor', 'Tecnologia'), ERICA])],
    totalPeople: 3,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: { id: 'lead-1', role: 'MANAGER', sectorId: 'sector-a', sectorFeatures: ['time'] } })
    mockApiFetch.mockResolvedValue(MY_TEAM)
  })

  it('busca o recorte dos diretos e não a empresa inteira', async () => {
    wrap(<TeamPage scope="direct-reports" />)

    expect(await screen.findByRole('link', { name: /Diego Dev/i })).toBeInTheDocument()
    expect(mockApiFetch).toHaveBeenCalledWith('/organization/direct-reports')
    expect(mockApiFetch).not.toHaveBeenCalledWith('/organization')
    expect(screen.getByRole('heading', { name: 'Organograma do meu time' })).toBeInTheDocument()
    expect(screen.getByText('2 pessoas respondem diretamente a você.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Lia Líder/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar para Liderança/ })).toHaveAttribute('href', '/lideranca')
    // Um nível só: nada para expandir ou recolher.
    expect(screen.queryByRole('button', { name: 'Expandir tudo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recolher tudo' })).not.toBeInTheDocument()
  })

  it('não oferece a empresa inteira para quem só lidera', async () => {
    wrap(<TeamPage scope="direct-reports" />)
    await screen.findByRole('link', { name: /Diego Dev/i })
    expect(screen.queryByRole('link', { name: /Ver a empresa inteira/ })).not.toBeInTheDocument()
  })

  it('dá a saída para a empresa inteira a admin e a Gente e Gestão', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'lead-1', role: 'ADMIN', sectorId: 'sector-a', sectorFeatures: [] } })
    const admin = wrap(<TeamPage scope="direct-reports" />)
    expect(await screen.findByRole('link', { name: /Ver a empresa inteira/ })).toHaveAttribute('href', '/time')
    admin.unmount()

    mockUseAuth.mockReturnValue({
      user: { id: 'lead-1', role: 'LEAD', sectorId: 'sector-a', sectorFeatures: ['time', 'gente-gestao'] },
    })
    wrap(<TeamPage scope="direct-reports" />)
    expect(await screen.findByRole('link', { name: /Ver a empresa inteira/ })).toHaveAttribute('href', '/time')
  })

  it('explica quando ninguém responde diretamente à pessoa', async () => {
    mockApiFetch.mockResolvedValue({
      company: { id: 'company-1', name: 'Empresa Legends' },
      roots: [],
      totalPeople: 0,
    } satisfies OrganizationChartDTO)
    wrap(<TeamPage scope="direct-reports" />)

    expect(await screen.findByText('Ninguém responde diretamente a você')).toBeInTheDocument()
    // Sem canvas: uma tela de organograma vazia passaria por bug.
    expect(screen.queryByTestId('organization-canvas')).not.toBeInTheDocument()
  })
})
