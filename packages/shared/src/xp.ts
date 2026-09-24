/**
 * Pontos (XP) e níveis — progressão do colaborador.
 *
 * Vizinho de `coin.ts` e de propósito **não** o mesmo domínio: EMR Coins é saldo
 * (sobe ao ganhar, DESCE ao gastar na loja), XP é acumulado e nunca é debitado.
 * Nível derivado de saldo cairia quando a pessoa comprasse algo — o oposto de
 * progressão. Por isso `XpTransaction` não tem `kind`: só existe ganho.
 *
 * Mesma divisão de responsabilidade dos coins: o CATÁLOGO de eventos é do código
 * (este arquivo + o enum `XpEvent` do Prisma), a REGRA (quanto vale, teto, ativa)
 * é dado, com CRUD pelo admin.
 */

export const XP_EVENTS = [
  'VOTE_CAST',
  'FEEDBACK_PUBLISHED',
  'FEEDBACK_REACTION',
  'MOOD_ANSWERED',
  'CHALLENGE_APPROVED',
  'CORPORATE_POST_REACTION',
  'CORPORATE_POST_COMMENT',
  'CORPORATE_POST_READ_FULL',
  'BADGE_EARNED',
  'COURSE_COMPLETED',
] as const
export type XpEvent = (typeof XP_EVENTS)[number]

export const XP_EVENT_LABELS: Record<XpEvent, string> = {
  VOTE_CAST: 'Votar no período',
  FEEDBACK_PUBLISHED: 'Publicar um feedback',
  FEEDBACK_REACTION: 'Reagir a um feedback',
  MOOD_ANSWERED: 'Registrar o humor do dia',
  CHALLENGE_APPROVED: 'Desafio aprovado',
  CORPORATE_POST_REACTION: 'Reagir a um comunicado',
  CORPORATE_POST_COMMENT: 'Comentar um comunicado',
  CORPORATE_POST_READ_FULL: 'Ler um comunicado por inteiro',
  BADGE_EARNED: 'Selo conquistado',
  COURSE_COMPLETED: 'Curso concluído',
}

/** Frase de ajuda por evento — formulário do admin e Manual do Game. */
export const XP_EVENT_DESCRIPTIONS: Record<XpEvent, string> = {
  VOTE_CAST: 'Creditado uma vez por voto registrado no período.',
  FEEDBACK_PUBLISHED: 'Creditado a cada feedback publicado para um colega.',
  FEEDBACK_REACTION: 'Creditado a quem reage; cada emoji num feedback conta uma vez.',
  MOOD_ANSWERED: 'Creditado uma vez por dia, na primeira resposta do humor.',
  CHALLENGE_APPROVED: 'Creditado quando a participação num desafio é aprovada.',
  CORPORATE_POST_REACTION: 'Creditado uma vez por comunicado, na primeira reação. Some se a pessoa desfizer todas.',
  CORPORATE_POST_COMMENT: 'Creditado uma vez por comunicado, no primeiro comentário. Some se a pessoa apagar todos.',
  CORPORATE_POST_READ_FULL: 'Creditado ao abrir o conteúdo completo de um comunicado longo.',
  BADGE_EARNED: 'Creditado ao conquistar um selo; o valor vem do próprio selo. Paga uma vez por selo.',
  COURSE_COMPLETED: 'Creditado ao concluir um curso; o valor vem do próprio curso. Paga uma vez por curso.',
}

/**
 * Eventos que **saem do extrato** quando a pessoa desfaz a ação (ver
 * `revokeXp`). É a única forma de tirar XP de alguém: o valor nunca é debitado,
 * a linha é apagada — o comentário do topo deste arquivo explica por quê.
 */
export const XP_REVOCABLE_EVENTS = ['CORPORATE_POST_REACTION', 'CORPORATE_POST_COMMENT'] as const

/**
 * Eventos com valor configurável por `XpRule`. Ao contrário dos coins,
 * `CHALLENGE_APPROVED` ENTRA aqui: a recompensa em coins é do próprio desafio,
 * mas o XP do desafio é um valor só, da empresa — senão cada desafio precisaria
 * cadastrar duas recompensas.
 */
