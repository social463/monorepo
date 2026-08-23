import type { AnalyticsEvent, AnalyticsTenantContext } from '@legends/shared'
import { describe, expect, it, vi } from 'vitest'
import { resolveGa4Config } from '../config'
import { buildGa4Payload, deriveClientId } from './ga4-sink'
import { createAnalyticsClient } from './index'
import type { AnalyticsSink } from './types'

const context: AnalyticsTenantContext = {
  userId: 'user-1',
  companyId: 'company-acme',
  sectorId: 'sector-dev-produto',
  role: 'LEGEND',
}

function recordingSink(name: string): AnalyticsSink & { events: AnalyticsEvent[] } {
  const events: AnalyticsEvent[] = []
  return {
    name,
    events,
    async send(event) {
      events.push(event)
    },
  }
}

describe('createAnalyticsClient', () => {
  it('entrega o evento a todos os sinks', async () => {
    const a = recordingSink('a')
    const b = recordingSink('b')
    const client = createAnalyticsClient([a, b])

    client.capture('vote_cast', { categoryId: 'cat-1', periodId: 'per-1', justificationLength: 42 }, context)
    await client.flush()

    expect(a.events).toHaveLength(1)
    expect(b.events).toHaveLength(1)
    expect(a.events[0]?.name).toBe('vote_cast')
    expect(a.events[0]?.context.companyId).toBe('company-acme')
    expect(a.events[0]?.source).toBe('api')
  })

  // O motivo de o sink do GA4 ser separado do Postgres: o Google fora do ar não
  // pode apagar o painel do super-admin.
  it('isola falha de um sink dos demais', async () => {
    const quebrado: AnalyticsSink = {
      name: 'quebrado',
      async send() {
        throw new Error('502')
      },
    }
    const bom = recordingSink('bom')
    const onError = vi.fn()
    const client = createAnalyticsClient([quebrado, bom], onError)

    client.capture('user_logged_in', { method: 'password' }, context)
    await client.flush()

    expect(bom.events).toHaveLength(1)
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toContain('quebrado')
  })

  it('não propaga erro para o call site', async () => {
    const client = createAnalyticsClient(
      [
        {
          name: 'quebrado',
          async send() {
            throw new Error('falhou')
          },
        },
      ],
      () => {},
    )

    expect(() => client.capture('user_logged_out', {}, context)).not.toThrow()
    await expect(client.flush()).resolves.toBeUndefined()
  })

  it('vira no-op sem sink configurado', async () => {
    const client = createAnalyticsClient([])
    expect(() => client.capture('manifesto_viewed', {}, context)).not.toThrow()
    expect(client.sinkNames).toEqual([])
  })
})

describe('resolveGa4Config', () => {
  it('devolve null sem chave, inclusive em produção', () => {
    expect(resolveGa4Config({})).toBeNull()
    expect(resolveGa4Config({ GA4_MEASUREMENT_ID: 'G-123' })).toBeNull()
    expect(resolveGa4Config({ GA4_API_SECRET: 'segredo' })).toBeNull()
  })

  it('aponta para o endpoint de debug quando pedido', () => {
    const config = resolveGa4Config({ GA4_MEASUREMENT_ID: 'G-123', GA4_API_SECRET: 's', GA4_DEBUG: 'true' })
    expect(config?.endpoint).toContain('/debug/mp/collect')
  })
})

describe('buildGa4Payload', () => {
  const evento = (over: Partial<AnalyticsEvent> = {}): AnalyticsEvent =>
    ({
      name: 'vote_cast',
      props: { categoryId: 'cat-1', periodId: 'per-1', justificationLength: 42 },
      context,
      source: 'api',
      occurredAt: new Date('2026-08-11T12:00:00.000Z').toISOString(),
      ...over,
    }) as AnalyticsEvent

  it('manda empresa e setor como user properties', () => {
    const payload = buildGa4Payload(evento(), new Date('2026-08-11T12:00:10.000Z').getTime())

    expect(payload.user_properties.company_id).toEqual({ value: 'company-acme' })
    expect(payload.user_properties.sector_id).toEqual({ value: 'sector-dev-produto' })
    expect(payload.user_properties.user_role).toEqual({ value: 'LEGEND' })
    expect(payload.events[0]?.name).toBe('vote_cast')
    expect(payload.events[0]?.params).toEqual({
      categoryId: 'cat-1',
      periodId: 'per-1',
      justificationLength: 42,
    })
  })

  it('deriva client_id estável por usuário e não reversível', () => {
    const primeiro = deriveClientId('user-1')
    expect(deriveClientId('user-1')).toBe(primeiro)
    expect(deriveClientId('user-2')).not.toBe(primeiro)
    expect(primeiro).not.toContain('user-1')
    expect(primeiro).toMatch(/^\d+\.\d+$/)
  })

  // O GA4 descarta o evento inteiro se o timestamp passar de 72h. Preferimos a
  // hora errada ao evento perdido.
  it('omite timestamp fora da janela de 72h em vez de perder o evento', () => {
    const agora = new Date('2026-08-11T12:00:00.000Z').getTime()

    const recente = buildGa4Payload(
      evento({ occurredAt: new Date(agora - 60 * 60 * 1000).toISOString() }),
      agora,
    )
    expect(recente.timestamp_micros).toBeDefined()

    const antigo = buildGa4Payload(
      evento({ occurredAt: new Date(agora - 80 * 60 * 60 * 1000).toISOString() }),
      agora,
    )
    expect(antigo.timestamp_micros).toBeUndefined()
    expect(antigo.events).toHaveLength(1)
  })

  it('corta valor acima do teto em vez de deixar o GA4 descartar o evento', () => {
    const longo = 'x'.repeat(250)
    const payload = buildGa4Payload(
      evento({ props: { categoryId: longo, periodId: 'per-1', justificationLength: 0 } }),
      new Date('2026-08-11T12:00:10.000Z').getTime(),
    )

    expect(payload.events[0]?.params.categoryId).toHaveLength(100)
  })

  it('não emite user_id nem propriedades quando o contexto vem vazio', () => {
    const payload = buildGa4Payload(
      evento({ context: { userId: null, companyId: null, sectorId: null, role: null } }),
      new Date('2026-08-11T12:00:10.000Z').getTime(),
    )

    expect(payload.user_id).toBeUndefined()
    expect(payload.user_properties).toEqual({})
    expect(payload.client_id).toMatch(/^\d+\.\d+$/)
  })
})
