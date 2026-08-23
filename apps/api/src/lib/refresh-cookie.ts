// O path '/api/auth' precisa casar com o prefixo /api visto pelo navegador
// (o front sempre chama /api/auth/...); senão o cookie não é enviado no refresh.
export const REFRESH_COOKIE = 'legends.refresh'

export function refreshCookieOptions(persistent: boolean, expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/api/auth',
    ...(persistent ? { expires: expiresAt } : {}),
  }
}

export function clearRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/api/auth',
  }
}
