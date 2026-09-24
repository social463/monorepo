/**
 * Calculadora do Todos Pelos 9 — a conta do bônus por cotas.
 *
 * A regra veio de um app à parte que a G&G mandou construir fora do portal
 * (Lovable + Supabase), e é a razão de a seção 14 do Documento 4 ter ficado
 * bloqueada meses: o material estava num `.zip` no Teams. A fórmula abaixo é a
 * daquele app, preservada ao pé da letra — inclusive o 14,33 do CLT e o 365,25
 * do tempo de casa.
 *
 * Toda a matemática mora aqui, em funções puras, e não na página: é conta sobre
 * salário de gente de verdade, e conta assim precisa ser testável sem montar
 * React. O que a página faz é ler o formulário e formatar o resultado.
 */

/** Faixa de atingimento da meta e o bolo que ela libera, em reais. */
export interface BonusTier {
  /** Percentual da meta (ex.: 64.3, 100). */
  percent: number
  /** Valor total distribuído entre todas as cotas da empresa, em reais. */
  pool: number
}

/**
 * Os números do programa. São **da empresa**, não do código: a data-limite e os
 * pools mudam a cada ciclo, e cravá-los aqui obrigaria um deploy para consertar
 * um número — com bônus errado na tela de todo mundo até lá. Vivem num JSON em
 * `AppSetting`, como a marca (ver `bonus-program-service`).
 */
export interface BonusProgramSettings {
  /** Total de cotas da empresa — o denominador do rateio. */
  totalQuotas: number
  /**
   * Data em que o tempo de casa para de contar (AAAA-MM-DD): o fim do ciclo do
   * programa, não "hoje". Todo mundo é medido contra a mesma régua, senão a
   * mesma pessoa veria um número diferente a cada dia.
   */
  deadline: string
  tiers: BonusTier[]
  /**
   * Manual ao qual a calculadora está vinculada (seção 14: "veiculada à página
   * existente do manual"). Nulo = a calculadora existe, mas nenhum manual
   * mostra o atalho para ela. É id, e não slug fixo: o manual é cadastrado pela
   * G&G em produção, e casar por texto quebraria numa renomeação.
   */
  manualId: string | null
}

/** Vínculo empregatício — muda como o salário entra na conta. */
export const BONUS_EMPLOYMENT_TYPES = ['CLT', 'PJ'] as const
export type BonusEmploymentType = (typeof BONUS_EMPLOYMENT_TYPES)[number]

/**
 * Meses de salário que um CLT recebe por ano: 12 + 13º + 14º + ⅓ de férias.
 * O programa usa a média mensal desse total, e não o salário de carteira, para
 * não punir quem é CLT frente a quem é PJ e fatura o bruto.
 */
export const CLT_ANNUAL_SALARY_MONTHS = 14.33

/** Dias do ano usados no tempo de casa — 365,25 absorve o bissexto. */
const DAYS_IN_YEAR = 365.25

/** Divisor do salário na fórmula das cotas. */
const SALARY_DIVISOR = 5

/** Nota mínima e máxima da avaliação de desempenho. */
export const BONUS_SCORE_MIN = 1
export const BONUS_SCORE_MAX = 5

/**
 * Os números da EMR, que valem enquanto a empresa não gravar os dela. São o
 * conteúdo do app original — ficam como PADRÃO, não como verdade cravada, pelo
 * mesmo motivo do modelo de comunicado (ver `campaign-settings-service`).
 */
export const DEFAULT_BONUS_PROGRAM: BonusProgramSettings = {
  totalQuotas: 1_467_033,
  deadline: '2028-12-31',
  tiers: [
    { percent: 64.3, pool: 5_000_000 },
    { percent: 70, pool: 6_000_000 },
    { percent: 80, pool: 7_000_000 },
    { percent: 90, pool: 8_000_000 },
    { percent: 100, pool: 9_000_000 },
  ],
  manualId: null,
}

/**
 * Tempo de casa em anos, da admissão até a data-limite do ciclo.
 *
 * As duas datas são civis (AAAA-MM-DD) e a conta é feita em UTC de propósito:
 * fuso aqui só criaria a chance de a mesma admissão render tempos diferentes
 * conforme quem abre a página.
 *
 * Negativo vira 0 — quem entra depois do fim do ciclo não tem tempo de casa
 * negativo, tem zero.
 */
export function yearsOfService(admissionYmd: string, deadlineYmd: string): number {
  const admission = Date.parse(`${admissionYmd}T00:00:00.000Z`)
  const deadline = Date.parse(`${deadlineYmd}T00:00:00.000Z`)
  if (Number.isNaN(admission) || Number.isNaN(deadline)) return 0
  const days = (deadline - admission) / 86_400_000
  if (days <= 0) return 0
  return Number((days / DAYS_IN_YEAR).toFixed(5))
}

/**
 * O salário que entra na fórmula. CLT vira a média mensal do ano inteiro
 * (13º, 14º e ⅓ de férias diluídos); PJ é o bruto da nota, como está.
 */
export function effectiveSalary(salary: number, employmentType: BonusEmploymentType): number {
  if (!Number.isFinite(salary) || salary <= 0) return 0
  if (employmentType === 'PJ') return salary
  return (salary * CLT_ANNUAL_SALARY_MONTHS) / 12
}

export interface QuotaInput {
  /** Salário JÁ efetivo — passe pelo `effectiveSalary` antes. */
  salary: number
  /** Valor do cargo, informado pela pessoa. */
  positionValue: number
  yearsOfService: number
  /** Avaliação de desempenho, de 1 a 5. */
  performanceScore: number
}

/**
 * Cotas da pessoa: `S/5 × (C + (TC + AD)/2)`.
 *
 * O cargo entra inteiro e o par tempo de casa + desempenho entra pela média —
 * é o que faz o cargo pesar o dobro de cada um dos outros dois na fórmula.
 */
export function calculateQuotas(input: QuotaInput): number {
  const { salary, positionValue, yearsOfService: years, performanceScore } = input
  if (salary <= 0) return 0
  return (salary / SALARY_DIVISOR) * (positionValue + (years + performanceScore) / 2)
}

export interface BonusByTier extends BonusTier {
  /** Quanto a pessoa recebe se a empresa fechar nesta meta, em reais. */
  amount: number
}

/**
 * Rateio: a fatia da pessoa no bolo de cada meta, proporcional às cotas dela
 * sobre o total da empresa.
 *
 * Total de cotas zerado devolve 0 em vez de dividir por zero — a empresa que
 * ainda não configurou o programa vê zero, não `Infinity`.
 */
export function calculateBonusByTier(quotas: number, settings: BonusProgramSettings): BonusByTier[] {
  const share = settings.totalQuotas > 0 ? quotas / settings.totalQuotas : 0
  return settings.tiers.map((tier) => ({ ...tier, amount: share * tier.pool }))
}

/** "R$ 1.234,56". */
export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}
