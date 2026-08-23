import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  COURSE_CATEGORY_MAX_LENGTH,
  COURSE_LESSON_TYPES,
  COURSE_LEVELS,
  COURSE_SHORT_DESCRIPTION_MAX_LENGTH,
  COURSE_TITLE_MAX_LENGTH,
  LESSON_TITLE_MAX_LENGTH,
  MAX_LESSON_DURATION_MINUTES,
  QUIZ_MAX_PASSING_SCORE,
  QUIZ_MIN_PASSING_SCORE,
  QUIZ_STATEMENT_MAX_LENGTH,
  quizOptionsSchema,
} from '@legends/shared'
import {
  CourseAdminError,
  createCourse,
  createLesson,
  createModule,
  deleteCourse,
  deleteLesson,
  deleteModule,
  getCourseForAdmin,
  listCoursesForAdmin,
  updateCourse,
  updateLesson,
  updateModule,
  type CourseActor,
} from '../services/course-admin-service'
import {
  createQuestion,
  createQuiz,
  deleteQuestion,
  deleteQuiz,
  getQuizForAuthor,
  listQuizzesForCourse,
  reorderQuestions,
  updateQuestion,
  updateQuiz,
} from '../services/course-quiz-service'

/** Ator da mutação/consulta: id, papel e setor de quem faz a chamada. */
function actorFrom(request: FastifyRequest): CourseActor {
  return {
    id: request.user.sub,
    role: request.user.role,
    sectorId: request.user.sectorId,
    companyId: request.user.companyId,
  }
}

const idParamsSchema = z.object({ id: z.string().min(1) })