/**
 * `BADGE_EARNED` fica de fora do CRUD de regras: o valor é do selo, e
 * `awardFixedXp` nunca consulta `XpRule` (Documento 4, seção 11.4). Mesma
 * exclusão que `CHALLENGE_APPROVED` já tem do lado dos coins.
 */
export const XP_RULE_EVENTS = XP_EVENTS.filter((event) => event !== 'BADGE_EARNED')

/** Janela em que o teto da regra é contado (dia civil de America/Sao_Paulo). */
export const XP_CAP_WINDOWS = ['NONE', 'DAY', 'WEEK', 'MONTH'] as const

/**
 * Valores com que uma empresa começa a pontuar.
 *
 * Fonte única de `prisma/seed.ts`, do provisionamento de empresa nova e do
 * backfill das antigas. Existia só dentro do seed, que roda em dev e **nunca**
 * em homologação ou produção: as três regras do Feed Corporativo nasceram assim
 * e nunca chegaram a nenhum ambiente publicado, então reagir, comentar e ler um
 * comunicado não pagavam nada — `awardXp` devolve `NO_RULE` quando a linha não
 * existe, e o bloco "Como ganhar pontos" some junto.
 *
 * É **default**, não regra: a empresa muda o que quiser em Administração ›
 * Pontos, e o que ela mudou nunca é sobrescrito.
 */
export interface XpRuleSeed {
  event: XpEvent
  amount: number
  capWindow: XpCapWindow
  capAmount: number | null
}

export const XP_RULE_SEED: readonly XpRuleSeed[] = [
  { event: 'VOTE_CAST', amount: 50, capWindow: 'NONE', capAmount: null },
  // +10 por reconhecimento, até 3 por semana — o pedido da G&G na 2ª rodada.
  { event: 'FEEDBACK_PUBLISHED', amount: 10, capWindow: 'WEEK', capAmount: 30 },
  { event: 'FEEDBACK_REACTION', amount: 5, capWindow: 'DAY', capAmount: 25 },
  { event: 'MOOD_ANSWERED', amount: 10, capWindow: 'NONE', capAmount: null },
  // Diferença deliberada em relação aos coins: o XP do desafio é um valor só,
  // da empresa, e não a recompensa configurada em cada desafio.
  { event: 'CHALLENGE_APPROVED', amount: 100, capWindow: 'NONE', capAmount: null },
  // Feed Corporativo. Os valores (1/2/3) são os que a G&G pediu.
  { event: 'CORPORATE_POST_REACTION', amount: 1, capWindow: 'NONE', capAmount: null },
  { event: 'CORPORATE_POST_COMMENT', amount: 2, capWindow: 'NONE', capAmount: null },
  { event: 'CORPORATE_POST_READ_FULL', amount: 3, capWindow: 'NONE', capAmount: null },
]
export type XpCapWindow = (typeof XP_CAP_WINDOWS)[number]

export const XP_CAP_WINDOW_LABELS: Record<XpCapWindow, string> = {
  NONE: 'Sem teto',
  DAY: 'Por dia',
  WEEK: 'Por semana',
  MONTH: 'Por mês',
}

export const XP_CURRENCY_LABEL = 'Pontos'
export const XP_MIN_AMOUNT = 1
export const XP_MAX_AMOUNT = 10_000
export const XP_LEDGER_PAGE_SIZE = 30

/**
 * Escada de níveis. Os cortes são os mesmos do protótipo do portal de propósito:
 * quem já tem nível lá não muda de nível aqui.
 *
 * `min` é inclusivo e a lista é crescente — `computeLevel` depende das duas
 * coisas. O último degrau é o topo e não tem próximo.
 */
export const XP_LEVELS = [
  { name: 'Bronze', min: 0, color: '#8C5A2B' },
  { name: 'Prata', min: 500, color: '#5F6B7A' },
  { name: 'Ouro', min: 1_500, color: '#8F6A00' },
  { name: 'Platina', min: 3_500, color: '#37697A' },
  { name: 'Diamante', min: 7_500, color: '#6D28D9' },
] as const

export type XpLevelName = (typeof XP_LEVELS)[number]['name']

