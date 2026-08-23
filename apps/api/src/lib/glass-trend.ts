import type { GlassTrendPointDTO } from '@legends/shared'

/**
 * Série mensal das notas. Função pura, e a bucketização acontece **em memória**
 * de propósito: a alternativa natural seria um `date_trunc` em `$queryRaw`, mas
 * SQL literal escapa da extensão de isolamento (`lib/tenant-scope.ts`) — o
 * relatório de uma empresa passaria a somar avaliações de outra, em silêncio.
 *
 * O volume é de centenas de linhas por empresa. Se algum tenant passar de
 * dezenas de milhares, isto vira view materializada; não hoje.
 */

export function roundRating(value: number): number {
  return Math.round(value * 100) / 100
}

/** Média de lista vazia é `null`, não zero: "sem dado" não é "nota zero". */
export function averageOf(values: number[]): number | null {
  if (values.length === 0) return null
  return roundRating(values.reduce((sum, value) => sum + value, 0) / values.length)
}

/** Chave `AAAA-MM` em UTC — o banco guarda a data em UTC. */
function monthKey(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}`
}

export function monthlyTrend(rows: { reviewDate: Date | null; rating: number | null }[]): GlassTrendPointDTO[] {
  const buckets = new Map<string, number[]>()

  for (const row of rows) {
    if (!row.reviewDate || row.rating === null) continue
    const key = monthKey(row.reviewDate)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row.rating)
    else buckets.set(key, [row.rating])
  }

  return [...buckets]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, ratings]) => ({
      month,
      averageRating: averageOf(ratings) ?? 0,
      count: ratings.length,
    }))
}
