import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  COURSE_LEVELS,
  MAX_COURSE_RATING,
  MAX_COURSE_RATING_COMMENT_LENGTH,
  MIN_COURSE_RATING,
} from '@legends/shared'
import {
  LearningError,
  enrollInCourse,
  findCertificateByCode,
  getCourseDetail,
  getTrack,
  learningHome,
  listCertificates,
  listCourses,
  listTracks,
  myLearning,
  rateCourse,
  requestCertificate,
  setCourseFavorite,
  setLessonCompletion,
} from '../services/learning-service'
import { getQuizForRespondent, submitQuizAttempt } from '../services/course-quiz-service'
import { toPublicCertificateDTO } from '../lib/serialize-learning'

const catalogQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  competency: z.string().trim().max(80).optional(),
  onlyMandatory: z.coerce.boolean().optional(),
  onlyFavorites: z.coerce.boolean().optional(),
})

const idParamsSchema = z.object({ id: z.string().min(1) })
const codeParamsSchema = z.object({ code: z.string().trim().min(4).max(40) })

const completeLessonSchema = z.object({ completed: z.boolean().default(true) })

const rateCourseSchema = z.object({
  rating: z.number().int().min(MIN_COURSE_RATING).max(MAX_COURSE_RATING),
  comment: z.string().trim().max(MAX_COURSE_RATING_COMMENT_LENGTH).nullable().optional(),
})

const submitQuizAttemptSchema = z.object({
  answers: z.array(z.object({ questionId: z.string().min(1), optionId: z.string().min(1) })),
})

export async function learningRoutes(app: FastifyInstance) {
  const gate = { onRequest: [app.authenticate, app.requireFeature('aprendizado')] }

  app.get('/learning/home', gate, async (request, reply) => {
    const viewer = { userId: request.user.sub, companyId: request.user.companyId }
    return reply.send(await learningHome(viewer))
  })

  app.get('/learning/courses', gate, async (request, reply) => {
    const parsed = catalogQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: parsed.error.flatten() })
    }
    const viewer = { userId: request.user.sub, companyId: request.user.companyId }
    return reply.send(await listCourses(viewer, parsed.data))
  })

  app.get('/learning/courses/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const viewer = { userId: request.user.sub, companyId: request.user.companyId }
      return reply.send({ course: await getCourseDetail(viewer, params.data.id) })
    } catch (err) {
      if (err instanceof LearningError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/learning/courses/:id/enroll', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const viewer = { userId: request.user.sub, companyId: request.user.companyId }
      return reply.code(201).send({ enrollment: await enrollInCourse(viewer, params.data.id) })
    } catch (err) {
      if (err instanceof LearningError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /**
   * Pedido de certificado feito pela pessoa (Documento 4, seção 9.3). Devolve
   * o curso já atualizado para a tela não precisar de um segundo GET só para
   * descobrir em que estado a fila ficou.
   */
  app.post('/learning/courses/:id/certificate-request', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const viewer = { userId: request.user.sub, companyId: request.user.companyId }
      await requestCertificate(viewer, params.data.id)
      return reply.code(201).send({ course: await getCourseDetail(viewer, params.data.id) })
    } catch (err) {
      if (err instanceof LearningError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.put('/learning/lessons/:id/complete', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = completeLessonSchema.safeParse(request.body ?? {})
    if (!params.success || !body.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    try {
      const viewer = { userId: request.user.sub, companyId: request.user.companyId }
      return reply.send(await setLessonCompletion(viewer, params.data.id, body.data.completed))
    } catch (err) {
      if (err instanceof LearningError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /**
   * Quiz como quem responde vê: sem `correct` nem `explanation` — o service
   * devolve `QuizForRespondentDTO`, o único formato aceito aqui. Exige
   * inscrição no curso dono (e o recorte por setor de `visibleCourseWhere`);
   * sem qualquer um dos dois, o service já responde 404.
   */
  app.get('/learning/quizzes/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const viewer = { userId: request.user.sub, companyId: request.user.companyId }
      return reply.send({ quiz: await getQuizForRespondent(viewer, params.data.id) })
    } catch (err) {
      if (err instanceof LearningError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /** Correção é sempre no servidor — o corpo só traz as respostas escolhidas, nunca nota. */
  app.post('/learning/quizzes/:id/attempts', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = submitQuizAttemptSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      const viewer = { userId: request.user.sub, companyId: request.user.companyId }
      return reply.code(201).send({ result: await submitQuizAttempt(viewer, params.data.id, body.data) })
    } catch (err) {
      if (err instanceof LearningError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.put('/learning/courses/:id/rating', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = rateCourseSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      const viewer = { userId: request.user.sub, companyId: request.user.companyId }
      return reply.send(await rateCourse(viewer, params.data.id, body.data))
    } catch (err) {
      if (err instanceof LearningError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.put('/learning/courses/:id/favorite', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const viewer = { userId: request.user.sub, companyId: request.user.companyId }
      await setCourseFavorite(viewer, params.data.id, true)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof LearningError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/learning/courses/:id/favorite', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const viewer = { userId: request.user.sub, companyId: request.user.companyId }
      await setCourseFavorite(viewer, params.data.id, false)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof LearningError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/learning/me', gate, async (request, reply) => {
    const viewer = { userId: request.user.sub, companyId: request.user.companyId }
    return reply.send(await myLearning(viewer))
  })

  app.get('/learning/tracks', gate, async (request, reply) => {
    const viewer = { userId: request.user.sub, companyId: request.user.companyId }
    return reply.send({ tracks: await listTracks(viewer) })
  })

  app.get('/learning/tracks/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const viewer = { userId: request.user.sub, companyId: request.user.companyId }
      return reply.send({ track: await getTrack(viewer, params.data.id) })
    } catch (err) {
      if (err instanceof LearningError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/learning/certificates', gate, async (request, reply) => {
    const viewer = { userId: request.user.sub, companyId: request.user.companyId }
    return reply.send({ certificates: await listCertificates(viewer) })
  })

  /**
   * Verificação pública do certificado — sem login, de propósito: é o link que a
   * pessoa compartilha no LinkedIn. Devolve só nome, curso, carga e data.
   */
  app.get('/learning/certificates/code/:code', async (request, reply) => {
    const params = codeParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Código inválido.' })
    try {
      const certificate = await findCertificateByCode(params.data.code)
      return reply.send({ certificate: toPublicCertificateDTO(certificate) })
    } catch (err) {
      if (err instanceof LearningError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
