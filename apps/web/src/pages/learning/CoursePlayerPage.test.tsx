import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi, type Mock } from 'vitest'
import type { CourseDetailDTO } from '@legends/shared'
import { CoursePlayerPage } from './CoursePlayerPage'
import { getCourse, rateCourse, requestCourseCertificate } from '../../lib/learning-api'

vi.mock('../../lib/learning-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/learning-api')>()
  return { ...actual, getCourse: vi.fn(), rateCourse: vi.fn(), requestCourseCertificate: vi.fn() }
})

const mockGetCourse = getCourse as unknown as Mock
const mockRateCourse = rateCourse as unknown as Mock
const mockRequestCertificate = requestCourseCertificate as unknown as Mock

function buildCourse(overrides: Partial<CourseDetailDTO> = {}): CourseDetailDTO {
  return {
    id: 'course-1',
    title: 'Liderança na prática',
    shortDescription: 'Conduzir 1:1 e dar feedback.',
    coverUrl: null,
    icon: null,
    primaryColor: null,
    bannerUrl: null,
    introVideoUrl: null,
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
    instructors: [],
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
            blocks: [{ id: 'b1', type: 'text', text: 'Conteúdo' }],
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
    certificateRequest: null,
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

// Documento 4, seção 9.3: o certificado era 100% automático — a pessoa não
// tinha o que clicar nem o que ler enquanto a fila não andava.
describe('CoursePlayerPage — solicitação de certificado', () => {
  it('trava o botão enquanto o curso não está concluído', async () => {
    renderPage(buildCourse())

    const botao = await screen.findByRole('button', { name: 'Solicitar certificado' })
    expect(botao).toBeDisabled()
    expect(screen.getByText(/Conclua todas as aulas do curso/)).toBeInTheDocument()
  })

  it('solicita o certificado com o curso concluído', async () => {
    const course = buildCourse({
      enrollment: {
        status: 'COMPLETED',
        progressPct: 100,
        completedAt: '2026-08-01T00:00:00.000Z',
        lastAccessedAt: null,
        lastLessonId: null,
      },
    })
    mockRequestCertificate.mockResolvedValue({ course })
    renderPage(course)

    await userEvent.click(await screen.findByRole('button', { name: 'Solicitar certificado' }))

    expect(mockRequestCertificate).toHaveBeenCalledWith('course-1')
  })

  it('mostra o estado da fila em vez do botão quando já solicitou', async () => {
    renderPage(
      buildCourse({
        certificateRequest: { status: 'PENDING', rejectionReason: null, createdAt: '2026-08-01T00:00:00.000Z' },
      }),
    )

    expect(await screen.findByText(/Solicitação enviada/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Solicitar certificado' })).not.toBeInTheDocument()
  })

  it('deixa pedir de novo depois de uma recusa, com o motivo à vista', async () => {
    renderPage(
      buildCourse({
        enrollment: {
          status: 'COMPLETED',
          progressPct: 100,
          completedAt: '2026-08-01T00:00:00.000Z',
          lastAccessedAt: null,
          lastLessonId: null,
        },
        certificateRequest: {
          status: 'REJECTED',
          rejectionReason: 'Falta o quiz final.',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      }),
    )

    expect(await screen.findByText(/Falta o quiz final\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Solicitar novamente' })).toBeEnabled()
  })
})

// Documento 4, seção 9.4: salvava em silêncio, e o rótulo "Atualizar avaliação"
// não confirmava envio nenhum.
describe('CoursePlayerPage — avaliação do curso', () => {
  it('confirma o envio e nunca oferece "Atualizar avaliação"', async () => {
    mockRateCourse.mockResolvedValue({ rating: { rating: 5, comment: null, updatedAt: '2026-08-01T00:00:00.000Z' } })
    renderPage(buildCourse({ myRating: { rating: 4, comment: null, updatedAt: '2026-08-01T00:00:00.000Z' } }))

    const botao = await screen.findByRole('button', { name: 'Enviar avaliação' })
    expect(screen.queryByRole('button', { name: 'Atualizar avaliação' })).not.toBeInTheDocument()

    await userEvent.click(botao)

    expect(await screen.findByRole('status')).toHaveTextContent('Obrigada pelo seu Feedback!')
  })
})
