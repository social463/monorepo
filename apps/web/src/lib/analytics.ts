import type { PublicUser } from '@legends/shared'
import { isWebAnalyticsEventName, type AnalyticsEventMap, type WebAnalyticsEventName } from '@legends/shared'

/**
 * Sink do GA4 no navegador.
 *
 * Não substitui o `useAccessLogPing`: page view continua indo para o
 * `AccessLog`, que é a base do People Analytics e do painel de adoção do
 * super-admin. Este arquivo só espelha o mesmo sinal para o GA4, onde a análise
 * de comportamento e funil acontece.
 *
 * Sem `VITE_GA4_MEASUREMENT_ID` no build, tudo aqui vira no-op silencioso —
 * nenhum script de terceiro é carregado. É o que permite o código já estar
 * pronto antes de a conta do GA4 existir.
 */

type GtagArgs = [string, ...unknown[]]

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: GtagArgs) => void
  }
}

const MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined

let loaded = false

export function isAnalyticsEnabled(): boolean {
  return Boolean(MEASUREMENT_ID)
}

/**
 * Injeta o `gtag.js` uma única vez.
 *
 * `send_page_view: false` de propósito: o app é uma SPA e o disparo automático
 * só veria a primeira carga. Quem manda page view é o `trackPageView`, na troca
 * de rota, junto do ping que já existe.
 */
export function initAnalytics(): void {
  if (!MEASUREMENT_ID || loaded || typeof document === 'undefined') return
  loaded = true

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`
  document.head.appendChild(script)

  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag(...args: GtagArgs) {
    window.dataLayer?.push(args)
  }
  window.gtag('js', new Date())
  window.gtag('config', MEASUREMENT_ID, { send_page_view: false, anonymize_ip: true })
}

/**
 * Associa a sessão à empresa e ao setor.
 *
 * São **user properties**, que é o que permite segmentar qualquer relatório do
 * GA4 por empresa e setor. Só identificadores saem daqui — nome e e-mail ficam
 * no banco, como no servidor.
 */
export function identifyAnalytics(user: PublicUser | null): void {
  if (!MEASUREMENT_ID || !window.gtag) return

  if (!user) {
    window.gtag('set', { user_id: undefined, user_properties: {} })
    return
  }

  window.gtag('set', { user_id: user.id })
  window.gtag('set', 'user_properties', {
    company_id: user.companyId,
    sector_id: user.sectorId,
    user_role: user.role,
  })
}

/** Page view de SPA. O `path` já vem normalizado, sem query string. */
export function trackPageView(path: string): void {
  if (!MEASUREMENT_ID || !window.gtag) return
  window.gtag('event', 'page_view', { page_path: path })
}

/**
 * Evento de produto disparado pelo front.
 *
 * A checagem contra `WEB_ANALYTICS_EVENT_NAMES` é a mesma regra do servidor:
 * o front não emite evento de domínio (voto, feedback), porque qualquer pessoa
 * com o console aberto poderia inflar a adoção da própria empresa.
 */
export function trackEvent<N extends WebAnalyticsEventName>(name: N, props: AnalyticsEventMap[N]): void {
  if (!MEASUREMENT_ID || !window.gtag) return
  if (!isWebAnalyticsEventName(name)) return
  window.gtag('event', name, props)
}
