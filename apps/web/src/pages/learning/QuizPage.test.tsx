import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi, type Mock } from 'vitest'
import { QuizPage } from './QuizPage'
import { ApiError } from '../../lib/api'
import * as learningApi from '../../lib/learning-api'

vi.mock('../../lib/learning-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/learning-api')>()
  return { ...actual, getQuizForRespondent: vi.fn(), submitQuizAttempt: vi.fn() }
})

const mockGetQuiz = learningApi.getQuizForRespondent as unknown as Mock
const mockSubmit = learningApi.submitQuizAttempt as unknown as Mock

function buildQuiz(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'quiz-1',
    courseId: 'course-1',
    lessonId: null,
    title: 'Quiz final',
    passingScore: 70,
    maxAttempts: 3,
    attemptsUsed: 0,
    attemptsLeft: 3,
    questions: [
      {
        id: 'q1',
        statement: 'Qual a capital do Brasil?',
        options: [
          { id: 'op-1', text: 'Brasília' },
          { id: 'op-2', text: 'Rio de Janeiro' },
        ],
        sortOrder: 0,
      },
    ],
    ...overrides,
  }
}

function renderPage(id = 'quiz-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/aprendizado/quiz/${id}`]}>
        <Routes>
          <Route path="/aprendizado/quiz/:id" element={<QuizPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('QuizPage', () => {
  it('mostra as tentativas restantes antes de enviar', async () => {
    mockGetQuiz.mockResolvedValue({ quiz: buildQuiz({ maxAttempts: 3 }) })
    renderPage()

    expect(await screen.findByText('Qual a capital do Brasil?')).toBeInTheDocument()
    expect(screen.getByText(/3 de 3 tentativas restantes/)).toBeInTheDocument()
  })

  /**
   * Antes, o rótulo pré-envio caía em `maxAttempts` (o teto): quem tinha usado
   * 2 de 3 e recarregava a página lia "3 de 3 restantes" — e levava um 409 ao
   * enviar. O DTO agora traz o que já foi usado.
   */
  it('desconta as tentativas já usadas em sessões anteriores, sem depender de um envio nesta', async () => {
    mockGetQuiz.mockResolvedValue({ quiz: buildQuiz({ maxAttempts: 3, attemptsUsed: 2, attemptsLeft: 1 }) })
    renderPage()

    await screen.findByText('Qual a capital do Brasil?')
    expect(screen.getByText('1 de 3 tentativas restante.')).toBeInTheDocument()
    expect(screen.queryByText(/3 de 3/)).not.toBeInTheDocument()
  })

  it('mostra 0 restantes quando o limite já foi esgotado antes desta sessão', async () => {
    mockGetQuiz.mockResolvedValue({ quiz: buildQuiz({ maxAttempts: 3, attemptsUsed: 3, attemptsLeft: 0 }) })
    renderPage()

    await screen.findByText('Qual a capital do Brasil?')
    expect(screen.getByText('0 de 3 tentativas restantes.')).toBeInTheDocument()
  })

  it('não mostra "tentativas restantes" quando o quiz tem tentativas ilimitadas', async () => {
    mockGetQuiz.mockResolvedValue({ quiz: buildQuiz({ maxAttempts: null }) })
    renderPage()

    await screen.findByText('Qual a capital do Brasil?')
    expect(screen.queryByText(/tentativas restantes/)).not.toBeInTheDocument()
    expect(screen.getByText('Tentativas ilimitadas.')).toBeInTheDocument()
  })

  it('não mostra o gabarito antes de responder', async () => {
    mockGetQuiz.mockResolvedValue({ quiz: buildQuiz() })
    renderPage()

    await screen.findByText('Qual a capital do Brasil?')
    expect(screen.queryByText('Resposta correta')).not.toBeInTheDocument()
    expect(screen.queryByText('Resposta incorreta')).not.toBeInTheDocument()
  })

  it('envia as respostas escolhidas e mostra nota, aprovação e explicação por questão', async () => {
    mockGetQuiz.mockResolvedValue({ quiz: buildQuiz() })
    mockSubmit.mockResolvedValue({
      result: {
        score: 100,
        passed: true,
        attemptNumber: 1,
        attemptsLeft: 2,
        feedback: [{ questionId: 'q1', correct: true, explanation: 'Brasília é a capital desde 1960.' }],
      },
    })
    renderPage()

    fireEvent.click(await screen.findByLabelText('Brasília'))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar respostas' }))

    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith('quiz-1', { answers: [{ questionId: 'q1', optionId: 'op-1' }] }),
    )

    expect(await screen.findByText('Aprovado')).toBeInTheDocument()
    expect(screen.getByText('Brasília é a capital desde 1960.')).toBeInTheDocument()
    expect(screen.getByText(/2 de 3 tentativas restantes/)).toBeInTheDocument()
  })

  it('reprovado mostra "Reprovado" e a explicação da questão errada', async () => {
    mockGetQuiz.mockResolvedValue({ quiz: buildQuiz() })
    mockSubmit.mockResolvedValue({
      result: {
        score: 0,
        passed: false,
        attemptNumber: 1,
        attemptsLeft: 2,
        feedback: [{ questionId: 'q1', correct: false, explanation: 'A capital é Brasília, não Rio de Janeiro.' }],
      },
    })
    renderPage()

    fireEvent.click(await screen.findByLabelText('Rio de Janeiro'))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar respostas' }))

    expect(await screen.findByText('Reprovado')).toBeInTheDocument()
    expect(screen.getByText('A capital é Brasília, não Rio de Janeiro.')).toBeInTheDocument()
  })

  it('esgotado o limite de tentativas, mostra a mensagem do servidor e mantém o botão visível e habilitado', async () => {
    mockGetQuiz.mockResolvedValue({ quiz: buildQuiz({ maxAttempts: 1 }) })
    mockSubmit.mockRejectedValue(new ApiError(409, 'Você já usou todas as 1 tentativas deste quiz.'))
    renderPage()

    fireEvent.click(await screen.findByLabelText('Brasília'))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar respostas' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Você já usou todas as 1 tentativas deste quiz.')
    const button = screen.getByRole('button', { name: 'Enviar respostas' })
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()
  })

  it('mostra a mensagem do servidor quando o quiz não pode ser carregado', async () => {
    mockGetQuiz.mockRejectedValue(new ApiError(404, 'Quiz não encontrado.'))
    renderPage()

    expect(await screen.findByText('Quiz não encontrado.')).toBeInTheDocument()
  })

  it('o botão de enviar desabilita durante o envio e não dispara duas chamadas em cliques duplos', async () => {
    mockGetQuiz.mockResolvedValue({ quiz: buildQuiz() })
    let resolveSubmit: (value: unknown) => void = () => {}
    mockSubmit.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve
      }),
    )
    renderPage()

    fireEvent.click(await screen.findByLabelText('Brasília'))
    const button = screen.getByRole('button', { name: 'Enviar respostas' })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)

    expect(mockSubmit).toHaveBeenCalledTimes(1)

    resolveSubmit({ result: { score: 100, passed: true, attemptNumber: 1, attemptsLeft: null, feedback: [] } })
    await waitFor(() => expect(button).not.toBeDisabled())
  })
})
