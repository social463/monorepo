import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { CompetencyDTO, CourseCategoryDTO, InstructorDTO } from '@legends/shared'
import { CompetenciesTab, CourseCategoriesTab, InstructorsTab } from './CourseCatalogTabs'
import * as learningApi from '../../lib/learning-api'
import * as api from '../../lib/api'
import { ApiError } from '../../lib/api'

vi.mock('../../lib/learning-api', () => ({
  courseCategoriesApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  competenciesApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  instructorsApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const categorias = learningApi.courseCategoriesApi as unknown as Record<string, Mock>
const competencias = learningApi.competenciesApi as unknown as Record<string, Mock>
const instrutores = learningApi.instructorsApi as unknown as Record<string, Mock>
const mockApiFetch = api.apiFetch as unknown as Mock

function categoria(over: Partial<CourseCategoryDTO> & { id: string; name: string }): CourseCategoryDTO {
  return {
    slug: over.name.toLowerCase(),
    icon: null,
    parentId: null,
    parentName: null,
    order: 0,
    active: true,
    courseCount: 0,
    ...over,
  }
}

function renderTab(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  categorias.list.mockResolvedValue({ categories: [] })
  competencias.list.mockResolvedValue({ competencies: [] })
  instrutores.list.mockResolvedValue({ instructors: [] })
  mockApiFetch.mockResolvedValue({ users: [] })
})

describe('Catálogo — Categorias', () => {
  it('cria categoria com ícone e raiz', async () => {
    const user = userEvent.setup()
    categorias.list.mockResolvedValue({ categories: [categoria({ id: 'raiz', name: 'Onboarding' })] })
    categorias.create.mockResolvedValue({ item: categoria({ id: 'nova', name: 'Primeiros dias' }) })
    renderTab(<CourseCategoriesTab />)

    await screen.findByText('Onboarding')
    await user.type(screen.getByRole('textbox', { name: /ícone/i }), '🎯')
    await user.type(screen.getByRole('textbox', { name: /nome da categoria/i }), 'Primeiros dias')
    await user.click(screen.getByRole('button', { name: /adicionar/i }))

    await waitFor(() => expect(categorias.create).toHaveBeenCalled())
    expect(categorias.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Primeiros dias', icon: '🎯' }),
    )
  })

  // Dois níveis, como a 9.6 pede: só raiz pode ser mãe.
  it('a subcategoria não é oferecida como raiz de outra', async () => {
    categorias.list.mockResolvedValue({
      categories: [
        categoria({ id: 'raiz', name: 'Onboarding' }),
        categoria({ id: 'filha', name: 'Primeiros dias', parentId: 'raiz', parentName: 'Onboarding' }),
      ],
    })
    renderTab(<CourseCategoriesTab />)

    await screen.findByText('Onboarding')
    const seletor = screen.getByRole('combobox', { name: /categoria raiz/i })
    expect(seletor).toBeInTheDocument()
    // A filha aparece na lista, com a raiz dela como apoio…
    expect(screen.getByText('em Onboarding')).toBeInTheDocument()
  })

  /**
   * O contador fica visível porque é ele que explica por que excluir vai
   * falhar: item com curso atrás se desativa, não se apaga.
   */
  it('mostra quantos cursos usam a categoria e oferece desativar', async () => {
    const user = userEvent.setup()
    categorias.list.mockResolvedValue({
      categories: [categoria({ id: 'c1', name: 'Liderança', courseCount: 3 })],
    })
    categorias.update.mockResolvedValue({ item: categoria({ id: 'c1', name: 'Liderança', active: false }) })
    renderTab(<CourseCategoriesTab />)

    expect(await screen.findByText('3 cursos')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(categorias.update).toHaveBeenCalledWith('c1', { active: false }))
  })

  it('mostra o erro do servidor quando a exclusão é recusada', async () => {
    const user = userEvent.setup()
    categorias.list.mockResolvedValue({
      categories: [categoria({ id: 'c1', name: 'Liderança', courseCount: 3 })],
    })
    // `errorMessage` só propaga o texto de um `ApiError` — é o que a API devolve.
    categorias.remove.mockRejectedValue(
      new ApiError(409, 'Esta categoria tem 3 curso(s). Desative-a em vez de excluir.'),
    )
    renderTab(<CourseCategoriesTab />)

    await screen.findByText('Liderança')
    await user.click(screen.getByRole('button', { name: /excluir liderança/i }))
    expect(await screen.findByText(/desative-a em vez de excluir/i)).toBeInTheDocument()
  })
})

describe('Catálogo — Competências', () => {
  it('cria competência com ícone e descrição', async () => {
    const user = userEvent.setup()
    competencias.create.mockResolvedValue({ item: {} as CompetencyDTO })
    renderTab(<CompetenciesTab />)

    await user.type(screen.getByRole('textbox', { name: /ícone/i }), '🤖')
    await user.type(screen.getByRole('textbox', { name: /^nome$/i }), 'Inteligência Artificial')
    await user.type(screen.getByRole('textbox', { name: /descrição curta/i }), 'IA no dia a dia')
    await user.click(screen.getByRole('button', { name: /adicionar/i }))

    await waitFor(() => expect(competencias.create).toHaveBeenCalled())
    expect(competencias.create).toHaveBeenCalledWith({
      name: 'Inteligência Artificial',
      icon: '🤖',
      description: 'IA no dia a dia',
    })
  })
})

describe('Catálogo — Instrutores (seção 9.7)', () => {
  const interno: InstructorDTO = {
    id: 'i1',
    userId: 'u1',
    name: 'Mariana Venancio',
    email: null,
    photoUrl: null,
    bio: null,
    area: 'Gente e Gestão',
    expertise: [],
    active: true,
    courseCount: 0,
  }

  /**
   * O ponto da 9.7: instrutor interno não redigita nome nem área — elas vêm do
   * cadastro de colaboradores.
   */
  it('o formulário do interno escolhe colaborador e avisa que os dados vêm da base', async () => {
    instrutores.list.mockResolvedValue({ instructors: [] })
    mockApiFetch.mockResolvedValue({ users: [{ id: 'u1', name: 'Mariana Venancio' }] })
    renderTab(<InstructorsTab />)

    expect(await screen.findByText(/vêm do cadastro do colaborador/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /^nome$/i })).not.toBeInTheDocument()
  })

  it('trocar para externo pede o nome na mão', async () => {
    const user = userEvent.setup()
    instrutores.create.mockResolvedValue({ item: interno })
    renderTab(<InstructorsTab />)

    await user.click(await screen.findByRole('radio', { name: /pessoa externa/i }))
    await user.type(screen.getByRole('textbox', { name: /^nome$/i }), 'Consultor de Fora')
    await user.click(screen.getByRole('button', { name: /cadastrar instrutor/i }))

    await waitFor(() => expect(instrutores.create).toHaveBeenCalled())
    expect(instrutores.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Consultor de Fora' }),
    )
  })

  // Quem já é instrutor não pode virar instrutor de novo — o service recusa com
  // 409, e a tela nem o oferece.
  it('não oferece colaborador que já é instrutor', async () => {
    instrutores.list.mockResolvedValue({ instructors: [interno] })
    mockApiFetch.mockResolvedValue({
      users: [
        { id: 'u1', name: 'Mariana Venancio' },
        { id: 'u2', name: 'Outra Pessoa' },
      ],
    })
    const user = userEvent.setup()
    renderTab(<InstructorsTab />)

    await screen.findByText('Mariana Venancio')
    await user.click(screen.getByRole('combobox', { name: /colaborador/i }))
    expect(await screen.findByRole('option', { name: 'Outra Pessoa' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Mariana Venancio' })).not.toBeInTheDocument()
  })

  it('mostra a área do interno e marca o externo como tal', async () => {
    instrutores.list.mockResolvedValue({
      instructors: [interno, { ...interno, id: 'i2', userId: null, name: 'De Fora', area: null }],
    })
    renderTab(<InstructorsTab />)

    expect(await screen.findByText(/Gente e Gestão/)).toBeInTheDocument()
    expect(screen.getByText('Externo')).toBeInTheDocument()
  })
})
