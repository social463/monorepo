import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { CoursesSection } from './CoursesSection'
import { apiFetch, ApiError } from '../../lib/api'
import * as learningApi from '../../lib/learning-api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

vi.mock('../../lib/learning-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/learning-api')>()
  return {
    ...actual,
    listCoursesForAdmin: vi.fn(),
    getCourseForAdmin: vi.fn(),
    updateCourse: vi.fn(),
    listCertificateTemplates: vi.fn(),
  }
})

const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockAuth.role } }),
}))

const mockApiFetch = apiFetch as unknown as Mock
const mockListCourses = learningApi.listCoursesForAdmin as unknown as Mock
const mockGetCourse = learningApi.getCourseForAdmin as unknown as Mock
const mockUpdateCourse = learningApi.updateCourse as unknown as Mock
const mockListTemplates = learningApi.listCertificateTemplates as unknown as Mock

function buildCourse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'course-1',
    slug: 'curso-1',
    title: 'Curso 1',
    shortDescription: null,
    description: null,
    coverUrl: null,
    categoryId: null,
    categoryName: 'Liderança',
    level: 'BEGINNER',
    competencyIds: [],
    objectives: [],
    prerequisites: null,
    instructors: [],
    audienceSectorIds: [],
    audiencePositionCategories: [],
    recommendedFor: [],
    autoEnroll: false,
    mandatory: false,
    certificateEnabled: false,
    status: 'DRAFT',
    rewardPoints: 25,
    rewardCoins: 10,
    bannerUrl: null,
    introVideoUrl: null,
    icon: null,
    primaryColor: null,
    published: false,
    publishedAt: null,
    durationMinutes: 0,
    totalLessons: 0,
    enrolledCount: 0,
    modules: [],
    sectorId: null,
    requiresCertificateApproval: false,
    certificateTemplateId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function setupFetch(course = buildCourse()) {
  mockListCourses.mockResolvedValue({
    courses: [
      {
        id: 'course-1',
        title: 'Curso 1',
        category: 'Liderança',
        level: 'BEGINNER',
        status: 'DRAFT',
        published: false,
        mandatory: false,
        durationMinutes: 0,
        totalLessons: 0,
        enrolledCount: 0,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  })
  mockGetCourse.mockResolvedValue({ course })
  mockUpdateCourse.mockResolvedValue({ course })
  mockListTemplates.mockResolvedValue({
    templates: [
      {
        id: 'tpl-1',
        name: 'Modelo Diretoria',
        title: 'Certificado',
        backgroundUrl: null,
        accentColor: '#2f8b4d',
        signatureName: 'Ana',
        signatureRole: 'CEO',
        signatureImageUrl: null,
        logoUrl: null,
        isDefault: false,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  })
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/admin/sectors' && !method) {
      return Promise.resolve({
        sectors: [
          { id: 's1', name: 'Comercial', slug: 'comercial', active: true, responsibleId: null, enabledFeatures: [], roles: [] },
        ],
      })
    }
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CoursesSection />
    </QueryClientProvider>,
  )
}

async function openEditor() {
  renderSection()
  await screen.findByText('Curso 1')
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
  await waitFor(() => expect(mockGetCourse).toHaveBeenCalled())
}

/** Vai para um passo do wizard (Documento 4, seção 9.6). */
async function irParaPasso(nome: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(nome, 'i') }))
}

