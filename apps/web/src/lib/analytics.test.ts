import { beforeEach, describe, expect, it, vi } from 'vitest'
import { identifyAnalytics, initAnalytics, isAnalyticsEnabled, trackEvent, trackPageView } from './analytics'

/**
 * Este arquivo roda **sem** `VITE_GA4_MEASUREMENT_ID` — que é o estado do
 * projeto hoje, antes de a conta do GA4 existir. O que ele trava é justamente
 * isso: enquanto a chave não chega, nada dispara e nada quebra.
 */
describe('analytics do front, sem chave configurada', () => {
  beforeEach(() => {
    window.gtag = undefined
    window.dataLayer = undefined
    document.head.innerHTML = ''
  })

  it('fica desligado', () => {
    expect(isAnalyticsEnabled()).toBe(false)
  })

  // O ponto: sem chave, nenhum script de terceiro entra na página.
  it('não carrega o gtag.js', () => {
    initAnalytics()
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull()
    expect(window.gtag).toBeUndefined()
  })

  it('não quebra ao identificar, navegar ou registrar evento', () => {
    expect(() =>
      identifyAnalytics({ id: 'u1', companyId: 'c1', sectorId: 's1', role: 'LEGEND' } as never),
    ).not.toThrow()
    expect(() => trackPageView('/perfil')).not.toThrow()
    expect(() => trackEvent('manifesto_viewed', {})).not.toThrow()
  })

  it('não chama o gtag nem quando ele existe na página', () => {
    const gtag = vi.fn()
    window.gtag = gtag

    trackPageView('/inicio')
    trackEvent('manifesto_viewed', {})
    identifyAnalytics(null)

    expect(gtag).not.toHaveBeenCalled()
  })
})
