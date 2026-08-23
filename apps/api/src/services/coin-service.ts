import { Prisma, type CoinCapWindow, type CoinEvent, type CoinRule, type CoinTransactionKind } from '@prisma/client'
import { scopedPrisma } from '../lib/tenant-scope'
import {
  addDays,
  dayFromYmd,
  monthBounds,
  monthRefOf,
  startOfWeekYmd,
  ymdInSaoPaulo,
} from '../lib/sao-paulo-date'

export const coinTransactionInclude = { actor: { select: { id: true, name: true } } } as const
export type CoinTransactionWithActor = Prisma.CoinTransactionGetPayload<{
  include: typeof coinTransactionInclude
}>

export type CoinAwardOutcome =
  | { status: 'CREDITED'; amount: number; transactionId: string }
  | { status: 'NO_RULE' }
  | { status: 'RULE_INACTIVE' }
  | { status: 'DUPLICATE' }
  | { status: 'CAP_REACHED'; capAmount: number; used: number }

export interface AwardCoinsInput {
  userId: string
  companyId: string
  event: CoinEvent
  /** Referência ÚNICA da ação: id do voto, id do feedback, `${feedbackId}:${emoji}`, ymd do humor. */
  reference: string
  /** Instante do crédito; injetável nos testes. */
  now?: Date
}

/**
 * Limites da janela do teto, sempre sobre a coluna `day` (dia civil de
 * America/Sao_Paulo) — nunca sobre `createdAt`, para manter a conta de fuso
 * fora da query. Semana é de segunda a domingo.
 */
function capWindowBounds(
  window: Exclude<CoinCapWindow, 'NONE'>,
  todayYmd: string,
): { gte: Date; lt: Date } {
  if (window === 'DAY') {
    return { gte: dayFromYmd(todayYmd), lt: dayFromYmd(addDays(todayYmd, 1)) }
  }
  if (window === 'WEEK') {
    const start = startOfWeekYmd(todayYmd)
    return { gte: dayFromYmd(start), lt: dayFromYmd(addDays(start, 7)) }
  }
  const { start, endExclusive } = monthBounds(monthRefOf(todayYmd))
  return { gte: start, lt: endExclusive }
}

/**
 * Credita EMR Coins por uma ação, se houver regra ativa e o teto da janela permitir.
 *
 * Não lança por motivo de negócio: todo "não creditou" volta como `status`, e só
 * falha de infraestrutura sobe (a rota chama isto como efeito best-effort).
 * A idempotência é garantida pela unique `(userId, dedupeKey)` — a chave inclui o
 * evento e a referência da ação, então duas ações distintas pagam duas vezes e a
 * mesma ação nunca paga de novo, mesmo que a regra mude depois.
 */
export async function awardCoins(input: AwardCoinsInput): Promise<CoinAwardOutcome> {
  const db = scopedPrisma(input.companyId)
  const ymd = ymdInSaoPaulo(input.now ?? new Date())
  const day = dayFromYmd(ymd)
  const dedupeKey = `${input.event}:${input.reference}`

  // findFirst e não findUnique: a extensão de tenant já injeta companyId no where,
  // e a unique (companyId, event) garante no máximo uma linha.
  const rule = await db.coinRule.findFirst({ where: { event: input.event } })
  if (!rule) return { status: 'NO_RULE' }
  if (!rule.active) return { status: 'RULE_INACTIVE' }

  if (rule.capWindow !== 'NONE' && rule.capAmount != null) {
    const { gte, lt } = capWindowBounds(rule.capWindow, ymd)
    // Filtra por ruleId (e não por event) de propósito: ajuste manual do admin
    // tem ruleId null e portanto não consome o teto da regra.
    const used = await db.coinTransaction.aggregate({
      where: { userId: input.userId, ruleId: rule.id, day: { gte, lt } },
      _sum: { amount: true },
    })
    const usedAmount = used._sum.amount ?? 0
    // Sem crédito parcial: se o valor cheio estoura o teto, não credita nada.
    if (usedAmount + rule.amount > rule.capAmount) {
      return { status: 'CAP_REACHED', capAmount: rule.capAmount, used: usedAmount }
    }
    // Corrida aceita: dois créditos concorrentes podem passar juntos por esta
    // checagem e estourar o teto em no máximo um `amount`. Transação não resolveria
    // sob Read Committed; o remédio real seria SELECT ... FOR UPDATE na regra.
  }

  try {
    const created = await db.coinTransaction.create({
      data: {
        userId: input.userId,
        kind: 'EARN',
        event: input.event,
        ruleId: rule.id,
        amount: rule.amount,
        dedupeKey,
        day,
      },
    })
    return { status: 'CREDITED', amount: created.amount, transactionId: created.id }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Ação já paga (ou corrida no mesmo dedupeKey) — mesmo padrão de badge-service.
      return { status: 'DUPLICATE' }
    }
    throw err
  }
}

export interface AwardFixedCoinsInput {
  userId: string
  companyId: string
  /** Valor a creditar. <= 0 não gera lançamento. */
  amount: number
  event: CoinEvent
  /** Referência ÚNICA da ação (ex.: id da submissão). Compõe o dedupeKey. */
  reference: string
  /** Transação em curso; quando presente, o crédito entra nela. */
  tx?: Prisma.TransactionClient
  now?: Date
}

export type AwardFixedCoinsOutcome =
  | { status: 'CREDITED'; amount: number; transactionId: string }
  | { status: 'SKIPPED' }
  | { status: 'DUPLICATE' }

