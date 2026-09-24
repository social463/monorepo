import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { APPRENTICE_SURVEY_LEARNED, APPRENTICE_SURVEY_MAX_SCORE, APPRENTICE_SURVEY_MIN_SCORE } from '@legends/shared'
import { ApprenticeError } from '../lib/apprentice-error'
import { apprenticeContextOf, assertApprenticeAccess } from '../lib/apprentice-context'
import {
  getApprenticeContract,
  getApprenticeMeetingDetail,
  getApprenticePortfolio,
  getApprenticePortfolioOverview,
  getApprenticeTrack,
  getApprenticeWall,
  listApprenticePeople,
  saveApprenticeSubmission,
  signApprenticeContract,
  submitApprenticeSurvey,
} from '../services/apprentice-service'

/** Erro de domínio → resposta. Compartilhado com a rota de administração. */
export function handleApprenticeError(err: unknown, reply: FastifyReply) {
  if (err instanceof ApprenticeError) return reply.code(err.status).send({ message: err.message })
  throw err
}

const idParams = z.object({ id: z.string().min(1) })

const listItemSchema = z.record(z.string(), z.string())
const valuesSchema = z.record(z.string(), z.union([z.string(), z.boolean(), z.array(listItemSchema)]))

const submissionSchema = z.object({
  values: valuesSchema,
  /** `false` salva rascunho; `true` envia e passa a contar como entrega. */
  submit: z.boolean().default(false),
})

const surveySchema = z.object({
  score: z.number().int().min(APPRENTICE_SURVEY_MIN_SCORE).max(APPRENTICE_SURVEY_MAX_SCORE),
  takeaway: z.string().min(1, 'Conte o que você leva deste encontro.'),
  improvement: z.string().default(''),
  learned: z.enum(APPRENTICE_SURVEY_LEARNED),
})

export async function apprenticeRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate] }

  app.get('/apprentice/track', guard, async (request, reply) => {
    try {
      const context = await apprenticeContextOf(request)
      assertApprenticeAccess(context)
      return reply.send(await getApprenticeTrack(context))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.get('/apprentice/meetings/:id', guard, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const context = await apprenticeContextOf(request)
      assertApprenticeAccess(context)
      return reply.send(await getApprenticeMeetingDetail(context, parsed.data.id))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.put('/apprentice/activities/:id/submission', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = submissionSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      const issues = params.success ? body.error!.issues : params.error.issues
      return reply.code(400).send({ message: 'Dados inválidos.', issues })
    }
    try {
      const context = await apprenticeContextOf(request)
      assertApprenticeAccess(context)
      const saved = await saveApprenticeSubmission(
        context,
        params.data.id,
        body.data.values,
        body.data.submit,
      )
      return reply.send(saved)
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.get('/apprentice/wall', guard, async (request, reply) => {
    try {
      const context = await apprenticeContextOf(request)
      assertApprenticeAccess(context)
      return reply.send(await getApprenticeWall(context))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.get('/apprentice/contract', guard, async (request, reply) => {
    try {
      const context = await apprenticeContextOf(request)
      assertApprenticeAccess(context)
      return reply.send(await getApprenticeContract(context))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.post('/apprentice/contract/signature', guard, async (request, reply) => {
    try {
      const context = await apprenticeContextOf(request)
      assertApprenticeAccess(context)
      return reply.code(201).send(await signApprenticeContract(context))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  /** Quem são os aprendizes — alimenta o seletor do portfólio para o facilitador. */
  app.get('/apprentice/people', guard, async (request, reply) => {
    try {
      const context = await apprenticeContextOf(request)
      assertApprenticeAccess(context)
      return reply.send(await listApprenticePeople(context.companyId))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  /**
   * O portfólio da turma. Vem antes da rota individual porque é o que o
   * facilitador abre por padrão — ele não tem portfólio próprio.
   */
  app.get('/apprentice/portfolio/overview', guard, async (request, reply) => {
    try {
      const context = await apprenticeContextOf(request)
      assertApprenticeAccess(context)
      return reply.send(await getApprenticePortfolioOverview(context))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.get('/apprentice/portfolio', guard, async (request, reply) => {
    const query = z.object({ userId: z.string().min(1).optional() }).safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: query.error.issues })
    }
    try {
      const context = await apprenticeContextOf(request)
      assertApprenticeAccess(context)
      return reply.send(await getApprenticePortfolio(context, query.data.userId ?? context.userId))
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })

  app.post('/apprentice/meetings/:id/survey', guard, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = surveySchema.safeParse(request.body)
    if (!params.success || !body.success) {
      const issues = params.success ? body.error!.issues : params.error.issues
      return reply.code(400).send({ message: 'Dados inválidos.', issues })
    }
    try {
      const context = await apprenticeContextOf(request)
      assertApprenticeAccess(context)
      await submitApprenticeSurvey(context, params.data.id, body.data)
      return reply.code(204).send()
    } catch (err) {
      return handleApprenticeError(err, reply)
    }
  })
}
