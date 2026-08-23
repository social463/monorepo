import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  QUIZ_MAX_OPTIONS_PER_QUESTION,
  QUIZ_MAX_PASSING_SCORE,
  QUIZ_MIN_PASSING_SCORE,
  QUIZ_STATEMENT_MAX_LENGTH,
  quizOptionsSchema,
  type AdminCourseModuleDTO,
  type CourseQuizDTO,
  type QuizOption,
  type QuizQuestionForAuthorDTO,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import {
  createCourseQuiz,
  createQuizQuestion,
  deleteCourseQuiz,
  deleteQuizQuestion,
  getCourseQuiz,
  listCourseQuizzes,
  reorderQuizQuestions,
  updateCourseQuiz,
  updateQuizQuestion,
} from '../../lib/learning-api'
import { errorMessage, inputCls } from './shared'

/**
 * Id de opção nova. `crypto.randomUUID` (disponível nos navegadores que o
 * projeto suporta e no jsdom dos testes) em vez do contador de módulo que
 * havia aqui: o contador zerava a cada carregamento da página, então editar,
 * depois de um reload, uma questão criada na sessão anterior gerava
 * `opt-novo-1` de novo — id DUPLICADO dentro da mesma questão. Com id
 * repetido, `toggleCorrect`/`updateOptionText` mexem nas duas opções de uma
 * vez, o React vê chave duplicada e, depois de salvo, a correção (que casa
 * por id) dá a resposta como certa se qualquer uma das duas estiver marcada
 * como correta. `quizOptionsSchema` recusa a repetição também no servidor.
 */
function newOptionId(): string {
  return `opt-${crypto.randomUUID()}`
}

function emptyOption(): QuizOption {
  return { id: newOptionId(), text: '', correct: false }
}

