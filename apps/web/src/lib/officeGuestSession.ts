import type { OfficeGuestSessionDTO } from '@legends/shared'

const STORAGE_KEY = 'office:guest-session'

export function readOfficeGuestSession(): OfficeGuestSessionDTO | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as OfficeGuestSessionDTO
    if (!session.token || new Date(session.expiresAt).getTime() <= Date.now()) {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    return session
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function saveOfficeGuestSession(session: OfficeGuestSessionDTO): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  window.dispatchEvent(new Event('office-guest-session-changed'))
}

export function clearOfficeGuestSession(): void {
  sessionStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event('office-guest-session-changed'))
}
