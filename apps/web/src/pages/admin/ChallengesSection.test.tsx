import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CHALLENGE_CATEGORIES, type ChallengeDTO, type SectorDTO } from '@legends/shared'
import { ChallengesSection } from './ChallengesSection'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }))

const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string, sectorId: 'sector-dev-produto' as string }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockAuth.role, sectorId: mockAuth.sectorId } }),
}))

const challenge: ChallengeDTO = {
  id: 'c1',
  title: 'Ler um livro técnico',
  description: 'Leia e conte.',
  category: 'Cultura',
  detailsMarkdown: null,
  imageUrl: null,
  position: 0,
  requiresReview: true,
  isPrivate: false,
  isFeatured: false,
  rewardCoins: 150,
  isActive: true,
  startsAt: null,
  endsAt: null,
  sectorId: null,
  sectorName: null,
  submissionCount: 2,
}

const challenge2: ChallengeDTO = {
  ...challenge,
  id: 'c2',
  title: 'Fazer um code review',
  position: 1,
}

const sectorChallenge: ChallengeDTO = {
  ...challenge,
  id: 'c3',
  title: 'Melhorar o onboarding do setor',
  sectorId: 'sector-x',
  sectorName: 'Setor X',
}

const sectors: SectorDTO[] = [
  { id: 'sector-dev-produto', name: 'Dev & Produto', slug: 'dev-produto', active: true, responsibleId: null, enabledFeatures: [], roles: [] },
  { id: 'sector-comercial', name: 'Comercial', slug: 'comercial', active: true, responsibleId: null, enabledFeatures: [], roles: [] },
]

