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
    category: 'Liderança',
    level: 'BEGINNER',
    competencies: [],
    objectives: [],
    prerequisites: null,
    instructorName: null,
    instructorBio: null,
    mandatory: false,
    certificateEnabled: false,
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
