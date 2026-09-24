import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { BADGE_KINDS, BadgesSection } from './BadgesSection'
import { apiFetch } from '../../lib/api'

describe('BadgesSection — tipos de selo', () => {
  it('oferece a opção de selo de ofensiva', () => {
    const option = BADGE_KINDS.find((k) => k.value === 'STREAK')
    expect(option?.label).toBe('Ofensiva (dias úteis consecutivos)')
  })
})

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockAuth.role } }),
}))

const mockApiFetch = apiFetch as unknown as Mock

/** Temas do catálogo que o mock devolve; cada teste ajusta antes de renderizar. */
let badgeCategories: unknown[] = []

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/admin/badges' && !method) {
      return Promise.resolve({
        badges: [{ id: 'b1', slug: 'conector', name: 'Conector do Time', description: '5 votos em Colaboração', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao', badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null, global: true, sectorIds: [] }],
      })
    }
    if (path === '/admin/sectors' && !method) {
      return Promise.resolve({ sectors: [] })
    }
    if (path === '/admin/users' && !method) {
      return Promise.resolve({
        users: [{ id: 'u9', name: 'Diego Reis', email: 'd@e.com', role: 'LEGEND', position: 'SRE', squad: 'Plataforma', photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' }],
      })
    }
    if (path === '/admin/categories' && !method) {
      return Promise.resolve({ categories: [] })
    }
    if (path === '/admin/users/u9/badges' && !method) {
      return Promise.resolve({
        badges: [
          { id: 'ub1', badge: { id: 'b1', slug: 'conector', name: 'Conector do Time', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao', badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null, global: true, sectorIds: [] }, awardedAt: '2026-06-01T00:00:00.000Z', source: 'MANUAL', awardedBy: { id: 'a1', name: 'Admin' } },
        ],
      })
    }
    if (path === '/admin/users/u9/badges' && method === 'POST') {
      return Promise.resolve({
        badge: { id: 'ub2', badge: { id: 'b1', slug: 'conector', name: 'Conector do Time', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao', badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null, global: true, sectorIds: [] }, awardedAt: '2026-06-02T00:00:00.000Z', source: 'MANUAL', awardedBy: { id: 'a1', name: 'Admin' } },
      })
    }
    if (path.startsWith('/admin/users/u9/badges/') && method === 'DELETE') {
      return Promise.resolve({})
    }
    if (path === '/admin/badge-categories' && !method) {
      return Promise.resolve({ categories: badgeCategories })
    }
    if (path.startsWith('/admin/badge-claims') && !method) {
      return Promise.resolve({ claims: [] })
    }
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BadgesSection />
    </QueryClientProvider>,
  )
}

async function pickOption(comboboxName: string, optionName: string) {
  fireEvent.click(screen.getByRole('combobox', { name: comboboxName }))
  fireEvent.click(await screen.findByRole('option', { name: optionName }))
}

describe('BadgesSection — atribuição manual', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    badgeCategories = []
    setupFetch()
  })

  it('lista os selos de um membro selecionado e mostra revogar só nos manuais', async () => {
    renderSection()
    await pickOption('Selecionar membro', 'Diego Reis')
    // Ancoramos no aria-label de revogar (único do painel) — o nome do selo também
    // aparece no catálogo, então findByText casaria múltiplos elementos.
    expect(await screen.findByLabelText('Revogar selo Conector do Time')).toBeInTheDocument()
  })

  it('concede um selo ao membro selecionado (POST)', async () => {
    renderSection()
    await pickOption('Selecionar membro', 'Diego Reis')
    await pickOption('Selecionar selo', 'Conector do Time')
    fireEvent.click(screen.getByRole('button', { name: 'Conceder' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/users/u9/badges',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ badgeId: 'b1' }) }),
      ),
    )
  })

  it('revoga um selo manual do membro (DELETE)', async () => {
    renderSection()
    await pickOption('Selecionar membro', 'Diego Reis')
    fireEvent.click(await screen.findByLabelText('Revogar selo Conector do Time'))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/users/u9/badges/ub1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })
})

describe('BadgesSection — global/setores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/admin/badges' && !method) {
        return Promise.resolve({
          badges: [
            { id: 'b1', slug: 'global-badge', name: 'Selo Global', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1, categorySlug: null, badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null, global: true, sectorIds: [] },
            { id: 'b2', slug: 'setor-badge', name: 'Selo Comercial', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1, categorySlug: null, badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null, global: false, sectorIds: ['s1'] },
          ],
        })
      }
      if (path === '/admin/sectors' && !method) {
        return Promise.resolve({ sectors: [{ id: 's1', name: 'Comercial', slug: 'comercial', active: true, enabledFeatures: [], roles: [] }] })
      }
      if (path === '/admin/users' && !method) return Promise.resolve({ users: [] })
      if (path === '/admin/categories' && !method) return Promise.resolve({ categories: [] })
      if (path === '/admin/badge-categories' && !method) return Promise.resolve({ categories: [] })
      if (path.startsWith('/admin/badge-claims') && !method) return Promise.resolve({ claims: [] })
      return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
    })
  })

  it('busca o catálogo em /admin/badges (não em /badges)', async () => {
    renderSection()
    await screen.findByRole('button', { name: /sem categoria \(2\)/i })
    expect(mockApiFetch).toHaveBeenCalledWith('/admin/badges')
    expect(mockApiFetch).not.toHaveBeenCalledWith('/badges')
  })

  /**
   * O agrupamento deixou de ser por setor e passou a ser por TEMA (Documento 4,
   * seção 11.3). O escopo por setor continua sendo regra de verdade — só deixou
   * de ser o eixo da gaveta e virou etiqueta do item.
   */
  it('agrupa por tema, recolhido por padrão, com o setor como etiqueta do item', async () => {
    renderSection()
    const gaveta = await screen.findByRole('button', { name: /sem categoria \(2\)/i })
    expect(screen.queryByText('Selo Global')).not.toBeInTheDocument()

    fireEvent.click(gaveta)

    expect(screen.getByText('Selo Global')).toBeInTheDocument()
    expect(screen.getByText('Selo Comercial')).toBeInTheDocument()
    // Só o não-global carrega a etiqueta de setor, na linha de metadados.
    expect(screen.getByText(/Impacto · limiar 1 · Comercial$/)).toBeInTheDocument()
  })

  it('envia global/sectorIds ao criar um selo específico de setor', async () => {
    renderSection()
    await screen.findByRole('button', { name: /sem categoria \(2\)/i })
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar selo' }))
    fireEvent.change(screen.getByLabelText('Nome do selo'), { target: { value: 'Novo Selo' } })
    fireEvent.change(screen.getByLabelText('Descrição do selo'), { target: { value: 'Descrição' } })
    fireEvent.click(screen.getByLabelText(/^global$/i))
    fireEvent.click(screen.getByLabelText('Comercial'))
    fireEvent.click(screen.getByRole('button', { name: 'Criar selo' }))
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/admin/badges', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/badges' && c[1]?.method === 'POST')![1] as RequestInit).body as string)
    expect(body.global).toBe(false)
    expect(body.sectorIds).toEqual(['s1'])
  })
})

