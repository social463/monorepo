import { Prisma, type XpCapWindow, type XpEvent, type XpRule } from '@prisma/client'
import { XP_REVOCABLE_EVENTS, computeLevel, type XpLevelInfo } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import {
  addDays,
  dayFromYmd,
  monthBounds,
  monthRefOf,
  startOfWeekYmd,
  ymdInSaoPaulo,
} from '../lib/sao-paulo-date'

export type XpAwardOutcome =
  | { status: 'CREDITED'; amount: number; transactionId: string }
  | { status: 'NO_RULE' }
  | { status: 'RULE_INACTIVE' }
  | { status: 'DUPLICATE' }
  | { status: 'CAP_REACHED'; capAmount: number; used: number }

export interface AwardXpInput {
  userId: string
  companyId: string
  event: XpEvent
  /** Referência ÚNICA da ação: id do voto, id do feedback, `${feedbackId}:${emoji}`, ymd do humor. */
  reference: string
  /** Transação em curso; quando presente, o crédito entra nela. */
  tx?: Prisma.TransactionClient
  /** Instante do crédito; injetável nos testes. */
  now?: Date
}

/**
 * Limites da janela do teto, sempre sobre a coluna `day` (dia civil de
 * America/Sao_Paulo). Idêntico ao de `coin-service` de propósito: as duas
 * moedas contam teto do mesmo jeito, e divergir aqui seria armadilha.
 */
function capWindowBounds(
  window: Exclude<XpCapWindow, 'NONE'>,
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
 * Credita XP por uma ação, se houver regra ativa e o teto da janela permitir.
 *
 * Mesmo contrato de `awardCoins`: não lança por motivo de negócio — todo "não
 * creditou" volta como `status`, e só falha de infraestrutura sobe, porque os
 * call sites chamam isto como efeito best-effort. A idempotência é do BANCO
 * (unique `(userId, dedupeKey)`), não desta função.
 *
 * XP e coins são creditados lado a lado nos mesmos pontos, mas por regras
 * separadas: uma empresa pode pagar coin e não pagar XP, ou o contrário.
 */
export async function awardXp(input: AwardXpInput): Promise<XpAwardOutcome> {
  const db = scopedPrisma(input.companyId)
  const ymd = ymdInSaoPaulo(input.now ?? new Date())
  const day = dayFromYmd(ymd)
  const dedupeKey = `${input.event}:${input.reference}`

  // findFirst e não findUnique: a extensão de tenant já injeta companyId no
  // where, e a unique (companyId, event) garante no máximo uma linha.
  const rule = await db.xpRule.findFirst({ where: { event: input.event } })
  if (!rule) return { status: 'NO_RULE' }
  if (!rule.active) return { status: 'RULE_INACTIVE' }

  if (rule.capWindow !== 'NONE' && rule.capAmount != null) {
    const { gte, lt } = capWindowBounds(rule.capWindow, ymd)
    const used = await db.xpTransaction.aggregate({
      where: { userId: input.userId, ruleId: rule.id, day: { gte, lt } },
      _sum: { amount: true },
    })
    const usedAmount = used._sum.amount ?? 0
    // Sem crédito parcial: se o valor cheio estoura o teto, não credita nada.
    if (usedAmount + rule.amount > rule.capAmount) {
      return { status: 'CAP_REACHED', capAmount: rule.capAmount, used: usedAmount }
    }
    // Mesma corrida aceita de `awardCoins`: dois créditos concorrentes podem
    // passar juntos por esta checagem e estourar o teto em no máximo um `amount`.
  }

  // O tx cru não passa por scopedPrisma — companyId vai explícito no data,
  // mesmo padrão de awardFixedCoins e recordAuditLog.
  const client = input.tx ?? db

  try {
    const created = await client.xpTransaction.create({
      data: {
        userId: input.userId,
        event: input.event,
        ruleId: rule.id,
        amount: rule.amount,
        dedupeKey,
        day,
        companyId: input.companyId,
      },
    })
    return { status: 'CREDITED', amount: created.amount, transactionId: created.id }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Ação já paga (ou corrida no mesmo dedupeKey) — mesmo padrão de coin-service.
      return { status: 'DUPLICATE' }
    }
    throw err
  }
}

export interface AwardFixedXpInput {
  userId: string
  companyId: string
  /** Valor a creditar. <= 0 não gera lançamento. */
  amount: number
  event: XpEvent
  /** Referência ÚNICA da ação (ex.: id do selo). Compõe o dedupeKey. */
  reference: string
  /** Transação em curso; quando presente, o crédito entra nela. */
  tx?: Prisma.TransactionClient
  now?: Date
}

export type AwardFixedXpOutcome =
  | { status: 'CREDITED'; amount: number; transactionId: string }
  | { status: 'SKIPPED' }
  | { status: 'DUPLICATE' }