/**
 * Texto sobre `color`. Fixo em branco, e não um token da marca: a cor do nível
 * é do METAL (bronze, prata, ouro), não da empresa — o Diamante roxo continua
 * roxo num tenant de marca verde, senão "Ouro" mudaria de cor por cliente e o
 * nível deixaria de ser reconhecível.
 *
 * Os tons foram escolhidos escuros o bastante para o branco passar de 4.5:1 em
 * todos os cinco — `xp.test.ts` trava isso.
 */
export const XP_LEVEL_ON_COLOR = '#FFFFFF'

/** A cor do nível de um total de XP — atalho de `computeLevel(points).color`. */
export function levelColor(points: number): string {
  return computeLevel(points).color
}

export interface XpLevelInfo {
  name: XpLevelName
  /** Cor do metal do nível atual (ver XP_LEVELS). */
  color: string
  /** Próximo nível; null no topo da escada. */
  next: XpLevelName | null
  /** XP mínimo do nível atual. */
  min: number
  /** XP mínimo do próximo nível; null no topo. */
  nextMin: number | null
  /** Quanto falta para o próximo nível; 0 no topo. */
  remaining: number
  /** Progresso dentro da faixa atual, 0–100 (inteiro). 100 no topo. */
  progress: number
}

/**
 * Nível de um total de XP. Tolera entrada suja (negativo, fracionário, NaN):
 * o total vem de uma soma do banco e uma tela não pode quebrar por causa dela.
 */
export function computeLevel(points: number): XpLevelInfo {
  const total = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0

  // Último degrau cujo mínimo já foi alcançado. O primeiro tem min 0, então
  // sempre há um índice — não existe "abaixo de Bronze".
  let index = 0
  for (let i = 0; i < XP_LEVELS.length; i += 1) {
    if (total >= XP_LEVELS[i]!.min) index = i
  }

  const current = XP_LEVELS[index]!
  const next = XP_LEVELS[index + 1] ?? null

  if (!next) {
    return {
      name: current.name,
      color: current.color,
      next: null,
      min: current.min,
      nextMin: null,
      remaining: 0,
      progress: 100,
    }
  }

  const span = next.min - current.min
  const progress = Math.min(100, Math.max(0, Math.round(((total - current.min) / span) * 100)))
  return {
    name: current.name,
    color: current.color,
    next: next.name,
    min: current.min,
    nextMin: next.min,
    remaining: next.min - total,
    progress,
  }
}

export interface XpRuleDTO {
  id: string
  event: XpEvent
  amount: number
  capWindow: XpCapWindow
  /** Teto de XP pago por esta regra na janela; null quando capWindow = NONE. */
  capAmount: number | null
  active: boolean
  createdAt: string
  updatedAt: string
}

/** O que o colaborador vê no Manual do Game — só regra ativa, sem metadado de admin. */
export interface XpRulePublicDTO {
  event: XpEvent
  amount: number
  capWindow: XpCapWindow
  capAmount: number | null
}

export interface XpTransactionDTO {
  id: string
  event: XpEvent
  /** Sempre positivo: XP não é debitado. */
  amount: number
  /** Dia civil em America/Sao_Paulo (YYYY-MM-DD). */
  day: string
  createdAt: string
}

/** Carteira de XP do colaborador: total acumulado + nível derivado dele. */
export interface XpBalanceDTO {
  points: number
  level: XpLevelInfo
}

export interface XpLedgerResponse {
  entries: XpTransactionDTO[]
  total: number
  page: number
  pageSize: number
  points: number
}

export interface XpRuleListResponse {
  rules: XpRuleDTO[]
}

export interface XpRulePublicListResponse {
  rules: XpRulePublicDTO[]
}

export interface CreateXpRuleRequest {
  event: XpEvent
  amount: number
  capWindow: XpCapWindow
  capAmount?: number | null
  active?: boolean
}

/** O evento não é editável: junto com a empresa, ele é a identidade da regra. */
export interface UpdateXpRuleRequest {
  amount?: number
  capWindow?: XpCapWindow
  capAmount?: number | null
  active?: boolean
}