describe('CoursesSection — seletor de setor (ADMIN)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.role = 'ADMIN'
  })

  it('mostra "Empresa toda" quando o curso não tem setor', async () => {
    setupFetch(buildCourse({ sectorId: null }))
    await openEditor()

    const select = await screen.findByRole('combobox', { name: 'Setor do curso' })
    expect(select).toHaveTextContent('Empresa toda')
  })

  it('faz o round-trip do setor existente do curso', async () => {
    setupFetch(buildCourse({ sectorId: 's1' }))
    await openEditor()

    const select = await screen.findByRole('combobox', { name: 'Setor do curso' })
    await waitFor(() => expect(select).toHaveTextContent('Comercial'))
  })

  it('envia sectorId null (não string vazia) ao salvar com "Empresa toda"', async () => {
    setupFetch(buildCourse({ sectorId: null }))
    await openEditor()
    await screen.findByRole('combobox', { name: 'Setor do curso' })

    fireEvent.click(screen.getByRole('button', { name: 'Salvar dados do curso' }))

    await waitFor(() =>
      expect(mockUpdateCourse).toHaveBeenCalledWith('course-1', expect.objectContaining({ sectorId: null })),
    )
  })

  it('envia o sectorId escolhido ao trocar o setor', async () => {
    setupFetch(buildCourse({ sectorId: null }))
    await openEditor()

    const select = await screen.findByRole('combobox', { name: 'Setor do curso' })
    fireEvent.click(select)
    fireEvent.click(await screen.findByRole('option', { name: 'Comercial' }))

    fireEvent.click(screen.getByRole('button', { name: 'Salvar dados do curso' }))

    await waitFor(() =>
      expect(mockUpdateCourse).toHaveBeenCalledWith('course-1', expect.objectContaining({ sectorId: 's1' })),
    )
  })

  it('mostra a mensagem de erro do servidor quando o salvamento falha', async () => {
    setupFetch(buildCourse({ sectorId: null }))
    mockUpdateCourse.mockRejectedValue(new ApiError(500, 'Não foi possível salvar o setor do curso.'))
    await openEditor()
    await screen.findByRole('combobox', { name: 'Setor do curso' })

    fireEvent.click(screen.getByRole('button', { name: 'Salvar dados do curso' }))

    expect(await screen.findByText('Não foi possível salvar o setor do curso.')).toBeInTheDocument()
  })
})

describe('CoursesSection — seletor de setor (SUBADMIN)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.role = 'SUBADMIN'
  })

  it('não mostra o seletor de setor para SUBADMIN', async () => {
    setupFetch(buildCourse({ sectorId: 's1' }))
    await openEditor()
    await screen.findByRole('heading', { name: 'Curso 1' })

    expect(screen.queryByRole('combobox', { name: 'Setor do curso' })).not.toBeInTheDocument()
  })
})

/**
 * Sem estes campos no formulário, `requiresCertificateApproval` ficava
 * permanentemente `false` (nenhuma `CertificateRequest` chegava a existir, e a
 * fila inteira era código inalcançável) e `certificateTemplateId`
 * permanentemente nulo.
 */
