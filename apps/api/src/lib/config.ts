import { createHash } from 'node:crypto'

export function resolveJwtSecret(env: { NODE_ENV?: string; JWT_SECRET?: string }): string {
  if (env.JWT_SECRET) {
    return env.JWT_SECRET
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET é obrigatório em produção')
  }
  return 'dev-secret-change-me'
}

export interface LivekitConfig {
  apiKey: string
  apiSecret: string
  /** URL que os NAVEGADORES usam para conectar (dev: ws://localhost:7880). */
  url: string
}

export function resolveLivekitConfig(env: {
  NODE_ENV?: string
  LIVEKIT_API_KEY?: string
  LIVEKIT_API_SECRET?: string
  LIVEKIT_URL?: string
}): LivekitConfig {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = env
  if (LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_URL) {
    return { apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET, url: LIVEKIT_URL }
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('LIVEKIT_API_KEY, LIVEKIT_API_SECRET e LIVEKIT_URL são obrigatórios em produção')
  }
  // Defaults do container `livekit-server --dev`
  return {
    apiKey: LIVEKIT_API_KEY ?? 'devkey',
    apiSecret: LIVEKIT_API_SECRET ?? 'secret',
    url: LIVEKIT_URL ?? 'ws://localhost:7880',
  }
}

/**
 * Chave de 32 bytes usada para cifrar segredos em repouso (credenciais OAuth de
 * calendário e tokens de conexão). Mesmo padrão do JWT_SECRET: obrigatória em
 * produção, derivada de um valor fixo em desenvolvimento.
 */
export function resolveCalendarEncryptionKey(env: {
  NODE_ENV?: string
  CALENDAR_ENCRYPTION_KEY?: string
}): Buffer {
  if (env.CALENDAR_ENCRYPTION_KEY) {
    const key = Buffer.from(env.CALENDAR_ENCRYPTION_KEY, 'base64')
    if (key.length !== 32) {
      throw new Error('CALENDAR_ENCRYPTION_KEY deve ser 32 bytes em base64')
    }
    return key
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('CALENDAR_ENCRYPTION_KEY é obrigatório em produção')
  }
  return createHash('sha256').update('dev-calendar-key-change-me').digest()
}

/**
 * Domínio sob o qual cada empresa ganha um subdomínio — `emr.<host do app>` →
 * `Company.slug = 'emr'`. É o que o `GET /branding` público usa para saber de
 * quem é a marca antes de existir login.
 *
 * Sai do **`APP_BASE_URL`**, que já existe, em vez de uma variável só para isto.
 * Precisa vir de algum lugar porque não dá para adivinhar onde termina o
 * subdomínio e começa o domínio: `legends.com.br` e `emr.legends.com.br` têm o
 * mesmo número de rótulos, e só o primeiro é o produto.
 *
 * A consequência é que os tenants moram **sob o host do app**. Se um dia o
 * domínio dos clientes divergir do domínio do produto, aí sim entra um env
 * próprio — enquanto forem o mesmo, ele seria uma segunda fonte de verdade para
 * o mesmo valor.
 *
 * Sem `APP_BASE_URL` (desenvolvimento), devolve `null`: nenhuma empresa resolve
 * por host e todo mundo vê a marca do produto. O `?slug=` continua funcionando.
 */
export function resolveBrandingBaseDomain(env: { APP_BASE_URL?: string }): string | null {
  if (!env.APP_BASE_URL) return null
  try {
    return new URL(env.APP_BASE_URL).hostname.toLowerCase()
  } catch {
    return null
  }
}

export interface Ga4Config {
  measurementId: string
  apiSecret: string
  /** Endpoint do Measurement Protocol; sobrescrito nos testes. */
  endpoint: string
  /** Manda para `/debug/mp/collect`, que valida o payload e não grava nada. */
  debug: boolean
}

/**
 * Configuração do GA4 (Measurement Protocol, server-side).
 *
 * Devolve `null` quando não está configurado, e **não** lança em produção — ao
 * contrário de `JWT_SECRET` e `CALENDAR_ENCRYPTION_KEY`. Analytics é acessório:
 * derrubar o boot da API porque falta uma chave de métrica trocaria uma perda
 * de dado por uma indisponibilidade. Sem chave, o sink some e o Postgres, que é
 * a fonte de verdade do painel, continua gravando.
 */
export function resolveGa4Config(env: {
  GA4_MEASUREMENT_ID?: string
  GA4_API_SECRET?: string
  GA4_DEBUG?: string
}): Ga4Config | null {
  const measurementId = env.GA4_MEASUREMENT_ID?.trim()
  const apiSecret = env.GA4_API_SECRET?.trim()
  if (!measurementId || !apiSecret) return null

  const debug = env.GA4_DEBUG === 'true'
  return {
    measurementId,
    apiSecret,
    endpoint: debug
      ? 'https://www.google-analytics.com/debug/mp/collect'
      : 'https://www.google-analytics.com/mp/collect',
    debug,
  }
}

/**
 * Hosts aceitos como origem de painel de RH embutido. Repetidos no `frame-src`
 * do CSP em `nginx/default.conf` — mexeu aqui, mexa lá.
 */
const HR_DASHBOARD_DEFAULT_ALLOWED_HOSTS = [
  'app.powerbi.com',
  'lookerstudio.google.com',
  'datastudio.google.com',
]

export function resolveHrDashboardAllowedHosts(env: { HR_DASHBOARD_ALLOWED_HOSTS?: string }): string[] {
  const configured = (env.HR_DASHBOARD_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0)
  return configured.length > 0 ? configured : [...HR_DASHBOARD_DEFAULT_ALLOWED_HOSTS]
}
