import type { AnalyticsEvent } from '@legends/shared'

/**
 * Destino de eventos. Cada sink é independente: um falhar não impede os outros
 * (ver `createAnalyticsClient`).
 */
export interface AnalyticsSink {
  /** Aparece no log quando o envio falha. */
  readonly name: string
  send(event: AnalyticsEvent): Promise<void>
}
