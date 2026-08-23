import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi, type Mock } from 'vitest'
import type { CourseDetailDTO } from '@legends/shared'
import { CoursePlayerPage } from './CoursePlayerPage'
import { getCourse } from '../../lib/learning-api'

vi.mock('../../lib/learning-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/learning-api')>()
  return { ...actual, getCourse: vi.fn() }
})

const mockGetCourse = getCourse as unknown as Mock

function buildCourse(overrides: Partial<CourseDetailDTO> = {}): CourseDetailDTO {
  return {
    id: 'course-1',
    title: 'Liderança na prática',
    shortDescription: 'Conduzir 1:1 e dar feedback.',
    coverUrl: null,
    category: 'Liderança',
    level: 'INTERMEDIATE',
    durationMinutes: 30,
    instructorName: null,
    competencies: [],
    mandatory: false,
    certificateEnabled: true,
    averageRating: 0,
    totalRatings: 0,
    totalStudents: 0,
    favorite: false,
    publishedAt: '2026-07-01T00:00:00.000Z',
    enrollment: {
      status: 'IN_PROGRESS',
      progressPct: 0,
      completedAt: null,
      lastAccessedAt: null,
      lastLessonId: null,
    },
    description: null,
    objectives: [],
    prerequisites: null,
    instructorBio: null,
    modules: [
      {
        id: 'module-1',
        title: 'Módulo 1',
        description: null,
        sortOrder: 0,
        lessons: [
          {
            id: 'lesson-1',
            moduleId: 'module-1',
            title: 'Aula 1',
            description: null,
            type: 'VIDEO',
            videoUrl: null,
            contentHtml: '<p>Conteúdo</p>',
            durationMinutes: 30,
            sortOrder: 0,
            completed: false,
            quizId: null,
          },
        ],
      },
    ],
    totalLessons: 1,
    completedLessons: 0,
    myRating: null,
    certificate: null,
    finalQuizId: null,
    ...overrides,
  }
}

function renderPage(course: CourseDetailDTO) {
  mockGetCourse.mockResolvedValue({ course })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/aprendizado/curso/${course.id}`]}>
        <Routes>
          <Route path="/aprendizado/curso/:id" element={<CoursePlayerPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CoursePlayerPage — links de quiz', () => {
  it('mostra o link do quiz da aula atual quando a aula tem quiz', async () => {
    const course = buildCourse()
    course.modules[0].lessons[0].quizId = 'quiz-lesson-1'
    renderPage(course)

    const link = await screen.findByRole('link', { name: 'Fazer quiz da aula' })
    expect(link).toHaveAttribute('href', '/aprendizado/quiz/quiz-lesson-1')
  })

  it('não mostra o link do quiz da aula quando a aula não tem quiz', async () => {
    const course = buildCourse()
    renderPage(course)

    await screen.findByRole('heading', { name: 'Aula 1' })
    expect(screen.queryByRole('link', { name: 'Fazer quiz da aula' })).not.toBeInTheDocument()
  })

  it('mostra o link do quiz final do curso quando o curso tem quiz final e a pessoa está inscrita', async () => {
    const course = buildCourse({ finalQuizId: 'quiz-final-1' })
    renderPage(course)

    const link = await screen.findByRole('link', { name: 'Fazer quiz final' })
    expect(link).toHaveAttribute('href', '/aprendizado/quiz/quiz-final-1')
  })

  it('não mostra o link do quiz final quando a pessoa não está inscrita', async () => {
    const course = buildCourse({ finalQuizId: 'quiz-final-1', enrollment: null })
    renderPage(course)

    await screen.findByText('Liderança na prática')
    expect(screen.queryByRole('link', { name: 'Fazer quiz final' })).not.toBeInTheDocument()
  })
})
