import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  COIN_ADJUSTMENT_REASON_MAX_LENGTH,
  COIN_ADJUSTMENT_REASON_MIN_LENGTH,
  COIN_CAP_WINDOWS,
  COIN_EVENTS,
  COIN_LEDGER_PAGE_SIZE,
  COIN_MAX_AMOUNT,
  COIN_MIN_AMOUNT,
  COIN_TRANSACTION_KINDS,
} from '@legends/shared'
import {
  getCoinBalance,
  listActiveCoinRules,
  listCoinTransactions,
} from '../services/coin-service'
import {
  CoinAdminError,
  adjustCoinsManually,
  createCoinRule,
  deleteCoinRule,
  getCoinReport,
  listCoinRules,
  updateCoinRule,
} from '../services/coin-admin-service'
import { findUserInCompany } from '../lib/tenant-scope'
import { toCoinRuleDTO, toCoinRulePublicDTO, toCoinTransactionDTO } from '../lib/serialize'

const ledgerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(COIN_LEDGER_PAGE_SIZE),
})

const adminLedgerQuerySchema = ledgerQuerySchema.extend({
  event: z.enum(COIN_EVENTS).optional(),
  kind: z.enum(COIN_TRANSACTION_KINDS).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

const createRuleSchema = z.object({
  event: z.enum(COIN_EVENTS),
  amount: z.number().int().min(COIN_MIN_AMOUNT).max(COIN_MAX_AMOUNT),
  capWindow: z.enum(COIN_CAP_WINDOWS).default('NONE'),
  capAmount: z.number().int().min(1).max(COIN_MAX_AMOUNT).nullable().optional(),
  active: z.boolean().optional(),
})

// O evento não é editável: junto com a empresa, ele é a identidade da regra.
const updateRuleSchema = createRuleSchema.omit({ event: true }).partial()

const adjustmentSchema = z.object({
  amount: z
    .number()
    .int()
    .min(-COIN_MAX_AMOUNT)
    .max(COIN_MAX_AMOUNT)
    .refine((value) => value !== 0, 'Informe um valor diferente de zero.'),
  reason: z.string().trim().min(COIN_ADJUSTMENT_REASON_MIN_LENGTH).max(COIN_ADJUSTMENT_REASON_MAX_LENGTH),
})

const reportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sectorId: z.string().min(1).optional(),
})

export async function coinRoutes(app: FastifyInstance) {
  const withCoins = { onRequest: [app.authenticate, app.requireFeature('coins')] }
  // Regra de coins é da empresa inteira (unique por companyId+event), não do setor —
  // não existe fatia legítima para o SUBADMIN aqui.
  const adminOnly = { onRequest: [app.authenticate, app.requireAdmin] }

  app.get('/me/coins', withCoins, async (request, reply) => {
    const balance = await getCoinBalance(request.user.sub, request.user.companyId)
    return reply.send({ balance })
  })

  app.get('/me/coins/transactions', withCoins, async (request, reply) => {
    const parsed = ledgerQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { page, pageSize } = parsed.data
    const [{ entries, total }, balance] = await Promise.all([
      listCoinTransactions(request.user.sub, request.user.companyId, { page, pageSize }),
      getCoinBalance(request.user.sub, request.user.companyId),
    ])
    return reply.send({ entries: entries.map(toCoinTransactionDTO), total, page, pageSize, balance })
  })

  app.get('/coins/rules', withCoins, async (request, reply) => {
    const rules = await listActiveCoinRules(request.user.companyId)
    return reply.send({ rules: rules.map(toCoinRulePublicDTO) })
  })

  app.get('/admin/coins/rules', adminOnly, async (request, reply) => {
    const rules = await listCoinRules(request.user.companyId)
    return reply.send({ rules: rules.map(toCoinRuleDTO) })
  })

  app.post('/admin/coins/rules', adminOnly, async (request, reply) => {
    const parsed = createRuleSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      const rule = await createCoinRule(
        {
          event: parsed.data.event,
          amount: parsed.data.amount,
          capWindow: parsed.data.capWindow,
          capAmount: parsed.data.capAmount ?? null,
          active: parsed.data.active,
        },
        request.user.sub,
        request.user.companyId,
      )
      return reply.code(201).send({ rule: toCoinRuleDTO(rule) })
    } catch (err) {
      if (err instanceof CoinAdminError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/admin/coins/rules/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateRuleSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      const rule = await updateCoinRule(id, parsed.data, request.user.sub, request.user.companyId)
      return reply.send({ rule: toCoinRuleDTO(rule) })
    } catch (err) {
      if (err instanceof CoinAdminError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/admin/coins/rules/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteCoinRule(id, request.user.sub, request.user.companyId)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof CoinAdminError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/admin/users/:userId/coins', adminOnly, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const target = await findUserInCompany(request.user.companyId, userId)
    if (!target) return reply.code(404).send({ message: 'Colaborador não encontrado.' })
    const balance = await getCoinBalance(userId, request.user.companyId)
    return reply.send({ balance, user: { id: target.id, name: target.name } })
  })

  app.get('/admin/users/:userId/coins/transactions', adminOnly, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const parsed = adminLedgerQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const target = await findUserInCompany(request.user.companyId, userId)
    if (!target) return reply.code(404).send({ message: 'Colaborador não encontrado.' })

    const { page, pageSize, event, kind, from, to } = parsed.data
    const [{ entries, total }, balance] = await Promise.all([
      listCoinTransactions(userId, request.user.companyId, { page, pageSize, event, kind, from, to }),
      getCoinBalance(userId, request.user.companyId),
    ])
    return reply.send({ entries: entries.map(toCoinTransactionDTO), total, page, pageSize, balance })
  })

  app.post('/admin/users/:userId/coins/adjustments', adminOnly, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const parsed = adjustmentSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      const { transaction, balance } = await adjustCoinsManually(
        { userId, amount: parsed.data.amount, reason: parsed.data.reason },
        request.user.sub,
        request.user.companyId,
      )
      return reply.code(201).send({ transaction: toCoinTransactionDTO(transaction), balance })
    } catch (err) {
      if (err instanceof CoinAdminError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/admin/coins/report', adminOnly, async (request, reply) => {
    const parsed = reportQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const report = await getCoinReport(request.user.companyId, parsed.data)
    return reply.send(report)
  })
}
