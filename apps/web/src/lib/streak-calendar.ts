export interface GridDay {
  ymd: string
  day: number
  inMonth: boolean
}

/** Dia civil de hoje em America/Sao_Paulo, como "YYYY-MM-DD". */
export function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * Grid 6×7 (42 dias) do mês, com a semana começando no domingo. Inclui os dias
 * adjacentes (inMonth=false). Aritmética em UTC para não depender do fuso do
 * navegador — só comparamos strings YYYY-MM-DD depois.
 */
export function buildMonthGrid(monthRef: string): GridDay[] {
  const first = new Date(`${monthRef}-01T00:00:00.000Z`)
  const startWeekday = first.getUTCDay() // 0=domingo
  const cells: GridDay[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(first)
    d.setUTCDate(1 - startWeekday + i)
    const ymd = d.toISOString().slice(0, 10)
    cells.push({ ymd, day: d.getUTCDate(), inMonth: ymd.slice(0, 7) === monthRef })
  }
  return cells
}

/** Sábado (6) ou domingo (0), por aritmética UTC. */
export function isWeekendYmd(ymd: string): boolean {
  const weekday = new Date(`${ymd}T00:00:00.000Z`).getUTCDay()
  return weekday === 0 || weekday === 6
}

/** Soma `delta` meses ao ref "YYYY-MM". */
export function shiftMonth(monthRef: string, delta: number): string {
  const [year, month] = monthRef.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

export const MONTH_NAMES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
