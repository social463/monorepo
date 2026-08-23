const DEFAULT_APP_BASE_URL = 'https://legends.eumedicoresidente.com.br'

/** Base pública do app (sem barra final). Default em dev/prod sem env. */
export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? DEFAULT_APP_BASE_URL).replace(/\/+$/, '')
}

/** Converte um path relativo (link de notificação) em URL absoluta. */
export function absoluteUrl(path: string | null): string {
  const base = appBaseUrl()
  if (!path) return base
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
}
