import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_NOTES_MAX_LENGTH,
  CAMPAIGN_QUANTITY_MAX,
  CAMPAIGN_QUANTITY_MIN,
  CAMPAIGN_THEME_MAX_LENGTH,
  CAMPAIGN_TITLE_MAX_LENGTH,
  CAMPAIGN_VISUAL_HINT_MAX_LENGTH,
  type CampaignAudience,
  type CampaignChannel,
} from '@legends/shared'
import { AgentError } from '../lib/agent-error'
import { CampaignError } from '../lib/campaign-error'
import { toCampaignPostDTO } from '../lib/serialize'
import { CorporateMuralError } from '../services/corporate-mural-service'
import {
  cancelCampaignPost,
  confirmCampaign,
  createCampaignPost,
  generateCampaignPreview,
  listCampaignPosts,
  publishCampaignPost,
  updateCampaignPost,
  type CampaignActor,
} from '../services/campaign-service'

const idParamsSchema = z.object({ id: z.string().min(1) })
const isoDate = z.string().datetime({ offset: true })
// As constantes do contrato são `readonly`; `z.enum` quer tupla mutável.
const audience = z.enum([...CAMPAIGN_AUDIENCES] as [CampaignAudience, ...CampaignAudience[]])
const channel = z.enum([...CAMPAIGN_CHANNELS] as [CampaignChannel, ...CampaignChannel[]])

/** A janela é validada aqui para o erro chegar como 400 de campo, não como exceção. */
const windowRefinement = <T extends { startsAt: string; endsAt: string }>(schema: z.ZodType<T>) =>
  schema.refine((v) => new Date(v.endsAt).getTime() >= new Date(v.startsAt).getTime(), {
    message: 'A data final não pode ser anterior à data inicial.',
    path: ['endsAt'],
  })

const generateSchema = windowRefinement(
  z.object({
    theme: z.string().trim().min(1).max(CAMPAIGN_THEME_MAX_LENGTH),
    startsAt: isoDate,
    endsAt: isoDate,
    audience,
    channel,
    quantity: z.number().int().min(CAMPAIGN_QUANTITY_MIN).max(CAMPAIGN_QUANTITY_MAX),
    notes: z.string().trim().max(CAMPAIGN_NOTES_MAX_LENGTH).optional(),
  }),
)

const postBodySchema = {
  title: z.string().trim().min(1).max(CAMPAIGN_TITLE_MAX_LENGTH),
  body: z.string().trim().min(1).max(CAMPAIGN_BODY_MAX_LENGTH),
  visualHint: z.string().trim().max(CAMPAIGN_VISUAL_HINT_MAX_LENGTH).nullable().optional(),
  scheduledFor: isoDate,
  channel,
  responsibleId: z.string().min(1).nullable().optional(),
}

const confirmSchema = windowRefinement(
  z.object({
    theme: z.string().trim().min(1).max(CAMPAIGN_THEME_MAX_LENGTH),
    startsAt: isoDate,
    endsAt: isoDate,
    audience,
    notes: z.string().trim().max(CAMPAIGN_NOTES_MAX_LENGTH).optional(),
    posts: z.array(z.object(postBodySchema)).min(1).max(CAMPAIGN_QUANTITY_MAX),
  }),
)

const createPostSchema = z.object({ ...postBodySchema, audience })
const updatePostSchema = z.object({ ...postBodySchema, audience }).partial()

const rangeSchema = z.object({ from: isoDate, to: isoDate })

function actorFrom(request: { user: { sub: string; companyId: string } }): CampaignActor {
  return { id: request.user.sub, companyId: request.user.companyId }
}

/**
 * Falha de IA e erro de domínio de campanha nunca viram 500 — os dois carregam
 * status próprio. `CorporateMuralError` entra aqui também: `publishCampaignPost`
 * chama o `createPost` do mural por dentro, que valida autor ativo e papel com
 * permissão de publicar por conta própria e lança essa classe (não
 * `CampaignError`) quando a checagem falha — sem tratá-la aqui, o erro
 * escaparia como 500 em vez de resposta tratada.
 */
function handleCampaignError(err: unknown, reply: FastifyReply) {
  if (err instanceof CampaignError || err instanceof AgentError || err instanceof CorporateMuralError) {
    return reply.code(err.status).send({ message: err.message })
  }
  throw err
}

/**
 * Calendário editorial. Mesma guarda das outras telas de Gente e Gestão: ADMIN
 * global, ou SUBADMIN do setor com a feature `gente-gestao` ligada.
 */
export async function campaignRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  app.post('/admin/campaigns/preview', guard, async (request, reply) => {
    const parsed = generateSchema.safeParse(request.body)
    if (!parsed.success) {
      const janela = parsed.error.issues.find((i) => i.path.includes('endsAt'))
      return reply.code(400).send({
        message: janela?.message ?? 'Dados inválidos.',
        issues: parsed.error.issues,
      })
    }
    try {
      const drafts = await generateCampaignPreview(actorFrom(request), parsed.data)
      return reply.send({ drafts })
    } catch (err) {
      return handleCampaignError(err, reply)
    }
  })

  app.post('/admin/campaigns', guard, async (request, reply) => {
    const parsed = confirmSchema.safeParse(request.body)
    if (!parsed.success) {
      const janela = parsed.error.issues.find((i) => i.path.includes('endsAt'))
      return reply.code(400).send({
        message: janela?.message ?? 'Dados inválidos.',
        issues: parsed.error.issues,
      })
    }
    try {
      const posts = await confirmCampaign(actorFrom(request), parsed.data)
      return reply.code(201).send({ posts: posts.map(toCampaignPostDTO) })
    } catch (err) {
      return handleCampaignError(err, reply)
    }
  })

  app.get('/admin/campaigns/posts', guard, async (request, reply) => {
    const parsed = rangeSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Período inválido.', issues: parsed.error.issues })
    }
    const posts = await listCampaignPosts(actorFrom(request), {
      from: new Date(parsed.data.from),
      to: new Date(parsed.data.to),
    })
    return reply.send({ posts: posts.map(toCampaignPostDTO) })
  })

  app.post('/admin/campaigns/posts', guard, async (request, reply) => {
    const parsed = createPostSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const post = await createCampaignPost(actorFrom(request), parsed.data)
      return reply.code(201).send({ post: toCampaignPostDTO(post) })
    } catch (err) {
      return handleCampaignError(err, reply)
    }
  })

  app.patch('/admin/campaigns/posts/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: params.error.issues })
    }
    const parsed = updatePostSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const post = await updateCampaignPost(actorFrom(request), params.data.id, parsed.data)
      return reply.send({ post: toCampaignPostDTO(post) })
    } catch (err) {
      return handleCampaignError(err, reply)
    }
  })

  app.post('/admin/campaigns/posts/:id/publish', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: params.error.issues })
    }
    try {
      const post = await publishCampaignPost(actorFrom(request), params.data.id)
      return reply.send({ post: toCampaignPostDTO(post) })
    } catch (err) {
      return handleCampaignError(err, reply)
    }
  })

  app.delete('/admin/campaigns/posts/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: params.error.issues })
    }
    try {
      const post = await cancelCampaignPost(actorFrom(request), params.data.id)
      return reply.send({ post: toCampaignPostDTO(post) })
    } catch (err) {
      return handleCampaignError(err, reply)
    }
  })
}
