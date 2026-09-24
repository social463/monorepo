import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { CourseQuizEditor } from './CourseQuizEditor'
import { ApiError } from '../../lib/api'
import * as learningApi from '../../lib/learning-api'

vi.mock('../../lib/learning-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/learning-api')>()
  return {
    ...actual,
    listCourseQuizzes: vi.fn(),
    createCourseQuiz: vi.fn(),
    getCourseQuiz: vi.fn(),
    updateCourseQuiz: vi.fn(),
    deleteCourseQuiz: vi.fn(),
    createQuizQuestion: vi.fn(),
    updateQuizQuestion: vi.fn(),
    deleteQuizQuestion: vi.fn(),
    reorderQuizQuestions: vi.fn(),
  }
})

const mockListQuizzes = learningApi.listCourseQuizzes as unknown as Mock
const mockCreateQuiz = learningApi.createCourseQuiz as unknown as Mock
const mockGetQuiz = learningApi.getCourseQuiz as unknown as Mock
const mockUpdateQuiz = learningApi.updateCourseQuiz as unknown as Mock
const mockDeleteQuiz = learningApi.deleteCourseQuiz as unknown as Mock
const mockCreateQuestion = learningApi.createQuizQuestion as unknown as Mock
const mockUpdateQuestion = learningApi.updateQuizQuestion as unknown as Mock
const mockDeleteQuestion = learningApi.deleteQuizQuestion as unknown as Mock
const mockReorder = learningApi.reorderQuizQuestions as unknown as Mock

function buildQuiz(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'quiz-1',
    courseId: 'course-1',
    lessonId: null,
    title: 'Quiz final',
    passingScore: 70,
    maxAttempts: null,
    questionCount: 0,
    ...overrides,
  }
}

function buildQuestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'question-1',
    statement: 'Qual a capital do Brasil?',
    options: [
      { id: 'op-1', text: 'Brasília', correct: true },
      { id: 'op-2', text: 'Rio de Janeiro', correct: false },
    ],
    explanation: null,
    sortOrder: 0,
    ...overrides,
  }
}

const oneLessonModules = [
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
        blocks: [],
        durationMinutes: 10,
        sortOrder: 0,
      },
    ],
  },
]

