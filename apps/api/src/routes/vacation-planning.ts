/**
 * Programação anual de férias.
 *
 * Duas famílias de rota, e a divisão não é cosmética:
 *
 * - `/vacation-planning/*` é do **gestor** — quem tem liderado direto. O
 *   recorte de quem ele alcança é do serviço (`team-scope-service`), nunca do
 *   parâmetro que chega na requisição.
 * - `/admin/vacation-planning/*` é do **bloco de Gente e Gestão**, com
 *   `requireSectorFeature` e não `requireAdmin`: o papel "DP" da ferramenta de
 *   origem é esse bloco, e `requireAdmin` liberaria todo SUBADMIN de qualquer
 *   setor.
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  EMPLOYMENT_TYPES,
  MAX_VACATION_PLAN_PERIODS,
  VACATION_CAMPAIGN_NOTICE_MAX_LENGTH,
  VACATION_PLAN_NOTE_MAX_LENGTH,
  VACATION_REQUEST_NOTE_MAX_LENGTH,
} from '@legends/shared'
import {
  VacationPlanningError,
  confirmPlans,
  correctEntitlement,
  exportCampaignCsv,
  getCampaignOverview,
  getMyVacationPlanning,
  getTeamPlanning,
  saveMyVacationRequest,
  setEmploymentType,
  savePlan,
  setVacationAnchorDate,
  syncEntitlements,
  unlockPlan,
  upsertCampaign,
  validatePlans,
} from '../services/vacation-planning-service'

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD')

const savePlanSchema = z.object({
  entitlementId: z.string().min(1),
  periods: z
    .array(z.object({ startDate: ymd, days: z.number().int().min(1).max(30) }))
    .max(MAX_VACATION_PLAN_PERIODS),
  note: z.string().max(VACATION_PLAN_NOTE_MAX_LENGTH).nullable().optional(),
  changeRequested: z.boolean().optional(),
})

const requestSchema = z.object({
  entitlementId: z.string().min(1),
  periods: z
    .array(z.object({ startDate: ymd, days: z.number().int().min(1).max(30) }))
    .max(MAX_VACATION_PLAN_PERIODS),
  note: z.string().max(VACATION_REQUEST_NOTE_MAX_LENGTH).nullable().optional(),
})

const idsSchema = z.object({ entitlementIds: z.array(z.string().min(1)).min(1).max(400) })

const campaignSchema = z
  .object({
    year: z.number().int().min(2020).max(2100),
    opensAt: ymd,
    deadline: ymd,
    manuallyLocked: z.boolean().optional(),
    noticeTemplate: z.string().max(VACATION_CAMPAIGN_NOTICE_MAX_LENGTH).optional(),
  })
  .refine(({ opensAt, deadline }) => opensAt <= deadline, {
    message: 'O prazo não pode ser anterior à abertura da campanha',
  })

const correctSchema = z.object({
  balanceDays: z.number().int().min(0).max(60).optional(),
  acquisitionStart: ymd.optional(),
  acquisitionEnd: ymd.optional(),
  dueDate: ymd.optional(),
  note: z.string().max(500).nullable().optional(),
})

const employmentSchema = z.object({ employmentType: z.enum(EMPLOYMENT_TYPES) })

/** Data-base de férias: `null` devolve a pessoa à admissão. */
const anchorSchema = z.object({ anchorDate: ymd.nullable() })

function fail(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof VacationPlanningError) return reply.status(err.status).send({ message: err.message })
  throw err
}

export async function vacationPlanningRoutes(app: FastifyInstance): Promise<void> {
  const authed = { onRequest: [app.authenticate] }
  // Bloco de Gente e Gestão — ver o comentário no topo.
  const gente = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  // O que a própria pessoa vê das férias dela. Hoje ela descobre por e-mail,
  // depois de decidido.
  app.get('/me/vacation-planning', authed, async (request, reply) => {
    try {
      return await getMyVacationPlanning(request.user.sub)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.put('/me/vacation-planning/request', authed, async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      await saveMyVacationRequest(request.user.sub, parsed.data)
      return { ok: true }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/vacation-planning/team', authed, async (request, reply) => {
    try {
      return await getTeamPlanning(request.user.sub)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.put('/vacation-planning/plans', authed, async (request, reply) => {
    const parsed = savePlanSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      return { plan: await savePlan(request.user.sub, parsed.data) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/vacation-planning/confirm', authed, async (request, reply) => {
    const parsed = idsSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      return { confirmed: await confirmPlans(request.user.sub, parsed.data.entitlementIds) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  // O gestor baixa a PRÓPRIA área; a G&G baixa tudo. Quem decide o recorte é o
  // servidor, pelo caminho da rota — nunca um parâmetro da requisição.
  app.get('/vacation-planning/export', authed, async (request, reply) => {
    try {
      const csv = await exportCampaignCsv(request.user.sub, 'meu-time')
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="ferias-meu-time.csv"')
        .send(csv)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/admin/vacation-planning/export', gente, async (request, reply) => {
    try {
      const csv = await exportCampaignCsv(request.user.sub, 'empresa')
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="ferias-controle-geral.csv"')
        .send(csv)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get('/admin/vacation-planning/overview', gente, async (request, reply) => {
    try {
      return await getCampaignOverview(request.user.companyId)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.put('/admin/vacation-planning/campaign', gente, async (request, reply) => {
    const parsed = campaignSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const campaign = await upsertCampaign(request.user.sub, parsed.data)
      // Abrir a campanha já cria os direitos que faltam: sem isso a G&G abriria
      // uma campanha vazia e ninguém saberia por que os cartões não aparecem.
      const created = await syncEntitlements(request.user.companyId, {
        year: campaign.year,
        policy: campaign.policy,
      })
      return { campaign, entitlementsCreated: created }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/admin/vacation-planning/validate', gente, async (request, reply) => {
    const parsed = idsSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      return { validated: await validatePlans(request.user.sub, parsed.data.entitlementIds) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.patch('/admin/vacation-planning/entitlements/:id', gente, async (request, reply) => {
    const parsed = correctSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    const { id } = request.params as { id: string }
    try {
      await correctEntitlement(request.user.sub, id, parsed.data)
      return { ok: true }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/admin/vacation-planning/unlock', gente, async (request, reply) => {
    const parsed = z.object({ entitlementId: z.string().min(1), until: ymd }).safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      await unlockPlan(request.user.sub, parsed.data.entitlementId, parsed.data.until)
      return { ok: true }
    } catch (err) {
      return fail(reply, err)
    }
  })

  // Data-base de férias: gravada por TELA, nunca por coluna de planilha. Apagar
  // uma célula sem querer reverteria a pessoa para a admissão em silêncio, e o
  // erro só apareceria na programação do ano seguinte.
  // Regime de contratação. Pela TELA, e não só pela planilha: é fato do
  // contrato da pessoa, e uma carga em lote com a coluna vazia não pode
  // devolvê-la a CLT em silêncio.
  app.patch('/admin/vacation-planning/users/:id/employment', gente, async (request, reply) => {
    const parsed = employmentSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    const { id } = request.params as { id: string }
    try {
      await setEmploymentType(request.user.sub, id, parsed.data.employmentType)
      return { ok: true }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.patch('/admin/vacation-planning/users/:id/anchor', gente, async (request, reply) => {
    const parsed = anchorSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    const { id } = request.params as { id: string }
    try {
      await setVacationAnchorDate(request.user.sub, id, parsed.data.anchorDate)
      return { ok: true }
    } catch (err) {
      return fail(reply, err)
    }
  })
}
