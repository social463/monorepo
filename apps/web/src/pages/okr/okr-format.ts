/** "2027-12-31" → "31/12/2027". Data de calendário: nada de `Date`, que traz fuso. */
export function formatYmd(ymd: string): string {
  const [year, month, day] = ymd.split('-')
  return `${day}/${month}/${year}`
}

/** "12,5", "12.5" e "1.250,50" valem; vazio é nulo; o resto é NaN. */
export function parseDecimal(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed
  const value = Number(normalized)
  return Number.isFinite(value) ? value : NaN
}

/** Página de uma meta (objetivo). */
export const okrObjectivePath = (id: string) => `/metas/objetivo/${id}`
