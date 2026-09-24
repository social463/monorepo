/**
 * Programação anual de férias — regras compartilhadas.
 *
 * Spec: docs/superpowers/specs/2026-08-25-programacao-anual-de-ferias-design.md
 *
 * Tudo aqui é função pura sobre **data civil** (`YYYY-MM-DD`): nenhum `Date`,
 * nenhum fuso. É o mesmo motivo de `Vacation.startDate` ser `@db.Date` — férias
 * são dias do calendário, não instantes, e o gestor que abre o portal de outro
 * fuso não pode ver o período deslocar um dia.
 *
 * Mora no shared porque as MESMAS regras rodam nos dois lados: o formulário
 * mostra o erro enquanto a pessoa digita, e o servidor recusa de novo ao salvar.
 * Duas implementações divergiriam, e a que perde é sempre a do servidor — que é
 * justamente a que decide.
 */

// ---------------------------------------------------------------------------
// Datas civis
// ---------------------------------------------------------------------------

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

function parts(ymd: string): [number, number, number] {
  const m = YMD.exec(ymd)
  if (!m) throw new Error(`Data civil inválida: ${ymd}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function pad(n: number, size = 2): string {
  return String(n).padStart(size, '0')
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Dias desde 1970-01-01 — só para somar e subtrair, nunca exposto. */
function toEpochDay(ymd: string): number {
  const [y, m, d] = parts(ymd)
  // Algoritmo civil de Howard Hinnant: aritmética inteira, sem Date nem fuso.
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function fromEpochDay(z: number): string {
  const zz = z + 719468
  const era = Math.floor(zz / 146097)
  const doe = zz - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`
}

export function addCivilDays(ymd: string, days: number): string {
  return fromEpochDay(toEpochDay(ymd) + days)
}

export function civilDaysBetween(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from)
}

/**
 * Soma meses **grampeando o dia no fim do mês**: 31/01 + 1 mês = 28/02, e
 * 29/02 + 12 meses = 28/02 do ano seguinte.
 *
 * É essa regra que responde a borda do 29/02 no aniversário de admissão — sem
 * ela, quem nasce para a empresa num 29 não tem aniversário em ano comum, e o
 * ciclo aquisitivo dele seria um defeito que só aparece de quatro em quatro
 * anos.
 */
