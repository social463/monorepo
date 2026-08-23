import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  XP_CAP_WINDOWS,
  XP_EVENTS,
  XP_LEDGER_PAGE_SIZE,
  XP_MAX_AMOUNT,
  XP_MIN_AMOUNT,
} from '@legends/shared'
import { getXpBalance, listActiveXpRules, listXpTransactions } from '../services/xp-service'
import {
  XpAdminError,
  createXpRule,
  deleteXpRule,
  listXpRules,
  updateXpRule,
} from '../services/xp-admin-service'
import { toXpRuleDTO, toXpRulePublicDTO, toXpTransactionDTO } from '../lib/serialize'

const ledgerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(XP_LEDGER_PAGE_SIZE),
  event: z.enum(XP_EVENTS).optional(),
})

const createRuleSchema = z.object({
  event: z.enum(XP_EVENTS),
  amount: z.number().int().min(XP_MIN_AMOUNT).max(XP_MAX_AMOUNT),
  capWindow: z.enum(XP_CAP_WINDOWS).default('NONE'),
  capAmount: z.number().int().min(1).max(XP_MAX_AMOUNT).nullable().optional(),
  active: z.boolean().optional(),
})

// O evento não é editável: junto com a empresa, ele é a identidade da regra.
const updateRuleSchema = createRuleSchema.omit({ event: true }).partial()

export async function xpRoutes(app: FastifyInstance) {
  // Sem `requireFeature`, ao contrário dos coins: o nível aparece no card de
  // perfil da Home, que toda pessoa logada vê. XP e coins são domínios
  // separados justamente para uma empresa poder ter progressão sem ter loja.
  const authed = { onRequest: [app.authenticate] }
  // Regra de XP é da empresa inteira (unique por companyId+event), não do setor —
  // não existe fatia legítima para o SUBADMIN aqui.
  const adminOnly = { onRequest: [app.authenticate, app.requireAdmin] }

  app.get('/me/xp', authed, async (request, reply) => {
    const balance = await getXpBalance(request.user.sub, request.user.companyId)
    return reply.send(balance)
  })

  app.get('/me/xp/transactions', authed, async (request, reply) => {
    const parsed = ledgerQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { page, pageSize, event } = parsed.data
    const [{ entries, total }, { points }] = await Promise.all([
      listXpTransactions(request.user.sub, request.user.companyId, { page, pageSize, event }),
      getXpBalance(request.user.sub, request.user.companyId),
    ])
    return reply.send({ entries: entries.map(toXpTransactionDTO), total, page, pageSize, points })
  })

  /** Alimenta o Manual do Game: como se ganha XP nesta empresa. */
  app.get('/xp/rules', authed, async (request, reply) => {
    const rules = await listActiveXpRules(request.user.companyId)
    return reply.send({ rules: rules.map(toXpRulePublicDTO) })
  })

  app.get('/admin/xp/rules', adminOnly, async (request, reply) => {
    const rules = await listXpRules(request.user.companyId)
    return reply.send({ rules: rules.map(toXpRuleDTO) })
  })

  app.post('/admin/xp/rules', adminOnly, async (request, reply) => {
    const parsed = createRuleSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      const rule = await createXpRule(
        { ...parsed.data, capAmount: parsed.data.capAmount ?? null },
        request.user.sub,
        request.user.companyId,
      )
      return reply.code(201).send({ rule: toXpRuleDTO(rule) })
    } catch (err) {
      if (err instanceof XpAdminError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/admin/xp/rules/:id', adminOnly, async (request, reply) => {
    const parsed = updateRuleSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { id } = request.params as { id: string }
    try {
      const rule = await updateXpRule(id, parsed.data, request.user.sub, request.user.companyId)
      return reply.send({ rule: toXpRuleDTO(rule) })
    } catch (err) {
      if (err instanceof XpAdminError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/admin/xp/rules/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteXpRule(id, request.user.sub, request.user.companyId)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof XpAdminError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
