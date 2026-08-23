import { z } from 'zod'

/**
 * Contrato de quiz de curso (aula ou final). O quiz final condiciona a
 * emissão do certificado, não a conclusão da aula — ver `course-certificate.ts`.
 *
 * O gabarito nunca pode chegar a quem responde: por isso há dois DTOs de
 * questão distintos, `QuizQuestionForAuthorDTO` (com `correct` e
 * `explanation`) e `QuizQuestionForRespondentDTO` (sem nenhum dos dois) — não
 * um único tipo com campos opcionais.
 */

export const QUIZ_MIN_PASSING_SCORE = 0
export const QUIZ_MAX_PASSING_SCORE = 100
export const QUIZ_MAX_QUESTIONS = 50
export const QUIZ_MAX_OPTIONS_PER_QUESTION = 6
export const QUIZ_STATEMENT_MAX_LENGTH = 2_000

/**
 * Opção de resposta de uma questão, incluindo o gabarito (`correct`). Forma
 * de autoria — nunca é enviada a quem responde.
 */
export const quizOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  correct: z.boolean(),
})
export type QuizOption = z.infer<typeof quizOptionSchema>

/**
 * Valida `CourseQuestion.options` na escrita: exportado do shared porque a
 * API valida na escrita e o formulário de autoria no web valida antes de
 * enviar. Exige ao menos duas opções (para haver escolha) e ao menos uma
 * marcada como correta.
 */
export const quizOptionsSchema = z
  .array(quizOptionSchema)
  .min(2, 'A questão precisa de ao menos duas opções.')
  .max(QUIZ_MAX_OPTIONS_PER_QUESTION, `A questão aceita no máximo ${QUIZ_MAX_OPTIONS_PER_QUESTION} opções.`)
  .refine((options) => options.some((option) => option.correct), {
    message: 'A questão precisa de ao menos uma opção correta.',
  })
  /**
   * Id repetido DENTRO da questão é corrupção, não estilo: a correção casa a
   * resposta enviada por id (`options.some(o => o.id === selected && o.correct)`),
   * então duas opções com o mesmo id fazem a escolha de uma valer pela outra —
   * a resposta conta como certa se QUALQUER das duas estiver marcada como
   * correta. No editor, ainda, as duas mudam juntas ao editar texto ou marcar
   * gabarito, e o React vê chave duplicada.
   *
   * A regra vive aqui, e não só no cliente, porque o servidor não pode
   * depender da disciplina de quem envia — o payload é livre.
   */
  .refine((options) => new Set(options.map((option) => option.id)).size === options.length, {
    message: 'As opções da questão não podem repetir o mesmo identificador.',
  })

/** Opção de resposta sem o gabarito — a única forma que chega a quem responde. */
export interface QuizOptionForRespondent {
  id: string
  text: string
}

export interface CourseQuizDTO {
  id: string
  courseId: string
  /** Nulo = quiz final do curso; preenchido = quiz daquela aula. */
  lessonId: string | null
  title: string
  passingScore: number
  /** Nulo = tentativas ilimitadas. */
  maxAttempts: number | null
  questionCount: number
}

/** Questão como a autoria vê: com o gabarito e a explicação. */
export interface QuizQuestionForAuthorDTO {
  id: string
  statement: string
  options: QuizOption[]
  explanation: string | null
  sortOrder: number
}

/** Questão como quem responde vê: sem gabarito, sem explicação. */
export interface QuizQuestionForRespondentDTO {
  id: string
  statement: string
  options: QuizOptionForRespondent[]
  sortOrder: number
}

/** Quiz devolvido a quem vai responder: metadados + questões sem gabarito. */
export interface QuizForRespondentDTO {
  id: string
  courseId: string
  lessonId: string | null
  title: string
  passingScore: number
  maxAttempts: number | null
  /**
   * Tentativas que a pessoa já usou neste quiz. Não é histórico (nem nota nem
   * resposta anterior vazam aqui) — é só a contagem, para a tela dizer quantas
   * restam ANTES do primeiro envio da sessão. Sem isso, quem usou 2 de 3 e
   * recarregava a página lia "3 restantes" e levava um 409 na cara.
   */
  attemptsUsed: number
  /** Tentativas restantes; `null` = ilimitadas (espelha `maxAttempts` nulo). */
  attemptsLeft: number | null
  questions: QuizQuestionForRespondentDTO[]
}

/** Feedback de uma questão após a correção da tentativa. */
export interface QuizQuestionFeedbackDTO {
  questionId: string
  correct: boolean
  explanation: string | null
}

/** Resultado de uma tentativa, devolvido logo após a submissão. */
export interface QuizAttemptResultDTO {
  score: number
  passed: boolean
  attemptNumber: number
  /** Nulo = tentativas ilimitadas. */
  attemptsLeft: number | null
  feedback: QuizQuestionFeedbackDTO[]
}

/** Resposta escolhida para uma questão, enviada por quem responde. */
export interface SubmitQuizAttemptAnswer {
  questionId: string
  optionId: string
}

/** Corpo de `POST /learning/quizzes/:id/attempts`. */
export interface SubmitQuizAttemptRequest {
  answers: SubmitQuizAttemptAnswer[]
}

/** `GET /learning/quizzes/:id` — quiz como quem responde vê, sem gabarito. */
export interface QuizForRespondentResponse {
  quiz: QuizForRespondentDTO
}

/** `POST /learning/quizzes/:id/attempts`. */
export interface QuizAttemptResultResponse {
  result: QuizAttemptResultDTO
}

// ---------------------------------------------------------------------------
// Autoria (admin/subadmin, escopado pelo curso)
// ---------------------------------------------------------------------------

export interface CreateQuizRequest {
  /** Omitido/nulo = quiz final do curso; preenchido = quiz daquela aula. */
  lessonId?: string | null
  title: string
  passingScore?: number
  maxAttempts?: number | null
}

export type UpdateQuizRequest = Partial<CreateQuizRequest>

export interface CreateQuizQuestionRequest {
  statement: string
  options: QuizOption[]
  explanation?: string | null
}

/**
 * `sortOrder` NÃO faz parte deste contrato de propósito: a única forma de
 * mudar a posição de uma questão é `ReorderQuizQuestionsRequest`, que exige a
 * lista completa de ids. Um `sortOrder` solto por id, sem constraint única no
 * banco (`quizId, sortOrder`), empataria posições sem nada pra barrar — ver
 * `updateQuestion` em `course-quiz-service.ts`.
 */
export type UpdateQuizQuestionRequest = Partial<CreateQuizQuestionRequest>

/** Nova ordem completa das questões: a posição no array vira o `sortOrder`. */
export interface ReorderQuizQuestionsRequest {
  ids: string[]
}

/** `GET /admin/courses/:id/quizzes` — quiz final (se houver) + um por aula que tiver. */
export interface CourseQuizListResponse {
  quizzes: CourseQuizDTO[]
}

/** `POST /admin/courses/:id/quizzes` e `PATCH /admin/course-quizzes/:id`. */
export interface CourseQuizResponse {
  quiz: CourseQuizDTO
}

/** `GET /admin/course-quizzes/:id` — quiz + questões, visão de autoria (com gabarito). */
export interface CourseQuizWithQuestionsResponse {
  quiz: CourseQuizDTO
  questions: QuizQuestionForAuthorDTO[]
}

/** `POST /admin/course-quizzes/:id/questions` e `PATCH /admin/course-questions/:id`. */
export interface QuizQuestionResponse {
  question: QuizQuestionForAuthorDTO
}
