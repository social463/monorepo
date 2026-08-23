import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_EVENT_NAMES,
  GA4_LIMITS,
  GA4_RESERVED_PREFIXES,
  WEB_ANALYTICS_EVENT_NAMES,
  isWebAnalyticsEventName,
} from './analytics'

describe('catálogo de eventos', () => {
  it('não repete nome', () => {
    expect(new Set(ANALYTICS_EVENT_NAMES).size).toBe(ANALYTICS_EVENT_NAMES.length)
  })

  // Nome fora do padrão o GA4 descarta sem erro. Evento que some em silêncio é
  // pior que evento que falha, porque o dashboard fica plausível e errado.
  it('usa nome aceito pelo GA4', () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      expect(name, `${name}: só minúsculas, dígitos e _, começando por letra`).toMatch(
        /^[a-z][a-z0-9_]*$/,
      )
      expect(name.length, `${name}: excede ${GA4_LIMITS.eventNameMaxLength} caracteres`).toBeLessThanOrEqual(
        GA4_LIMITS.eventNameMaxLength,
      )
      for (const prefix of GA4_RESERVED_PREFIXES) {
        expect(name.startsWith(prefix), `${name}: prefixo ${prefix} é reservado`).toBe(false)
      }
    }
  })

  it('só expõe ao front eventos que existem no catálogo', () => {
    for (const name of WEB_ANALYTICS_EVENT_NAMES) {
      expect(ANALYTICS_EVENT_NAMES).toContain(name)
    }
  })

  // O front é entrada não confiável: se pudesse emitir `vote_cast`, qualquer
  // pessoa com o console aberto inflaria a adoção da própria empresa.
  it('mantém eventos de domínio fora do alcance do front', () => {
    expect(isWebAnalyticsEventName('page_viewed')).toBe(true)
    expect(isWebAnalyticsEventName('vote_cast')).toBe(false)
    expect(isWebAnalyticsEventName('ai_agent_invoked')).toBe(false)
    expect(isWebAnalyticsEventName('inventado')).toBe(false)
  })
})
