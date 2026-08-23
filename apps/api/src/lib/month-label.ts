const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/** "2026-06" -> "Junho de 2026". Espera formato YYYY-MM válido. */
export function monthLabel(monthRef: string): string {
  const [year, month] = monthRef.split('-')
  const name = MONTHS_PT[Number(month) - 1] ?? month
  return `${name} de ${year}`
}

/** "2026-06" -> "Junho". Só o nome do mês, por extenso. */
export function monthName(monthRef: string): string {
  const month = monthRef.split('-')[1]
  return MONTHS_PT[Number(month) - 1] ?? month
}