/** Formulário de metadados: cria (sem quiz ainda) ou edita (quiz existente) — mesmos campos. */
function QuizMetaForm({
  quiz,
  courseId,
  lessonId,
  submitLabel,
  onSaved,
}: {
  quiz?: CourseQuizDTO
  courseId: string
  lessonId: string | null
  submitLabel: string
  onSaved: () => void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(quiz?.title ?? '')
  const [passingScore, setPassingScore] = useState(String(quiz?.passingScore ?? 70))
  const [maxAttempts, setMaxAttempts] = useState(quiz?.maxAttempts != null ? String(quiz.maxAttempts) : '')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (variables: { title: string; passingScore: number; maxAttempts: number | null }) =>
      quiz ? updateCourseQuiz(quiz.id, variables) : createCourseQuiz(courseId, { ...variables, lessonId }),
    onSuccess: () => {
      setError(null)
      onSaved()
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível salvar o quiz.')),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    save.mutate({
      title: title.trim(),
      passingScore: Number(passingScore) || 0,
      maxAttempts: maxAttempts.trim() ? Number(maxAttempts) : null,
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-md">
      <div className="grid gap-md sm:grid-cols-3">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-label text-label-sm text-on-surface-variant">Título do quiz</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Nota de aprovação (%)</span>
          <input
            type="number"
            min={QUIZ_MIN_PASSING_SCORE}
            max={QUIZ_MAX_PASSING_SCORE}
            value={passingScore}
            onChange={(event) => setPassingScore(event.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Tentativas (vazio = ilimitadas)</span>
          <input
            type="number"
            min={1}
            value={maxAttempts}
            onChange={(event) => setMaxAttempts(event.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!title.trim() || save.isPending}
        className="inline-flex w-fit items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
      >
        {submitLabel}
      </button>
    </form>
  )
}

/** Enunciado + opções (com gabarito) de uma questão nova ou existente. */
function QuestionForm({
  quizId,
  question,
  onDone,
  onSaved,
}: {
  quizId: string
  question?: QuizQuestionForAuthorDTO
  onDone: () => void
  onSaved: () => void
}) {
  const [statement, setStatement] = useState(question?.statement ?? '')
  const [options, setOptions] = useState<QuizOption[]>(
    () => question?.options.map((option) => ({ ...option })) ?? [emptyOption(), emptyOption()],
  )
  const [explanation, setExplanation] = useState(question?.explanation ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (variables: { statement: string; options: QuizOption[]; explanation: string | null }) =>
      question ? updateQuizQuestion(question.id, variables) : createQuizQuestion(quizId, variables),
    onSuccess: () => {
      setError(null)
      onSaved()
      onDone()
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível salvar a questão.')),
  })

  function updateOptionText(id: string, text: string) {
    setOptions((prev) => prev.map((option) => (option.id === id ? { ...option, text } : option)))
  }

  function toggleCorrect(id: string) {
    setOptions((prev) => prev.map((option) => (option.id === id ? { ...option, correct: !option.correct } : option)))
  }

  function addOption() {
    setOptions((prev) => (prev.length >= QUIZ_MAX_OPTIONS_PER_QUESTION ? prev : [...prev, emptyOption()]))
  }

  function removeOption(id: string) {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((option) => option.id !== id)))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!statement.trim()) {
      setError('Informe o enunciado da questão.')
      return
    }
    // Linhas de opção deixadas em branco (ex.: uma 3ª opção aberta e não
    // preenchida) não entram na validação — mesmo critério que o service usa
    // pra decidir o que é "opção de verdade".
    const filled = options
      .map((option) => ({ ...option, text: option.text.trim() }))
      .filter((option) => option.text.length > 0)
    // Valida pelo mesmo schema do shared que a rota usa — não uma regra
    // escrita à mão aqui, pra cliente e servidor nunca discordarem do que é
    // uma questão válida.
    const parsed = quizOptionsSchema.safeParse(filled)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Opções da questão inválidas.')
      return
    }
    setError(null)
    save.mutate({ statement: statement.trim(), options: parsed.data, explanation: explanation.trim() || null })
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-md rounded-lg border border-dashed border-outline-variant/50 p-md"
    >
      <label className="flex flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Enunciado da questão</span>
        <textarea
          value={statement}
          onChange={(event) => setStatement(event.target.value)}
          maxLength={QUIZ_STATEMENT_MAX_LENGTH}
          rows={2}
          className={inputCls}
        />
      </label>

      <div className="flex flex-col gap-sm">
        {options.map((option, index) => (
          <div key={option.id} className="flex items-center gap-sm">
            <input
              type="checkbox"
              checked={option.correct}
              onChange={() => toggleCorrect(option.id)}
              aria-label={`Opção ${index + 1} correta`}
            />
            <input
              value={option.text}
              onChange={(event) => updateOptionText(option.id, event.target.value)}
              placeholder={`Opção ${index + 1}`}
              aria-label={`Texto da opção ${index + 1}`}
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => removeOption(option.id)}
              disabled={options.length <= 2}
              aria-label={`Remover opção ${index + 1}`}
              className="rounded-full p-1 text-on-surface-variant hover:text-error disabled:opacity-50"
            >
              <Icon name="close" className="text-[16px]" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addOption}
          disabled={options.length >= QUIZ_MAX_OPTIONS_PER_QUESTION}
          className="inline-flex w-fit items-center gap-1 font-label text-label-sm text-primary hover:underline disabled:opacity-50"
        >
          <Icon name="add" className="text-[16px]" /> Adicionar opção
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Explicação (opcional)</span>
        <textarea
          value={explanation ?? ''}
          onChange={(event) => setExplanation(event.target.value)}
          rows={2}
          className={inputCls}
        />
      </label>

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}

      <div className="flex gap-sm">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {question ? 'Salvar questão' : 'Adicionar questão'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

/** Edição de um quiz já criado: metadados + CRUD de questões + reordenação por ↑/↓. */
function QuizEditor({ quizId, courseId }: { quizId: string; courseId: string }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'course-quiz', quizId],
    queryFn: () => getCourseQuiz(quizId),
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['admin', 'course-quiz', quizId] })
    qc.invalidateQueries({ queryKey: ['admin', 'course-quizzes', courseId] })
  }

  const removeQuiz = useMutation({
    mutationFn: () => deleteCourseQuiz(quizId),
    onSuccess: () => {
      setError(null)
      qc.invalidateQueries({ queryKey: ['admin', 'course-quizzes', courseId] })
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível excluir o quiz.')),
  })

  const removeQuestion = useMutation({
    mutationFn: (questionId: string) => deleteQuizQuestion(questionId),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível excluir a questão.')),
  })

  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderQuizQuestions(quizId, ids),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível reordenar as questões.')),
  })

  if (isLoading || !data) return <p className="text-body-sm text-on-surface-variant">Carregando quiz…</p>

  const { quiz, questions } = data

  function moveQuestion(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= questions.length) return
    const ids = questions.map((question) => question.id)
    const swap = ids[index]
    ids[index] = ids[target]
    ids[target] = swap
    reorder.mutate(ids)
  }

  return (
    <div className="flex flex-col gap-md">
      <QuizMetaForm quiz={quiz} courseId={courseId} lessonId={quiz.lessonId} submitLabel="Salvar quiz" onSaved={invalidate} />

      <button
        type="button"
        onClick={() => removeQuiz.mutate()}
        disabled={removeQuiz.isPending}
        className="inline-flex w-fit items-center gap-1 rounded-md px-md py-sm font-label text-label-sm text-on-surface-variant hover:text-error disabled:opacity-50"
      >
        <Icon name="delete" className="text-[16px]" /> Excluir quiz
      </button>

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-sm">
        {questions.map((question, index) =>
          editingQuestionId === question.id ? (
            <li key={question.id}>
              <QuestionForm
                quizId={quizId}
                question={question}
                onDone={() => setEditingQuestionId(null)}
                onSaved={invalidate}
              />
            </li>
          ) : (
            <li
              key={question.id}
              className="flex flex-wrap items-center gap-sm rounded-md bg-surface-container px-md py-sm"
            >
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => moveQuestion(index, -1)}
                  disabled={index === 0 || reorder.isPending}
                  aria-label={`Mover questão ${index + 1} para cima`}
                  className="rounded-full p-0.5 text-on-surface-variant hover:text-primary disabled:opacity-30"
                >
                  <Icon name="arrow_upward" className="text-[14px]" />
                </button>
                <button
                  type="button"
                  onClick={() => moveQuestion(index, 1)}
                  disabled={index === questions.length - 1 || reorder.isPending}
                  aria-label={`Mover questão ${index + 1} para baixo`}
                  className="rounded-full p-0.5 text-on-surface-variant hover:text-primary disabled:opacity-30"
                >
                  <Icon name="arrow_downward" className="text-[14px]" />
                </button>
              </div>
              <span className="min-w-0 flex-1 truncate text-body-sm text-on-surface">{question.statement}</span>
              <button
                type="button"
                onClick={() => setEditingQuestionId(question.id)}
                aria-label="Editar questão"
                className="rounded-full p-1 text-on-surface-variant hover:text-primary"
              >
                <Icon name="edit" className="text-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => removeQuestion.mutate(question.id)}
                disabled={removeQuestion.isPending}
                aria-label="Excluir questão"
                className="rounded-full p-1 text-on-surface-variant hover:text-error disabled:opacity-50"
              >
                <Icon name="delete" className="text-[18px]" />
              </button>
            </li>
          ),
        )}
        {questions.length === 0 && !addingQuestion && (
          <li className="text-body-sm text-on-surface-variant">Nenhuma questão neste quiz.</li>
        )}
      </ul>

      {addingQuestion ? (
        <QuestionForm quizId={quizId} onDone={() => setAddingQuestion(false)} onSaved={invalidate} />
      ) : (
        <button
          type="button"
          onClick={() => setAddingQuestion(true)}
          className="inline-flex w-fit items-center gap-1 rounded-md px-md py-sm font-label text-label-md text-primary hover:underline"
        >
          <Icon name="add" className="text-[18px]" /> Adicionar questão
        </button>
      )}
    </div>
  )
}

