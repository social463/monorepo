import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  COMPETENCY_DESCRIPTION_MAX_LENGTH,
  COMPETENCY_NAME_MAX_LENGTH,
  COURSE_CATEGORY_NAME_MAX_LENGTH,
  courseLessonBlocksSchema,
  INSTRUCTOR_BIO_MAX_LENGTH,
  INSTRUCTOR_NAME_MAX_LENGTH,
  COURSE_RECOMMENDED_FOR,
  COURSE_STATUSES,
  MAX_COURSE_AUDIENCE_SECTORS,
  MAX_COURSE_COMPETENCIES,
  MAX_COURSE_REWARD,
  MAX_COURSE_INSTRUCTORS,
  MAX_INSTRUCTOR_EXPERTISE,
  POSITION_CATEGORIES,
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
  CourseCatalogError,
  createCompetency,
  createCourseCategory,
  createInstructor,
  deleteCompetency,
  deleteCourseCategory,
  deleteInstructor,
  listCompetencies,
  listCourseCategories,
  listInstructors,
  updateCompetency,
  updateCourseCategory,
  updateInstructor,
} from '../services/course-catalog-service'
import { getCourseDashboard } from '../services/course-dashboard-service'
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
  // Id do catálogo (Documento 4, 9.6), e não mais texto livre. Nulo é válido:
  // a categoria deixou de ser obrigatória junto com o texto.
  categoryId: z.string().trim().min(1).nullable().optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  shortDescription: z.string().trim().max(COURSE_SHORT_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  coverUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  competencyIds: z.array(z.string().trim().min(1)).max(MAX_COURSE_COMPETENCIES).optional(),
  objectives: z.array(z.string().trim().max(200)).max(20).optional(),
  prerequisites: z.string().trim().max(500).nullable().optional(),
  // Ordem importa: o primeiro é o instrutor principal, e é o que vai no card.
  instructorIds: z.array(z.string().trim().min(1)).max(MAX_COURSE_INSTRUCTORS).optional(),
  // Público-alvo (seção 9.2). Setor DONO continua em `sectorId`; estes são os
  // que também enxergam.
  bannerUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  introVideoUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  icon: z.string().trim().max(8).nullable().optional(),
  // Hex de 6 dígitos: é o que o `style` da prévia e do card sabem ler.
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional().or(z.literal('')),
  // Teto para o valor não virar erro de digitação com três zeros a mais.
  rewardPoints: z.number().int().min(0).max(MAX_COURSE_REWARD).optional(),
  rewardCoins: z.number().int().min(0).max(MAX_COURSE_REWARD).optional(),
  audienceSectorIds: z.array(z.string().trim().min(1)).max(MAX_COURSE_AUDIENCE_SECTORS).optional(),
  audiencePositionCategories: z.array(z.enum(POSITION_CATEGORIES)).optional(),
  recommendedFor: z.array(z.enum(COURSE_RECOMMENDED_FOR)).optional(),
  autoEnroll: z.boolean().optional(),
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

const updateCourseSchema = courseBodySchema.partial().extend({ status: z.enum(COURSE_STATUSES).optional() })

const moduleSchema = z.object({
  title: z.string().trim().min(1).max(COURSE_TITLE_MAX_LENGTH),
  description: z.string().trim().max(500).nullable().optional(),
})
const updateModuleSchema = moduleSchema.partial().extend({ sortOrder: z.number().int().min(0).optional() })

const lessonSchema = z.object({
  title: z.string().trim().min(1).max(LESSON_TITLE_MAX_LENGTH),
  blocks: courseLessonBlocksSchema.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  durationMinutes: z.number().int().min(0).max(MAX_LESSON_DURATION_MINUTES).optional(),
})
const updateLessonSchema = lessonSchema.partial().extend({ sortOrder: z.number().int().min(0).optional() })

const categorySchema = z.object({
  name: z.string().trim().min(1).max(COURSE_CATEGORY_NAME_MAX_LENGTH),
  icon: z.string().trim().max(8).nullable().optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
  order: z.number().int().min(0).max(999).optional(),
})

const competencySchema = z.object({
  name: z.string().trim().min(1).max(COMPETENCY_NAME_MAX_LENGTH),
  icon: z.string().trim().max(8).nullable().optional(),
  description: z.string().trim().max(COMPETENCY_DESCRIPTION_MAX_LENGTH).nullable().optional(),
})

/**
 * `userId` preenchido = instrutor interno, e aí o nome vem do colaborador. O
 * schema aceita os dois formatos; quem decide qual é qual é o service.
 */
const instructorSchema = z.object({
  userId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().max(INSTRUCTOR_NAME_MAX_LENGTH).nullable().optional(),
  email: z.string().trim().email().max(160).nullable().optional().or(z.literal('')),
  photoUrl: z.string().trim().max(500).nullable().optional().or(z.literal('')),
  bio: z.string().trim().max(INSTRUCTOR_BIO_MAX_LENGTH).nullable().optional(),
  expertise: z.array(z.string().trim().min(1).max(60)).max(MAX_INSTRUCTOR_EXPERTISE).optional(),
})

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
    if (err instanceof CourseCatalogError) return reply.code(err.status).send({ message: err.message })
    throw err
  }

  /**
   * Catálogo da Central de Cursos (Documento 4, seções 9.6 e 9.7). Mesmo gate do
   * resto da autoria: quem administra curso administra o catálogo dele.
   *
   * Três recursos com a mesma forma, então um gerador em vez de trinta linhas
   * repetidas três vezes — o que muda entre eles são os handlers.
   */
  function catalogRoutes<C, U>(
    caminho: string,
    ops: {
      list: (actor: CourseActor) => Promise<unknown>
      create: (actor: CourseActor, data: C) => Promise<unknown>
      update: (actor: CourseActor, id: string, data: U) => Promise<unknown>
      remove: (actor: CourseActor, id: string) => Promise<void>
      createSchema: z.ZodType<C>
      updateSchema: z.ZodType<U>
      chave: string
    },
  ): void {
    app.get(`/admin/${caminho}`, gate, async (request, reply) =>
      reply.send({ [ops.chave]: await ops.list(actorFrom(request)) }),
    )

    app.post(`/admin/${caminho}`, gate, async (request, reply) => {
      const body = ops.createSchema.safeParse(request.body)
      if (!body.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: body.error.flatten() })
      try {
        return reply.code(201).send({ item: await ops.create(actorFrom(request), body.data) })
      } catch (err) {
        return handle(reply, err)
      }
    })

    app.patch(`/admin/${caminho}/:id`, gate, async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params)
      const body = ops.updateSchema.safeParse(request.body)
      if (!params.success || !body.success) return reply.code(400).send({ message: 'Dados inválidos.' })
      try {
        return reply.send({ item: await ops.update(actorFrom(request), params.data.id, body.data) })
      } catch (err) {
        return handle(reply, err)
      }
    })

    app.delete(`/admin/${caminho}/:id`, gate, async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params)
      if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
      try {
        await ops.remove(actorFrom(request), params.data.id)
        return reply.code(204).send()
      } catch (err) {
        return handle(reply, err)
      }
    })
  }

  catalogRoutes('course-categories', {
    chave: 'categories',
    list: listCourseCategories,
    create: createCourseCategory,
    update: updateCourseCategory,
    remove: deleteCourseCategory,
    createSchema: categorySchema,
    updateSchema: categorySchema.partial().extend({ active: z.boolean().optional() }),
  })

  catalogRoutes('competencies', {
    chave: 'competencies',
    list: listCompetencies,
    create: createCompetency,
    update: updateCompetency,
    remove: deleteCompetency,
    createSchema: competencySchema,
    updateSchema: competencySchema.partial().extend({ active: z.boolean().optional() }),
  })

  catalogRoutes('instructors', {
    chave: 'instructors',
    list: listInstructors,
    create: createInstructor,
    update: updateInstructor,
    remove: deleteInstructor,
    createSchema: instructorSchema,
    updateSchema: instructorSchema.partial().extend({ active: z.boolean().optional() }),
  })

  /** Indicadores da Central de Cursos (Documento 4, seção 9.6 — Dashboard). */
  app.get('/admin/courses/dashboard', gate, async (request, reply) => {
    return reply.send({ dashboard: await getCourseDashboard(actorFrom(request)) })
  })

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
