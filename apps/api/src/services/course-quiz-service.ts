import { Prisma, type CourseQuestion, type CourseQuiz, type QuizAttempt } from '@prisma/client'
import {
  quizOptionsSchema,
  QUIZ_MAX_PASSING_SCORE,
  QUIZ_MIN_PASSING_SCORE,
  type CourseQuizDTO,
  type CreateQuizQuestionRequest,
  type CreateQuizRequest,
  type QuizAttemptResultDTO,
  type QuizForRespondentDTO,
  type QuizOption,
  type QuizOptionForRespondent,
  type QuizQuestionFeedbackDTO,
  type QuizQuestionForAuthorDTO,
  type QuizQuestionForRespondentDTO,
  type ReorderQuizQuestionsRequest,
  type SubmitQuizAttemptRequest,
  type UpdateQuizQuestionRequest,
  type UpdateQuizRequest,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'
import { CourseAdminError, readableCourseWhere, writableCourseWhere, type CourseActor } from './course-admin-service'
import { issueCertificate, LearningError, viewerSectorId, visibleCourseWhere, type Viewer } from './learning-service'

/**
 * Autoria de quiz (de aula e final) e de questões, e a resposta (consumo) do
 * quiz por quem faz o curso. Escopo por setor da autoria vem inteiramente da
 * Task 4: todo `findFirst` que precede uma mutação passa por
 * `writableCourseWhere` — via `quiz.course` ou `question.quiz.course` — nunca
 * por `readableCourseWhere`. Ver o mesmo raciocínio no topo de
 * `course-admin-service.ts`.
 *
 * A seção "Responder", no fim do arquivo, é a fatia de consumo: usa o recorte
 * de leitura de `learning-service.ts` (`visibleCourseWhere`/`viewerSectorId`),
 * não `readableCourseWhere` — este é escopo de autoria (admin/subadmin), não
 * de quem só faz o curso.
 */

function toCourseQuizDTO(quiz: CourseQuiz, questionCount: number): CourseQuizDTO {
  return {
    id: quiz.id,
    courseId: quiz.courseId,
    lessonId: quiz.lessonId,
    title: quiz.title,
    passingScore: quiz.passingScore,
    maxAttempts: quiz.maxAttempts,
    questionCount,
  }
}

function toQuizQuestionForAuthorDTO(question: CourseQuestion): QuizQuestionForAuthorDTO {
  return {
    id: question.id,
    statement: question.statement,
    options: question.options as unknown as QuizOption[],
    explanation: question.explanation,
    sortOrder: question.sortOrder,
  }
}

/**
 * Questão como quem responde vê: monta cada opção pegando SÓ `id`/`text`, nunca
 * `question.options as unknown as QuizOptionForRespondent[]` — `options` é uma
 * coluna `Json` com o gabarito dentro (`correct`); um cast direto (ou um
 * spread) deixaria o campo passar sem erro de tipo e vazaria a resposta certa.
 * Mesma lógica para a questão: sem `explanation` no objeto devolvido.
 */
function toQuizQuestionForRespondentDTO(question: CourseQuestion): QuizQuestionForRespondentDTO {
  const options = question.options as unknown as QuizOption[]
  return {
    id: question.id,
    statement: question.statement,
    options: options.map((option): QuizOptionForRespondent => ({ id: option.id, text: option.text })),
    sortOrder: question.sortOrder,
  }
}

/** `max(sortOrder) + 1` dentro do pai — nunca `count()` (colide após apagar item do meio). */
function nextSortOrder(rows: { sortOrder: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1
}

function validatePassingScore(passingScore: number): void {
  if (!Number.isInteger(passingScore) || passingScore < QUIZ_MIN_PASSING_SCORE || passingScore > QUIZ_MAX_PASSING_SCORE) {
    throw new CourseAdminError(`A nota de aprovação precisa ser de ${QUIZ_MIN_PASSING_SCORE} a ${QUIZ_MAX_PASSING_SCORE}.`)
  }
}

function validateMaxAttempts(maxAttempts: number | null | undefined): void {
  if (maxAttempts === undefined || maxAttempts === null) return
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new CourseAdminError('O número máximo de tentativas precisa ser nulo (ilimitado) ou maior ou igual a 1.')
  }
}

function parseOptionsOrThrow(options: QuizOption[]): QuizOption[] {
  const parsed = quizOptionsSchema.safeParse(options)
  if (!parsed.success) {
    throw new CourseAdminError(parsed.error.issues[0]?.message ?? 'Opções da questão inválidas.')
  }
  return parsed.data
}

/** Confere que o curso existe e é alcançável em ESCRITA — sem carregar módulos/aulas. */
async function assertCourseWritable(actor: CourseActor, courseId: string): Promise<void> {
  const course = await scopedPrisma(actor.companyId).course.findFirst({ where: writableCourseWhere(actor, { id: courseId }) })
  if (!course) throw new CourseAdminError('Curso não encontrado.', 404)
}

async function assertLessonBelongsToCourse(
  db: ReturnType<typeof scopedPrisma>,
  courseId: string,
  lessonId: string,
): Promise<void> {
  const lesson = await db.courseLesson.findFirst({ where: { id: lessonId, courseId } })
  if (!lesson) throw new CourseAdminError('Aula não encontrada neste curso.', 400)
}

/**
 * "Um quiz final por curso" não é coberto pelo índice único (`lessonId` nullable
 * aceita vários `NULL`) — é regra de service. `excludeQuizId` serve ao update
 * (mover um quiz de aula pra final não deve trombar com ele mesmo).
 */
async function assertNoOtherFinalQuiz(
  db: ReturnType<typeof scopedPrisma>,
  courseId: string,
  excludeQuizId?: string,
): Promise<void> {
  const existing = await db.courseQuiz.findFirst({
    where: { courseId, lessonId: null, ...(excludeQuizId ? { id: { not: excludeQuizId } } : {}) },
  })
  if (existing) throw new CourseAdminError('Este curso já tem um quiz final.', 409)
}

/** Busca de ESCRITA: resolve o quiz via o recorte de setor do curso dono. */
async function findQuizForWrite(actor: CourseActor, quizId: string): Promise<CourseQuiz> {
  const quiz = await scopedPrisma(actor.companyId).courseQuiz.findFirst({
    where: { id: quizId, course: writableCourseWhere(actor) },
  })
  if (!quiz) throw new CourseAdminError('Quiz não encontrado.', 404)
  return quiz
}

/** Busca de LEITURA: usa `readableCourseWhere` — SUBADMIN também vê quiz de curso sem setor. */
async function findQuizReadable(actor: CourseActor, quizId: string): Promise<CourseQuiz> {
  const quiz = await scopedPrisma(actor.companyId).courseQuiz.findFirst({
    where: { id: quizId, course: readableCourseWhere(actor) },
  })
  if (!quiz) throw new CourseAdminError('Quiz não encontrado.', 404)
  return quiz
}

/** Mesma lógica de `findQuizForWrite`, resolvendo a questão pelo quiz dono. */
async function findQuestionForWrite(actor: CourseActor, questionId: string): Promise<CourseQuestion> {
  const question = await scopedPrisma(actor.companyId).courseQuestion.findFirst({
    where: { id: questionId, quiz: { course: writableCourseWhere(actor) } },
  })
  if (!question) throw new CourseAdminError('Questão não encontrada.', 404)
  return question
}

function isP2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

export async function listQuizzesForCourse(actor: CourseActor, courseId: string): Promise<CourseQuizDTO[]> {
  const db = scopedPrisma(actor.companyId)
  const course = await db.course.findFirst({ where: readableCourseWhere(actor, { id: courseId }) })
  if (!course) throw new CourseAdminError('Curso não encontrado.', 404)

  const quizzes = await db.courseQuiz.findMany({
    where: { courseId },
    include: { _count: { select: { questions: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return quizzes.map((quiz) => toCourseQuizDTO(quiz, quiz._count.questions))
}

export async function getQuizForAuthor(
  actor: CourseActor,
  quizId: string,
): Promise<{ quiz: CourseQuizDTO; questions: QuizQuestionForAuthorDTO[] }> {
  const quiz = await findQuizReadable(actor, quizId)
  const questions = await scopedPrisma(actor.companyId).courseQuestion.findMany({
    where: { quizId },
    orderBy: { sortOrder: 'asc' },
  })
  return { quiz: toCourseQuizDTO(quiz, questions.length), questions: questions.map(toQuizQuestionForAuthorDTO) }
}

export async function createQuiz(input: {
  courseId: string
  data: CreateQuizRequest
  actor: CourseActor
}): Promise<CourseQuizDTO> {
  const db = scopedPrisma(input.actor.companyId)
  await assertCourseWritable(input.actor, input.courseId)

  const title = input.data.title.trim()
  if (!title) throw new CourseAdminError('Informe o título do quiz.')
  const passingScore = input.data.passingScore ?? 70
  validatePassingScore(passingScore)
  validateMaxAttempts(input.data.maxAttempts)
  const lessonId = input.data.lessonId ?? null

  if (lessonId === null) {
    await assertNoOtherFinalQuiz(db, input.courseId)
  } else {
    await assertLessonBelongsToCourse(db, input.courseId, lessonId)
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const quiz = await tx.courseQuiz.create({
        data: { courseId: input.courseId, lessonId, title, passingScore, maxAttempts: input.data.maxAttempts ?? null },
      })
      await recordAuditLog({
        actorId: input.actor.id,
        entityType: 'CourseQuiz',
        entityId: quiz.id,
        action: 'CREATE',
        after: quiz,
        companyId: input.actor.companyId,
        tx: tx as unknown as Prisma.TransactionClient,
      })
      return quiz
    })
    return toCourseQuizDTO(created, 0)
  } catch (err) {
    if (isP2002(err)) throw new CourseAdminError('Esta aula já tem um quiz.', 409)
    throw err
  }
}

export async function updateQuiz(input: {
  quizId: string
  data: UpdateQuizRequest
  actor: CourseActor
}): Promise<CourseQuizDTO> {
  const db = scopedPrisma(input.actor.companyId)
  const before = await findQuizForWrite(input.actor, input.quizId)

  const data: Prisma.CourseQuizUncheckedUpdateInput = {}
  if (input.data.title !== undefined) {
    const title = input.data.title.trim()
    if (!title) throw new CourseAdminError('Informe o título do quiz.')
    data.title = title
  }
  if (input.data.passingScore !== undefined) {
    validatePassingScore(input.data.passingScore)
    data.passingScore = input.data.passingScore
  }
  if (input.data.maxAttempts !== undefined) {
    validateMaxAttempts(input.data.maxAttempts)
    data.maxAttempts = input.data.maxAttempts
  }
  if (input.data.lessonId !== undefined) {
    const lessonId = input.data.lessonId
    if (lessonId === null) {
      await assertNoOtherFinalQuiz(db, before.courseId, before.id)
    } else {
      await assertLessonBelongsToCourse(db, before.courseId, lessonId)
    }
    data.lessonId = lessonId
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const quiz = await tx.courseQuiz.update({ where: { id: input.quizId }, data })
      await recordAuditLog({
        actorId: input.actor.id,
        entityType: 'CourseQuiz',
        entityId: input.quizId,
        action: 'UPDATE',
        before,
        after: quiz,
        companyId: input.actor.companyId,
        tx: tx as unknown as Prisma.TransactionClient,
      })
      return quiz
    })
    const questionCount = await db.courseQuestion.count({ where: { quizId: input.quizId } })
    return toCourseQuizDTO(updated, questionCount)
  } catch (err) {
    if (isP2002(err)) throw new CourseAdminError('Esta aula já tem um quiz.', 409)
    throw err
  }
}

export async function deleteQuiz(input: { quizId: string; actor: CourseActor }): Promise<void> {
  const db = scopedPrisma(input.actor.companyId)
  const before = await findQuizForWrite(input.actor, input.quizId)
  await db.$transaction(async (tx) => {
    // As questões (e tentativas) saem junto (onDelete: Cascade).
    await tx.courseQuiz.delete({ where: { id: input.quizId } })
    await recordAuditLog({
      actorId: input.actor.id,
      entityType: 'CourseQuiz',
      entityId: input.quizId,
      action: 'DELETE',
      before,
      companyId: input.actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}

// ---------------------------------------------------------------------------
// Questões
// ---------------------------------------------------------------------------

export async function createQuestion(input: {
  quizId: string
  data: CreateQuizQuestionRequest
  actor: CourseActor
}): Promise<QuizQuestionForAuthorDTO> {
  const db = scopedPrisma(input.actor.companyId)
  await findQuizForWrite(input.actor, input.quizId)

  const statement = input.data.statement.trim()
  if (!statement) throw new CourseAdminError('Informe o enunciado da questão.')
  const options = parseOptionsOrThrow(input.data.options)

  const siblings = await db.courseQuestion.findMany({ where: { quizId: input.quizId }, select: { sortOrder: true } })
  const sortOrder = nextSortOrder(siblings)

  const created = await db.$transaction(async (tx) => {
    const question = await tx.courseQuestion.create({
      data: {
        quizId: input.quizId,
        statement,
        options: options as unknown as Prisma.InputJsonValue,
        explanation: input.data.explanation?.trim() || null,
        sortOrder,
      },
    })
    await recordAuditLog({
      actorId: input.actor.id,
      entityType: 'CourseQuestion',
      entityId: question.id,
      action: 'CREATE',
      after: question,
      companyId: input.actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return question
  })
  return toQuizQuestionForAuthorDTO(created)
}

export async function updateQuestion(input: {
  questionId: string
  data: UpdateQuizQuestionRequest
  actor: CourseActor
}): Promise<QuizQuestionForAuthorDTO> {
  const db = scopedPrisma(input.actor.companyId)
  const before = await findQuestionForWrite(input.actor, input.questionId)

  const data: Prisma.CourseQuestionUpdateInput = {}
  if (input.data.statement !== undefined) {
    const statement = input.data.statement.trim()
    if (!statement) throw new CourseAdminError('Informe o enunciado da questão.')
    data.statement = statement
  }
  if (input.data.options !== undefined) {
    data.options = parseOptionsOrThrow(input.data.options) as unknown as Prisma.InputJsonValue
  }
  if (input.data.explanation !== undefined) data.explanation = input.data.explanation?.trim() || null
  // `sortOrder` NÃO é aceito aqui de propósito, e foi removido de
  // `UpdateQuizQuestionRequest` (Task 6, antes constava lá desde a Task 2): a
  // única forma de mudar posição é `reorderQuestions`, que exige a lista
  // completa de ids. `CourseQuestion` não tem `@@unique([quizId, sortOrder])`
  // — um `sortOrder` solto e por id aceito aqui empataria posições sem o
  // banco reclamar, e a ordem que `getQuizForAuthor`/quem responde vê
  // passaria a depender de desempate não garantido pelo Postgres entre
  // leituras.

  const updated = await db.$transaction(async (tx) => {
    const question = await tx.courseQuestion.update({ where: { id: input.questionId }, data })
    await recordAuditLog({
      actorId: input.actor.id,
      entityType: 'CourseQuestion',
      entityId: input.questionId,
      action: 'UPDATE',
      before,
      after: question,
      companyId: input.actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return question
  })
  return toQuizQuestionForAuthorDTO(updated)
}

export async function deleteQuestion(input: { questionId: string; actor: CourseActor }): Promise<void> {
  const db = scopedPrisma(input.actor.companyId)
  const before = await findQuestionForWrite(input.actor, input.questionId)
  await db.$transaction(async (tx) => {
    await tx.courseQuestion.delete({ where: { id: input.questionId } })
    await recordAuditLog({
      actorId: input.actor.id,
      entityType: 'CourseQuestion',
      entityId: input.questionId,
      action: 'DELETE',
      before,
      companyId: input.actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}

/**
 * Reordena todas as questões de um quiz. Exige a lista COMPLETA de ids do
 * quiz — nada de aceitar um subconjunto e completar o resto por trás.
 *
 * A checagem de validade tem três partes, e as três importam:
 *  1. `ids.length === existing.length` — pega id faltando ou sobrando.
 *  2. `new Set(ids).size === ids.length` — pega id repetido. Sem isso,
 *     `[a,a,b,c]` (existing = {a,b,c,d}) passa pela checagem de tamanho E,
 *     se comparado por conjunto deduplicado, também passaria pela de
 *     pertencimento — o duplicado "cobre" o buraco deixado pelo item que
 *     sumiu (`d`) e corrompe a ordem ao gravar.
 *  3. `ids.every(existingIds.has)` — pega id de outro pai (outro quiz).
 */
export async function reorderQuestions(input: {
  quizId: string
  data: ReorderQuizQuestionsRequest
  actor: CourseActor
}): Promise<QuizQuestionForAuthorDTO[]> {
  const db = scopedPrisma(input.actor.companyId)
  await findQuizForWrite(input.actor, input.quizId)

  const existing = await db.courseQuestion.findMany({ where: { quizId: input.quizId }, select: { id: true } })
  const existingIds = new Set(existing.map((row) => row.id))
  const incomingIds = input.data.ids

  const isValid =
    incomingIds.length === existingIds.size &&
    new Set(incomingIds).size === incomingIds.length &&
    incomingIds.every((id) => existingIds.has(id))

  if (!isValid) {
    throw new CourseAdminError('A ordem enviada não corresponde aos itens atuais. Recarregue a página.', 400)
  }

  const reordered = await db.$transaction(async (tx) => {
    for (const [index, id] of incomingIds.entries()) {
      await tx.courseQuestion.update({ where: { id }, data: { sortOrder: index } })
    }
    // Evento em lote (mexe em várias questões de uma vez): a entidade auditada
    // é o quiz dono, não uma questão individual — `entityId` de uma
    // `CourseQuestion` que não existe seria enganoso.
    await recordAuditLog({
      actorId: input.actor.id,
      entityType: 'CourseQuiz',
      entityId: input.quizId,
      action: 'UPDATE',
      after: { reorderedQuestionIds: incomingIds },
      companyId: input.actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return tx.courseQuestion.findMany({ where: { quizId: input.quizId }, orderBy: { sortOrder: 'asc' } })
  })
  return reordered.map(toQuizQuestionForAuthorDTO)
}

// ---------------------------------------------------------------------------
// Responder (consumo, não autoria) — recorte de leitura vem de
// `visibleCourseWhere`/`viewerSectorId` (learning-service), o mesmo usado no
// resto do consumo de curso: publicado + (sem setor OU setor da pessoa). Exige
// inscrição no curso — sem ela, tratado como inexistente (404), igual ao
// recorte por setor: nunca 403, pra não confirmar que o quiz existe.
// ---------------------------------------------------------------------------

/** Resolve o quiz alcançável em LEITURA de consumo + confere inscrição no curso dono. */
async function findQuizForRespondent(viewer: Viewer, quizId: string): Promise<CourseQuiz> {
  const db = scopedPrisma(viewer.companyId)
  const sectorId = await viewerSectorId(viewer)
  const quiz = await db.courseQuiz.findFirst({ where: { id: quizId, course: visibleCourseWhere(sectorId) } })
  if (!quiz) throw new LearningError('Quiz não encontrado.', 404)

  const enrollment = await db.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: viewer.userId, courseId: quiz.courseId } },
  })
  // Não inscrito é tratado como quiz inexistente — mesma lógica do recorte por
  // setor: não vaza a existência de um quiz de curso fora do alcance da pessoa.
  if (!enrollment) throw new LearningError('Quiz não encontrado.', 404)

  return quiz
}

export async function getQuizForRespondent(viewer: Viewer, quizId: string): Promise<QuizForRespondentDTO> {
  const quiz = await findQuizForRespondent(viewer, quizId)
  const db = scopedPrisma(viewer.companyId)
  const [questions, attemptsUsed] = await Promise.all([
    db.courseQuestion.findMany({ where: { quizId }, orderBy: { sortOrder: 'asc' } }),
    // Só a CONTAGEM das tentativas da própria pessoa — nunca nota ou resposta
    // anterior. É o que a tela precisa para dizer quantas restam antes do
    // primeiro envio da sessão, em vez de repetir o teto (`maxAttempts`) e
    // prometer tentativa que já foi gasta.
    db.quizAttempt.count({ where: { quizId, userId: viewer.userId } }),
  ])
  return {
    id: quiz.id,
    courseId: quiz.courseId,
    lessonId: quiz.lessonId,
    title: quiz.title,
    passingScore: quiz.passingScore,
    maxAttempts: quiz.maxAttempts,
    attemptsUsed,
    attemptsLeft: quiz.maxAttempts === null ? null : Math.max(quiz.maxAttempts - attemptsUsed, 0),
    questions: questions.map(toQuizQuestionForRespondentDTO),
  }
}

/** Tentativas de criação até um `attemptNumber` livre "pegar" — ver nota abaixo sobre concorrência. */
const MAX_ATTEMPT_CREATE_RETRIES = 5

/**
 * Cria a `QuizAttempt` tentando `attemptNumber = count(anteriores) + 1`,
 * recalculado a cada volta. Duas submissões simultâneas da mesma pessoa podem
 * ler a mesma contagem e colidir no `@@unique([quizId, userId, attemptNumber])`
 * — a volta que perde a corrida recebe P2002 (`isP2002`), recalcula a
 * contagem (agora já inclui a tentativa da outra) e tenta de novo com o
 * próximo número. O limite de tentativas é reconferido a cada volta, então a
 * corrida nunca produz uma tentativa além do permitido.
 *
 * As duas decisões do `catch` são independentes e não podem compartilhar uma
 * única condição: erro que não é P2002 sobe imediatamente, sempre — inclusive
 * na última volta. P2002 na última volta não sobe o erro cru do Prisma (viraria
 * 500 no Fastify): encerra o laço com `break`, deixando a função sem `return`,
 * pra cair no 409 genérico depois do laço — nunca um `throw err` do
 * `PrismaClientKnownRequestError`.
 *
 * Extraída da função principal (e exportada) pra ser testável sem precisar
 * forçar `maxRetries` colisões reais de Postgres em série, o que exigiria
 * vencer a corrida contra a própria chamada um número exato de vezes seguidas
 * — impraticável de provocar de propósito. O teste injeta um `createAttempt`
 * que sempre rejeita com P2002 (ou com um erro qualquer, pro caso não-P2002).
 */
export async function createAttemptWithRetry(input: {
  maxAttempts: number | null
  countAttempts: () => Promise<number>
  createAttempt: (attemptNumber: number) => Promise<QuizAttempt>
  maxRetries?: number
}): Promise<QuizAttempt> {
  const maxRetries = input.maxRetries ?? MAX_ATTEMPT_CREATE_RETRIES
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const previousAttempts = await input.countAttempts()
    if (input.maxAttempts !== null && previousAttempts >= input.maxAttempts) {
      throw new LearningError(`Você já usou todas as ${input.maxAttempts} tentativas deste quiz.`, 409)
    }
    try {
      return await input.createAttempt(previousAttempts + 1)
    } catch (err) {
      if (!isP2002(err)) throw err
      if (attempt === maxRetries - 1) break
      // P2002 e ainda há voltas sobrando: recalcula a contagem e tenta de novo.
    }
  }
  // Só chega aqui se `maxRetries` colisões em sequência esgotaram o laço —
  // extremamente improvável; melhor um 409 genérico do que travar.
  throw new LearningError('Não foi possível registrar a tentativa. Tente novamente.', 409)
}

/** Corrige no servidor: nunca confia em `score`/`passed` vindos do corpo — o tipo do parâmetro nem aceita esses campos. */
export async function submitQuizAttempt(
  viewer: Viewer,
  quizId: string,
  data: SubmitQuizAttemptRequest,
): Promise<QuizAttemptResultDTO> {
  const db = scopedPrisma(viewer.companyId)
  const quiz = await findQuizForRespondent(viewer, quizId)
  const questions = await db.courseQuestion.findMany({ where: { quizId }, orderBy: { sortOrder: 'asc' } })
  // Quiz sem questão nenhuma não é respondível: a nota sairia 0 (nada certo
  // sobre nada) e a pessoa veria "Reprovado — 0%" num quiz vazio. Pior no
  // outro extremo: com `passingScore: 0` o vazio APROVA e, num quiz final,
  // valeria certificado sem ninguém responder nada.
  if (questions.length === 0) {
    throw new LearningError('Este quiz ainda não tem questões.', 409)
  }

  const submittedOptionByQuestion = new Map(data.answers.map((answer) => [answer.questionId, answer.optionId]))
  const feedback: QuizQuestionFeedbackDTO[] = []
  let correctCount = 0
  for (const question of questions) {
    const options = question.options as unknown as QuizOption[]
    const selectedOptionId = submittedOptionByQuestion.get(question.id)
    const isCorrect = options.some((option) => option.id === selectedOptionId && option.correct)
    if (isCorrect) correctCount++
    feedback.push({ questionId: question.id, correct: isCorrect, explanation: question.explanation })
  }
  // Divisão segura: a guarda de quiz sem questão já saiu com 409 lá em cima.
  const score = Math.round((correctCount / questions.length) * 100)
  const passed = score >= quiz.passingScore

  const created = await createAttemptWithRetry({
    maxAttempts: quiz.maxAttempts,
    countAttempts: () => db.quizAttempt.count({ where: { quizId, userId: viewer.userId } }),
    createAttempt: (attemptNumber) =>
      db.quizAttempt.create({
        data: {
          quizId,
          userId: viewer.userId,
          attemptNumber,
          score,
          passed,
          answers: data.answers as unknown as Prisma.InputJsonValue,
        },
      }),
  })

  if (passed && quiz.lessonId === null) {
    await tryIssueCertificateAfterFinalQuiz(viewer, quiz.courseId)
  }

  return {
    score,
    passed,
    attemptNumber: created.attemptNumber,
    attemptsLeft: quiz.maxAttempts === null ? null : Math.max(quiz.maxAttempts - created.attemptNumber, 0),
    feedback,
  }
}

/**
 * Segundo gatilho de emissão do certificado, e o único que fecha a ordem
 * natural do curso: concluir as aulas primeiro e passar no quiz final depois.
 * Sem isto, `issueCertificate` só rodava de dentro de `setLessonCompletion`
 * — quem terminasse as aulas antes de passar no quiz final caía na guarda de
 * quiz reprovado (que devolve `null` ANTES da guarda de aprovação, então nem
 * `CertificateRequest` nascia) e nada mais voltava a tentar emitir: o
 * certificado ficava inalcançável até a pessoa desmarcar e remarcar uma aula
 * por acaso.
 *
 * Chamar `issueCertificate` aqui é seguro porque ela é idempotente e
 * reexecuta TODAS as guardas: certificado desligado, inscrição não concluída
 * (o caso comum aqui — quem faz o quiz final antes de terminar as aulas),
 * quiz final ainda não aprovado e aprovação obrigatória (que cria a
 * `CertificateRequest` PENDENTE). Nada é emitido por passar no quiz sozinho.
 *
 * Best-effort, igual à sincronia de selos de `setLessonCompletion`: a
 * tentativa já foi gravada e corrigida quando chegamos aqui — falhar em
 * emitir não pode transformar um envio bem-sucedido em 500 (que gastaria uma
 * tentativa da pessoa sem devolver a nota). A emissão volta a ser tentada no
 * próximo gatilho.
 */
async function tryIssueCertificateAfterFinalQuiz(viewer: Viewer, courseId: string): Promise<void> {
  try {
    const course = await scopedPrisma(viewer.companyId).course.findUnique({ where: { id: courseId } })
    if (!course) return
    await issueCertificate(viewer, course)
  } catch {
    // silencioso de propósito — ver o comentário acima
  }
}