/** Roteia por path: lista de desafios (envelope `{ challenges }`), setores e mutações. */
function mockApi(overrides: Record<string, unknown> = {}) {
  vi.mocked(apiFetch).mockImplementation((path: string, init?: { method?: string }) => {
    for (const [key, value] of Object.entries(overrides)) {
      const [prefix, method] = key.split(' ')
      if (path.startsWith(prefix) && (!method || init?.method === method)) {
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
      }
    }
    if (path === '/admin/challenges' && !init?.method) return Promise.resolve({ challenges: [challenge] })
    if (path === '/admin/sectors' && !init?.method) return Promise.resolve({ sectors })
    return Promise.resolve(null)
  })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ChallengesSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
  mockAuth.role = 'ADMIN'
  mockAuth.sectorId = 'sector-dev-produto'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChallengesSection', () => {
  it('lista os desafios lendo o envelope { challenges }, com recompensa e contagem de participações', async () => {
    mockApi()
    renderSection()

    expect(await screen.findByText('Ler um livro técnico')).toBeInTheDocument()
    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('mostra todas as sete categorias canônicas no select', async () => {
    mockApi({ '/admin/challenges': { challenges: [] } })
    renderSection()
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const select = screen.getByLabelText('Categoria') as HTMLSelectElement
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent)

    expect(options).toEqual([...CHALLENGE_CATEGORIES])
  })

  it('ADMIN cria um desafio da empresa inteira por padrão, mandando a categoria escolhida', async () => {
    mockApi({ '/admin/challenges': { challenges: [] } })
    renderSection()
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    await userEvent.type(screen.getByLabelText('Título'), 'Indicar um talento')
    await userEvent.type(screen.getByLabelText('Descrição'), 'Indique alguém.')
    await userEvent.selectOptions(screen.getByLabelText('Categoria'), 'Inovação')
    await userEvent.clear(screen.getByLabelText('Recompensa (coins)'))
    await userEvent.type(screen.getByLabelText('Recompensa (coins)'), '300')
    await userEvent.click(screen.getByRole('button', { name: 'Criar desafio' }))

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/admin/challenges', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Indicar um talento',
          description: 'Indique alguém.',
          category: 'Inovação',
          detailsMarkdown: null,
          rewardCoins: 300,
          requiresReview: true,
          isPrivate: false,
          isFeatured: false,
          sectorId: null,
        }),
      })
    })
  })

  it('ADMIN pode escolher um setor específico ao criar o desafio', async () => {
    mockApi({ '/admin/challenges': { challenges: [] } })
    renderSection()
    await screen.findByRole('combobox', { name: 'Setor do desafio' })

    await userEvent.click(screen.getByRole('combobox', { name: 'Setor do desafio' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Comercial' }))

    await userEvent.type(screen.getByLabelText('Título'), 'Café com a liderança')
    await userEvent.type(screen.getByLabelText('Descrição'), 'Marque um café.')
    await userEvent.click(screen.getByRole('button', { name: 'Criar desafio' }))

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/admin/challenges', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Café com a liderança',
          description: 'Marque um café.',
          category: 'Cultura',
          detailsMarkdown: null,
          rewardCoins: 0,
          requiresReview: true,
          isPrivate: false,
          isFeatured: false,
          sectorId: 'sector-comercial',
        }),
      })
    })
  })

  it('SUBADMIN não escolhe setor: o campo fica travado no próprio setor e é enviado automaticamente', async () => {
    mockAuth.role = 'SUBADMIN'
    mockAuth.sectorId = 'sector-comercial'
    mockApi({ '/admin/challenges': { challenges: [] } })
    renderSection()
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    // Campo de setor mostra o setor da pessoa, desabilitado (sem opção de trocar).
    const sectorField = await screen.findByRole('combobox', { name: 'Setor do desafio' })
    expect(sectorField).toBeDisabled()
    expect(sectorField).toHaveTextContent('Comercial')

    await userEvent.type(screen.getByLabelText('Título'), 'Mentoria interna')
    await userEvent.type(screen.getByLabelText('Descrição'), 'Ofereça uma mentoria.')
    await userEvent.click(screen.getByRole('button', { name: 'Criar desafio' }))

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/admin/challenges', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Mentoria interna',
          description: 'Ofereça uma mentoria.',
          category: 'Cultura',
          detailsMarkdown: null,
          rewardCoins: 0,
          requiresReview: true,
          isPrivate: false,
          isFeatured: false,
          sectorId: 'sector-comercial',
        }),
      })
    })
  })

  it('edita um desafio de setor sem zerar o sectorId dele', async () => {
    mockApi({ '/admin/challenges': { challenges: [sectorChallenge] } })
    renderSection()
    await screen.findByText('Melhorar o onboarding do setor')

    await userEvent.click(screen.getByRole('button', { name: 'Editar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/admin/challenges/c3', expect.anything()))

    const patchCall = vi.mocked(apiFetch).mock.calls.find(([path]) => path === '/admin/challenges/c3')
    expect(patchCall).toBeDefined()
    const body = JSON.parse((patchCall![1] as { body: string }).body)
    expect(body).not.toHaveProperty('sectorId')
  })

  it('reordena mandando a sequência inteira de ids', async () => {
    mockApi({ '/admin/challenges': { challenges: [challenge, challenge2] } })
    renderSection()
    await screen.findByText('Ler um livro técnico')

    await userEvent.click(screen.getByLabelText('Mover "Fazer um code review" para cima'))

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/admin/challenges/reorder', {
        method: 'POST',
        body: JSON.stringify({ ids: ['c2', 'c1'] }),
      })
    })
  })

  it('pede confirmação antes de apagar e não chama a API se o usuário cancelar', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockApi({ '/admin/challenges': { challenges: [challenge] } })
    renderSection()
    await screen.findByText('Ler um livro técnico')

    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }))

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Ler um livro técnico'),
    )
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/admin/challenges/'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('mostra o erro da API ao tentar apagar desafio com participações', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockApi({ '/admin/challenges/c1 DELETE': new Error('Desafio com participações não pode ser apagado. Desative-o.') })
    renderSection()
    await screen.findByText('Ler um livro técnico')

    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }))

    expect(
      await screen.findByText('Desafio com participações não pode ser apagado. Desative-o.'),
    ).toBeInTheDocument()
  })
})
