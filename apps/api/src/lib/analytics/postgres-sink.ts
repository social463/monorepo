import type { AnalyticsEvent } from '@legends/shared'
import { prisma } from '../prisma'
import type { AnalyticsSink } from './types'

/**
 * Fonte de verdade do painel de adoção do super-admin.
 *
 * Grava com `prisma` cru, e não com `scopedPrisma`: `companyId` já vem
 * resolvido do JWT no contexto do evento, e o escopo aqui é justamente o que
 * está sendo registrado. O model está em `TENANT_SCOPED_MODELS`, então quem
 * gravar por engano dentro de um `scopedPrisma` de outra empresa esbarra no
 * `TenantScopeError` em vez de contaminar o painel em silêncio.
 *
 * Evento sem empresa é descartado: um registro com `companyId` chutado é pior
 * que registro nenhum, porque some no meio do agregado de quem não pediu.
 */
export function createPostgresSink(): AnalyticsSink {
  return {
    name: 'postgres',
    async send(event: AnalyticsEvent) {
      if (!event.context.companyId) return

      await prisma.analyticsEvent.create({
        data: {
          name: event.name,
          userId: event.context.userId,
          sectorId: event.context.sectorId,
          companyId: event.context.companyId,
          source: event.source,
          props: event.props as object,
          occurredAt: new Date(event.occurredAt),
        },
      })
    },
  }
}