function renderEditor(modules: typeof oneLessonModules = [], courseId = 'course-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CourseQuizEditor courseId={courseId} modules={modules} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CourseQuizEditor — quiz final', () => {
  it('mostra o formulário de criação quando o curso ainda não tem quiz final', async () => {
    mockListQuizzes.mockResolvedValue({ quizzes: [] })
    renderEditor()

    expect(await screen.findByLabelText('Título do quiz')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar quiz final' })).toBeInTheDocument()
  })

  it('cria o quiz final com nota de corte e limite de tentativas informados, e troca para a edição', async () => {
    mockListQuizzes
      .mockResolvedValueOnce({ quizzes: [] })
      .mockResolvedValue({ quizzes: [buildQuiz({ passingScore: 80, maxAttempts: 3 })] })
    mockCreateQuiz.mockResolvedValue({ quiz: buildQuiz({ passingScore: 80, maxAttempts: 3 }) })
    mockGetQuiz.mockResolvedValue({ quiz: buildQuiz({ passingScore: 80, maxAttempts: 3 }), questions: [] })
    renderEditor()

    fireEvent.change(await screen.findByLabelText('Título do quiz'), { target: { value: 'Quiz final' } })
    fireEvent.change(screen.getByLabelText('Nota de aprovação (%)'), { target: { value: '80' } })
    fireEvent.change(screen.getByLabelText('Tentativas (vazio = ilimitadas)'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar quiz final' }))

    await waitFor(() =>
      expect(mockCreateQuiz).toHaveBeenCalledWith('course-1', {
        title: 'Quiz final',
        lessonId: null,
        passingScore: 80,
        maxAttempts: 3,
      }),
    )

    // Depois de criar, a lista (invalidada) já devolve o quiz — a tela troca
    // sozinha do formulário de criação para a edição, sem clique extra.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar quiz' })).toBeInTheDocument())
  })

  it('envia maxAttempts nulo quando o campo fica em branco', async () => {
    mockListQuizzes.mockResolvedValue({ quizzes: [] })
    mockCreateQuiz.mockResolvedValue({ quiz: buildQuiz() })
    renderEditor()

    fireEvent.change(await screen.findByLabelText('Título do quiz'), { target: { value: 'Quiz final' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar quiz final' }))

    await waitFor(() =>
      expect(mockCreateQuiz).toHaveBeenCalledWith('course-1', {
        title: 'Quiz final',
        lessonId: null,
        passingScore: 70,
        maxAttempts: null,
      }),
    )
  })

  it('mostra a mensagem do servidor quando a criação falha com 409', async () => {
    mockListQuizzes.mockResolvedValue({ quizzes: [] })
    mockCreateQuiz.mockRejectedValue(new ApiError(409, 'Este curso já tem um quiz final.'))
    renderEditor()

    fireEvent.change(await screen.findByLabelText('Título do quiz'), { target: { value: 'Quiz final' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar quiz final' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Este curso já tem um quiz final.')
  })

  it('mostra os metadados do quiz existente e salva a edição sem sortOrder', async () => {
    const quiz = buildQuiz({ passingScore: 70, maxAttempts: null, questionCount: 1 })
    mockListQuizzes.mockResolvedValue({ quizzes: [quiz] })
    mockGetQuiz.mockResolvedValue({ quiz, questions: [buildQuestion()] })
    mockUpdateQuiz.mockResolvedValue({ quiz: { ...quiz, passingScore: 90 } })
    renderEditor()

    const scoreInput = await screen.findByLabelText('Nota de aprovação (%)')
    expect(scoreInput).toHaveValue(70)
    fireEvent.change(scoreInput, { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar quiz' }))

    await waitFor(() =>
      expect(mockUpdateQuiz).toHaveBeenCalledWith('quiz-1', {
        title: 'Quiz final',
        passingScore: 90,
        maxAttempts: null,
      }),
    )
  })

  it('exclui o quiz final ao clicar em excluir', async () => {
    const quiz = buildQuiz()
    mockListQuizzes.mockResolvedValue({ quizzes: [quiz] })
    mockGetQuiz.mockResolvedValue({ quiz, questions: [] })
    mockDeleteQuiz.mockResolvedValue(undefined)
    renderEditor()

    fireEvent.click(await screen.findByRole('button', { name: 'Excluir quiz' }))

    await waitFor(() => expect(mockDeleteQuiz).toHaveBeenCalledWith('quiz-1'))
  })
})

describe('CourseQuizEditor — quiz de aula', () => {
  it('cria o quiz de uma aula específica com o lessonId correto', async () => {
    mockListQuizzes.mockResolvedValue({ quizzes: [] })
    mockCreateQuiz.mockResolvedValue({ quiz: buildQuiz({ id: 'quiz-lesson', lessonId: 'lesson-1' }) })
    renderEditor(oneLessonModules)

    const region = await screen.findByRole('region', { name: 'Quiz da aula: Aula 1' })
    fireEvent.change(within(region).getByLabelText('Título do quiz'), { target: { value: 'Quiz da aula 1' } })
    fireEvent.click(within(region).getByRole('button', { name: 'Criar quiz da aula' }))

    await waitFor(() =>
      expect(mockCreateQuiz).toHaveBeenCalledWith('course-1', {
        title: 'Quiz da aula 1',
        lessonId: 'lesson-1',
        passingScore: 70,
        maxAttempts: null,
      }),
    )
  })
})

describe('CourseQuizEditor — questões', () => {
  function setupWithQuestions(questions = [buildQuestion(), buildQuestion({ id: 'question-2', sortOrder: 1, statement: 'Segunda pergunta?' })]) {
    const quiz = buildQuiz({ questionCount: questions.length })
    mockListQuizzes.mockResolvedValue({ quizzes: [quiz] })
    mockGetQuiz.mockResolvedValue({ quiz, questions })
    return quiz
  }

  it('lista as questões existentes com o enunciado', async () => {
    setupWithQuestions()
    renderEditor()

    expect(await screen.findByText('Qual a capital do Brasil?')).toBeInTheDocument()
    expect(screen.getByText('Segunda pergunta?')).toBeInTheDocument()
  })

  it('adiciona uma questão nova com as opções e o gabarito marcado', async () => {
    setupWithQuestions([])
    mockCreateQuestion.mockResolvedValue({ question: buildQuestion() })
    renderEditor()

    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar questão' }))
    fireEvent.change(screen.getByLabelText('Enunciado da questão'), { target: { value: 'Qual a capital do Brasil?' } })
    fireEvent.change(screen.getByLabelText('Texto da opção 1'), { target: { value: 'Brasília' } })
    fireEvent.click(screen.getByLabelText('Opção 1 correta'))
    fireEvent.change(screen.getByLabelText('Texto da opção 2'), { target: { value: 'Rio de Janeiro' } })

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar questão' }))

    await waitFor(() =>
      expect(mockCreateQuestion).toHaveBeenCalledWith('quiz-1', {
        statement: 'Qual a capital do Brasil?',
        options: [
          { id: expect.any(String), text: 'Brasília', correct: true },
          { id: expect.any(String), text: 'Rio de Janeiro', correct: false },
        ],
        explanation: null,
      }),
    )
  })

  it('recusa salvar uma questão com uma única opção preenchida, sem chamar a API', async () => {
    setupWithQuestions([])
    renderEditor()

    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar questão' }))
    fireEvent.change(screen.getByLabelText('Enunciado da questão'), { target: { value: 'Pergunta incompleta?' } })
    fireEvent.change(screen.getByLabelText('Texto da opção 1'), { target: { value: 'Única opção' } })
    fireEvent.click(screen.getByLabelText('Opção 1 correta'))
    // opção 2 fica em branco — só uma opção de fato preenchida

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar questão' }))

    expect(await screen.findByText('A questão precisa de ao menos duas opções.')).toBeInTheDocument()
    expect(mockCreateQuestion).not.toHaveBeenCalled()
  })

  it('recusa salvar uma questão sem nenhuma opção correta, sem chamar a API', async () => {
    setupWithQuestions([])
    renderEditor()

    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar questão' }))
    fireEvent.change(screen.getByLabelText('Enunciado da questão'), { target: { value: 'Pergunta sem gabarito?' } })
    fireEvent.change(screen.getByLabelText('Texto da opção 1'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('Texto da opção 2'), { target: { value: 'B' } })

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar questão' }))

    expect(await screen.findByText('A questão precisa de ao menos uma opção correta.')).toBeInTheDocument()
    expect(mockCreateQuestion).not.toHaveBeenCalled()
  })

  it('edita uma questão existente sem enviar sortOrder no payload', async () => {
    setupWithQuestions([buildQuestion()])
    mockUpdateQuestion.mockResolvedValue({ question: buildQuestion({ statement: 'Pergunta revisada?' }) })
    renderEditor()

    fireEvent.click(await screen.findByRole('button', { name: 'Editar questão' }))
    fireEvent.change(screen.getByLabelText('Enunciado da questão'), { target: { value: 'Pergunta revisada?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar questão' }))

    await waitFor(() => expect(mockUpdateQuestion).toHaveBeenCalled())
    const [, payload] = mockUpdateQuestion.mock.calls[0]
    expect(payload).not.toHaveProperty('sortOrder')
    expect(payload.statement).toBe('Pergunta revisada?')
  })

  it('exclui uma questão', async () => {
    setupWithQuestions([buildQuestion()])
    mockDeleteQuestion.mockResolvedValue(undefined)
    renderEditor()

    fireEvent.click(await screen.findByRole('button', { name: 'Excluir questão' }))

    await waitFor(() => expect(mockDeleteQuestion).toHaveBeenCalledWith('question-1'))
  })

  it('não dispara uma segunda exclusão enquanto a primeira ainda está em voo', async () => {
    setupWithQuestions([buildQuestion()])
    // Nunca resolve — mantém a mutação pendente pelos dois cliques.
    mockDeleteQuestion.mockReturnValue(new Promise(() => {}))
    renderEditor()

    const button = await screen.findByRole('button', { name: 'Excluir questão' })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)

    expect(mockDeleteQuestion).toHaveBeenCalledTimes(1)
  })
})

describe('CourseQuizEditor — reordenação', () => {
  it('envia a lista completa de ids na nova ordem ao mover uma questão para cima', async () => {
    const questions = [
      buildQuestion({ id: 'q-1', statement: 'Primeira?' }),
      buildQuestion({ id: 'q-2', statement: 'Segunda?', sortOrder: 1 }),
      buildQuestion({ id: 'q-3', statement: 'Terceira?', sortOrder: 2 }),
    ]
    const quiz = buildQuiz({ questionCount: 3 })
    mockListQuizzes.mockResolvedValue({ quizzes: [quiz] })
    mockGetQuiz.mockResolvedValue({ quiz, questions })
    mockReorder.mockResolvedValue(undefined)
    renderEditor()

    await screen.findByText('Segunda?')
    fireEvent.click(screen.getByRole('button', { name: 'Mover questão 2 para cima' }))

    await waitFor(() => expect(mockReorder).toHaveBeenCalledWith('quiz-1', ['q-2', 'q-1', 'q-3']))
  })

  it('não dispara uma segunda reordenação enquanto a primeira ainda está em voo', async () => {
    const questions = [
      buildQuestion({ id: 'q-1', statement: 'Primeira?' }),
      buildQuestion({ id: 'q-2', statement: 'Segunda?', sortOrder: 1 }),
      buildQuestion({ id: 'q-3', statement: 'Terceira?', sortOrder: 2 }),
    ]
    const quiz = buildQuiz({ questionCount: 3 })
    mockListQuizzes.mockResolvedValue({ quizzes: [quiz] })
    mockGetQuiz.mockResolvedValue({ quiz, questions })
    // Nunca resolve — a segunda "volta" (duplo clique, ou ↑ seguido de ↓ antes
    // do primeiro terminar) recalcularia a partir da MESMA ordem anterior ao
    // primeiro clique, e a segunda chamada sobrescreveria a primeira com uma
    // ordem que o usuário não pediu. O botão desabilitado em `isPending`
    // impede o segundo clique de sequer disparar.
    mockReorder.mockReturnValue(new Promise(() => {}))
    renderEditor()

    await screen.findByText('Segunda?')
    const up = screen.getByRole('button', { name: 'Mover questão 2 para cima' })
    fireEvent.click(up)
    await waitFor(() => expect(up).toBeDisabled())
    fireEvent.click(up)

    expect(mockReorder).toHaveBeenCalledTimes(1)
  })

  it('desabilita mover para cima na primeira questão e para baixo na última', async () => {
    const questions = [
      buildQuestion({ id: 'q-1', statement: 'Primeira?' }),
      buildQuestion({ id: 'q-2', statement: 'Segunda?', sortOrder: 1 }),
    ]
    const quiz = buildQuiz({ questionCount: 2 })
    mockListQuizzes.mockResolvedValue({ quizzes: [quiz] })
    mockGetQuiz.mockResolvedValue({ quiz, questions })
    renderEditor()

    await screen.findByText('Segunda?')
    expect(screen.getByRole('button', { name: 'Mover questão 1 para cima' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover questão 2 para baixo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover questão 1 para baixo' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mover questão 2 para cima' })).not.toBeDisabled()
  })

  it('mostra a mensagem do servidor quando a reordenação é recusada (400)', async () => {
    const questions = [
      buildQuestion({ id: 'q-1', statement: 'Primeira?' }),
      buildQuestion({ id: 'q-2', statement: 'Segunda?', sortOrder: 1 }),
    ]
    const quiz = buildQuiz({ questionCount: 2 })
    mockListQuizzes.mockResolvedValue({ quizzes: [quiz] })
    mockGetQuiz.mockResolvedValue({ quiz, questions })
    mockReorder.mockRejectedValue(
      new ApiError(400, 'A ordem enviada não corresponde aos itens atuais. Recarregue a página.'),
    )
    renderEditor()

    await screen.findByText('Segunda?')
    fireEvent.click(screen.getByRole('button', { name: 'Mover questão 2 para cima' }))

    expect(
      await screen.findByText('A ordem enviada não corresponde aos itens atuais. Recarregue a página.'),
    ).toBeInTheDocument()
  })
})

/**
 * O id de opção nova vinha de um contador de MÓDULO (`opt-novo-${n}`), que
 * zera a cada carregamento da página. Sequência que quebrava: criar uma
 * questão numa sessão (opções `opt-novo-1`/`opt-novo-2`) → recarregar → editar
 * a mesma questão → "Adicionar opção" → id `opt-novo-1` de novo, duplicado
 * DENTRO da questão. `vi.resetModules()` + reimport é justamente o recarregar:
 * é o que devolve o contador a zero.
 */
describe('CourseQuizEditor — id de opção nova não colide após recarregar a página', () => {
  it('a opção adicionada depois do reload não repete o id de uma opção já salva', async () => {
    vi.resetModules()
    const api = await import('../../lib/learning-api')
    const { CourseQuizEditor: FreshEditor } = await import('./CourseQuizEditor')
    const listQuizzes = api.listCourseQuizzes as unknown as Mock
    const getQuiz = api.getCourseQuiz as unknown as Mock
    const updateQuestion = api.updateQuizQuestion as unknown as Mock

    // Questão salva na sessão ANTERIOR, com os ids que o contador produzia.
    const question = buildQuestion({
      options: [
        { id: 'opt-novo-1', text: 'Brasília', correct: true },
        { id: 'opt-novo-2', text: 'Rio de Janeiro', correct: false },
      ],
    })
    const quiz = buildQuiz({ questionCount: 1 })
    listQuizzes.mockResolvedValue({ quizzes: [quiz] })
    getQuiz.mockResolvedValue({ quiz, questions: [question] })
    updateQuestion.mockResolvedValue({ question })

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <FreshEditor courseId="course-1" modules={[]} />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Editar questão' }))
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar opção' }))
    fireEvent.change(screen.getByLabelText('Texto da opção 3'), { target: { value: 'Salvador' } })

    // Com id duplicado, `updateOptionText` casa por id e escreveria nas duas.
    expect(screen.getByLabelText('Texto da opção 1')).toHaveValue('Brasília')

    fireEvent.click(screen.getByRole('button', { name: 'Salvar questão' }))

    await waitFor(() => expect(updateQuestion).toHaveBeenCalled())
    const options = updateQuestion.mock.calls[0][1].options as { id: string; text: string }[]
    expect(options.map((option) => option.text)).toEqual(['Brasília', 'Rio de Janeiro', 'Salvador'])
    expect(new Set(options.map((option) => option.id)).size).toBe(3)
  })
})