describe('BadgesSection — Subadmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
    mockAuth.role = 'SUBADMIN'
  })

  it('esconde o checkbox Global no formulário quando logado como Subadmin', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar selo' }))
    expect(screen.queryByLabelText(/^global$/i)).not.toBeInTheDocument()
  })
})

/**
 * Documento 4, seção 11.3: o catálogo era agrupado por SETOR, e a pergunta
 * "quantos selos de Cultura existem" não tinha resposta na tela.
 */
describe('BadgesSection — catálogo por tema', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    badgeCategories = [{ id: 'cat1', name: 'Cultura', slug: 'cultura', order: 0, active: true, badgeCount: 0 }]
    setupFetch()
  })

  it('agrupa por tema, com contador — e o selo sem tema cai em "Sem categoria"', async () => {
    renderSection()

    // O único selo do mock não tem tema.
    expect(await screen.findByRole('button', { name: /Sem categoria \(1\)/ })).toBeInTheDocument()
    // Gaveta vazia não vira cabeçalho: contador zero não informa nada.
    expect(screen.queryByRole('button', { name: /^Cultura/ })).toBeNull()
  })

  it('cada selo tem Atribuir e Excluir', async () => {
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /Sem categoria/ }))
    expect(screen.getByLabelText('Atribuir selo Conector do Time')).toBeInTheDocument()
    expect(screen.getByLabelText('Excluir selo Conector do Time')).toBeInTheDocument()
  })

  it('"Atribuir" abre o seletor de pessoa daquele selo', async () => {
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /Sem categoria/ }))
    fireEvent.click(screen.getByLabelText('Atribuir selo Conector do Time'))

    expect(await screen.findByRole('heading', { name: 'Atribuir "Conector do Time"' })).toBeInTheDocument()
    await pickOption('Pessoa que recebe o selo', 'Diego Reis')
    fireEvent.click(screen.getByRole('button', { name: 'Atribuir' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/users/u9/badges',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ badgeId: 'b1' }) }),
      ),
    )
  })

  it('o formulário aceita tema e as duas recompensas, e vazio não vira zero', async () => {
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Adicionar selo' }))
    fireEvent.change(screen.getByLabelText('Nome do selo'), { target: { value: 'Novo selo' } })
    fireEvent.change(screen.getByLabelText('Descrição do selo'), { target: { value: 'Descrição.' } })
    fireEvent.change(screen.getByLabelText('Recompensa em Pontos'), { target: { value: '50' } })
    // EMR Coins fica vazio de propósito: os dois campos são opcionais.
    fireEvent.click(screen.getByRole('button', { name: 'Criar selo' }))

    await waitFor(() => {
      const chamada = mockApiFetch.mock.calls.find(
        ([path, options]) => path === '/admin/badges' && options?.method === 'POST',
      )
      expect(chamada).toBeTruthy()
      const corpo = JSON.parse(chamada![1].body)
      expect(corpo.rewardPoints).toBe(50)
      expect(corpo.rewardCoins).toBeNull()
      expect(corpo.badgeCategoryId).toBeNull()
    })
  })
})
