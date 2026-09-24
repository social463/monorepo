import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_NOTES_MAX_LENGTH,
  CAMPAIGN_PROMPT_TEMPLATE_MAX_LENGTH,
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
import { toCampaignPostDTO, toScheduledFeedPostDTO } from '../lib/serialize'
import { CorporateMuralError, listScheduledFeedPosts } from '../services/corporate-mural-service'
import {
  getCampaignPromptTemplate,
  setCampaignPromptTemplate,
} from '../services/campaign-settings-service'
import {
  cancelCampaignPost,
  confirmCampaign,
  createCampaignPost,
  deleteCampaignPost,
  generateCampaignPreview,
  getCampaignCalendarContext,
  listCampaignBands,
  listCampaignPosts,
  publishCampaignPost,
  updateCampaignPost,
  type CampaignActor,
} from '../services/campaign-service'
import { CalendarEventError } from '../services/calendar-event-service'

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
    // Ausente = ligado: o modelo padrão é o comportamento normal, e cliente
    // antigo (que não manda o campo) continua gerando com ele.
    applyTemplate: z.boolean().optional(),
  }),
)

const promptTemplateSchema = z.object({
  template: z.string().max(CAMPAIGN_PROMPT_TEMPLATE_MAX_LENGTH),
})

/**
 * A arte do item. Só a forma é validada aqui — que a URL pertence ao bucket
 * configurado é o `assertImageHost` do mural que decide, na publicação, e é lá
 * que essa checagem tem de morar: é ele que já protege o Feed Corporativo, e
 * uma segunda cópia da regra divergiria dele.
 */
const imageSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})

const postBodySchema = {
  title: z.string().trim().min(1).max(CAMPAIGN_TITLE_MAX_LENGTH),
  body: z.string().trim().min(1).max(CAMPAIGN_BODY_MAX_LENGTH),
  visualHint: z.string().trim().max(CAMPAIGN_VISUAL_HINT_MAX_LENGTH).nullable().optional(),
  image: imageSchema.nullable().optional(),
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

/** Data civil (sem hora) — o mesmo formato que `calendar-event-service` espera. */
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
const calendarContextRangeSchema = z.object({ from: ymd, to: ymd })

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
    const range = { from: new Date(parsed.data.from), to: new Date(parsed.data.to) }
    const actor = actorFrom(request)
    // As campanhas viajam junto dos itens, e não numa rota própria: é sempre a
    // MESMA janela, e uma segunda requisição só criaria a chance de a grade
    // desenhar a faixa de um mês sobre os comunicados de outro.
    const [posts, campaigns] = await Promise.all([
      listCampaignPosts(actor, range),
      listCampaignBands(actor, range),
    ])
    return reply.send({
      posts: posts.map(toCampaignPostDTO),
      campaigns: campaigns.map((c) => ({
        id: c.id,
        theme: c.theme,
        startsAt: c.startsAt.toISOString(),
        endsAt: c.endsAt.toISOString(),
      })),
    })
  })

  /**
   * Os agendados do Feed Corporativo na mesma janela, para a grade mostrar tudo
   * o que a empresa vai publicar no mês — não só o que saiu do calendário.
   *
   * Mora nas rotas de campanha, e não nas do mural, porque quem faz a pergunta
   * é o calendário editorial: o guarda é o dele (`gente-gestao`), não o de
   * moderação do feed. A consulta em si continua no service do mural, que é
   * quem é dono de `CorporatePost`.
   */
  app.get('/admin/campaigns/feed-posts', guard, async (request, reply) => {
    const parsed = rangeSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Período inválido.', issues: parsed.error.issues })
    }
    const posts = await listScheduledFeedPosts(request.user.companyId, {
      from: new Date(parsed.data.from),
      to: new Date(parsed.data.to),
    })
    return reply.send({ posts: posts.map(toScheduledFeedPostDTO) })
  })

  /**
   * Contexto do calendário organizacional (eventos, aniversários e tempo de
   * casa) na janela do calendário editorial — leitura, não espelho: mesmo
   * princípio de `listCalendarCampaignPosts` na direção oposta (Documento 4,
   * seção 13.2). Quem planeja campanha vê o dia 12 já é feriado ou que três
   * pessoas fazem aniversário, sem sair da tela.
   */
  app.get('/admin/campaigns/calendar-context', guard, async (request, reply) => {
    const parsed = calendarContextRangeSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Período inválido.', issues: parsed.error.issues })
    }
    try {
      const context = await getCampaignCalendarContext(
        {
          userId: request.user.sub,
          companyId: request.user.companyId,
          sectorId: request.user.sectorId,
          sectorFeatures: request.user.features ?? [],
          role: request.user.role,
          adminAccess: request.user.adminAccess,
        },
        parsed.data,
      )
      return reply.send(context)
    } catch (err) {
      if (err instanceof CalendarEventError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
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

  /**
   * Exclusão de verdade, em rota própria — `DELETE /posts/:id` continua sendo o
   * cancelamento, que é outra coisa (ver `deleteCampaignPost`).
   *
   * Não troquei o significado do DELETE existente de propósito: uma aba aberta
   * antes do deploy clicaria em "Cancelar comunicado" e apagaria a linha. Perder
   * dado por causa de bundle velho é caro demais para economizar uma rota.
   */
  app.delete('/admin/campaigns/posts/:id/permanently', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: params.error.issues })
    }
    try {
      await deleteCampaignPost(actorFrom(request), params.data.id)
      return reply.code(204).send()
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

  /**
   * Modelo padrão de comunicado (Documento 4, seção 13.4).
   *
   * Vale para os DOIS geradores — o de campanhas e o do Feed Corporativo. Fica
   * nas rotas de campanha porque é lá que a G&G o edita, e é o único lugar do
   * produto que trata "como escrevemos comunicado" como configuração.
   */
  app.get('/admin/campaign-prompt-template', guard, async (request, reply) => {
    return reply.send(await getCampaignPromptTemplate(request.user.companyId))
  })

  app.put('/admin/campaign-prompt-template', guard, async (request, reply) => {
    const parsed = promptTemplateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    // Texto vazio restaura o oficial — ver `setCampaignPromptTemplate`.
    return reply.send(
      await setCampaignPromptTemplate({
        companyId: request.user.companyId,
        actorId: request.user.sub,
        template: parsed.data.template,
      }),
    )
  })
}