const courseBodySchema = z.object({
  title: z.string().trim().min(1).max(COURSE_TITLE_MAX_LENGTH),
  category: z.string().trim().min(1).max(COURSE_CATEGORY_MAX_LENGTH),
  level: z.enum(COURSE_LEVELS).optional(),
  shortDescription: z.string().trim().max(COURSE_SHORT_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  coverUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  competencies: z.array(z.string().trim().max(80)).max(20).optional(),
  objectives: z.array(z.string().trim().max(200)).max(20).optional(),
  prerequisites: z.string().trim().max(500).nullable().optional(),
  instructorName: z.string().trim().max(120).nullable().optional(),
  instructorBio: z.string().trim().max(500).nullable().optional(),
  mandatory: z.boolean().optional(),
  certificateEnabled: z.boolean().optional(),
  // Liga a fila de aprovação deste curso: concluir cria uma solicitação
  // PENDENTE em vez de emitir o certificado na hora.
  requiresCertificateApproval: z.boolean().optional(),
  // Modelo visual do certificado; nulo (ou '') volta ao `isDefault` da empresa.
  // Que o modelo é da mesma empresa quem confere é o service — igual a `sectorId`.
  certificateTemplateId: z.string().trim().min(1).nullable().optional().or(z.literal('')),
  // Nulo (ou '', que `emptyToNull` converte) = curso da empresa toda. Pedido de
  // SUBADMIN para outro setor é ignorado pelo service, não recusado aqui — ver
  // `course-admin-service.ts`.
  sectorId: z.string().trim().min(1).nullable().optional().or(z.literal('')),
})

const updateCourseSchema = courseBodySchema.partial().extend({ published: z.boolean().optional() })

const moduleSchema = z.object({
  title: z.string().trim().min(1).max(COURSE_TITLE_MAX_LENGTH),
  description: z.string().trim().max(500).nullable().optional(),
})
const updateModuleSchema = moduleSchema.partial().extend({ sortOrder: z.number().int().min(0).optional() })

const lessonSchema = z.object({
  title: z.string().trim().min(1).max(LESSON_TITLE_MAX_LENGTH),
  type: z.enum(COURSE_LESSON_TYPES),
  description: z.string().trim().max(500).nullable().optional(),
  // Aceita o link como se copia do navegador; a normalização para embed é do player.
  videoUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  contentHtml: z.string().trim().max(20000).nullable().optional(),
  durationMinutes: z.number().int().min(0).max(MAX_LESSON_DURATION_MINUTES).optional(),
})
const updateLessonSchema = lessonSchema.partial().extend({ sortOrder: z.number().int().min(0).optional() })

const quizBodySchema = z.object({
  // Omitido/nulo = quiz final do curso; preenchido = quiz daquela aula.
  lessonId: z.string().trim().min(1).nullable().optional(),
  // Mesmo teto de `courseBodySchema.title`/`moduleSchema.title` — reusado
  // aqui pelo mesmo motivo que `moduleSchema` reusa: `CourseQuiz.title` é
  // `String` (text) no Postgres, sem limite do banco.
  title: z.string().trim().min(1).max(COURSE_TITLE_MAX_LENGTH),
  passingScore: z.number().int().min(QUIZ_MIN_PASSING_SCORE).max(QUIZ_MAX_PASSING_SCORE).optional(),
  maxAttempts: z.number().int().min(1).nullable().optional(),
})
const updateQuizSchema = quizBodySchema.partial()

// `options` usa `quizOptionsSchema` do shared — não uma regra escrita à mão
// aqui — para o 400 vir da mesma fonte de verdade que a validação do service.
const questionBodySchema = z.object({
  statement: z.string().trim().min(1).max(QUIZ_STATEMENT_MAX_LENGTH),
  options: quizOptionsSchema,
  explanation: z.string().trim().max(QUIZ_STATEMENT_MAX_LENGTH).nullable().optional(),
})
// NOTA: `sortOrder` não entra aqui de propósito — ver a remoção do campo em
// `UpdateQuizQuestionRequest` (`@legends/shared`, Task 6). A única forma de
// mudar posição é `PUT /admin/course-quizzes/:id/questions/order`.
const updateQuestionSchema = questionBodySchema.partial()

const reorderQuestionsSchema = z.object({ ids: z.array(z.string().min(1)) })

/** `''` de campo opcional do formulário vira `null` no banco. */
function emptyToNull<T extends Record<string, unknown>>(data: T): T {
  const entries = Object.entries(data).map(([key, value]) => [key, value === '' ? null : value])
  return Object.fromEntries(entries) as T
}

export async function coursesAdminRoutes(app: FastifyInstance) {
  // Gestão do catálogo é área de Gente e Gestão. O consumo dos cursos pelo
  // colaborador continua na feature `aprendizado`, em routes/learning.ts.
  const gate = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  function handle(reply: { code: (n: number) => { send: (body: unknown) => unknown } }, err: unknown): unknown {
    if (err instanceof CourseAdminError) return reply.code(err.status).send({ message: err.message })
    throw err
  }

  app.get('/admin/courses', gate, async (request, reply) => {
    return reply.send({ courses: await listCoursesForAdmin(actorFrom(request)) })
  })

  app.get('/admin/courses/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      return reply.send({ course: await getCourseForAdmin(actorFrom(request), params.data.id) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/admin/courses', gate, async (request, reply) => {
    const body = courseBodySchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: body.error.flatten() })
    try {
      const course = await createCourse({
        data: emptyToNull(body.data),
        actor: actorFrom(request),
      })
      return reply.code(201).send({ course })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/admin/courses/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = updateCourseSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      const course = await updateCourse({
        courseId: params.data.id,
        data: emptyToNull(body.data),
        actor: actorFrom(request),
      })
      return reply.send({ course })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/admin/courses/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      await deleteCourse({ courseId: params.data.id, actor: actorFrom(request) })
      return reply.code(204).send()
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/admin/courses/:id/modules', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = moduleSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const course = await createModule({
        courseId: params.data.id,
        data: emptyToNull(body.data),
        actor: actorFrom(request),
      })
      return reply.code(201).send({ course })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/admin/course-modules/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = updateModuleSchema.safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const course = await updateModule({
        moduleId: params.data.id,
        data: emptyToNull(body.data),
        actor: actorFrom(request),
      })
      return reply.send({ course })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/admin/course-modules/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const course = await deleteModule({ moduleId: params.data.id, actor: actorFrom(request) })
      return reply.send({ course })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/admin/course-modules/:id/lessons', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = lessonSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      const course = await createLesson({
        moduleId: params.data.id,
        data: emptyToNull(body.data),
        actor: actorFrom(request),
      })
      return reply.code(201).send({ course })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/admin/course-lessons/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = updateLessonSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      const course = await updateLesson({
        lessonId: params.data.id,
        data: emptyToNull(body.data),
        actor: actorFrom(request),
      })
      return reply.send({ course })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/admin/course-lessons/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const course = await deleteLesson({ lessonId: params.data.id, actor: actorFrom(request) })
      return reply.send({ course })
    } catch (err) {
      return handle(reply, err)
    }
  })

  // Quiz final do curso (se houver) + um por aula que tiver — a autoria web
  // usa esta lista pra saber se já existe quiz a editar antes de tentar criar
  // outro (criar um segundo quiz final, ou um segundo de uma aula que já tem,
  // é 409 no POST abaixo).
  app.get('/admin/courses/:id/quizzes', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      return reply.send({ quizzes: await listQuizzesForCourse(actorFrom(request), params.data.id) })
    } catch (err) {
      return handle(reply, err)
    }
  })

  // Quiz final do curso (lessonId omitido/nulo) ou de aula (lessonId no corpo).
  app.post('/admin/courses/:id/quizzes', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = quizBodySchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      const quiz = await createQuiz({ courseId: params.data.id, data: body.data, actor: actorFrom(request) })
      return reply.code(201).send({ quiz })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.get('/admin/course-quizzes/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const { quiz, questions } = await getQuizForAuthor(actorFrom(request), params.data.id)
      return reply.send({ quiz, questions })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/admin/course-quizzes/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = updateQuizSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      const quiz = await updateQuiz({ quizId: params.data.id, data: body.data, actor: actorFrom(request) })
      return reply.send({ quiz })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/admin/course-quizzes/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      await deleteQuiz({ quizId: params.data.id, actor: actorFrom(request) })
      return reply.code(204).send()
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/admin/course-quizzes/:id/questions', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = questionBodySchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      const question = await createQuestion({ quizId: params.data.id, data: body.data, actor: actorFrom(request) })
      return reply.code(201).send({ question })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/admin/course-questions/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = updateQuestionSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      const question = await updateQuestion({ questionId: params.data.id, data: body.data, actor: actorFrom(request) })
      return reply.send({ question })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/admin/course-questions/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      await deleteQuestion({ questionId: params.data.id, actor: actorFrom(request) })
      return reply.code(204).send()
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.put('/admin/course-quizzes/:id/questions/order', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = reorderQuestionsSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      await reorderQuestions({ quizId: params.data.id, data: body.data, actor: actorFrom(request) })
      return reply.code(204).send()
    } catch (err) {
      return handle(reply, err)
    }
  })
}
