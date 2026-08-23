import type { AnalyticsEventMap, AnalyticsEventName, AnalyticsTenantContext } from '@legends/shared'
import type { FastifyRequest } from 'fastify'
import { createAnalyticsClientFromEnv, type AnalyticsClient } from './index'

/**
 * Cliente único do processo, como o `prisma`. Sem chave do GA4 configurada ele
 * já nasce só com o sink do Postgres.
 */
export const analytics: AnalyticsClient = createAnalyticsClientFromEnv()

/** String vazia é ausência: o convidado do escritório vem com `sectorId: ''`. */
function orNull(value: string | undefined | null): string | null {
  return value && value.length > 0 ? value : null
}

/**
 * Extrai empresa, setor e pessoa do JWT já verificado.
 *
 * É um helper por call site, e não um hook global: o repo não usa `addHook` em
 * lugar nenhum (auth é sempre por rota), e um `onRequest` global rodaria também
 * nas rotas públicas — antes de existir `request.user` —, produzindo evento sem
 * empresa justo onde a dimensão mais importa.
 */
export function analyticsContextFrom(request: FastifyRequest): AnalyticsTenantContext {
  const user = request.user as
    | { sub?: string; role?: string; sectorId?: string; companyId?: string }
    | undefined

  return {
    userId: orNull(user?.sub),
    companyId: orNull(user?.companyId),
    sectorId: orNull(user?.sectorId),
    role: orNull(user?.role),
  }
}

/**
 * Registra um evento no contexto da request. Não é `await`-ável de propósito —
 * ver `createAnalyticsClient`.
 */
export function captureFor<N extends AnalyticsEventName>(
  request: FastifyRequest,
  name: N,
  props: AnalyticsEventMap[N],
): void {
  analytics.capture(name, props, analyticsContextFrom(request))
}
