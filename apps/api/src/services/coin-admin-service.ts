import { randomUUID } from 'node:crypto'
import { Prisma, type CoinCapWindow, type CoinEvent, type CoinRule } from '@prisma/client'
import { COIN_EVENTS, type CoinReportDTO, type CoinReportRowDTO } from '@legends/shared'
import { scopedPrisma, findUserInCompany } from '../lib/tenant-scope'
import { todayInSaoPaulo, ymdOf } from '../lib/sao-paulo-date'
import { recordAuditLog } from './audit-log-service'
import {
  coinTransactionInclude,
  type CoinTransactionWithActor,
} from './coin-service'

export class CoinAdminError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'CoinAdminError'
  }
}

export interface CreateCoinRuleInput {
  event: CoinEvent
  amount: number
  capWindow: CoinCapWindow
  capAmount: number | null
  active?: boolean
}

/** O evento não é editável: junto com a empresa, ele é a identidade da regra. */
export interface UpdateCoinRuleInput {
  amount?: number
  capWindow?: CoinCapWindow
  capAmount?: number | null
  active?: boolean
}

export interface AdjustCoinsInput {
  userId: string
  amount: number
  reason: string
}

export interface CoinReportFilters {
  from?: Date
  to?: Date
  sectorId?: string
}

/**
 * Normaliza e valida o par (janela, teto). `NONE` zera o teto; janela com teto
 * ausente e teto menor que o valor por ação são erros — no segundo caso a regra
 * nunca pagaria nada, o que parece bug para quem configurou.
 */
function normalizeCap(
  capWindow: CoinCapWindow,
  capAmount: number | null | undefined,
  amount: number,
): number | null {
  if (capWindow === 'NONE') return null
  if (capAmount == null) {
    throw new CoinAdminError('Informe o teto para a janela escolhida.', 400)
  }
  if (capAmount < amount) {
    throw new CoinAdminError('O teto deve ser pelo menos igual ao valor por ação.', 400)
  }
  return capAmount
}

export function listCoinRules(companyId: string): Promise<CoinRule[]> {
  return scopedPrisma(companyId).coinRule.findMany({ orderBy: { event: 'asc' } })
}

export function getCoinRule(id: string, companyId: string): Promise<CoinRule | null> {
  return scopedPrisma(companyId).coinRule.findUnique({ where: { id } })
}

export async function createCoinRule(
  input: CreateCoinRuleInput,
  actorId: string,
  companyId: string,
): Promise<CoinRule> {
  const capAmount = normalizeCap(input.capWindow, input.capAmount, input.amount)
  const db = scopedPrisma(companyId)
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.coinRule.create({
        data: {
          event: input.event,
          amount: input.amount,
          capWindow: input.capWindow,
          capAmount,
          active: input.active ?? true,
        },
      })
      // O cast reconcilia o client estendido por `scopedPrisma` com a assinatura de
      // `recordAuditLog` (que prevê Prisma.TransactionClient); o companyId vai explícito.
      await recordAuditLog({
        actorId,
        entityType: 'CoinRule',
        entityId: created.id,
        action: 'CREATE',
        after: created,
        companyId,
        tx: tx as unknown as Prisma.TransactionClient,
      })
      return created
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new CoinAdminError('Já existe uma regra para este evento.', 409)
    }
    throw err
  }
}

