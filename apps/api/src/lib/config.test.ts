import { describe, it, expect } from 'vitest'
import {
  resolveJwtSecret,
  resolveLivekitConfig,
  resolveHrDashboardAllowedHosts,
  resolveBrandingBaseDomain,
} from './config'

describe('resolveJwtSecret', () => {
  it('returns the provided secret when set', () => {
    expect(resolveJwtSecret({ JWT_SECRET: 'abc', NODE_ENV: 'production' })).toBe('abc')
  })

  it('throws in production when the secret is missing', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production' })).toThrow()
  })

  it('falls back to a dev secret outside production', () => {
    expect(resolveJwtSecret({ NODE_ENV: 'development' })).toBe('dev-secret-change-me')
    expect(resolveJwtSecret({})).toBe('dev-secret-change-me')
  })
})

describe('resolveLivekitConfig', () => {
  it('returns the explicit values when all three are set', () => {
    const config = resolveLivekitConfig({
      LIVEKIT_API_KEY: 'my-key',
      LIVEKIT_API_SECRET: 'my-secret',
      LIVEKIT_URL: 'wss://livekit.example.com',
      NODE_ENV: 'production',
    })
    expect(config).toEqual({
      apiKey: 'my-key',
      apiSecret: 'my-secret',
      url: 'wss://livekit.example.com',
    })
  })

  it('returns dev defaults when unset outside production', () => {
    const configDev = resolveLivekitConfig({ NODE_ENV: 'development' })
    expect(configDev).toEqual({
      apiKey: 'devkey',
      apiSecret: 'secret',
      url: 'ws://localhost:7880',
    })
    const configEmpty = resolveLivekitConfig({})
    expect(configEmpty).toEqual({
      apiKey: 'devkey',
      apiSecret: 'secret',
      url: 'ws://localhost:7880',
    })
  })

  it('throws in production when any required env var is missing', () => {
    expect(() => resolveLivekitConfig({ NODE_ENV: 'production' })).toThrow()
    expect(() =>
      resolveLivekitConfig({
        NODE_ENV: 'production',
        LIVEKIT_API_KEY: 'key',
      }),
    ).toThrow()
    expect(() =>
      resolveLivekitConfig({
        NODE_ENV: 'production',
        LIVEKIT_API_KEY: 'key',
        LIVEKIT_API_SECRET: 'secret',
      }),
    ).toThrow()
  })
})

describe('resolveHrDashboardAllowedHosts', () => {
  it('usa a lista padrão quando a env está ausente', () => {
    expect(resolveHrDashboardAllowedHosts({})).toEqual([
      'app.powerbi.com',
      'lookerstudio.google.com',
      'datastudio.google.com',
    ])
  })

  it('usa a lista padrão quando a env está vazia', () => {
    expect(resolveHrDashboardAllowedHosts({ HR_DASHBOARD_ALLOWED_HOSTS: '  ,  ' })).toEqual([
      'app.powerbi.com',
      'lookerstudio.google.com',
      'datastudio.google.com',
    ])
  })

  it('lê a env, normaliza para minúsculas e ignora espaços', () => {
    expect(
      resolveHrDashboardAllowedHosts({ HR_DASHBOARD_ALLOWED_HOSTS: ' App.PowerBI.com , metabase.emr.local ' }),
    ).toEqual(['app.powerbi.com', 'metabase.emr.local'])
  })
})

describe('resolveBrandingBaseDomain', () => {
  it('sai do host do APP_BASE_URL — não existe env própria para isto', () => {
    expect(resolveBrandingBaseDomain({ APP_BASE_URL: 'https://legends.com.br' })).toBe('legends.com.br')
    expect(resolveBrandingBaseDomain({ APP_BASE_URL: 'https://Legends.EuMedicoResidente.com.br/app' })).toBe(
      'legends.eumedicoresidente.com.br',
    )
  })

  it('sem APP_BASE_URL, ninguém resolve por host — e nada quebra', () => {
    // Desenvolvimento: a marca cai no padrão do produto e o `?slug=` assume.
    expect(resolveBrandingBaseDomain({})).toBeNull()
  })

  it('URL inválida não derruba o endpoint público', () => {
    expect(resolveBrandingBaseDomain({ APP_BASE_URL: 'não é url' })).toBeNull()
  })
})