/**
 * Credita um valor VINDO DO CHAMADOR (não de CoinRule) no livro-razão.
 *
 * Existe porque a recompensa de desafio é configurada por desafio, e `CoinRule`
 * só sabe valor fixo por evento. Sem regra, não há teto de janela para consultar.
 *
 * Aceita um `tx` para o crédito entrar na MESMA transação que muda o estado da
 * ação creditada — é o que garante "aprovou e creditou, ou nada". O `tx` cru não
 * passa por `scopedPrisma`, então `companyId` vai explícito no `data`, mesmo
 * padrão de `recordAuditLog`.
 */
export async function awardFixedCoins(input: AwardFixedCoinsInput): Promise<AwardFixedCoinsOutcome> {
  if (input.amount <= 0) return { status: 'SKIPPED' }

  const ymd = ymdInSaoPaulo(input.now ?? new Date())
  const client = input.tx ?? scopedPrisma(input.companyId)

  try {
    const created = await client.coinTransaction.create({
      data: {
        userId: input.userId,
        kind: 'EARN',
        event: input.event,
        ruleId: null,
        amount: input.amount,
        dedupeKey: `${input.event}:${input.reference}`,
        day: dayFromYmd(ymd),
        companyId: input.companyId,
      },
    })
    return { status: 'CREDITED', amount: created.amount, transactionId: created.id }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { status: 'DUPLICATE' }
    }
    throw err
  }
}

/** Saldo do colaborador: soma do livro-razão, sem coluna materializada. */
export async function getCoinBalance(userId: string, companyId: string): Promise<number> {
  const result = await scopedPrisma(companyId).coinTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  })
  return result._sum.amount ?? 0
}

export interface CoinLedgerFilters {
  page: number
  pageSize: number
  event?: CoinEvent
  kind?: CoinTransactionKind
  /** Recorte por dia civil (coluna `day`), inclusive nas duas pontas. */
  from?: Date
  to?: Date
}

export async function listCoinTransactions(
  userId: string,
  companyId: string,
  filters: CoinLedgerFilters,
): Promise<{ entries: CoinTransactionWithActor[]; total: number }> {
  const db = scopedPrisma(companyId)
  const where: Prisma.CoinTransactionWhereInput = {
    userId,
    ...(filters.event ? { event: filters.event } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.from || filters.to
      ? {
          day: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  }
  const [entries, total] = await Promise.all([
    db.coinTransaction.findMany({
      where,
      include: coinTransactionInclude,
      // Desempate por `id`: `createdAt` é timestamp(3), então dois lançamentos
      // do mesmo milissegundo (um award seguido de um ajuste, por exemplo)
      // empatam e o Postgres devolve a ordem que quiser. Sem o desempate a
      // paginação fica instável de verdade — a mesma linha pode aparecer em
      // duas páginas, ou sumir das duas.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.coinTransaction.count({ where }),
  ])
  return { entries, total }
}

/** Regras ativas — alimenta o "como ganhar EMR Coins" do colaborador. */
export function listActiveCoinRules(companyId: string): Promise<CoinRule[]> {
  return scopedPrisma(companyId).coinRule.findMany({
    where: { active: true },
    orderBy: { event: 'asc' },
  })
}

export interface StoreLedgerInput {
  userId: string
  companyId: string
  /** Valor absoluto em coins; o sinal é decidido aqui, não pelo chamador. */
  amount: number
  /** Id do pedido — compõe o dedupeKey e é a chave da idempotência. */
  orderId: string
  /** Transação em curso; quando presente, o lançamento entra nela. */
  tx?: Prisma.TransactionClient
  now?: Date
}

export type StoreLedgerOutcome =
  | { status: 'RECORDED'; transactionId: string }
  | { status: 'DUPLICATE' }

/**
 * Lançamento da loja no livro-razão. `event` fica null de propósito: gasto não é
 * um evento instrumentado do catálogo `CoinEvent`, e o relatório de eventos não
 * deve contá-lo.
 *
 * A idempotência é do BANCO, não daqui: a unique (userId, dedupeKey) é o que
 * impede o segundo estorno do mesmo pedido de creditar de novo, mesmo que a
 * checagem de status a montante falhe.
 */
async function recordStoreEntry(
  input: StoreLedgerInput,
  kind: Extract<CoinTransactionKind, 'SPEND' | 'REFUND'>,
): Promise<StoreLedgerOutcome> {
  const prefix = kind === 'SPEND' ? 'STORE_ORDER' : 'STORE_REFUND'
  const ymd = ymdInSaoPaulo(input.now ?? new Date())
  // O tx cru não passa por scopedPrisma — companyId vai explícito no data,
  // mesmo padrão de awardFixedCoins e recordAuditLog.
  const client = input.tx ?? scopedPrisma(input.companyId)

  try {
    const created = await client.coinTransaction.create({
      data: {
        userId: input.userId,
        kind,
        event: null,
        ruleId: null,
        amount: kind === 'SPEND' ? -input.amount : input.amount,
        dedupeKey: `${prefix}:${input.orderId}`,
        day: dayFromYmd(ymd),
        companyId: input.companyId,
      },
    })
    return { status: 'RECORDED', transactionId: created.id }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { status: 'DUPLICATE' }
    }
    throw err
  }
}

/** Débito do resgate. dedupeKey `STORE_ORDER:<orderId>`. */
export function spendCoins(input: StoreLedgerInput): Promise<StoreLedgerOutcome> {
  return recordStoreEntry(input, 'SPEND')
}

/** Crédito do cancelamento. dedupeKey `STORE_REFUND:<orderId>`. */
export function refundCoins(input: StoreLedgerInput): Promise<StoreLedgerOutcome> {
  return recordStoreEntry(input, 'REFUND')
}