describe('CoursesSection — aprovação e modelo de certificado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.role = 'ADMIN'
  })

  it('reflete o estado atual do curso nos dois campos', async () => {
    setupFetch(buildCourse({ requiresCertificateApproval: true, certificateTemplateId: 'tpl-1' }))
    await openEditor()

    expect(await screen.findByRole('checkbox', { name: 'Exigir aprovação antes de emitir' })).toBeChecked()
    const select = await screen.findByRole('combobox', { name: 'Modelo do certificado' })
    await waitFor(() => expect(select).toHaveTextContent('Modelo Diretoria'))
  })

  it('liga a fila de aprovação e envia o campo ao salvar', async () => {
    setupFetch(buildCourse({ requiresCertificateApproval: false }))
    await openEditor()

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Exigir aprovação antes de emitir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar dados do curso' }))

    await waitFor(() =>
      expect(mockUpdateCourse).toHaveBeenCalledWith(
        'course-1',
        expect.objectContaining({ requiresCertificateApproval: true }),
      ),
    )
  })

  it('escolhe um modelo e envia o id ao salvar', async () => {
    setupFetch(buildCourse({ certificateTemplateId: null }))
    await openEditor()

    const select = await screen.findByRole('combobox', { name: 'Modelo do certificado' })
    fireEvent.click(select)
    fireEvent.click(await screen.findByRole('option', { name: 'Modelo Diretoria' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar dados do curso' }))

    await waitFor(() =>
      expect(mockUpdateCourse).toHaveBeenCalledWith(
        'course-1',
        expect.objectContaining({ certificateTemplateId: 'tpl-1' }),
      ),
    )
  })

  it('"Modelo padrão da empresa" envia null, não string vazia', async () => {
    setupFetch(buildCourse({ certificateTemplateId: null }))
    await openEditor()
    await screen.findByRole('combobox', { name: 'Modelo do certificado' })

    fireEvent.click(screen.getByRole('button', { name: 'Salvar dados do curso' }))

    await waitFor(() =>
      expect(mockUpdateCourse).toHaveBeenCalledWith(
        'course-1',
        expect.objectContaining({ certificateTemplateId: null }),
      ),
    )
  })

  it('SUBADMIN não vê (nem envia) o modelo, mas segue podendo exigir aprovação', async () => {
    mockAuth.role = 'SUBADMIN'
    setupFetch(buildCourse({ certificateTemplateId: 'tpl-1' }))
    await openEditor()
    await screen.findByRole('heading', { name: 'Curso 1' })

    expect(screen.queryByRole('combobox', { name: 'Modelo do certificado' })).not.toBeInTheDocument()
    expect(mockListTemplates).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Exigir aprovação antes de emitir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar dados do curso' }))

    await waitFor(() => expect(mockUpdateCourse).toHaveBeenCalled())
    const payload = mockUpdateCourse.mock.calls[0][1]
    expect(payload.requiresCertificateApproval).toBe(true)
    expect(payload).not.toHaveProperty('certificateTemplateId')
  })
})

/**
 * Cinco estados do curso (Documento 4, seção 9.6). O documento é explícito
 * sobre os rótulos: o protótipo os mostra crus (`review`, `pending_approval`),
 * e aqui eles saem em português.
 */
describe('CoursesSection — status do curso', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.role = 'ADMIN'
  })

  it('mostra o rótulo em português e avisa que o curso não está visível', async () => {
    setupFetch(buildCourse({ status: 'PENDING_APPROVAL' }))
    await openEditor()

    expect(await screen.findByRole('combobox', { name: 'Status do curso' })).toHaveTextContent(
      'Aguardando aprovação',
    )
    expect(screen.getByText(/o curso não aparece no catálogo/i)).toBeInTheDocument()
  })

  it('trocar o status manda o estado escolhido', async () => {
    setupFetch(buildCourse({ status: 'DRAFT' }))
    await openEditor()

    fireEvent.click(await screen.findByRole('combobox', { name: 'Status do curso' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Em revisão' }))

    await waitFor(() => expect(mockUpdateCourse).toHaveBeenCalledWith('course-1', { status: 'REVIEW' }))
  })

  // Publicar continua tendo botão próprio: é a ação frequente, e enterrá-la num
  // seletor de cinco itens custaria um clique a mais toda vez.
  it('publicar tem botão próprio, que some quando o curso já está publicado', async () => {
    setupFetch(buildCourse({ status: 'DRAFT' }))
    await openEditor()
    // `openEditor` só espera a CHAMADA da query; esperar o seletor aparecer é o
    // que prova que o editor já renderizou.
    await screen.findByRole('combobox', { name: 'Status do curso' })
    fireEvent.click(screen.getByRole('button', { name: 'Publicar curso' }))
    await waitFor(() => expect(mockUpdateCourse).toHaveBeenCalledWith('course-1', { status: 'PUBLISHED' }))
  })

  it('curso publicado não mostra o botão nem o aviso', async () => {
    setupFetch(buildCourse({ status: 'PUBLISHED', published: true }))
    await openEditor()
    // Sem esperar o editor renderizar, as duas asserções de ausência passariam
    // por vácuo — o que não provaria nada.
    await screen.findByRole('combobox', { name: 'Status do curso' })

    expect(screen.queryByRole('button', { name: 'Publicar curso' })).not.toBeInTheDocument()
    expect(screen.queryByText(/não aparece no catálogo/i)).not.toBeInTheDocument()
  })
})

/**
 * Identidade visual (Documento 4, seção 9.6, passo 2). A prévia existe para
 * responder "como vai ficar?" enquanto se preenche — por isso ela reage ao
 * campo, e não ao que está salvo.
 */
describe('CoursesSection — identidade visual', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.role = 'ADMIN'
  })

  it('a prévia mostra o emoji digitado, sem salvar', async () => {
    setupFetch(buildCourse())
    await openEditor()
    await irParaPasso('Identidade visual')

    const campo = await screen.findByRole('textbox', { name: /ícone \(emoji\)/i })
    fireEvent.change(campo, { target: { value: '🎓' } })

    // Aparece na prévia sem nenhuma chamada de salvamento.
    expect(screen.getByText('🎓')).toBeInTheDocument()
    expect(mockUpdateCourse).not.toHaveBeenCalled()
  })

  // A capa manda sobre o emoji: quem subiu imagem quer a imagem.
  it('com capa, a prévia mostra a imagem e não o emoji', async () => {
    setupFetch(buildCourse({ coverUrl: 'https://cdn.exemplo.com/capa.png', icon: '🎓' }))
    await openEditor()
    await irParaPasso('Identidade visual')

    await screen.findByRole('textbox', { name: /ícone \(emoji\)/i })
    expect(document.querySelector('img[src="https://cdn.exemplo.com/capa.png"]')).not.toBeNull()
    expect(screen.queryByText('🎓')).not.toBeInTheDocument()
  })

  // Eram dois campos de URL digitada, "Capa" e "Banner" — e o banner nunca foi
  // desenhado em lugar nenhum. Virou uma imagem só, por upload.
  it('a identidade visual tem uma imagem só, e ela não é campo de URL', async () => {
    setupFetch(buildCourse())
    await openEditor()
    await irParaPasso('Identidade visual')

    expect(await screen.findByText('Imagem do curso')).toBeInTheDocument()
    expect(screen.queryByText(/capa \(url\)/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/banner/i)).not.toBeInTheDocument()
  })

  it('envia a identidade visual ao salvar', async () => {
    setupFetch(buildCourse())
    await openEditor()
    await irParaPasso('Identidade visual')

    fireEvent.change(await screen.findByRole('textbox', { name: /ícone \(emoji\)/i }), {
      target: { value: '🚀' },
    })
    fireEvent.change(screen.getByLabelText('Cor principal do curso'), { target: { value: '#123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar dados do curso' }))

    await waitFor(() =>
      expect(mockUpdateCourse).toHaveBeenCalledWith(
        'course-1',
        expect.objectContaining({ icon: '🚀', primaryColor: '#123456' }),
      ),
    )
  })
})

