import { describe, it, expect, afterEach, vi } from 'vitest'
import { appBaseUrl, absoluteUrl } from './app-url'

afterEach(() => vi.unstubAllEnvs())

describe('app-url', () => {
  it('appBaseUrl usa o default e remove barra final', () => {
    vi.stubEnv('APP_BASE_URL', 'https://exemplo.test/')
    expect(appBaseUrl()).toBe('https://exemplo.test')
  })

  it('absoluteUrl concatena path relativo à base', () => {
    vi.stubEnv('APP_BASE_URL', 'https://exemplo.test')
    expect(absoluteUrl('/perfil/123')).toBe('https://exemplo.test/perfil/123')
  })

  it('absoluteUrl com path nulo retorna a base', () => {
    vi.stubEnv('APP_BASE_URL', 'https://exemplo.test')
    expect(absoluteUrl(null)).toBe('https://exemplo.test')
  })
})
