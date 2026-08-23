import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import type { CourseCardDTO, LearningHomeResponse } from '@legends/shared'
import { LearningPage } from './LearningPage'
import { getLearningHome, listCertificates, listCourses, listTracks, getMyLearning } from '../../lib/learning-api'

vi.mock('../../lib/learning-api', () => ({
  getLearningHome: vi.fn(),
  listCourses: vi.fn(),
  listTracks: vi.fn(),
  getMyLearning: vi.fn(),
  listCertificates: vi.fn(),
  setCourseFavorite: vi.fn(),
}))

const mockHome = getLearningHome as unknown as Mock
const mockCourses = listCourses as unknown as Mock
const mockTracks = listTracks as unknown as Mock
const mockMine = getMyLearning as unknown as Mock
const mockCertificates = listCertificates as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function course(overrides: Partial<CourseCardDTO> = {}): CourseCardDTO {
  return {
    id: 'c1',
    title: 'Liderança na prática',
    shortDescription: 'Conduzir 1:1 e dar feedback.',
    coverUrl: null,
    category: 'Liderança',
    level: 'INTERMEDIATE',
    durationMinutes: 90,
    instructorName: 'Gente & Gestão',
    competencies: ['Liderança'],
    mandatory: false,
    certificateEnabled: true,
    averageRating: 4.5,
    totalRatings: 2,
    totalStudents: 7,
    favorite: false,
    publishedAt: '2026-07-01T00:00:00.000Z',
    enrollment: null,
    ...overrides,
  }
}

const HOME: LearningHomeResponse = {
  summary: { monthMinutes: 90, certificates: 1, inProgress: 2, pendingMandatory: 1 },
  continueLearning: [],
  mandatory: [course({ id: 'c2', title: 'Segurança da informação', mandatory: true })],
  recommended: [course()],
  newest: [course()],
  popular: [course()],
  tracks: [],
}

describe('LearningPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHome.mockResolvedValue(HOME)
    mockCourses.mockResolvedValue({ courses: [course()], categories: ['Liderança'], competencies: ['Liderança'] })
    mockTracks.mockResolvedValue({ tracks: [] })
    mockMine.mockResolvedValue({ enrollments: [], summary: HOME.summary })
    mockCertificates.mockResolvedValue({ certificates: [] })
  })

  it('mostra os KPIs do mês e os trilhos da home', async () => {
    wrap(<LearningPage />)

    // O valor do KPI é conferido dentro do próprio card: "1h30" também aparece
    // como duração nos cards de curso.
    const hoursKpi = (await screen.findByText('Horas estudadas no mês')).parentElement
    expect(hoursKpi).toHaveTextContent('1h30')
    expect(screen.getByText('Cursos obrigatórios')).toBeInTheDocument()
    expect(screen.getByText('Segurança da informação')).toBeInTheDocument()
  })

  it('troca para o catálogo e busca com os filtros', async () => {
    const user = userEvent.setup()
    wrap(<LearningPage />)

    await user.click(await screen.findByRole('tab', { name: 'Catálogo' }))

    const input = await screen.findByPlaceholderText('Busque por curso, categoria ou competência…')
    await user.type(input, 'lideran')

    expect(mockCourses).toHaveBeenCalled()
    const lastCall = mockCourses.mock.calls.at(-1)?.[0]
    expect(lastCall).toMatchObject({ search: 'lideran' })
  })

  it('mostra o estado vazio dos certificados', async () => {
    const user = userEvent.setup()
    wrap(<LearningPage />)

    await user.click(await screen.findByRole('tab', { name: 'Certificados' }))

    expect(await screen.findByText('Nenhum certificado ainda')).toBeInTheDocument()
  })
})
