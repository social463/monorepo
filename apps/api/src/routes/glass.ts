import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  GLASS_RAW_MAX_LENGTH,
  GLASS_SENTIMENTS,
  GLASS_SHORT_TEXT_MAX_LENGTH,
  GLASS_STATUS,
  GLASS_TENURE_BUCKETS,
  GLASS_TEXT_MAX_LENGTH,
  GLASS_THEMES_NEGATIVE,
  GLASS_THEMES_POSITIVE,
} from '@legends/shared'
import { AgentError } from '../lib/agent-error'
import { toGlassReviewDTO } from '../lib/serialize'
import { getGlassOverview } from '../services/glass-overview-service'
import {
  createGlassReview,
  listGlassReviewsPage,
  parseGlassReview,
  type GlassActor,
} from '../services/glass-review-service'

const parseSchema = z.object({
  raw: z.string().trim().min(1).max(GLASS_RAW_MAX_LENGTH),
})

const nullableText = (max: number) => z.string().trim().max(max).nullable()

/**
 * Os três obrigatórios (`sector`, `role`, `tenure`) usam `.min(1)`: a coluna
 * aceita null — Glassdoor é anônimo e nem toda avaliação traz tudo — mas a porta
 * de entrada não deixa passar registro incompleto, porque é ele que fura os
 * recortes do relatório.
 */
const createSchema = z.object({
  reviewDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD.')
    .nullable(),
  // Passo de meia estrela, como a escala do site. A coluna é Decimal(2,1):
  // aceitar 4.27 grava 4.3 em silêncio e a média passa a descrever nota que
  // ninguém deu.
  rating: z.number().min(1).max(5).multipleOf(0.5).nullable(),
  sector: z.string().trim().min(1).max(GLASS_SHORT_TEXT_MAX_LENGTH),
  role: z.string().trim().min(1).max(GLASS_SHORT_TEXT_MAX_LENGTH),
  tenure: z.enum(GLASS_TENURE_BUCKETS),
  level: nullableText(GLASS_SHORT_TEXT_MAX_LENGTH),
  status: z.enum(GLASS_STATUS).nullable(),
  recommends: z.boolean().nullable(),
  leadershipApproval: z.boolean().nullable(),
  title: nullableText(400),
  positives: nullableText(GLASS_TEXT_MAX_LENGTH),
  negatives: nullableText(GLASS_TEXT_MAX_LENGTH),
  advice: nullableText(GLASS_TEXT_MAX_LENGTH),
  sentiment: z.enum(GLASS_SENTIMENTS),
  themesPositive: z.array(z.enum(GLASS_THEMES_POSITIVE)).max(4),
  themesNegative: z.array(z.enum(GLASS_THEMES_NEGATIVE)).max(4),
  aiSummary: nullableText(400),
})

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()

const overviewQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  sector: z.string().trim().min(1).max(GLASS_SHORT_TEXT_MAX_LENGTH).optional(),
})

const listQuerySchema = z.object({
  sector: z.string().trim().min(1).max(GLASS_SHORT_TEXT_MAX_LENGTH).optional(),
  status: z.enum(GLASS_STATUS).optional(),
  withAlerts: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

function handleAgentError(err: unknown, reply: FastifyReply) {
  if (err instanceof AgentError) return reply.code(err.status).send({ message: err.message })
  throw err
}

function actorFrom(request: { user: { sub: string; companyId: string } }): GlassActor {
  return { id: request.user.sub, companyId: request.user.companyId }
}

/**
 * GlassAgent — avaliações externas. Mesma guarda do agente de Benchmarking:
 * ADMIN global, ou SUBADMIN do setor com a feature `gente-gestao` ligada.
 *
 * Quem passa lê a empresa **inteira**: o `sector` da avaliação é o setor
 * avaliado, um campo de dado, não o setor de quem lê. Prender o SUBADMIN de G&G
 * às avaliações do próprio setor deixaria o painel dele vazio e mataria o
 * recorte por setor, que é o valor da tela. O setor entra como filtro.
 */
export async function glassRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  app.post('/admin/glass/reviews/parse', guard, async (request, reply) => {
    const parsed = parseSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Cole o texto da avaliação.', issues: parsed.error.issues })
    }
    try {
      const resposta = await parseGlassReview(actorFrom(request), parsed.data.raw)
      return reply.send(resposta)
    } catch (err) {
      return handleAgentError(err, reply)
    }
  })

  app.post('/admin/glass/reviews', guard, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const review = await createGlassReview(actorFrom(request), parsed.data)
      return reply.code(201).send({ review: toGlassReviewDTO(review) })
    } catch (err) {
      return handleAgentError(err, reply)
    }
  })

  app.get('/admin/glass/overview', guard, async (request, reply) => {
    const parsed = overviewQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Filtros inválidos.', issues: parsed.error.issues })
    }
    const overview = await getGlassOverview(actorFrom(request), {
      from: parsed.data.from ? new Date(`${parsed.data.from}T00:00:00.000Z`) : undefined,
      // Fim do dia: `to=2026-03-12` precisa incluir o dia 12 inteiro.
      to: parsed.data.to ? new Date(`${parsed.data.to}T23:59:59.999Z`) : undefined,
      sector: parsed.data.sector,
    })
    return reply.send({ overview })
  })

  app.get('/admin/glass/reviews', guard, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Filtros inválidos.', issues: parsed.error.issues })
    }
    // `total` é a contagem do filtro inteiro, não da página: o painel de alertas
    // mostra esse número no cabeçalho e não pode ficar preso no `limit`.
    const { reviews, total } = await listGlassReviewsPage(actorFrom(request), parsed.data)
    return reply.send({ reviews: reviews.map(toGlassReviewDTO), total })
  })
}