export async function updateCoinRule(
  id: string,
  input: UpdateCoinRuleInput,
  actorId: string,
  companyId: string,
): Promise<CoinRule> {
  const db = scopedPrisma(companyId)
  const before = await db.coinRule.findUnique({ where: { id } })
  if (!before) throw new CoinAdminError('Regra não encontrada.', 404)

  const amount = input.amount ?? before.amount
  const capWindow = input.capWindow ?? before.capWindow
  // Trocar a janela exige informar o teto novo: o teto antigo foi pensado para
  // outra janela, e herdá-lo em silêncio muda o significado da regra.
  const capAmount = normalizeCap(
    capWindow,
    input.capWindow !== undefined && input.capAmount === undefined ? null : (input.capAmount ?? before.capAmount),
    amount,
  )

  try {
    return await db.$transaction(async (tx) => {
      const updated = await tx.coinRule.update({
        where: { id },
        data: { amount, capWindow, capAmount, ...(input.active !== undefined ? { active: input.active } : {}) },
      })
      await recordAuditLog({
        actorId,
        entityType: 'CoinRule',
        entityId: id,
        action: 'UPDATE',
        before,
        after: updated,
        companyId,
        tx: tx as unknown as Prisma.TransactionClient,
      })
      return updated
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new CoinAdminError('Regra não encontrada.', 404)
    }
    throw err
  }
}

/**
 * Remove a regra. Os lançamentos ficam: `ruleId` vira null (SetNull) e o `event`
 * denormalizado mantém o extrato e o relatório legíveis.
 */
export async function deleteCoinRule(id: string, actorId: string, companyId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const before = await db.coinRule.findUnique({ where: { id } })
  if (!before) throw new CoinAdminError('Regra não encontrada.', 404)
  await db.$transaction(async (tx) => {
    await tx.coinRule.delete({ where: { id } })
    await recordAuditLog({
      actorId,
      entityType: 'CoinRule',
      entityId: id,
      action: 'DELETE',
      before,
      companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}

/**
 * Crédito ou débito manual do admin, com justificativa. Entra no mesmo livro-razão
 * dos créditos automáticos, com `dedupeKey` próprio (`MANUAL:<uuid>`) para não
 * colidir com a idempotência por ação nem entre dois ajustes do mesmo usuário.
 *
 * Reusa o MESMO advisory lock por pessoa da loja (`store:<userId>`, ver
 * `store-service.redeemProduct`): este débito manual e um resgate — ou outro
 * ajuste manual — da mesma pessoa não podem correr em paralelo, senão os dois
 * leem o mesmo saldo, os dois passam no cheque abaixo e o saldo termina
 * negativo mesmo assim. O lock tem de ser a PRIMEIRA instrução da transação, e
 * o saldo tem de ser lido DEPOIS dele e DENTRO da mesma transação — lido antes
 * (como antes desta correção) ou fora do lock não participa da serialização.
 */
export async function adjustCoinsManually(
  input: AdjustCoinsInput,
  actorId: string,
  companyId: string,
): Promise<{ transaction: CoinTransactionWithActor; balance: number }> {
  const target = await findUserInCompany(companyId, input.userId)
  if (!target) throw new CoinAdminError('Colaborador não encontrado.', 404)

  const db = scopedPrisma(companyId)
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store:${input.userId}`}))`

    const { _sum } = await tx.coinTransaction.aggregate({
      where: { userId: input.userId },
      _sum: { amount: true },
    })
    const balance = _sum.amount ?? 0
    if (input.amount < 0 && balance + input.amount < 0) {
      throw new CoinAdminError(
        `Saldo insuficiente: o colaborador tem ${balance} EMR Coins disponíveis.`,
        409,
      )
    }

    const created = await tx.coinTransaction.create({
      data: {
        userId: input.userId,
        kind: input.amount > 0 ? 'MANUAL_CREDIT' : 'MANUAL_DEBIT',
        amount: input.amount,
        reason: input.reason,
        actorId,
        dedupeKey: `MANUAL:${randomUUID()}`,
        day: todayInSaoPaulo().day,
      },
      include: coinTransactionInclude,
    })
    await recordAuditLog({
      actorId,
      entityType: 'CoinTransaction',
      entityId: created.id,
      action: 'CREATE',
      after: {
        userId: created.userId,
        kind: created.kind,
        amount: created.amount,
        reason: created.reason,
      },
      companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return { transaction: created, balance: balance + input.amount }
  })
}

/**
 * Quanto cada regra pagou no recorte. Sem SQL cru: `$queryRaw` furaria o
 * isolamento por empresa do `scopedPrisma`.
 */
export async function getCoinReport(
  companyId: string,
  filters: CoinReportFilters,
): Promise<CoinReportDTO> {
  const db = scopedPrisma(companyId)
  const where: Prisma.CoinTransactionWhereInput = {
    ...(filters.from || filters.to
      ? {
          day: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters.sectorId ? { user: { sectorId: filters.sectorId } } : {}),
  }

  const [byEvent, byEventUser, byKind, rules] = await Promise.all([
    db.coinTransaction.groupBy({
      by: ['event'],
      where: { ...where, kind: 'EARN' },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.coinTransaction.groupBy({
      by: ['event', 'userId'],
      where: { ...where, kind: 'EARN' },
    }),
    db.coinTransaction.groupBy({
      by: ['kind'],
      where: { ...where, kind: { in: ['MANUAL_CREDIT', 'MANUAL_DEBIT'] } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    listCoinRules(companyId),
  ])

  const rows: CoinReportRowDTO[] = COIN_EVENTS.map((event) => {
    const totals = byEvent.find((row) => row.event === event)
    const rule = rules.find((r) => r.event === event)
    return {
      event,
      ruleId: rule?.id ?? null,
      amount: rule?.amount ?? null,
      totalAmount: totals?._sum.amount ?? 0,
      transactionCount: totals?._count._all ?? 0,
      userCount: byEventUser.filter((row) => row.event === event).length,
    }
  })

  const credited = byKind.find((row) => row.kind === 'MANUAL_CREDIT')
  const debited = byKind.find((row) => row.kind === 'MANUAL_DEBIT')

  return {
    rows,
    manual: {
      creditedAmount: credited?._sum.amount ?? 0,
      debitedAmount: debited?._sum.amount ?? 0,
      transactionCount: (credited?._count._all ?? 0) + (debited?._count._all ?? 0),
    },
    totalAmount:
      rows.reduce((sum, row) => sum + row.totalAmount, 0) +
      (credited?._sum.amount ?? 0) +
      (debited?._sum.amount ?? 0),
    from: filters.from ? ymdOf(filters.from) : null,
    to: filters.to ? ymdOf(filters.to) : null,
    sectorId: filters.sectorId ?? null,
  }
}
