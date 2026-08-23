/** "Hoje" / "Amanhã" / "Em N dias", a partir de `daysUntil` (0 = hoje). */
export function relativeDayLabel(daysUntil: number): string {
  if (daysUntil <= 0) return 'Hoje'
  if (daysUntil === 1) return 'Amanhã'
  return `Em ${daysUntil} dias`
}

/** `YYYY-MM-DD` → `dd/mm/aaaa`. */
export function formatObservedDate(observedDate: string): string {
  const [year, month, day] = observedDate.split('-')
  return `${day}/${month}/${year}`
}
