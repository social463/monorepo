import { createHash } from 'node:crypto'
import { GA4_LIMITS, type AnalyticsEvent } from '@legends/shared'
import type { Ga4Config } from '../config'
import type { AnalyticsSink } from './types'

/** Nome de user property: 24 caracteres. Valor: 36. Menores que os de evento. */
const USER_PROPERTY_VALUE_MAX_LENGTH = 36

/** O GA4 descarta evento com mais de 72h. Ver `buildGa4Payload`. */
const BACKDATE_LIMIT_MS = 72 * 60 * 60 * 1000

/**
 * `client_id` é obrigatório e o servidor não tem o cookie `_ga` do navegador.
 * Derivamos um valor estável por pessoa, para que sessões diferentes do mesmo
 * usuário não virem usuários distintos na contagem. É um hash do id — não dá
 * para voltar dele ao usuário sem o banco.
 *
 * O formato imita o `_ga` (`<n>.<n>`) porque é o que o GA4 espera; valor fora
 * do padrão é aceito mas atribui de forma imprevisível.
 */
export function deriveClientId(userId: string | null): string {
  const digest = createHash('sha256').update(userId ?? 'anonimo').digest('hex')
  const left = BigInt(`0x${digest.slice(0, 8)}`).toString()
  const right = BigInt(`0x${digest.slice(8, 16)}`).toString()
  return `${left}.${right}`
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

/**
 * Converte as props do evento em parâmetros do GA4, respeitando os tetos.
 *
 * Corta em vez de rejeitar: parâmetro fora do limite faz o GA4 descartar o
 * evento **inteiro**, em silêncio. Perder um parâmetro truncado é melhor que
 * perder o evento e não saber.
 */
function toEventParams(props: Record<string, unknown>): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue
    if (Object.keys(params).length >= GA4_LIMITS.paramsPerEvent) break

    const name = truncate(key, GA4_LIMITS.paramKeyMaxLength)
    params[name] =
      typeof value === 'string'
        ? truncate(value, GA4_LIMITS.paramValueMaxLength)
        : (value as number | boolean)
  }
  return params
}

export interface Ga4Payload {
  client_id: string
  user_id?: string
  timestamp_micros?: string
  non_personalized_ads: boolean
  events: Array<{ name: string; params: Record<string, string | number | boolean> }>
  user_properties: Record<string, { value: string }>
}

/**
 * Monta o corpo do Measurement Protocol.
 *
 * `companyId` e `sectorId` vão como **user properties**, não como parâmetro de
 * evento: no GA4 é isso que permite segmentar qualquer relatório por empresa e
 * setor sem repetir a dimensão em cada evento. Cabem folgado nas 25 permitidas.
 *
 * Só identificador sai daqui — nada de nome, e-mail ou texto escrito por
 * pessoa. É a decisão de pseudonimização do projeto, e o que mantém dado de
 * colaborador fora de servidor de terceiro sob a LGPD.
 */
export function buildGa4Payload(event: AnalyticsEvent, now: number = Date.now()): Ga4Payload {
  const { context } = event
  const userProperties: Record<string, { value: string }> = {}
  if (context.companyId) {
    userProperties.company_id = { value: truncate(context.companyId, USER_PROPERTY_VALUE_MAX_LENGTH) }
  }
  if (context.sectorId) {
    userProperties.sector_id = { value: truncate(context.sectorId, USER_PROPERTY_VALUE_MAX_LENGTH) }
  }
  if (context.role) {
    userProperties.user_role = { value: truncate(context.role, USER_PROPERTY_VALUE_MAX_LENGTH) }
  }

  const payload: Ga4Payload = {
    client_id: deriveClientId(context.userId),
    // `non_personalized_ads`: isto é telemetria de produto interno, nunca
    // audiência de anúncio.
    non_personalized_ads: true,
    events: [{ name: event.name, params: toEventParams(event.props) }],
    user_properties: userProperties,
  }

  if (context.userId) {
    payload.user_id = context.userId
  }

  // Só mandamos `timestamp_micros` quando o evento ainda está na janela de 72h.
  // Fora dela o GA4 descarta o evento inteiro; omitir o campo faz ele usar a
  // hora da ingestão — a hora fica errada, mas o evento sobrevive, o que
  // importa mais para contagem de adoção.
  const occurredAt = new Date(event.occurredAt).getTime()
  if (Number.isFinite(occurredAt) && now - occurredAt < BACKDATE_LIMIT_MS && occurredAt <= now) {
    payload.timestamp_micros = String(occurredAt * 1000)
  }

  return payload
}

export function createGa4Sink(config: Ga4Config): AnalyticsSink {
  const url = `${config.endpoint}?measurement_id=${encodeURIComponent(config.measurementId)}&api_secret=${encodeURIComponent(config.apiSecret)}`

  return {
    name: 'ga4',
    async send(event: AnalyticsEvent) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGa4Payload(event)),
      })

      // Fora do modo debug o GA4 responde 204 mesmo para payload inválido — ele
      // nunca diz que descartou. Por isso o `/debug/mp/collect` existe e por
      // isso os limites acima são tratados aqui, e não descobertos em produção.
      if (!response.ok) {
        throw new Error(`GA4 respondeu ${response.status}`)
      }
    },
  }
}