export function addCivilMonths(ymd: string, months: number): string {
  const [y, m, d] = parts(ymd)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${pad(ny, 4)}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`
}

/** 0 = domingo … 6 = sábado, como `Date.getDay`. 1970-01-01 foi quinta (4). */
export function civilWeekday(ymd: string): number {
  return (((toEpochDay(ymd) + 4) % 7) + 7) % 7
}

/** `2026-08-25` → `25/08/2026`. */
export function formatCivilDate(ymd: string | null | undefined): string {
  if (!ymd || !YMD.test(ymd)) return '—'
  const [y, m, d] = parts(ymd)
  return `${pad(d)}/${pad(m)}/${pad(y, 4)}`
}

/** `2027-07-14` → `2027-07`. Agrupa o informativo de coincidência no mês. */
export function civilMonthOf(ymd: string): string {
  return ymd.slice(0, 7)
}

// ---------------------------------------------------------------------------
// Política da campanha
// ---------------------------------------------------------------------------

/**
 * Uma das formas permitidas de dividir os dias.
 *
 * `days` é o descanso de cada período e `soldDays` o abono correspondente —
 * paralelos, mesmo tamanho. A venda é **propriedade da combinação**, e não uma
 * conta sobre o saldo: a ferramenta antiga calculava `saldo / 3`, o que só dava
 * os 10 de sempre porque o saldo era 30.
 */
export interface VacationSplitOption {
  id: string
  label: string
  description: string
  days: number[]
  soldDays: number[]
}

/**
 * Regime de contratação, para efeito de férias.
 *
 * PJ não é terceirizado (`THIRD_PARTY`, que é acesso restrito por allowlist):
 * é membro pleno do time, com contrato diferente. Sem esta distinção, o PJ
 * recebe o padrão da CLT — 30 dias e as cinco combinações — que não é o dele.
 */
export const EMPLOYMENT_TYPES = ['CLT', 'PJ'] as const
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  CLT: 'CLT',
  PJ: 'PJ',
}

/**
 * O padrão de férias do PJ.
 *
 * Nada aqui é lei: é contrato. Por isso as regras da CLT que sobreviveram no
 * núcleo do código — começar de segunda a quinta, não começar em feriado, a
 * véspera de dois dias — **não se aplicam**, e a divisão é livre: o combinado
 * é entre a pessoa e o líder direto, não entre a empresa e a legislação.
 *
 * O que fica é o prazo: os dias pertencem a um ciclo e precisam ser usados
 * dentro dele, senão o saldo acumula sem fim.
 */
export interface VacationPjPolicy {
  balanceDays: number
  /** Divide como quiser — não há combinação fechada. */
  freeSplit: boolean
  applyWeekdayRule: boolean
  applyHolidayRule: boolean
}

export interface VacationPolicy {
  /** O padrão do PJ. Ausente em campanha antiga: o preset preenche. */
  pj: VacationPjPolicy
  /** As únicas divisões aceitas para quem tem o saldo cheio. */
  splits: VacationSplitOption[]
  /** Dias da semana em que as férias podem começar (0 = domingo). */
  allowedStartWeekdays: number[]
  /** Feriado a até N dias do início escolhido dispara a exceção legal. */
  holidayLookaheadDays: number
  /** Nessa exceção, o início deve cair N dias antes do feriado. */
  holidayEveDays: number
  /** Nenhum período da campanha começa antes desta data. */
  minStartDate: string
  /** Antecedência mínima do aviso de férias. Abaixo disso é aviso, não erro. */
  noticeDays: number
  /**
   * Margem da EMPRESA sobre o período concessivo. A CLT dá 12 meses depois do
   * fim do aquisitivo; a EMR exige que as férias TERMINEM dentro de 11. O mês
   * de diferença é folga deliberada — por isso mora aqui, e não no núcleo de
   * regras legais: outra empresa pode ter margem diferente, ou nenhuma.
   */
  grantMarginMonths: number
}

/** As cinco combinações da EMR. Deliberação interna — ver o spec. */
export const EMR_VACATION_SPLITS: VacationSplitOption[] = [
  {
    id: '20v10',
    label: '20 dias, vendendo 10',
    description: 'Um único período de 20 dias de descanso + 10 dias vendidos (abono).',
    days: [20],
    soldDays: [10],
  },
  {
    id: '10x2v5',
    label: '10 + 10, vendendo 5 em cada',
    description: 'Dois períodos de 10 dias de descanso, vendendo 5 dias em cada um (10 no total).',
    days: [10, 10],
    soldDays: [5, 5],
  },
  {
    id: '15e15',
    label: '15 e 15',
    description: 'Dois períodos iguais de 15 dias, sem venda de dias.',
    days: [15, 15],
    soldDays: [0, 0],
  },
  {
    id: '20e10',
    label: '20 e 10',
    description: 'Um período de 20 dias e outro de 10 dias, sem venda de dias.',
    days: [20, 10],
    soldDays: [0, 0],
  },
  {
    id: '30',
    label: '30 dias corridos',
    description: 'Férias inteiras de uma só vez.',
    days: [30],
    soldDays: [0],
  },
]

export const EMR_VACATION_POLICY: VacationPolicy = {
  pj: { balanceDays: 20, freeSplit: true, applyWeekdayRule: false, applyHolidayRule: false },
  splits: EMR_VACATION_SPLITS,
  // Segunda a quinta.
  allowedStartWeekdays: [1, 2, 3, 4],
  holidayLookaheadDays: 3,
  holidayEveDays: 2,
  minStartDate: '2026-10-01',
  noticeDays: 30,
  grantMarginMonths: 1,
}

/** Saldo cheio de um período aquisitivo completo. */
export const FULL_VACATION_BALANCE = 30

/**
 * Combinações disponíveis para um saldo.
 *
 * Saldo quebrado — de quem já gozou parte deste aquisitivo — não escolhe: o
 * restante vai num período único, sem venda. É o que a ferramenta da G&G já
 * fazia, e vale para 7 das 112 linhas de hoje.
 */
export function splitsForBalance(
  policy: VacationPolicy,
  balanceDays: number,
  employmentType: EmploymentType = 'CLT',
): VacationSplitOption[] {
  // PJ divide como quiser: oferecer combinação fechada seria impor à pessoa uma
  // regra que não é do contrato dela.
  if (employmentType === 'PJ' && policy.pj.freeSplit) return []
  if (balanceDays >= FULL_VACATION_BALANCE) return policy.splits
  return [
    {
      id: 'restante-unico',
      label: `${balanceDays} dias de uma só vez`,
      description: `Este colaborador já tirou um período. Os ${balanceDays} dias restantes precisam ser programados de uma única vez, sem nova divisão.`,
      days: [balanceDays],
      soldDays: [0],
    },
  ]
}

/** A combinação que corresponde ao que está preenchido, ou null. */
export function matchSplit(
  policy: VacationPolicy,
  balanceDays: number,
  periods: readonly PlannedPeriod[],
): VacationSplitOption | null {
  const days = periods.filter((p) => p.days > 0).map((p) => p.days)
  return (
    splitsForBalance(policy, balanceDays).find(
      (s) => s.days.length === days.length && s.days.every((d, i) => d === days[i]),
    ) ?? null
  )
}

// ---------------------------------------------------------------------------
// Derivação do direito
// ---------------------------------------------------------------------------

/**
 * Fim do período aquisitivo do ciclo N a partir da data-base.
 *
 * Ciclo 1 é `data-base + 12 meses − 1 dia`; do segundo em diante mantém dia e
 * mês, avançando o ano — que é como a G&G descreveu e como as 112 linhas da
 * planilha se comportam, do 1º ao 7º ciclo.
 *
 * A data-base é a admissão (`User.joinedAt`), exceto para quem teve o ciclo
 * interrompido por afastamento acima de 180 dias — aí é a data de volta, e
 * grava-se **uma vez** em `User.vacationAnchorDate`. Guardar a exceção como
 * correção do ciclo obrigaria o DP a corrigir aquela pessoa todo ano: a
 * interrupção não desloca um ciclo, desloca todos os seguintes.
 */
export function acquisitionEndFor(anchorDate: string, cycle: number): string {
  if (cycle < 1) throw new Error('O ciclo aquisitivo começa em 1.')
  return addCivilDays(addCivilMonths(anchorDate, 12 * cycle), -1)
}

export function acquisitionStartFor(anchorDate: string, cycle: number): string {
  return cycle === 1 ? anchorDate : addCivilDays(acquisitionEndFor(anchorDate, cycle - 1), 1)
}

/**
 * Data limite para as férias **terminarem**.
 *
 * Período concessivo legal (12 meses) menos a margem da empresa. Não é prazo
 * legal, e a tela precisa dizer isso: chamar de lei o que é decisão da G&G faz
 * quem precisa de uma semana a mais desistir de pedir.
 */
export function dueDateFor(acquisitionEnd: string, policy: VacationPolicy): string {
  return addCivilMonths(acquisitionEnd, 12 - policy.grantMarginMonths)
}

/** Ciclos com direito vencido ou vencendo que ainda não foram gozados. */
export function acquisitionCyclesOpenAt(anchorDate: string, referenceDate: string): number[] {
  const cycles: number[] = []
  for (let cycle = 1; cycle <= 60; cycle += 1) {
    const end = acquisitionEndFor(anchorDate, cycle)
    // Ciclo aberto é o que já se completou e ainda não passou do concessivo.
    if (end <= referenceDate) cycles.push(cycle)
    if (end > referenceDate) break
  }
  return cycles
}

// ---------------------------------------------------------------------------
// Regras de data
// ---------------------------------------------------------------------------

/** Último dia do período: inclusivo nas duas pontas. */
export function periodEndDate(startDate: string, days: number): string | null {
  if (!startDate || days <= 0) return null
  return addCivilDays(startDate, days - 1)
}

/** O feriado que começa até `holidayLookaheadDays` depois do início escolhido. */
export function holidayNear(
  startDate: string,
  holidays: ReadonlyMap<string, string>,
  policy: VacationPolicy,
): { date: string; name: string } | null {
  for (let i = 0; i <= policy.holidayLookaheadDays; i += 1) {
    const day = addCivilDays(startDate, i)
    const name = holidays.get(day)
    if (name) return { date: day, name }
  }
  return null
}

/** A data em que o início é permitido por causa de um feriado próximo. */
export function holidayEveStart(holidayDate: string, policy: VacationPolicy): string {
  return addCivilDays(holidayDate, -policy.holidayEveDays)
}

/**
 * Regra da empresa: as férias começam de segunda a quinta e nunca em feriado.
 * Exceção: havendo feriado próximo, o início pode (e deve) ocorrer 2 dias antes
 * dele, ainda que caia em sexta, sábado ou domingo.
 *
 * Devolve a mensagem de erro, ou null quando a data é permitida.
 */
export function blockedStartReason(
  startDate: string,
  holidays: ReadonlyMap<string, string>,
  policy: VacationPolicy,
): string | null {
  if (!startDate) return null

  const onHoliday = holidays.get(startDate)
  if (onHoliday) {
    return `As férias não podem começar em ${formatCivilDate(startDate)}: é feriado (${onHoliday}).`
  }

  if (policy.allowedStartWeekdays.includes(civilWeekday(startDate))) return null

  const near = holidayNear(startDate, holidays, policy)
  if (near && holidayEveStart(near.date, policy) === startDate) return null

  const nomes = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
  return `As férias não podem começar em ${nomes[civilWeekday(startDate)]} (${formatCivilDate(startDate)}). Escolha um dia entre segunda e quinta-feira — ou, havendo feriado próximo, exatamente ${policy.holidayEveDays} dias antes do feriado.`
}

/** Aviso quando há feriado perto e o início não caiu na véspera correta. */
export function holidayEveHint(
  startDate: string,
  holidays: ReadonlyMap<string, string>,
  policy: VacationPolicy,
): string | null {
  if (!startDate) return null
  const near = holidayNear(startDate, holidays, policy)
  if (!near) return null
  const suggested = holidayEveStart(near.date, policy)
  if (suggested === startDate) return null
  return `Há o feriado de ${near.name} em ${formatCivilDate(near.date)} perto do início escolhido. Nesse caso o início deve ocorrer ${policy.holidayEveDays} dias antes do feriado: ${formatCivilDate(suggested)}.`
}

// ---------------------------------------------------------------------------
// Validação do plano
// ---------------------------------------------------------------------------

export interface PlannedPeriod {
  startDate: string
  days: number
}

export type VacationPlanValidationStatus = 'vazio' | 'erro' | 'atencao' | 'ok'

export interface VacationPlanValidation {
  status: VacationPlanValidationStatus
  /** Impedem salvar como confirmado. */
  errors: string[]
  /** Aparecem, mas não travam. */
  warnings: string[]
  daysUsed: number
  soldDays: number
  daysLeft: number
}

export interface ValidateVacationPlanInput {
  policy: VacationPolicy
  /** Saldo do direito, em dias. */
  balanceDays: number
  /** Fim do período aquisitivo — as férias começam depois dele. */
  acquisitionEnd: string
  /** Data em que as férias precisam terminar. */
  dueDate: string
  periods: readonly PlannedPeriod[]
  /** Feriados da empresa (`YYYY-MM-DD` → nome), do calendário. */
  holidays: ReadonlyMap<string, string>
  /** Hoje, para a antecedência mínima do aviso. */
  today: string
  /** Regime do contrato. Ausente é CLT — o caso da esmagadora maioria. */
  employmentType?: EmploymentType
}

/** Primeiro dia que este direito aceita: o maior entre a abertura e o aquisitivo. */
export function earliestStartFor(acquisitionEnd: string, policy: VacationPolicy): string {
  const afterAcquisition = addCivilDays(acquisitionEnd, 1)
  return afterAcquisition > policy.minStartDate ? afterAcquisition : policy.minStartDate
}

/** Abono correspondente a cada período preenchido, na ordem em que aparecem. */
export function soldDaysPerPeriod(
  policy: VacationPolicy,
  balanceDays: number,
  periods: readonly PlannedPeriod[],
  employmentType: EmploymentType = 'CLT',
): number[] {
  if (employmentType === 'PJ') return periods.map(() => 0)
  const split = matchSplit(policy, balanceDays, periods)
  if (!split) return periods.map(() => 0)
  let i = -1
  return periods.map((p) => {
    if (p.days <= 0) return 0
    i += 1
    return split.soldDays[i] ?? 0
  })
}

export function validateVacationPlan(input: ValidateVacationPlanInput): VacationPlanValidation {
  const { policy, balanceDays, acquisitionEnd, dueDate, holidays, today } = input
  const ehPJ = input.employmentType === 'PJ'
  const errors: string[] = []
  const warnings: string[] = []

  const filled = input.periods.filter((p) => p.startDate && p.days > 0)
  const daysUsed = filled.reduce((sum, p) => sum + p.days, 0)
  // Venda de dias é abono, instituto da CLT: o PJ não vende nada, e por isso
  // não passa nem pela busca de combinação.
  const split = ehPJ ? null : matchSplit(policy, balanceDays, input.periods)
  const soldDays = split ? split.soldDays.reduce((a, b) => a + b, 0) : 0
  const forRest = balanceDays - soldDays

  // Saldo zerado não pede nada — são 15 das 112 linhas de hoje. Sem este ramo,
  // essas pessoas ficariam eternamente pendentes na barra de progresso.
  if (balanceDays <= 0) {
    return { status: 'ok', errors, warnings, daysUsed: 0, soldDays: 0, daysLeft: 0 }
  }

  if (filled.length === 0) {
    return { status: 'vazio', errors, warnings, daysUsed: 0, soldDays: 0, daysLeft: balanceDays }
  }

  if (!split && !ehPJ) {
    errors.push(
      balanceDays < FULL_VACATION_BALANCE
        ? `Este colaborador já tirou um período de férias. O saldo restante (${balanceDays} dias) precisa ser programado em um único período, sem divisão.`
        : 'Escolha uma das combinações permitidas pela empresa.',
    )
  }

  if (daysUsed > forRest) {
    errors.push(
      `A soma dos dias (${daysUsed}) passou do saldo disponível para descanso (${forRest} dias).`,
    )
  } else if (daysUsed < forRest) {
    warnings.push(`Ainda faltam programar ${forRest - daysUsed} dia(s) de férias.`)
  }

  const earliest = earliestStartFor(acquisitionEnd, policy)
  const ordered = [...filled].sort((a, b) => a.startDate.localeCompare(b.startDate))

  ordered.forEach((p, i) => {
    const end = periodEndDate(p.startDate, p.days)

    if (p.startDate < earliest) {
      errors.push(
        `As férias não podem começar em ${formatCivilDate(p.startDate)}. O primeiro dia permitido para este colaborador é ${formatCivilDate(earliest)}.`,
      )
    }
    if (end && end > dueDate) {
      errors.push(
        `O período que começa em ${formatCivilDate(p.startDate)} termina depois da data limite (${formatCivilDate(dueDate)}).`,
      )
    }

    // Dia da semana e feriado são regra da CLT. Para o PJ elas não valem, e
    // impô-las transformaria um combinado entre duas pessoas numa exigência da
    // empresa que o contrato dele não tem.
    if (!ehPJ || policy.pj.applyWeekdayRule) {
      const blocked = blockedStartReason(p.startDate, holidays, policy)
      if (blocked) errors.push(blocked)
    }
    if (!ehPJ || policy.pj.applyHolidayRule) {
      const hint = holidayEveHint(p.startDate, holidays, policy)
      if (hint) warnings.push(hint)
    }

    // Antecedência do aviso de férias: é alerta, não impedimento — quem programa
    // em cima da hora precisa saber, mas quem decide é a G&G.
    if (civilDaysBetween(today, p.startDate) < policy.noticeDays) {
      warnings.push(
        `O início em ${formatCivilDate(p.startDate)} está a menos de ${policy.noticeDays} dias — o aviso de férias precisa ser entregue com ${policy.noticeDays} dias de antecedência.`,
      )
    }

    const next = ordered[i + 1]
    if (next && end && next.startDate <= end) {
      errors.push('Existem períodos com datas sobrepostas.')
    }
  })

  const unique = (list: string[]) => [...new Set(list)]
  return {
    status: errors.length ? 'erro' : warnings.length ? 'atencao' : 'ok',
    errors: unique(errors),
    warnings: unique(warnings),
    daysUsed,
    soldDays,
    daysLeft: Math.max(0, forRest - daysUsed),
  }
}

/**
 * Meses em que mais de uma pessoa do time sai de férias.
 *
 * **Informativo, nunca impedimento.** A G&G foi explícita: não há limite, e quem
 * avalia a cobertura da área é o gestor. Por isso o resultado não entra em
 * `errors` nem em `warnings` da validação — se entrasse junto, viraria trava por
 * acidente na primeira vez que alguém somasse as listas.
 */
export interface TeamMonthOverlap {
  month: string
  userIds: string[]
}

export function teamMonthOverlaps(
  entries: readonly { userId: string; startDate: string; endDate: string }[],
): TeamMonthOverlap[] {
  const byMonth = new Map<string, Set<string>>()
  for (const entry of entries) {
    // Um período que atravessa o mês conta nos dois — quem sai em 28/07 e volta
    // em 10/08 está fora nos dois meses, e é isso que interessa ao gestor.
    let cursor = entry.startDate
    while (cursor <= entry.endDate) {
      const month = civilMonthOf(cursor)
      if (!byMonth.has(month)) byMonth.set(month, new Set())
      byMonth.get(month)!.add(entry.userId)
      const [y, m] = parts(cursor)
      cursor = addCivilMonths(`${pad(y, 4)}-${pad(m)}-01`, 1)
    }
  }
  return [...byMonth.entries()]
    .filter(([, users]) => users.size > 1)
    .map(([month, users]) => ({ month, userIds: [...users].sort() }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

// ---------------------------------------------------------------------------
// Contrato api ⇄ web
// ---------------------------------------------------------------------------

export const VACATION_PLAN_STATUSES = ['DRAFT', 'CONFIRMED', 'VALIDATED'] as const
export type VacationPlanStatus = (typeof VACATION_PLAN_STATUSES)[number]

export const VACATION_PLAN_STATUS_LABELS: Record<VacationPlanStatus, string> = {
  DRAFT: 'Em preenchimento',
  CONFIRMED: 'Confirmado pelo gestor',
  VALIDATED: 'Validado pelo DP',
}

export const VACATION_PLAN_NOTE_MAX_LENGTH = 2000
export const VACATION_CAMPAIGN_NOTICE_MAX_LENGTH = 2000
export const MAX_VACATION_PLAN_PERIODS = 4

export interface VacationCampaignDTO {
  id: string
  year: number
  opensAt: string
  deadline: string
  manuallyLocked: boolean
  /** Já passou do prazo (ou está bloqueada à mão)? Calculado no servidor. */
  locked: boolean
  policy: VacationPolicy
  noticeTemplate: string
}

export interface VacationEntitlementDTO {
  id: string
  /** Regime do contrato: decide o padrão de férias que a tela oferece. */
  employmentType: EmploymentType
  acquisitionStart: string
  acquisitionEnd: string
  dueDate: string
  balanceDays: number
  note: string | null
  /** Quantos dias faltam para o limite de gozo — ordena a lista do gestor. */
  daysToDueDate: number
}

export interface VacationPlanPeriodDTO {
  startDate: string
  endDate: string
  days: number
  soldDays: number
}

/** Uma linha da tela do gestor: a pessoa, o direito dela e o plano. */
export interface VacationPlanDTO {
  id: string | null
  user: import('./auth').PublicUser
  entitlement: VacationEntitlementDTO
  periods: VacationPlanPeriodDTO[]
  sellDays: boolean
  note: string | null
  status: VacationPlanStatus
  /** O gestor recusou as datas semeadas e vai propor outras. */
  changeRequested: boolean
  confirmedBy: string | null
  confirmedAt: string | null
  validatedBy: string | null
  validatedAt: string | null
  /** Reabertura pontual concedida pela G&G, depois do prazo. */
  unlockedUntil: string | null
  /**
   * O que a pessoa pediu, quando pediu. Aparece para o gestor ANTES de ele
   * programar — é o ponto do pedido existir.
   */
  request: { periods: { startDate: string; days: number }[]; note: string | null } | null
  /**
   * Períodos já lançados à mão que este plano vai substituir ao ser validado.
   * Aparecem na hora de programar, e não na validação: quem programa precisa
   * saber que está passando por cima de algo que alguém lançou de propósito.
   */
  replacing: { startDate: string; endDate: string; note: string | null }[]
}

export interface VacationPlanningResponse {
  campaign: VacationCampaignDTO | null
  plans: VacationPlanDTO[]
  /** Feriados da empresa na janela da campanha. */
  holidays: { date: string; name: string }[]
  /** Meses em que mais de uma pessoa do time sai — informativo. */
  monthOverlaps: TeamMonthOverlap[]
}

export interface SaveVacationPlanRequest {
  entitlementId: string
  periods: { startDate: string; days: number }[]
  note?: string | null
  changeRequested?: boolean
}

export interface ConfirmVacationPlansRequest {
  entitlementIds: string[]
}

export interface UpsertVacationCampaignRequest {
  year: number
  opensAt: string
  deadline: string
  manuallyLocked?: boolean
  noticeTemplate?: string
}

export interface CorrectVacationEntitlementRequest {
  balanceDays?: number
  acquisitionStart?: string
  acquisitionEnd?: string
  dueDate?: string
  note?: string | null
}

/** Progresso da campanha por área, para a G&G parar de caçar gestor. */
export interface VacationCampaignProgressDTO {
  sectorId: string
  sectorName: string
  total: number
  draft: number
  confirmed: number
  validated: number
  changeRequested: number
}

export interface VacationCampaignOverviewResponse {
  campaign: VacationCampaignDTO | null
  progress: VacationCampaignProgressDTO[]
  /** Planos cujo gestor pediu alteração do que já estava combinado. */
  changeRequests: { userName: string; sectorName: string; managerName: string | null }[]
}

/** Preenche o texto do aviso ao colaborador com o que a campanha sabe. */
export function renderVacationNotice(
  template: string,
  values: { nome: string; periodos: string; ano: number },
): string {
  return template
    .replaceAll('{nome}', values.nome)
    .replaceAll('{periodos}', values.periodos)
    .replaceAll('{ano}', String(values.ano))
}

export const DEFAULT_VACATION_NOTICE_TEMPLATE =
  'Olá, {nome}! Sua programação de férias de {ano} foi validada pelo Departamento Pessoal: {periodos}. ' +
  'O aviso e o recibo de férias seguem sendo enviados pela Contabilidade para assinatura.'

// ---------------------------------------------------------------------------
// O lado do colaborador
// ---------------------------------------------------------------------------

export const VACATION_REQUEST_NOTE_MAX_LENGTH = 500

/**
 * Antecedências, em dias, do lembrete de prazo ao gestor.
 *
 * Três e não uma: uma cobrança só, muito antes, é esquecida; muito perto, não
 * dá tempo de conversar com a equipe. Zero é o último dia, que é quando quem
 * empurrou até o fim ainda pode resolver.
 */
export const VACATION_DEADLINE_REMINDER_DAYS = [15, 7, 0] as const

/**
 * O que a pessoa **pediu**, antes de o gestor programar.
 *
 * Pedido, não promessa — e a tela diz isso com essas palavras. Quem decide é o
 * gestor, que precisa cobrir a área; prometer o contrário criaria uma
 * expectativa que o produto não tem como honrar.
 */
export interface VacationRequestDTO {
  periods: { startDate: string; days: number }[]
  note: string | null
  updatedAt: string
}

/** O que a própria pessoa vê sobre as férias dela. */
export interface MyVacationEntitlementDTO {
  entitlement: VacationEntitlementDTO
  /** O que já foi programado para ela, quando houver. */
  plan: {
    periods: VacationPlanPeriodDTO[]
    status: VacationPlanStatus
    validatedAt: string | null
  } | null
  request: VacationRequestDTO | null
}

export interface MyVacationPlanningResponse {
  campaign: VacationCampaignDTO | null
  items: MyVacationEntitlementDTO[]
}

export interface SaveVacationRequestRequest {
  entitlementId: string
  periods: { startDate: string; days: number }[]
  note?: string | null
}
