import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { FEATURE_KEYS } from '@legends/shared'
import { AppLayout } from './AppLayout'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { useOfficeSession } from '../office/session/OfficeSessionContext'

const currentUser = { id: 'u1', name: 'Ana Souza', role: 'LEGEND', position: 'Dev', photoUrl: null, sectorFeatures: FEATURE_KEYS, adminAccess: false }

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: currentUser,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  })),
}))

vi.mock('../office/session/OfficeSessionContext', () => ({
  useOfficeSession: vi.fn(() => ({ exitOffice: vi.fn() })),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock
const mockUseAuth = useAuth as unknown as Mock
const mockUseOfficeSession = useOfficeSession as unknown as Mock

function setupPeriod(period: unknown) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/periods/current') return Promise.resolve({ period })
    if (path === '/me/coins') return Promise.resolve({ balance: 0 })
    return Promise.reject(new Error(`unexpected ${path}`))
  })
}

function renderLayout(initialPath = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppLayout />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AppLayout — indicador de votação', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentUser.role = 'LEGEND'
    mockUseAuth.mockReturnValue({
      user: currentUser,
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    })
    mockUseOfficeSession.mockReturnValue({ exitOffice: vi.fn() })
  })

  it('mostra o selo "Aberta" e o CTA da votação quando há período aberto', async () => {
    setupPeriod({
      id: 'p1',
      monthRef: '2026-06',
      startsAt: '2026-06-01T00:00:00.000Z',
      endsAt: '2026-06-30T23:59:59.000Z',
      status: 'OPEN',
    })
    renderLayout()

    // O CTA vive na própria barra; o selo "Aberta" está no item Votar, que
    // mora dentro do dropdown de Engajamento.
    expect(await screen.findByRole('button', { name: /votar no destaque/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^engajamento$/i }))
    expect(screen.getAllByText(/aberta/i).length).toBeGreaterThan(0)
  })

  it('esconde o selo "Aberta" e o CTA quando não há período aberto', async () => {
    setupPeriod(null)
    renderLayout()

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/periods/current'))
    expect(screen.queryByRole('button', { name: /votar no destaque/i })).not.toBeInTheDocument()
    // O item Votar continua alcançável, para chegar na página de estado fechado.
    fireEvent.click(screen.getByRole('button', { name: /^engajamento$/i }))
    expect(screen.getByRole('link', { name: /votar/i })).toBeInTheDocument()
    expect(screen.queryByText(/aberta/i)).not.toBeInTheDocument()
  })

  // A saudação saiu da barra superior, onde disputava espaço com a busca:
  // virou a faixa de boas-vindas da Home (ver HomePage).
  it('não repete a saudação na barra superior', async () => {
    setupPeriod(null)
    renderLayout()
    await screen.findByRole('navigation', { name: /navegação principal/i })
    expect(screen.queryByText(/olá, ana!/i)).not.toBeInTheDocument()
  })

  // Sair mora só no menu do avatar: a barra superior não tem rodapé onde
  // repetir a ação, como a sidebar tinha.
  it('inclui "Sair" no menu do avatar', async () => {
    setupPeriod(null)
    renderLayout()
    await screen.findByRole('navigation', { name: /navegação principal/i })

    fireEvent.click(screen.getByRole('button', { name: /abrir menu da conta/i }))
    expect(screen.getByRole('menuitem', { name: /sair/i })).toBeInTheDocument()
  })

  it('inclui "Meu perfil" no menu do avatar (não está na navegação)', async () => {
    setupPeriod(null)
    renderLayout()
    const nav = await screen.findByRole('navigation', { name: /navegação principal/i })
    expect(within(nav).queryByRole('link', { name: /meu perfil/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /abrir menu da conta/i }))
    expect(screen.getByRole('menuitem', { name: /meu perfil/i })).toBeInTheDocument()
  })

  it('não repete "Notificações" na sidebar (o acesso é pelo sino do header)', async () => {
    setupPeriod(null)
    renderLayout()
    const nav = await screen.findByRole('navigation', { name: /navegação principal/i })
    expect(within(nav).queryByRole('link', { name: /notificações/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /notificações/i })).toBeInTheDocument()
  })

  // Na barra superior os dropdowns nascem FECHADOS — um menu aberto sozinho
  // ao carregar cobriria o conteúdo sem ninguém ter pedido. O grupo da rota
  // atual é marcado, não expandido.
  it('marca o grupo da rota atual sem abri-lo, e abre um dropdown por vez', async () => {
    setupPeriod(null)
    renderLayout('/votar')
    const nav = await screen.findByRole('navigation', { name: /navegação principal/i })

    const engajamento = within(nav).getByRole('button', { name: /^engajamento$/i })
    const cultura = within(nav).getByRole('button', { name: /^cultura$/i })
    expect(engajamento).toHaveAttribute('aria-current', 'true')
    expect(engajamento).toHaveAttribute('aria-expanded', 'false')
    expect(cultura).not.toHaveAttribute('aria-current')

    fireEvent.click(engajamento)
    expect(engajamento).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(cultura)
    expect(cultura).toHaveAttribute('aria-expanded', 'true')
    expect(engajamento).toHaveAttribute('aria-expanded', 'false')
  })

  it('encerra o escritório ao clicar em Sair no menu do avatar', async () => {
    const logout = vi.fn()
    const exitOffice = vi.fn()
    mockUseAuth.mockReturnValue({ user: currentUser, loading: false, login: vi.fn(), logout })
    mockUseOfficeSession.mockReturnValue({ exitOffice })
    setupPeriod(null)
    renderLayout()
    await screen.findByRole('navigation', { name: /navegação principal/i })

    fireEvent.click(screen.getByRole('button', { name: /abrir menu da conta/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /sair/i }))

    expect(exitOffice).toHaveBeenCalledOnce()
    expect(logout).toHaveBeenCalledOnce()
  })
})

