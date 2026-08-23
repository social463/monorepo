import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { HomePage } from './HomePage'
import { apiFetch } from '../lib/api'
import type { Mock } from 'vitest'

const ALL_FEATURES = ['resenha', 'mural-corporativo', 'votar', 'time', 'lendas', 'selos', 'destaques', 'notificacoes', 'quinta-desenvolvimento', 'retrospectivas', 'escritorio']

const mockUseAuth = vi.fn()
vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    name: 'Test User',
    role: 'LEGEND',
    position: null,
    squad: null,
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    active: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    enabledFeatures: [],
    sectorFeatures: ALL_FEATURES,
    ...overrides,
  }
}

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({
      user: baseUser(),
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    })
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/periods/current') return Promise.resolve({ period: null })
      if (path === '/mural') return Promise.resolve({ items: [] })
      if (path === '/badges') return Promise.resolve({ badges: [] })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [] })
      if (path === '/me/xp') return Promise.resolve({ points: 0, level: { name: 'Bronze', next: 'Prata', min: 0, nextMin: 500, remaining: 500, progress: 0 } })
      if (path === '/vacations/month') return Promise.resolve({ vacations: [] })
      if (path.startsWith('/ranking'))
        return Promise.resolve({
          entries: [
            {
              position: 1,
              points: 120,
              online: true,
              level: { name: 'Bronze', color: '#8C5A2B', next: 'Prata', min: 0, nextMin: 500, remaining: 380, progress: 24 },
              user: { ...baseUser({ id: 'u2', name: 'Ana Top' }), sectorName: 'Comercial' },
            },
          ],
          total: 1,
          me: null,
        })
      // Humor de hoje já registrado por padrão → seletor fica escondido.
      if (path === '/me/mood/today')
        return Promise.resolve({ day: '2026-06-30', mood: 'GOOD', note: null })
      return Promise.resolve({ items: [], nextCursor: null })
    })
  })

  // A saudação "Olá, {nome}!" mora no header global (AppLayout), não aqui.
  // A coluna do meio abre com o Feed Corporativo (empresa toda); a Resenha do
  // time (por setor) fica na rota /resenha.
  it('mostra mural e o Feed Corporativo', async () => {
    wrap(<HomePage />)

    expect(screen.getByRole('heading', { name: /feed corporativo/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /resenha do time/i })).not.toBeInTheDocument()
    // Os selos/progresso do usuário saíram da Home — vivem em /engajamento.
    expect(screen.queryByRole('heading', { name: /minhas conquistas/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver tudo/i })).toHaveAttribute('href', '/mural-corporativo')
  })

  it('abre com a faixa de boas-vindas e a saudação da hora', async () => {
    // Hora cravada: o texto muda entre bom dia / boa tarde / boa noite, e o
    // teste não pode depender do relógio de quem roda a suíte.
    wrap(<HomePage now={new Date(2026, 7, 12, 9, 0, 0)} />)
    expect(await screen.findByRole('heading', { name: /bom dia, test!/i })).toBeInTheDocument()

    wrap(<HomePage now={new Date(2026, 7, 12, 20, 0, 0)} />)
    expect(await screen.findAllByRole('heading', { name: /boa noite, test!/i })).not.toHaveLength(0)
  })

  // As três colunas do desenho novo: identidade, comunicação e datas do time.
  it('mostra o card de perfil à esquerda e os blocos da coluna da direita', async () => {
    wrap(<HomePage />)

    expect(screen.getByTestId('home-profile-card')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /próximos aniversariantes/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /férias do mês/i })).toBeInTheDocument()
  })

  // O bloco fecha a coluna da direita: as datas do time vêm antes (informação
  // do dia) e o placar por último, como no protótipo do portal.
  it('traz o Top 5 engajamento na coluna da direita, com setor e presença', async () => {
    wrap(<HomePage />)

    expect(await screen.findByRole('heading', { name: /top 5 engajamento/i })).toBeInTheDocument()
    expect(screen.getByText('Ana Top')).toBeInTheDocument()
    expect(screen.getByText('Comercial')).toBeInTheDocument()
    expect(screen.getByLabelText('On-line na plataforma')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver ranking completo/i })).toHaveAttribute('href', '/ranking')
  })

  it('mostra o Mural de Feedbacks com link para a página completa', async () => {
    wrap(<HomePage />)

    expect(screen.getByRole('heading', { name: /mural de feedbacks/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver todas/i })).toHaveAttribute('href', '/mural-feedbacks')
  })

  it('mostra o seletor de humor quando o humor de hoje ainda não foi registrado', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/periods/current') return Promise.resolve({ period: null })
      if (path === '/mural') return Promise.resolve({ items: [] })
      if (path === '/badges') return Promise.resolve({ badges: [] })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [] })
      if (path === '/me/xp') return Promise.resolve({ points: 0, level: { name: 'Bronze', next: 'Prata', min: 0, nextMin: 500, remaining: 500, progress: 0 } })
      if (path === '/vacations/month') return Promise.resolve({ vacations: [] })
      if (path === '/me/mood/today')
        return Promise.resolve({ day: '2026-06-30', mood: null, note: null })
      return Promise.resolve({ items: [], nextCursor: null })
    })

    wrap(<HomePage />)

    expect(
      await screen.findByRole('heading', { name: /como está seu humor hoje/i }),
    ).toBeInTheDocument()
  })

  // O mural é da empresa toda: ocupa a coluna principal mesmo sem a feature no
  // setor (e mesmo sem publicação) — senão a Home fica com um buraco no lugar
  // da seção principal.
  it('mostra a seção do Mural da empresa mesmo sem a feature habilitada pro setor', async () => {
    mockUseAuth.mockReturnValue({
      user: baseUser({ sectorFeatures: ALL_FEATURES.filter((f) => f !== 'mural-corporativo') }),
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    })
    wrap(<HomePage />)
    expect(screen.getByRole('heading', { name: /feed corporativo/i })).toBeInTheDocument()
    expect(await screen.findByText(/nenhum comunicado por aqui ainda/i)).toBeInTheDocument()
  })

  it('esconde o Mural da empresa para terceirizado sem a feature na allowlist', async () => {
    mockUseAuth.mockReturnValue({
      user: baseUser({ role: 'THIRD_PARTY', enabledFeatures: ['votar'], sectorFeatures: [] }),
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    })
    wrap(<HomePage />)
    // Âncora assíncrona: a sidebar só aparece depois de /celebrations resolver.
    await screen.findByRole('heading', { name: /próximos aniversariantes/i })
    expect(screen.queryByRole('heading', { name: /feed corporativo/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /ver tudo/i })).not.toBeInTheDocument()
  })
})
