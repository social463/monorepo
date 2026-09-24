/**
 * EMR Coins — moeda interna creditada por ação.
 *
 * O CATÁLOGO de eventos é do código (este arquivo + o enum `CoinEvent` do Prisma):
 * cada evento corresponde a um ponto instrumentado numa rota da API. A REGRA
 * (quanto vale, teto, ativa) é dado, com CRUD pelo admin.
 */

export const COIN_EVENTS = [
  'VOTE_CAST',
  'FEEDBACK_PUBLISHED',
  'FEEDBACK_REACTION',
  'MOOD_ANSWERED',
  'CHALLENGE_APPROVED',
  'BADGE_EARNED',
  'COURSE_COMPLETED',
] as const
export type CoinEvent = (typeof COIN_EVENTS)[number]

export const COIN_EVENT_LABELS: Record<CoinEvent, string> = {
  VOTE_CAST: 'Votar no período',
  FEEDBACK_PUBLISHED: 'Publicar um feedback',
  FEEDBACK_REACTION: 'Reagir a um feedback',
  MOOD_ANSWERED: 'Registrar o humor do dia',
  CHALLENGE_APPROVED: 'Desafio aprovado',
  BADGE_EARNED: 'Selo conquistado',
  COURSE_COMPLETED: 'Curso concluído',
}

/** Frase de ajuda por evento — usada no formulário do admin e no "como ganhar". */
export const COIN_EVENT_DESCRIPTIONS: Record<CoinEvent, string> = {
  VOTE_CAST: 'Creditado uma vez por voto registrado no período.',
  FEEDBACK_PUBLISHED: 'Creditado a cada feedback publicado para um colega.',
  FEEDBACK_REACTION: 'Creditado a quem reage; cada emoji num feedback conta uma vez.',
  MOOD_ANSWERED: 'Creditado uma vez por dia, na primeira resposta do humor.',
  CHALLENGE_APPROVED: 'Creditado quando a participação num desafio é aprovada; o valor vem do próprio desafio.',
  BADGE_EARNED: 'Creditado ao conquistar um selo; o valor vem do próprio selo. Paga uma vez por selo.',
  COURSE_COMPLETED: 'Creditado ao concluir um curso; o valor vem do próprio curso. Paga uma vez por curso.',
}

/**
 * Eventos com valor configurável por `CoinRule` — o que o admin escolhe no CRUD
 * de regras. `CHALLENGE_APPROVED` fica de fora de propósito: a recompensa é do
 * desafio, não de uma regra, e `awardFixedCoins` nunca consulta `CoinRule`.
 * Uma regra criada para ele não teria efeito nenhum. `BADGE_EARNED` fica de
 * fora pelo mesmo motivo: o valor é do selo (Documento 4, seção 11.4).
 */
export const COIN_RULE_EVENTS = COIN_EVENTS.filter(
  (event) => event !== 'CHALLENGE_APPROVED' && event !== 'BADGE_EARNED' && event !== 'COURSE_COMPLETED',
)

/** Janela em que o teto da regra é contado (dia civil de America/Sao_Paulo). */
export const COIN_CAP_WINDOWS = ['NONE', 'DAY', 'WEEK', 'MONTH'] as const
export type CoinCapWindow = (typeof COIN_CAP_WINDOWS)[number]

export const COIN_CAP_WINDOW_LABELS: Record<CoinCapWindow, string> = {
  NONE: 'Sem teto',
  DAY: 'Por dia',
  WEEK: 'Por semana',
  MONTH: 'Por mês',
}

export const COIN_TRANSACTION_KINDS = [
  'EARN',
  'MANUAL_CREDIT',
  'MANUAL_DEBIT',
  /** Resgate na loja: amount negativo, dedupeKey `STORE_ORDER:<orderId>`. */
  'SPEND',
  /** Estorno de resgate cancelado: amount positivo, dedupeKey `STORE_REFUND:<orderId>`. */
  'REFUND',
] as const
export type CoinTransactionKind = (typeof COIN_TRANSACTION_KINDS)[number]

export const COIN_TRANSACTION_KIND_LABELS: Record<CoinTransactionKind, string> = {
  EARN: 'Ganho',
  MANUAL_CREDIT: 'Crédito manual',
  MANUAL_DEBIT: 'Débito manual',
  SPEND: 'Resgate na loja',
  REFUND: 'Estorno de resgate',
}

export const COIN_CURRENCY_LABEL = 'EMR Coins'
export const COIN_MIN_AMOUNT = 1
export const COIN_MAX_AMOUNT = 10_000
export const COIN_ADJUSTMENT_REASON_MIN_LENGTH = 3
export const COIN_ADJUSTMENT_REASON_MAX_LENGTH = 280
export const COIN_LEDGER_PAGE_SIZE = 30

export interface CoinRuleDTO {
  id: string
  event: CoinEvent
  amount: number
  capWindow: CoinCapWindow
  /** Teto de coins pagos por esta regra na janela; null quando capWindow = NONE. */
  capAmount: number | null
  active: boolean
  createdAt: string
  updatedAt: string
}

/** O que o colaborador vê no "como ganhar" — só regra ativa, sem metadado de admin. */
export interface CoinRulePublicDTO {
  event: CoinEvent
  amount: number
  capWindow: CoinCapWindow
  capAmount: number | null
}

export interface CoinTransactionDTO {
  id: string
  kind: CoinTransactionKind
  /** Evento do crédito automático; null em ajuste manual. */
  event: CoinEvent | null
  /** Positivo credita, negativo debita. */
  amount: number
  /** Justificativa do ajuste manual; null em crédito automático. */
  reason: string | null
  /** Admin autor do ajuste manual; null em crédito automático. */
  actor: { id: string; name: string } | null
  /** Dia civil em America/Sao_Paulo (YYYY-MM-DD). */
  day: string
  createdAt: string
}

export interface CoinBalanceDTO {
  balance: number
}

export interface CoinLedgerResponse {
  entries: CoinTransactionDTO[]
  total: number
  page: number
  pageSize: number
  balance: number
}

export interface CoinRuleListResponse {
  rules: CoinRuleDTO[]
}

export interface CoinRulePublicListResponse {
  rules: CoinRulePublicDTO[]
}

export interface CreateCoinRuleRequest {
  event: CoinEvent
  amount: number
  capWindow: CoinCapWindow
  capAmount?: number | null
  active?: boolean
}

/** O evento não é editável: junto com a empresa, ele é a identidade da regra. */
export interface UpdateCoinRuleRequest {
  amount?: number
  capWindow?: CoinCapWindow
  capAmount?: number | null
  active?: boolean
}

export interface CreateCoinAdjustmentRequest {
  amount: number
  reason: string
}

export interface CoinAdjustmentResponse {
  transaction: CoinTransactionDTO
  balance: number
}

export interface CoinUserBalanceResponse {
  balance: number
  user: { id: string; name: string }
}

export interface CoinReportRowDTO {
  event: CoinEvent
  /** Regra vigente do evento; null quando a regra foi apagada depois dos créditos. */
  ruleId: string | null
  /** Valor atual da regra vigente; null quando não há regra. */
  amount: number | null
  totalAmount: number
  transactionCount: number
  userCount: number
}

export interface CoinReportDTO {
  rows: CoinReportRowDTO[]
  manual: { creditedAmount: number; debitedAmount: number; transactionCount: number }
  totalAmount: number
  from: string | null
  to: string | null
  sectorId: string | null
}