/**
 * Um "slot" de quiz: quiz final do curso (`lessonId: null`) ou de uma aula
 * específica. Mostra o formulário de criação enquanto não existe um quiz ali
 * e troca sozinho para a edição assim que a lista (invalidada após criar)
 * devolve o quiz — sem alternância manual de modo.
 */
function QuizSlot({
  title,
  courseId,
  lessonId,
  quiz,
  createLabel,
}: {
  title: string
  courseId: string
  lessonId: string | null
  quiz?: CourseQuizDTO
  createLabel: string
}) {
  const qc = useQueryClient()
  function onCreated() {
    qc.invalidateQueries({ queryKey: ['admin', 'course-quizzes', courseId] })
  }

  return (
    <section aria-label={title} className="flex flex-col gap-md rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
      <h4 className="font-label text-label-lg text-on-surface">{title}</h4>
      {quiz ? (
        <QuizEditor quizId={quiz.id} courseId={courseId} />
      ) : (
        <QuizMetaForm courseId={courseId} lessonId={lessonId} submitLabel={createLabel} onSaved={onCreated} />
      )}
    </section>
  )
}

export function CourseQuizEditor({ courseId, modules }: { courseId: string; modules: AdminCourseModuleDTO[] }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'course-quizzes', courseId],
    queryFn: () => listCourseQuizzes(courseId),
  })

  if (isLoading) return <p className="text-body-sm text-on-surface-variant">Carregando quiz…</p>
  if (isError) return <p className="text-body-sm text-error">Não foi possível carregar os quizzes deste curso.</p>

  const quizzes = data?.quizzes ?? []
  const finalQuiz = quizzes.find((quiz) => quiz.lessonId === null)
  const lessons = modules.flatMap((courseModule) => courseModule.lessons)
  const quizByLesson = new Map(quizzes.filter((quiz) => quiz.lessonId !== null).map((quiz) => [quiz.lessonId as string, quiz]))

  return (
    <div className="flex flex-col gap-md">
      <QuizSlot
        title="Quiz final do curso"
        courseId={courseId}
        lessonId={null}
        quiz={finalQuiz}
        createLabel="Criar quiz final"
      />

      {lessons.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Adicione aulas para criar quizzes de aula.</p>
      )}
      {lessons.map((lesson) => (
        <QuizSlot
          key={lesson.id}
          title={`Quiz da aula: ${lesson.title}`}
          courseId={courseId}
          lessonId={lesson.id}
          quiz={quizByLesson.get(lesson.id)}
          createLabel="Criar quiz da aula"
        />
      ))}
    </div>
  )
}