/**
 * Credita Pontos com valor VINDO DO CHAMADOR (não de `XpRule`).
 *
 * Par de `awardFixedCoins`, e existe pelo mesmo motivo: a recompensa do selo é
 * configurada por selo, e `XpRule` só sabe valor fixo por evento. Sem regra,
 * não há teto de janela para consultar.
 *
 * Aceita um `tx` para o crédito entrar na MESMA transação que concede o selo —
 * é o que garante "concedeu e creditou, ou nada". O `tx` cru não passa por
 * `scopedPrisma`, então `companyId` vai explícito no `data`.
 */
export async function awardFixedXp(input: AwardFixedXpInput): Promise<AwardFixedXpOutcome> {
  if (input.amount <= 0) return { status: 'SKIPPED' }

  const ymd = ymdInSaoPaulo(input.now ?? new Date())
  const client = input.tx ?? scopedPrisma(input.companyId)

  try {
    const created = await client.xpTransaction.create({
      data: {
        userId: input.userId,
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

/**
 * Estorna um crédito de XP **apagando a linha** do livro-razão.
 *
 * Não é um lançamento negativo de propósito: o invariante deste arquivo é que
 * XP nunca é debitado (`XpTransaction` não tem `kind` por isso), e valor
 * negativo obrigaria a revisar `computeLevel`, o extrato e o backfill. Apagar
 * mantém o sinal de pé, e a unique `(userId, dedupeKey)` deixa recreditar se a
 * pessoa refizer a ação — reagir, desfazer e reagir de novo volta a pagar.
 *
 * Só vale para os eventos de `XP_REVOCABLE_EVENTS`, que são ações que a pessoa
 * pode desfazer. Devolve quanto saiu do saldo (0 quando não havia crédito).
 */
export async function revokeXp(input: {
  userId: string
  companyId: string
  event: (typeof XP_REVOCABLE_EVENTS)[number]
  reference: string
  tx?: Prisma.TransactionClient
}): Promise<{ revoked: number }> {
  const db = scopedPrisma(input.companyId)
  const client = input.tx ?? db
  const dedupeKey = `${input.event}:${input.reference}`
  // deleteMany e não delete: sem crédito a apagar isto é um no-op, não um
  // P2025 — o call site é best-effort, igual ao de `awardXp`.
  const existing = await db.xpTransaction.findFirst({
    where: { userId: input.userId, dedupeKey },
    select: { id: true, amount: true },
  })
  if (!existing) return { revoked: 0 }
  const { count } = await client.xpTransaction.deleteMany({
    where: { id: existing.id, userId: input.userId, companyId: input.companyId },
  })
  return { revoked: count > 0 ? existing.amount : 0 }
}

/** Total acumulado: soma do livro-razão, sem coluna materializada. */
export async function getXpPoints(userId: string, companyId: string): Promise<number> {
  const result = await scopedPrisma(companyId).xpTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  })
  return result._sum.amount ?? 0
}

/** Carteira de XP: total e o nível derivado dele. */
export async function getXpBalance(
  userId: string,
  companyId: string,
): Promise<{ points: number; level: XpLevelInfo }> {
  const points = await getXpPoints(userId, companyId)
  return { points, level: computeLevel(points) }
}

/**
 * Total de XP de várias pessoas de uma vez, em UMA query.
 *
 * Existe para telas de lista (time do líder, perfil) não caírem em N+1 — sem
 * isto, um time de 30 pessoas viraria 30 agregações.
 *
 * `window` limita o total ao intervalo de dias civis informado (`day` é
 * `@db.Date`, então o recorte é por dia, nunca por instante). Sem ele, o
 * resultado é o acumulado de sempre.
 */
export async function getXpPointsForUsers(
  userIds: string[],
  companyId: string,
  window?: { gte: Date; lt: Date },
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map()
  const rows = await scopedPrisma(companyId).xpTransaction.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds }, ...(window ? { day: window } : {}) },
    _sum: { amount: true },
  })
  const totals = new Map<string, number>(userIds.map((id) => [id, 0]))
  for (const row of rows) totals.set(row.userId, row._sum.amount ?? 0)
  return totals
}

export interface XpLedgerFilters {
  page: number
  pageSize: number
  event?: XpEvent
}

export async function listXpTransactions(
  userId: string,
  companyId: string,
  filters: XpLedgerFilters,
): Promise<{ entries: Prisma.XpTransactionGetPayload<Record<string, never>>[]; total: number }> {
  const db = scopedPrisma(companyId)
  const where: Prisma.XpTransactionWhereInput = {
    userId,
    ...(filters.event ? { event: filters.event } : {}),
  }
  const [entries, total] = await Promise.all([
    db.xpTransaction.findMany({
      where,
      // Desempate por `id` pelo mesmo motivo do extrato de coins: `createdAt` é
      // timestamp(3), e dois lançamentos do mesmo milissegundo empatariam,
      // deixando a paginação instável.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.xpTransaction.count({ where }),
  ])
  return { entries, total }
}

/** Regras ativas — alimenta o Manual do Game. */
export function listActiveXpRules(companyId: string): Promise<XpRule[]> {
  return scopedPrisma(companyId).xpRule.findMany({
    where: { active: true },
    orderBy: { event: 'asc' },
  })
}
