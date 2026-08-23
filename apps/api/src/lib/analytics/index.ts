import type {
  AnalyticsEvent,
  AnalyticsEventMap,
  AnalyticsEventName,
  AnalyticsSource,
  AnalyticsTenantContext,
} from '@legends/shared'
import { resolveGa4Config } from '../config'
import { createGa4Sink } from './ga4-sink'
import { createPostgresSink } from './postgres-sink'
import type { AnalyticsSink } from './types'

export type { AnalyticsSink } from './types'
export { buildGa4Payload, deriveClientId } from './ga4-sink'

export interface AnalyticsClient {
  capture<N extends AnalyticsEventName>(
    name: N,
    props: AnalyticsEventMap[N],
    context: AnalyticsTenantContext,
    source?: AnalyticsSource,
  ): void
  /** Espera os envios em voo. Só para teste — produção é fire-and-forget. */
  flush(): Promise<void>
  readonly sinkNames: string[]
}

/**
 * Cliente de analytics.
 *
 * Duas garantias, e as duas existem porque telemetria não pode custar mais que
 * o que mede:
 *
 * 1. **`capture` não é `await`-ável.** Retorna `void` de propósito. Se
 *    devolvesse Promise, um call site distraído colocaria um `await` antes de
 *    responder a request e a latência do GA4 viraria latência do produto.
 * 2. **Sink que falha não contamina os outros.** Cada envio é isolado; o GA4
 *    fora do ar não impede o Postgres de gravar, que é a fonte do painel.
 *
 * Erro nunca sobe: é logado e engolido, igual ao `useAccessLogPing` no front e
 * à avaliação de selos pós-voto — telemetria perdida, nunca request derrubada.
 */
export function createAnalyticsClient(
  sinks: AnalyticsSink[],
  onError: (message: string) => void = (message) => console.warn(message),
): AnalyticsClient {
  const inFlight = new Set<Promise<void>>()

  function capture<N extends AnalyticsEventName>(
    name: N,
    props: AnalyticsEventMap[N],
    context: AnalyticsTenantContext,
    source: AnalyticsSource = 'api',
  ): void {
    if (sinks.length === 0) return

    const event: AnalyticsEvent<N> = {
      name,
      props,
      context,
      source,
      occurredAt: new Date().toISOString(),
    }

    for (const sink of sinks) {
      const pending = sink
        .send(event as AnalyticsEvent)
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error)
          onError(`[analytics] sink ${sink.name} falhou em ${name}: ${detail}`)
        })
        .finally(() => {
          inFlight.delete(pending)
        })
      inFlight.add(pending)
    }
  }

  return {
    capture,
    async flush() {
      await Promise.allSettled([...inFlight])
    },
    get sinkNames() {
      return sinks.map((sink) => sink.name)
    },
  }
}

/**
 * Monta o cliente a partir do ambiente.
 *
 * O Postgres entra sempre — é a fonte de verdade do painel do super-admin e não
 * depende de chave nenhuma. O GA4 só entra se estiver configurado; sem chave,
 * a lista fica com um sink e nada quebra. É o que permite o código já estar
 * pronto antes de a conta do GA4 existir.
 */
export function createAnalyticsClientFromEnv(env: NodeJS.ProcessEnv = process.env): AnalyticsClient {
  const sinks: AnalyticsSink[] = [createPostgresSink()]

  const ga4 = resolveGa4Config(env)
  if (ga4) {
    sinks.push(createGa4Sink(ga4))
  }

  return createAnalyticsClient(sinks)
}