describe('AppLayout — seção /admin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentUser.role = 'ADMIN'
    currentUser.adminAccess = false
    setupPeriod(null)
  })

  // A barra não some mais dentro de /admin: ela troca de CONTEÚDO. Antes o
  // console tinha uma sidebar fixa própria, o único padrão de navegação
  // diferente do resto do app — e 16rem a menos de conteúdo em toda tela.
  it('mostra os grupos do console na mesma barra, dentro de /admin', async () => {
    renderLayout('/admin/setores')
    const nav = await screen.findByRole('navigation', { name: /navegação principal/i })
    expect(within(nav).getByRole('button', { name: /organização/i })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /sistema/i })).toBeInTheDocument()
    // …e não os grupos do produto.
    expect(within(nav).queryByRole('button', { name: /engajamento/i })).not.toBeInTheDocument()
  })

  it('mostra a navegação principal fora de /admin', async () => {
    renderLayout('/time')
    await screen.findByRole('navigation', { name: /navegação principal/i })
    expect(screen.getByRole('navigation', { name: /navegação principal/i })).toBeInTheDocument()
  })

  it('não renderiza o indicador de ofensiva (streak) para admin', async () => {
    renderLayout('/time')
    await screen.findByRole('navigation', { name: /navegação principal/i })
    expect(mockApiFetch).not.toHaveBeenCalledWith('/me/streak')
    expect(screen.queryByRole('button', { name: /ofensiva/i })).not.toBeInTheDocument()
    // O chip de EMR Coins segue a mesma regra: é de colaborador, não de admin.
    expect(mockApiFetch).not.toHaveBeenCalledWith('/me/coins')
    expect(screen.queryByRole('button', { name: /emr coins/i })).not.toBeInTheDocument()
  })

  it('trata SUBADMIN como conta de gestão: console recortado, sem ofensiva', async () => {
    currentUser.role = 'SUBADMIN'
    renderLayout('/admin/lendas')
    const nav = await screen.findByRole('navigation', { name: /navegação principal/i })
    expect(within(nav).getByRole('button', { name: /organização/i })).toBeInTheDocument()
    // Escritório só tem itens de ADMIN pleno: o grupo inteiro some.
    expect(within(nav).queryByRole('button', { name: /^escritório$/i })).not.toBeInTheDocument()
    expect(mockApiFetch).not.toHaveBeenCalledWith('/me/streak')
  })

  // Só quem administra sem ser conta de administração tem produto do outro lado.
  it('oferece a volta para a Home a quem entrou pelo acesso delegado', async () => {
    currentUser.role = 'LEAD'
    currentUser.adminAccess = true
    renderLayout('/admin/lendas')
    const nav = await screen.findByRole('navigation', { name: /navegação principal/i })
    expect(within(nav).getByRole('link', { name: /voltar para a home/i })).toHaveAttribute('href', '/')
  })

  it('não oferece a volta a quem não tem o outro lado (seria um laço pelo HomeRoute)', async () => {
    renderLayout('/admin/lendas')
    const nav = await screen.findByRole('navigation', { name: /navegação principal/i })
    expect(within(nav).queryByRole('link', { name: /voltar para a home/i })).not.toBeInTheDocument()
  })

  it('fora de /admin não há botão de voltar — não se está dentro de nada', async () => {
    currentUser.role = 'LEAD'
    currentUser.adminAccess = true
    renderLayout('/time')
    await screen.findByRole('navigation', { name: /navegação principal/i })
    expect(screen.queryByRole('link', { name: /voltar para a home/i })).not.toBeInTheDocument()
  })
})