/**
 * Wizard de três passos (Documento 4, seção 9.6). Eles são NAVEGAÇÃO, não um
 * fluxo travado: o curso já existe desde o "Criar curso", e quem volta para
 * editar não quer refazer o caminho.
 */
describe('CoursesSection — wizard de três passos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.role = 'ADMIN'
  })

  it('abre no primeiro passo', async () => {
    setupFetch(buildCourse())
    await openEditor()

    expect(await screen.findByRole('button', { name: /Informações/i })).toHaveAttribute(
      'aria-current',
      'step',
    )
    // O conteúdo do passo 1 está à vista; o dos outros, não.
    expect(screen.getByRole('textbox', { name: 'Título' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /ícone \(emoji\)/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Módulos e aulas')).not.toBeInTheDocument()
  })

  it('dá para pular direto ao terceiro passo, sem passar pelos outros', async () => {
    setupFetch(buildCourse())
    await openEditor()

    fireEvent.click(await screen.findByRole('button', { name: /Conteúdo/i }))

    expect(screen.getByText('Módulos e aulas')).toBeInTheDocument()
    expect(screen.getByText('Avaliações')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Título' })).not.toBeInTheDocument()
  })

  /**
   * O estado do formulário é UM só para os passos 1 e 2: trocar de passo não
   * pode perder o que foi digitado no outro.
   */
  it('o que foi digitado sobrevive à troca de passo', async () => {
    setupFetch(buildCourse())
    await openEditor()

    fireEvent.change(await screen.findByRole('textbox', { name: 'Título' }), {
      target: { value: 'Título novo' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Identidade visual/i }))
    fireEvent.change(screen.getByRole('textbox', { name: /ícone \(emoji\)/i }), {
      target: { value: '🚀' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Informações/i }))

    expect(screen.getByRole('textbox', { name: 'Título' })).toHaveValue('Título novo')
  })

  // O botão fica nos dois passos: obrigar a voltar ao passo 1 para salvar uma
  // cor seria pedir um passeio.
  it('salva a partir do passo de identidade visual, com o que foi digitado no primeiro', async () => {
    setupFetch(buildCourse())
    await openEditor()

    fireEvent.change(await screen.findByRole('textbox', { name: 'Título' }), {
      target: { value: 'Título novo' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Identidade visual/i }))
    fireEvent.change(screen.getByRole('textbox', { name: /ícone \(emoji\)/i }), {
      target: { value: '🚀' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar dados do curso' }))

    await waitFor(() =>
      expect(mockUpdateCourse).toHaveBeenCalledWith(
        'course-1',
        expect.objectContaining({ title: 'Título novo', icon: '🚀' }),
      ),
    )
  })
})
