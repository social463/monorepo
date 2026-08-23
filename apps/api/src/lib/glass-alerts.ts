import {
  GLASS_ALERT_RULES,
  GLASS_CRITICAL_KEYWORDS,
  GLASS_KEYWORD_ALERTS,
  type GlassAggregateAlertDTO,
  type GlassAlertKey,
  type GlassKeywordGroup,
} from '@legends/shared'

/**
 * Alertas do GlassAgent. **Regra determinística em código, nunca no prompt.**
 * Um alerta que depende do humor do modelo não é alerta: dispara em uma leitura
 * e não na seguinte, para o mesmo dado.
 *
 * São duas famílias, e a diferença não é estilística:
 *
 * - **Por avaliação** — dependem só da linha. Calculadas na gravação e
 *   guardadas em `GlassReview.alerts`.
 * - **Agregadas** — dependem das avaliações vizinhas. Calculadas na leitura, em
 *   `glass-overview-service`. Gravá-las na linha faria a coluna mentir sobre
 *   registros antigos assim que uma avaliação nova chegasse.
 */

export interface GlassReviewFacts {
  rating: number | null
  status: string | null
  title: string | null
  positives: string | null
  negatives: string | null
  advice: string | null
}

export interface GlassAggregateRow {
  rating: number | null
  sector: string | null
  reviewDate: Date | null
}

/** Minúsculas, sem acento, espaço colapsado — o mesmo formato das constantes. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Casamento com fronteira de palavra, não substring: "assediado" casa,
 * "assessoria" não. `\b` do JS não serve porque a fronteira precisa considerar
 * dígitos e acentos já removidos — a classe explícita é mais previsível.
 */
function containsKeyword(haystack: string, keyword: string): boolean {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`)
  return pattern.test(haystack)
}

/** Alertas que dependem só desta avaliação. */
export function reviewAlerts(facts: GlassReviewFacts): GlassAlertKey[] {
  const alerts = new Set<GlassAlertKey>()

  // Nota baixa de quem AINDA está na casa é o alerta que dá tempo de agir; de
  // ex-funcionário é diagnóstico do passado. Por isso o status entra na regra.
  if (facts.rating !== null && facts.rating <= GLASS_ALERT_RULES.lowRatingMax && facts.status === 'ATIVO') {
    alerts.add('NOTA_BAIXA_ATIVO')
  }

  const haystack = normalizeForMatch(
    [facts.title, facts.positives, facts.negatives, facts.advice].filter(Boolean).join(' \n '),
  )

  if (haystack) {
    for (const [group, keywords] of Object.entries(GLASS_CRITICAL_KEYWORDS) as [
      GlassKeywordGroup,
      readonly string[],
    ][]) {
      if (keywords.some((keyword) => containsKeyword(haystack, keyword))) {
        alerts.add(GLASS_KEYWORD_ALERTS[group])
      }
    }
  }

  return [...alerts]
}

/**
 * Alertas que só existem olhando o conjunto. Recebem as linhas **já filtradas
 * pelo escopo de empresa** — esta função não sabe consultar banco de propósito.
 */
export function aggregateAlerts(rows: GlassAggregateRow[]): GlassAggregateAlertDTO[] {
  const alerts: GlassAggregateAlertDTO[] = []
  const rated = rows.filter((row): row is GlassAggregateRow & { rating: number } => row.rating !== null)

  // --- Queda consecutiva ---
  // A leitura acionável é "está acontecendo agora": as N mais recentes, todas
  // abaixo da média geral. Avaliação sem data fica fora — não há onde encaixá-la
  // na série — mas continua contando para a média.
  const dated = rated
    .filter((row): row is GlassAggregateRow & { rating: number; reviewDate: Date } => row.reviewDate !== null)
    .sort((a, b) => b.reviewDate.getTime() - a.reviewDate.getTime())

  const needed = GLASS_ALERT_RULES.consecutiveBelowAverage
  if (rated.length > 0 && dated.length >= needed) {
    const average = rated.reduce((sum, row) => sum + row.rating, 0) / rated.length
    if (dated.slice(0, needed).every((row) => row.rating < average)) {
      alerts.push({ key: 'QUEDA_CONSECUTIVA', count: needed })
    }
  }

  // --- Setor crítico ---
  const lowBySector = new Map<string, number>()
  for (const row of rated) {
    if (!row.sector) continue
    if (row.rating >= GLASS_ALERT_RULES.sectorLowRatingCutoff) continue
    lowBySector.set(row.sector, (lowBySector.get(row.sector) ?? 0) + 1)
  }
  for (const [sector, count] of [...lowBySector].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (count >= GLASS_ALERT_RULES.sectorMinLowReviews) {
      alerts.push({ key: 'SETOR_CRITICO', scope: sector, count })
    }
  }

  return alerts
}
